#!/usr/bin/env node
// Read-only inventory. Run with: node --import tsx scripts/audit-cart-products.mjs [output-directory]
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { gunzipSync } from "node:zlib";
import { extractRetailerSku } from "../packages/browser-adapters/src/retailers.ts";
import { extractTargetSku } from "../packages/browser-adapters/src/target.ts";
import { ADD_LANES } from "../packages/contracts/src/index.ts";

const root = resolve(import.meta.dirname, "..");
const output = resolve(process.argv[2] || join(root, "docs/evidence/cart-audit-2026-09-06"));
const stores = ["bestbuy", "target", "walmart", "amazon"];
const products = new Map();
const unresolved = [];
const snapshots = [];
const canonical = (store, sku) => store === "target" ? `https://www.target.com/p/-/A-${sku}`
  : store === "bestbuy" ? `https://www.bestbuy.com/site/-/${sku}.p`
    : store === "walmart" ? `https://www.walmart.com/ip/${sku}` : `https://www.amazon.com/dp/${sku}`;
const identity = (store, url) => store === "target" ? extractTargetSku(url) : extractRetailerSku(store, url);
function add(store, sku, url, source, kind) {
  sku = String(sku || "").trim().toUpperCase();
  if (!sku || !new RegExp(ADD_LANES[store].skuPattern).test(sku)) {
    unresolved.push({ retailerId: store, retailerSku: sku, url, source, reason: "missing_or_invalid_identity" });
    return;
  }
  const key = `${store}:${sku}`;
  const product = products.get(key) || { retailerId: store, retailerSku: sku, canonicalUrl: canonical(store, sku), urls: [], sources: [], kinds: [] };
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.port
        && (parsed.hostname === `${store}.com` || parsed.hostname.endsWith(`.${store}.com`))) {
        parsed.hash = ""; parsed.search = "";
        if (!product.urls.includes(parsed.href)) product.urls.push(parsed.href);
      }
    } catch {}
  }
  if (!product.sources.includes(source)) product.sources.push(source);
  if (!product.kinds.includes(kind)) product.kinds.push(kind);
  products.set(key, product);
}
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
const db = new DatabaseSync(join(root, "data/yoink.sqlite"), { readOnly: true });
try {
  for (const store of stores) {
    for (const row of db.prepare("SELECT retailer_sku, canonical_url FROM listings WHERE retailer_id = ?").all(store))
      add(store, row.retailer_sku, row.canonical_url, "database:listings", "catalog");
    for (const row of db.prepare("SELECT DISTINCT retailer_sku, canonical_url FROM retailer_shadow_observations WHERE retailer_id = ?").all(store))
      add(store, row.retailer_sku, row.canonical_url, "database:retailer_shadow_observations", "observed");
    for (const row of db.prepare("SELECT DISTINCT retailer_sku, outbound_url FROM source_listing_candidates WHERE retailer_id = ?").all(store))
      add(store, row.retailer_sku || identity(store, row.outbound_url), row.outbound_url, "database:source_listing_candidates", "candidate");
    for (const table of ["retailer_adapter_trials", "retailer_adapter_diagnostics", "exact_offer_keys"]) {
      for (const row of db.prepare(`SELECT DISTINCT retailer_sku FROM ${table} WHERE retailer_id = ?`).all(store))
        add(store, row.retailer_sku, "", `database:${table}`, table === "retailer_adapter_trials" ? "rehearsed" : "observed");
    }
  }
} finally { db.close(); }
for (const store of stores) {
  for (const path of files(join(root, "test/fixtures/capsules", store)).filter(path => path.endsWith(".json"))) {
    const metadata = JSON.parse(readFileSync(path, "utf8"));
    add(store, metadata.retailerSku, metadata.url, relative(root, path), "fixture");
    snapshots.push({ kind: "promoted", path: relative(root, path), retailerId: store, retailerSku: metadata.retailerSku,
      url: metadata.url, requiredFulfillment: metadata.requiredFulfillment || "shipping" });
  }
}
for (const path of files(join(root, "data/evidence")).filter(path => /\.json\.gz$/.test(path))) {
  const capsule = JSON.parse(gunzipSync(readFileSync(path)).toString("utf8"));
  if (!stores.includes(capsule.retailerId)) continue;
  add(capsule.retailerId, capsule.retailerSku, capsule.url, relative(root, path), "captured");
  snapshots.push({ kind: "captured", path: relative(root, path), retailerId: capsule.retailerId, retailerSku: capsule.retailerSku,
    url: capsule.url, requiredFulfillment: capsule.requiredFulfillment || "shipping" });
}
// Include exact product references in fixtures, tests and evidence documents.
// Fixture-only IDs are kept separate from actual catalog/live evidence identities.
for (const path of [...files(join(root, "test")), ...files(join(root, "docs"))]) {
  if (!/\.(?:ts|html|md|json)$/.test(path) || path.startsWith(output) || path.includes("/screenshots/")) continue;
  const source = readFileSync(path, "utf8");
  for (const match of source.matchAll(/https:\/\/(?:www\.)?(target|bestbuy|walmart|amazon)\.com\/[^\s<>"'`\\]+/g)) {
    const store = match[1];
    const url = match[0].replace(/[),;]+$/, "");
    const sku = identity(store, url);
    if (sku) add(store, sku, url, relative(root, path), path.includes("/test/") ? "fixture" : "documented");
  }
}
const items = [...products.values()].sort((a,b) => a.retailerId.localeCompare(b.retailerId) || a.retailerSku.localeCompare(b.retailerSku));
for (const product of items) {
  product.snapshots = snapshots.filter(snapshot => snapshot.retailerId === product.retailerId && snapshot.retailerSku === product.retailerSku).map(snapshot => snapshot.path);
  product.identityCheck = identity(product.retailerId, product.canonicalUrl) === product.retailerSku ? "passed" : "failed";
  product.liveStatus = "not_tested";
  product.cartStatus = "not_verified";
}
const inventory = { schemaVersion: 1, generatedAt: new Date().toISOString(),
  definition: "Union of catalog listings, source candidates, observed/tried/diagnosed/exact-offer identities, captured/promoted snapshots, and exact product URL references in tests/docs. Identity validation is not Add or cart proof.",
  counts: Object.fromEntries(stores.map(store => [store, {
    products: items.filter(item => item.retailerId === store).length,
    catalog: items.filter(item => item.retailerId === store && item.kinds.includes("catalog")).length,
    previouslyObserved: items.filter(item => item.retailerId === store && item.kinds.includes("observed")).length,
    withSnapshots: items.filter(item => item.retailerId === store && item.snapshots.length).length,
    fixtureOnly: items.filter(item => item.retailerId === store && item.kinds.every(kind => kind === "fixture")).length
  }])), products: items, unresolvedSources: unresolved, snapshots };
mkdirSync(output, { recursive: true });
writeFileSync(join(output, "inventory.json"), JSON.stringify(inventory, null, 2) + "\n");
console.log(JSON.stringify({ output: join(output, "inventory.json"), counts: inventory.counts, unresolvedSources: unresolved.length, snapshots: snapshots.length }, null, 2));
