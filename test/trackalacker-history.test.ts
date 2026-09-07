import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { historyRowsFromText, referenceFromHistoryRows, validateHistoryReference, trackalackerHistoryUrl } from "../packages/domain/src/trackalacker-history.js";
import { CatalogRepository } from "../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../packages/database/src/control-repository.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import type { TrackalackerCatalogItemInput, TrackalackerMsrpReference } from "../packages/contracts/src/index.js";
import type { fetchHistoryReference, parseHistoryPage } from "../apps/extension/src/trackalacker-sync.js";

const { JSDOM } = createRequire(import.meta.url)("jsdom");
const listingUrl = "https://www.trackalacker.com/products/showcase/fixture/listings/901/item";
const observedAt = "2026-09-06T22:00:00.000Z";
const now = Date.parse(observedAt);
const approximate = `Recent Changes
Time (PDT) Price Status
6/20/2026, 2:48:45 AM $93.97
Out of Stock
6/20/2026, 2:18:44 AM $93.97
In Stock
(~ MSRP)
6/18/2026, 8:10:43 AM $93.97
Out of Stock
6/6/2026, 8:55:41 PM $93.97
In Stock
(~ MSRP)
5/26/2026, 8:16:10 PM -
Out of Stock`;
const reported = `Recent Changes
Time (PDT) Price Status
1/28/2025, 8:01:27 AM $39.99
Out of Stock
1/28/2025, 7:59:09 AM $39.99
In Stock
(MSRP)
1/28/2025, 7:56:30 AM $39.99
Out of Stock
1/28/2025, 7:54:48 AM $39.99
In Stock
(MSRP)`;
const surge = `Recent Changes
Time (PDT) Price Status
9/4/2026, 10:42:19 AM $199.99
Price Surge
9/4/2026, 10:41:45 AM $214.95
Price Surge
9/4/2026, 8:07:29 AM $199.99
Price Surge`;
const under = `Recent Changes
Time (PDT) Price Status
9/6/2026, 2:13:46 PM $24.97
Out of Stock
9/6/2026, 2:12:45 PM $28.72
Out of Stock
9/2/2026, 5:56:04 AM $24.97
Out of Stock
9/2/2026, 5:53:00 AM $24.97
In Stock
(Under MSRP)
9/1/2026, 11:37:36 PM $24.97
In Stock
(Under MSRP)
9/1/2026, 10:51:45 PM $24.97
In Stock
(Under MSRP)`;

function reference(text: string) {
  return referenceFromHistoryRows(historyRowsFromText(text), listingUrl, "PDT", observedAt);
}

function table(text: string, next = "") {
  const rows = historyRowsFromText(text);
  return `<table><tr><th>Time (PDT)</th><th>Price</th><th>Status</th></tr>${rows.map(row => `<tr><td>${row.time}</td><td>${row.price}</td><td>${row.status}</td></tr>`).join("")}</table>${next}`;
}

function bridge() {
  const window = new JSDOM("").window;
  const context = createContext({ URL, Date, AbortController, DOMParser: window.DOMParser, setTimeout, clearTimeout });
  runInContext(readFileSync("apps/extension/trackalacker-sync.js", "utf8"), context);
  return (context as unknown as { YoinkTrackalackerSync: {
    parseHistoryPage: typeof parseHistoryPage; fetchHistoryReference: typeof fetchHistoryReference;
  } }).YoinkTrackalackerSync;
}

test("copied History examples distinguish reported, approximate, surge and under-MSRP prices", () => {
  assert.deepEqual(reference(approximate), {
    kind: "approximate_msrp", priceCents: 9397, currency: "USD", label: "In Stock (~ MSRP)",
    sourceUrl: listingUrl, timeZone: "PDT", reportedAt: "6/20/2026, 2:18:44 AM", sampleCount: 2, observedAt
  });
  assert.equal(reference(reported)?.kind, "reported_msrp");
  assert.equal(reference(reported)?.priceCents, 3999);
  assert.equal(reference(reported)?.reportedAt, "1/28/2025, 7:59:09 AM");
  assert.equal(reference(surge), null);
  assert.equal(reference(under), null, "being below MSRP does not reveal the MSRP amount");
  assert.equal(reference(`${approximate}\n${reported}`)?.kind, "reported_msrp", "explicit reports take priority over approximations");
  assert.equal(reference(`${reported}\n${reported}`)?.sampleCount, 2, "overlapping pages do not double-count reports");
});

