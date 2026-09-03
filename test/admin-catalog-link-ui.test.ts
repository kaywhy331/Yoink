import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html: string, options: Record<string, unknown>) => {
    window: Window & typeof globalThis & { close(): void; eval(source: string): unknown };
  };
};

async function eventually(assertion: () => void, attempts = 300): Promise<void> {
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

test("admin Catalog previews a product URL and sends one governed proposal with optional MSRP", async () => {
  const db = new YoinkDatabase();
  const webRoot = join(process.cwd(), "apps", "web");
  const server = createYoinkServer({ db, webRoot, version: "admin-catalog-link-ui-test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const dom = new JSDOM(readFileSync(join(webRoot, "index.html"), "utf8"), {
    url: `${baseUrl}/admin#library`,
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
  Object.defineProperty(browser.HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute("open", ""); }
  });
  Object.defineProperty(browser.HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) { this.removeAttribute("open"); }
  });
  Object.defineProperty(browser, "confirm", { configurable: true, value: () => { throw new Error("Native confirm must not run."); } });
  Object.defineProperty(browser, "YoinkDialogs", {
    configurable: true,
    value: { confirmDialog: async () => ({ confirmed: true, note: "" }) }
  });
  Object.defineProperty(browser, "CSS", {
    configurable: true,
    value: { escape: (value: string) => String(value).replace(/[^A-Za-z0-9_-]/g, "\\$&") }
  });

  try {
    await browser.eval(`(async () => { ${readFileSync(join(webRoot, "app.js"), "utf8")}\n })()`);
    await eventually(() => assert.equal(browser.document.querySelector("#libraryCount")?.textContent?.includes("matching"), true));

    const listingForm = browser.document.querySelector("#listingForm") as HTMLFormElement;
    assert.deepEqual(
      [...listingForm.querySelectorAll<HTMLInputElement>("input")].map((input) => input.name).filter(Boolean),
      ["url", "title", "msrp", "confirmed"]
    );
    assert.equal(listingForm.querySelector('[name="sourceProductId"]'), null);
    const rawForm = browser.document.querySelector("#rawListingForm") as HTMLFormElement;
    assert.ok(rawForm.querySelector('[name="sourceProductId"]'));
    assert.ok(rawForm.querySelector('[name="canonicalUrl"]'));
    assert.ok(browser.document.querySelector('[data-community-panel="catalog"] #addRawListingButton'));

    (browser.document.querySelector("#addListingButton") as HTMLButtonElement).click();
    await eventually(() => assert.equal((browser.document.querySelector("#listingDialog") as HTMLDialogElement).open, true));
    const url = listingForm.querySelector<HTMLInputElement>('[name="url"]')!;
    const title = listingForm.querySelector<HTMLInputElement>('[name="title"]')!;
    const msrp = listingForm.querySelector<HTMLInputElement>('[name="msrp"]')!;
    const confirmed = listingForm.querySelector<HTMLInputElement>('[name="confirmed"]')!;
    url.value = "https://www.target.com/p/example/-/A-95280894?tracking=discard";
    title.value = "Exact Target product";
    msrp.value = "44.99";
    url.dispatchEvent(new browser.Event("input", { bubbles: true }));
    (browser.document.querySelector("#checkListingLinkButton") as HTMLButtonElement).click();
    await eventually(() => assert.match(browser.document.querySelector("#listingLinkPreview")?.textContent ?? "", /Target.*Product found.*95280894/s));
    confirmed.checked = true;
    confirmed.dispatchEvent(new browser.Event("input", { bubbles: true }));
    const submit = browser.document.querySelector("#submitListingLinkButton") as HTMLButtonElement;
    assert.equal(submit.disabled, false);
    listingForm.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));

    await eventually(() => assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM catalog_change_proposals")?.count, 1));
    const payload = JSON.parse(db.get<{ payload: string }>("SELECT payload_json AS payload FROM catalog_change_proposals")?.payload || "{}") as Record<string, unknown>;
    assert.equal(payload.retailerId, "target");
    assert.equal(payload.retailerSku, "95280894");
    assert.equal(payload.msrpCents, 4499);
    assert.equal(payload.listingStatus, "unknown");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM listings")?.count, 0);
    await eventually(() => assert.equal((browser.document.querySelector("#listingDialog") as HTMLDialogElement).open, false));
    await eventually(() => assert.match(browser.document.querySelector("#toast")?.textContent ?? "", /Product link sent for review/));
  } finally {
    browser.close();
    server.close();
    await once(server, "close");
    db.close();
  }
});
