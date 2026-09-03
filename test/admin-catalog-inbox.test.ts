import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { CatalogGovernanceRepository } from "../packages/database/src/catalog-governance-repository.js";
import { LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";

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

function proposedListing(suffix: string) {
  return {
    sourceConnectionId: "source_trackalacker_local",
    source: "trackalacker",
    sourceProductId: `catalog-inbox-product-${suffix}`,
    sourceListingId: `catalog-inbox-listing-${suffix}`,
    title: `Catalog inbox product ${suffix}`,
    retailerId: "target",
    retailerSku: `900000000${suffix}`,
    canonicalUrl: `https://www.target.com/p/-/A-900000000${suffix}`,
    listingStatus: "in_stock" as const,
    executionSupported: true,
    msrpCents: 2499,
    currency: "USD",
    observedAt: new Date().toISOString()
  };
}

test("Catalog reviews are actionable from Inbox with a named proposer and review notes", async () => {
  const db = new YoinkDatabase();
  db.run("UPDATE users SET display_name = ? WHERE id = ?", "Catalog proposer", LOCAL_USER_ID);
  const governance = new CatalogGovernanceRepository(db);
  const approveProposal = governance.proposeListing(proposedListing("1")).proposal;
  const rejectProposal = governance.proposeListing(proposedListing("2")).proposal;

  const webRoot = join(process.cwd(), "apps", "web");
  const server = createYoinkServer({ db, webRoot, version: "admin-catalog-inbox-test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const dom = new JSDOM(readFileSync(join(webRoot, "index.html"), "utf8"), {
    url: `${baseUrl}/admin#catalog-reviews`,
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
  Object.defineProperty(browser, "confirm", {
    configurable: true,
    value: () => { throw new Error("Catalog Inbox must not use a native confirmation dialog."); }
  });
  Object.defineProperty(browser, "prompt", {
    configurable: true,
    value: () => { throw new Error("Catalog Inbox must not use a native prompt dialog."); }
  });
  const confirmationNotes = [
    "Exact Target identity and price verified.",
    "Seller identity is not authoritative."
  ];
  Object.defineProperty(browser, "YoinkDialogs", {
    configurable: true,
    value: {
      confirmDialog: async () => ({ confirmed: true, note: confirmationNotes.shift() || "" })
    }
  });
  Object.defineProperty(browser, "CSS", {
    configurable: true,
    value: { escape: (value: string) => String(value).replace(/[^A-Za-z0-9_-]/g, "\\$&") }
  });

  try {
    await browser.eval(`(async () => { ${readFileSync(join(webRoot, "app.js"), "utf8")}\n })()`);
    await eventually(() => assert.equal(browser.document.querySelectorAll("#inboxCatalogReviewList [data-catalog-proposal]").length, 2));

    const inboxBadge = browser.document.querySelector("#inboxNavBadge") as HTMLElement;
    assert.equal(inboxBadge.hidden, false);
    assert.equal(inboxBadge.textContent, "2");
    assert.equal(inboxBadge.getAttribute("aria-label"), "2 inbox items");

    const approveCard = browser.document.querySelector(`[data-catalog-proposal="${approveProposal.id}"]`) as HTMLElement;
    assert.match(approveCard.textContent ?? "", /proposed by Catalog proposer/);
    assert.doesNotMatch(approveCard.querySelector(".card-meta")?.textContent ?? "", new RegExp(approveProposal.payloadHash));
    assert.match(approveCard.querySelector("details")?.textContent ?? "", new RegExp(approveProposal.payloadHash));
    assert.equal(approveCard.querySelector("[data-catalog-review-note]"), null);
    (approveCard.querySelector("[data-catalog-approve]") as HTMLButtonElement).click();

    await eventually(() => assert.equal(db.get<{ status: string }>(
      "SELECT status FROM catalog_change_proposals WHERE id = ?",
      approveProposal.id
    )?.status, "approved"));
    assert.equal(db.get<{ reviewNote: string }>(
      "SELECT review_note AS reviewNote FROM catalog_change_proposals WHERE id = ?",
      approveProposal.id
    )?.reviewNote, "Exact Target identity and price verified.");
    await eventually(() => assert.equal(browser.document.querySelectorAll("#inboxCatalogReviewList [data-catalog-proposal]").length, 1));

    const rejectCard = browser.document.querySelector(`[data-catalog-proposal="${rejectProposal.id}"]`) as HTMLElement;
    assert.equal(rejectCard.querySelector("[data-catalog-review-note]"), null);
    (rejectCard.querySelector("[data-catalog-reject]") as HTMLButtonElement).click();

    await eventually(() => assert.equal(db.get<{ status: string }>(
      "SELECT status FROM catalog_change_proposals WHERE id = ?",
      rejectProposal.id
    )?.status, "rejected"));
    assert.equal(db.get<{ reviewNote: string }>(
      "SELECT review_note AS reviewNote FROM catalog_change_proposals WHERE id = ?",
      rejectProposal.id
    )?.reviewNote, "Seller identity is not authoritative.");
    await eventually(() => {
      assert.equal(browser.document.querySelectorAll("#inboxCatalogReviewList [data-catalog-proposal]").length, 0);
      assert.equal(inboxBadge.hidden, true);
      assert.equal(inboxBadge.textContent, "0");
    });
  } finally {
    browser.close();
    server.close();
    await once(server, "close");
    db.close();
  }
});