test("History requires a valid row-local price, time and exact category and rejects tied conflicting prices", () => {
  for (const price of ["-", "$0.00", "$-1", "€39.99", "$39.999", "$1,23.45", "$1000001", "39.99"]) {
    assert.equal(referenceFromHistoryRows([{ price, time: "1/28/2025, 7:59:09 AM", status: "In Stock (MSRP)" }], listingUrl, "PDT", observedAt), null);
  }
  for (const status of ["In Stock", "In Stock (Under MSRP)", "Out of Stock (MSRP)", "Price Surge (MSRP)", "MSRP"]) {
    assert.equal(referenceFromHistoryRows([{ price: "$39.99", time: "1/28/2025, 7:59:09 AM", status }], listingUrl, "PDT", observedAt), null);
  }
  for (const time of ["yesterday", "2/30/2026, 7:59:09 AM", "1/28/2025, 13:00:00 AM"]) {
    assert.equal(referenceFromHistoryRows([{ price: "$39.99", time, status: "In Stock (MSRP)" }], listingUrl, "PDT", observedAt), null);
  }
  assert.equal(reference(`${reported}\n1/28/2025, 7:59:09 AM $40.00\nIn Stock\n(MSRP)`), null);
  assert.equal(reference(reported.replaceAll("1/28/2025", "1/1/2025") + "\n" + reported)?.reportedAt, "1/28/2025, 7:59:09 AM");
  assert.equal(reference(approximate.replaceAll("~ MSRP", "≈ MSRP"))?.priceCents, 9397);
});

test("History DOM extraction uses table columns, ignores unrelated markup and refuses challenges", () => {
  const api = bridge();
  for (const fixture of [approximate, reported, surge, under]) {
    const parsed = api.parseHistoryPage(new JSDOM(`<aside>MSRP $1999</aside>${table(fixture)}`).window.document, listingUrl);
    assert.deepEqual(JSON.parse(JSON.stringify(parsed.rows)), historyRowsFromText(fixture));
    assert.equal(parsed.timeZone, "PDT");
  }
  const noTable = api.parseHistoryPage(new JSDOM(`<div>${reported}</div><script type="application/json">{"msrp":9999}</script>`).window.document, listingUrl);
  assert.equal(noTable.rows.length, 0);
  const challenged = api.parseHistoryPage(new JSDOM(`<form id="challenge-form">Verify you are human</form>${table(reported)}`).window.document, listingUrl);
  assert.equal(challenged.blocked, true);
  assert.equal(challenged.rows.length, 0);
});

test("History pagination is bounded, listing-specific, and preserves usable evidence on fetch failure", async () => {
  const api = bridge();
  const listing = { sourceListingUrl: listingUrl, sourceListingId: "901" };
  const urls: string[] = [];
  const budget = { remaining: 10 };
  const result = await api.fetchHistoryReference(listing, observedAt, budget, async url => {
    urls.push(url);
    return { url, text: table(urls.length === 1 ? under : approximate, '<a rel="next" href="?page=2">Next</a>') };
  }, async () => {});
  assert.equal(result?.priceCents, 9397);
  assert.equal(result?.sourceUrl, `${listingUrl}?page=2`);
  assert.deepEqual(urls, [listingUrl, `${listingUrl}?page=2`]);
  assert.equal(budget.remaining, 8);
  let pages = 0;
  await api.fetchHistoryReference(listing, observedAt, { remaining: 10 }, async url => {
    pages++;
    return { url, text: table(under, `<a rel="next" href="?page=${pages + 1}">Next</a>`) };
  }, async () => {});
  assert.equal(pages, 3);
  let attempts = 0;
  const partial = await api.fetchHistoryReference(listing, observedAt, { remaining: 3 }, async url => {
    if (++attempts === 2) throw new Error("network down");
    return { url, text: table(reported, '<a rel="next" href="?page=2">Next</a>') };
  }, async () => {});
  assert.equal(partial?.priceCents, 3999);
  const stopped = { remaining: 10, blocked: false };
  assert.equal(await api.fetchHistoryReference(listing, observedAt, stopped, async url => ({ url, text: "Verify you are human" }), async () => {}), null);
  assert.equal(stopped.blocked, true);
  assert.equal(await api.fetchHistoryReference(listing, observedAt, stopped, async () => { throw new Error("must not fetch"); }, async () => {}), null);
  assert.equal(await api.fetchHistoryReference(listing, observedAt, { remaining: 0 }, async () => { throw new Error("must not fetch"); }, async () => {}), null);
  assert.equal(await api.fetchHistoryReference(listing, observedAt, { remaining: 3 }, async () => ({ url: listingUrl.replace("901", "902"), text: table(reported) }), async () => {}), null);
  for (const value of [listingUrl.replace("901", "902"), "https://evil.example/?page=2", `${listingUrl}?token=secret`, `${listingUrl}?page=2&page=3`, "https://www.trackalacker.com/users/sign_in", "https://user:pass@www.trackalacker.com/"]) {
    assert.equal(trackalackerHistoryUrl(value, listingUrl, "901"), "");
  }
});

