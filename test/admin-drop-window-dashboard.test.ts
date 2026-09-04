import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: Record<string, unknown>) => {
    window: Window & typeof globalThis & { close(): void; eval(source: string): unknown };
  };
};

async function eventually(assertion: () => void, attempts = 400): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

function localDateTimeInZone(value: string, timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(value)).filter((part) => part.type !== "literal")
    .map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

test("admin authors, inspects, edits, and cancels a drop window through product pickers", async () => {
  const db = new YoinkDatabase();
  const listing = new CatalogRepository(db).upsertListing({
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId: "drop-window-picker-product",
    sourceListingId: "drop-window-picker-listing",
    title: "Picker Target Product",
    retailerId: "target",
    retailerSku: "95280894",
    canonicalUrl: "https://www.target.com/p/-/A-95280894",
    listingStatus: "in_stock",
    executionSupported: true,
    observedPriceCents: 4499,
    currency: "USD"
  }).listing;
  const webRoot = join(process.cwd(), "apps", "web");
  const server = createYoinkServer({ db, webRoot, version: "admin-drop-window-dashboard-test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const dom = new JSDOM(readFileSync(join(webRoot, "index.html"), "utf8"), {
    url: `${baseUrl}/admin#sources/drops`,
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const browser = dom.window;
  Object.defineProperty(browser, "fetch", {
    configurable: true,
    value: (path: string, options: RequestInit = {}) => fetch(new URL(path, baseUrl), {
      ...options,
      headers: {
        ...(options.method && options.method !== "GET" ? { Origin: baseUrl } : {}),
        ...(options.headers || {})
      }
    })
  });
  Object.defineProperty(browser, "setInterval", { configurable: true, value: () => 1 });
  Object.defineProperty(browser, "scrollTo", { configurable: true, value: () => undefined });
  Object.defineProperty(browser.HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
  Object.defineProperty(browser, "CSS", {
    configurable: true,
    value: { escape: (value: string) => String(value).replace(/[^A-Za-z0-9_-]/g, "\\$&") }
  });
  const dialogPrototype = browser.HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal?: () => void;
    close?: () => void;
  };
  Object.defineProperty(dialogPrototype, "showModal", {
    configurable: true,
    value: function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); }
  });
  Object.defineProperty(dialogPrototype, "close", {
    configurable: true,
    value: function close(this: HTMLDialogElement) { this.removeAttribute("open"); }
  });

  try {
    await browser.eval(`(async () => { ${readFileSync(join(webRoot, "app.js"), "utf8")}\n })()`);
    const search = browser.document.querySelector("#dropWindowProductSearch") as HTMLInputElement;
    search.value = "Picker Target";
    search.dispatchEvent(new browser.Event("input", { bubbles: true }));
    await eventually(() => assert.match(browser.document.querySelector("#dropWindowProductResults")?.textContent ?? "", /Picker Target Product/));
    (browser.document.querySelector("[data-add-drop-window-product]") as HTMLButtonElement).click();
    assert.match(browser.document.querySelector("#dropWindowProductSelection")?.textContent ?? "", /Picker Target Product/);
    assert.equal((browser.document.querySelector("#dropWindowRetailer") as HTMLInputElement).value, "target");
    assert.equal(browser.document.querySelector("#dropWindowStore")?.textContent, "Target");

    const form = browser.document.querySelector("#dropWindowForm") as HTMLFormElement;
    (form.elements.namedItem("title") as HTMLInputElement).value = "Target collector drop";
    const enteredStart = localDateTimeInZone(new Date(Date.now() + 60 * 60_000).toISOString(), "America/New_York");
    (form.elements.namedItem("startsAt") as HTMLInputElement).value = enteredStart;
    (form.elements.namedItem("closesAt") as HTMLInputElement).value = localDateTimeInZone(
      new Date(Date.now() + 3 * 60 * 60_000).toISOString(),
      "America/New_York"
    );
    (form.elements.namedItem("timezone") as HTMLSelectElement).value = "America/New_York";
    (form.elements.namedItem("staggerMinutes") as HTMLInputElement).value = "20";
    (form.elements.namedItem("confidenceBps") as HTMLSelectElement).value = "10000";
    form.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
    await eventually(() => assert.match(
      browser.document.querySelector("#dropWindowList")?.textContent ?? "",
      /Target collector drop/,
      browser.document.querySelector("#toast")?.textContent ?? "Drop window submission did not complete."
    ));
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM drop_windows")?.count, 1);
    const storedWindow = db.get<{ startsAt: string; timezone: string }>(
      "SELECT starts_at AS startsAt, timezone FROM drop_windows"
    );
    assert.equal(storedWindow?.timezone, "America/New_York");
    assert.equal(
      localDateTimeInZone(storedWindow?.startsAt ?? "", "America/New_York"),
      enteredStart,
      "the entered wall-clock time must be interpreted in the selected zone"
    );
    assert.equal(browser.document.querySelector("#dropWindowGate")?.textContent, "1 scheduled");
    assert.match(browser.document.querySelector("#dropWindowList")?.textContent ?? "", /0 opted in/);

    (browser.document.querySelector("[data-drop-window-open]") as HTMLButtonElement).click();
    await eventually(() => assert.equal(browser.document.querySelector("#dropWindowDialog")?.hasAttribute("open"), true));
    const dropWindowId = db.get<{ id: string }>("SELECT id FROM drop_windows")?.id;
    assert.ok(dropWindowId);
    assert.equal(browser.location.hash, `#sources/drops/${dropWindowId}`);
    assert.match(browser.document.querySelector("#dropWindowDetailItems")?.textContent ?? "", /Picker Target Product/);
    assert.match(browser.document.querySelector("#dropWindowDetailSummary")?.textContent ?? "", /0 opted in/);
    assert.equal(browser.document.querySelector("#dropWindowOptedIn")?.textContent, "Opted in: nobody yet");
    const edit = browser.document.querySelector("#dropWindowEditForm") as HTMLFormElement;
    (edit.elements.namedItem("title") as HTMLInputElement).value = "Edited Target collector drop";
    edit.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
    await eventually(() => assert.match(browser.document.querySelector("#dropWindowList")?.textContent ?? "", /Edited Target collector drop/));
    // The drawer was opened by pushState, so closing it goes back to the list entry.
    await eventually(() => assert.equal(browser.location.hash, "#sources/drops"));
    assert.equal(browser.history.length, 2, "closing a pushed drawer must not add a history entry");

    (browser.document.querySelector("[data-drop-window-open]") as HTMLButtonElement).click();
    await eventually(() => assert.equal(browser.document.querySelector("#dropWindowDialog")?.hasAttribute("open"), true));
    (browser.document.querySelector("#replaceDropWindowButton") as HTMLButtonElement).click();
    assert.equal(browser.document.querySelector("#dropWindowDialog")?.hasAttribute("open"), false);
    assert.equal((browser.document.querySelector("#dropWindowSupersedes") as HTMLInputElement).value, dropWindowId,
      "Replace prefills the hidden supersedes input");
    assert.equal(browser.document.querySelector("#dropWindowSupersedes")?.getAttribute("type"), "hidden");
    assert.match((form.elements.namedItem("title") as HTMLInputElement).value, /replacement$/);
    await eventually(() => assert.equal(browser.location.hash, "#sources/drops"));

    (browser.document.querySelector("[data-drop-window-open]") as HTMLButtonElement).click();
    await eventually(() => assert.equal(browser.document.querySelector("#dropWindowDialog")?.hasAttribute("open"), true));
    assert.equal(browser.location.hash, `#sources/drops/${dropWindowId}`);
    const cancel = browser.document.querySelector("#cancelDropWindowButton") as HTMLButtonElement;
    cancel.click();
    assert.equal((browser.document.querySelector("#dropWindowCancelReasonField") as HTMLElement).hidden, false);
    assert.equal(cancel.textContent, "Confirm cancellation");
    cancel.click();
    await eventually(() => assert.match(browser.document.querySelector("#dropWindowList")?.textContent ?? "", /cancelled/i));
    await eventually(() => assert.equal(browser.location.hash, "#sources/drops"));
    assert.equal(browser.document.querySelector("#dropWindowGate")?.textContent, "None scheduled");
    assert.equal(db.get<{ status: string }>("SELECT status FROM drop_windows")?.status, "cancelled");
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'drop_window_cancelled'"
    )?.count, 1);

    const restockSearch = browser.document.querySelector("#restockPatternProductSearch") as HTMLInputElement;
    restockSearch.value = "Picker Target";
    restockSearch.dispatchEvent(new browser.Event("input", { bubbles: true }));
    await eventually(() => assert.match(browser.document.querySelector("#restockPatternProductResults")?.textContent ?? "", /Picker Target Product/));
    (browser.document.querySelector("[data-choose-restock-pattern-product]") as HTMLButtonElement).click();
    assert.equal((browser.document.querySelector("#restockPatternListingId") as HTMLInputElement).value, listing.id);
  } finally {
    browser.close();
    server.close();
    await once(server, "close");
    db.close();
  }
});