function catalogItem(ref: TrackalackerMsrpReference | null): TrackalackerCatalogItemInput {
  return { sourceProductId: "138022", sourceProductSlug: "fixture", sourceProductUrl: "https://www.trackalacker.com/products/showcase/fixture",
    title: "History Fixture", observedAt, listings: [
      { sourceListingId: "901", storeName: "Target", retailerId: "target", retailerSku: "95280910", canonicalUrl: "https://www.target.com/p/-/A-95280910", sourceListingUrl: listingUrl,
        availability: "out_of_stock", unitPriceCents: 19999, msrpReference: ref },
      { sourceListingId: "902", storeName: "Target", retailerId: "target", retailerSku: "95280911", canonicalUrl: "https://www.target.com/p/-/A-95280911", sourceListingUrl: listingUrl.replace("901", "902"), availability: "out_of_stock" }
    ] };
}

test("catalog stores listing-specific estimates without asserting MSRP or changing current offer evidence", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    const item = catalogItem(reference(approximate));
    catalog.upsertTrackalackerItem(item, now);
    const rows = catalog.listLibrary();
    const target = rows.find(row => row.retailerSku === "95280910")!;
    assert.equal(target.msrpCents, null);
    assert.equal(target.estimatedMsrpCents, 9397);
    assert.deepEqual(target.msrpReference, reference(approximate));
    assert.equal(target.currentPriceCents, 19999);
    assert.equal(target.status, "out_of_stock");
    assert.equal(rows.find(row => row.retailerSku === "95280911")?.estimatedMsrpCents, null);
    const grouped = catalog.listLibraryProducts();
    assert.equal(grouped[0]?.listings.find(row => row.retailerSku === "95280910")?.estimatedMsrpCents, 9397);
    catalog.upsertTrackalackerItem(catalogItem(null), now);
    assert.equal(catalog.listLibrary().find(row => row.retailerSku === "95280910")?.estimatedMsrpCents, 9397, "unavailable history preserves prior evidence");
    catalog.upsertTrackalackerItem(catalogItem(reference(reported)), now);
    const exact = catalog.listLibrary().find(row => row.retailerSku === "95280910")!;
    assert.equal(exact.msrpCents, 3999);
    assert.equal(exact.estimatedMsrpCents, null);
    assert.deepEqual(exact.msrpReference, reference(reported));
    const older = catalogItem(reference(reported.replaceAll("1/28/2025", "1/1/2025").replaceAll("$39.99", "$79.99")));
    older.msrpCents = 5000;
    catalog.upsertTrackalackerItem(older, now);
    assert.equal(catalog.listLibrary().find(row => row.retailerSku === "95280910")?.msrpCents, 3999, "older history and product-wide MSRP cannot displace newer listing evidence");
    catalog.upsertTrackalackerItem(item, now);
    assert.equal(catalog.listLibrary().find(row => row.retailerSku === "95280910")?.estimatedMsrpCents, null, "an estimate cannot displace reported MSRP");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM missions")?.count, 0);
  } finally { db.close(); }
});

test("catalog validates History provenance, currency, amounts and dates before accepting a price reference", () => {
  const base = reference(approximate)!;
  const invalid = [
    { ...base, sourceUrl: listingUrl.replace("901", "902") },
    { ...base, label: "In Stock (Under MSRP)" }, { ...base, currency: "CAD" },
    { ...base, priceCents: "9397" }, { ...base, priceCents: -1 }, { ...base, sampleCount: 0 },
    { ...base, observedAt: "2099-01-01T00:00:00Z" }, { ...base, reportedAt: "not a date" }
  ];
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    for (const bad of invalid) {
      assert.equal(validateHistoryReference(bad, listingUrl, "901", now), null);
      catalog.upsertTrackalackerItem(catalogItem(bad as TrackalackerMsrpReference), now);
      assert.equal(catalog.listLibrary().find(row => row.retailerSku === "95280910")?.estimatedMsrpCents, null);
    }
    catalog.upsertTrackalackerItem(catalogItem(base), now);
    const explicit = catalogItem(null);
    explicit.msrpCents = 4000;
    catalog.upsertTrackalackerItem(explicit, now);
    const listing = catalog.listLibrary().find(row => row.retailerSku === "95280910")!;
    assert.equal(listing.msrpCents, 4000);
    assert.equal(listing.estimatedMsrpCents, null);
    assert.equal(listing.msrpReference, null, "an explicit product MSRP does not inherit the old estimate's provenance");
  } finally { db.close(); }
});

test("purchase profiles require explicit estimate opt-in and apply the requested percent to the correct reference", () => {
  const db = new YoinkDatabase();
  try {
    const catalog = new CatalogRepository(db);
    const control = new ControlRepository(db);
    catalog.upsertTrackalackerItem(catalogItem(reference(approximate)), now);
    const listingId = String(catalog.listLibrary().find(row => row.retailerSku === "95280910")!.listingId);
    const profile = control.savePurchaseProfile({ name: "History buy price", targetQuantity: 1, actionCeiling: "notify", priceMode: "msrp" }, now).profiles[0]!;
    const mission = control.createConfiguredMission({ contractVersion: 1, listingId, targetQuantity: 1, maxUnitPriceCents: 1000, maxAllInCents: 1000,
      actionCeiling: "notify", sellerPolicy: "first_party_only", fulfillment: "shipping", substitutionPolicy: "exact_only", cooldownSeconds: 0,
      confirmation: "CREATE_EXACT_PURCHASE_PLAN", quickAddProfileId: profile.id }, now);
    const strict = control.savePurchaseProfile({ ...profile, actionCeiling: "add_to_cart" }, now);
    assert.equal(strict.propagation.skipped[0]?.reasonCode, "msrp_unavailable");
    const estimate = control.savePurchaseProfile({ ...profile, actionCeiling: "add_to_cart", priceMode: "estimated_msrp_offset_percent", msrpOffsetPercent: -10 }, now);
    assert.equal(estimate.propagation.updatedMissionCount, 1);
    const cap = () => db.get<{ cents: number }>("SELECT max_unit_price_cents AS cents FROM mission_targets WHERE mission_id = ?", mission.mission.id)?.cents;
    assert.equal(cap(), 8457, "$93.97 with a -10% offset rounds to $84.57");
    assert.equal(control.listPurchaseProfiles()[0]?.priceMode, "estimated_msrp_offset_percent");
    assert.throws(() => control.savePurchaseProfile({ ...profile, priceMode: "estimated_msrp_offset_percent", msrpOffsetPercent: -91 }, now), /percent/);
    catalog.upsertTrackalackerItem(catalogItem(reference(reported)), now);
    assert.equal(cap(), 8457, "importing evidence does not silently change saved purchase limits");
    control.savePurchaseProfile({ ...profile, actionCeiling: "add_to_cart", priceMode: "estimated_msrp" }, now);
    assert.equal(cap(), 3999, "opt-in mode prefers reported MSRP when available");
  } finally { db.close(); }
});

test("web Quick add resolves the same reference and offsets and displays source evidence safely", () => {
  const source = readFileSync("apps/web/user.js", "utf8");
  const functionSource = (name: string) => source.slice(source.indexOf(`function ${name}(`)).split(/\n(?:async )?function /)[0]!;
  const context = createContext({ money: (cents: number) => `$${(cents / 100).toFixed(2)}`, escapeHtml: (s: unknown) => String(s).replaceAll("<", "&lt;").replaceAll('"', "&quot;"), URL });
  runInContext(["listingEffectivePrice", "resolveProfileMaxUnitPriceCents", "msrpReferenceMarkup", "profileSummary"].map(functionSource).join("\n"), context);
  const resolve = context.resolveProfileMaxUnitPriceCents as (listing: unknown, profile: unknown) => unknown;
  const listing = { msrpCents: null, estimatedMsrpCents: 9397, currentPriceCents: 19999 };
  assert.equal(resolve(listing, { priceMode: "msrp" }), null);
  assert.equal(resolve(listing, { priceMode: "estimated_msrp" }), 9397);
  assert.equal(resolve(listing, { priceMode: "estimated_msrp_offset_percent", msrpOffsetPercent: -10 }), 8457);
  assert.equal(resolve({ ...listing, msrpCents: 3999 }, { priceMode: "estimated_msrp" }), 3999);
  assert.equal(resolve(listing, { priceMode: "store_price" }), 19999);
  assert.equal(resolve({ estimatedMsrpCents: 9397 }, null), null, "default Quick add never silently opts into estimates");
  const markup = context.msrpReferenceMarkup as (listing: unknown) => string;
  assert.match(markup({ msrpReference: reference(approximate) }), /Estimated MSRP \$93.97/);
  assert.match(markup({ msrpReference: reference(reported) }), /Reported MSRP \$39.99/);
  assert.match(markup({ msrpReference: reference(approximate) }), /6\/20\/2026, 2:18:44 AM PDT/);
  assert.doesNotMatch(markup({ msrpReference: { ...reference(approximate), sourceUrl: "javascript:alert(1)" } }), /href=/);
});
