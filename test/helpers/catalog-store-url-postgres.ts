import assert from "node:assert/strict";
import { buildPostgresSignalCatalogApplyManifest, signalCatalogApplyFunctionSource } from "../../packages/database/src/postgres-signal-catalog-apply.js";
import { signalCatalogImportApplyFunctionSource } from "../../packages/database/src/postgres-signal-catalog-import-apply.js";

// Execute the predicates emitted into both deployed boundaries in PostgreSQL.
// This catches URL spelling and SQL-regex errors that manifest checks miss.
export async function verifyStoreCatalogUrls(query: (sql: string, values: string[]) => Promise<{ rows: { accepted: boolean }[] }>) {
  const stores = [
    { id: "athleta", sku: "7844640220000", url: "https://athleta.gap.com/browse/product.do?pid=7844640220000" },
    { id: "athleta", sku: "7678720420000", url: "https://athleta.gap.com/browse/product.do?pid=7678720420000" },
    { id: "asus", sku: "90MP04D0-BMAA02", url: "https://eshop.asus.com/us/90mp04d0-bmaa02-rog-harpe-mini-core.html" },
    { id: "asus", sku: "90MP03H0-BPAA00", url: "https://eshop.asus.com/us/90mp03h0-bpaa00-rog-scabbard-ii-arctic-gray-xxl.html" },
    { id: "americaneagle", sku: "0045503992", url: "https://www.ae.com/us/en/p/women/belts-bags/bags/ae-off-duty-snoopy-tote-bag/0427_9775_410?sku=0045503992" },
    { id: "americaneagle", sku: "0045350782", url: "https://www.ae.com/us/en/p/0577_9778_900?sku=0045350782" }
  ];
  for (const [boundary, source] of [
    ["signal", signalCatalogApplyFunctionSource(buildPostgresSignalCatalogApplyManifest())],
    ["import", signalCatalogImportApplyFunctionSource()]
  ]) {
    const predicate = source!.match(/CASE retailer_id_value\s+WHEN 'target'[\s\S]*?\bEND/)?.[0];
    assert.ok(predicate, `${boundary} emits the canonical URL predicate`);
    const sql = `SELECT (${predicate}) AS accepted FROM (SELECT $1::text AS retailer_id_value, $2::text AS retailer_sku_value, $3::text AS canonical_url_value) AS offer`;
    for (const store of stores) {
      assert.equal((await query(sql, [store.id, store.sku, store.url])).rows[0]?.accepted, true, `${boundary}: ${store.url}`);
      const invalid = [store.url + "#details", store.url + "&extra=1", store.url.replace(new URL(store.url).hostname, "example.com")];
      if (store.id === "athleta") invalid.push(store.url.replace("athleta.gap.com", "secure-athleta.gap.com"), store.url + "&vid=2", store.url.replace(/\?pid=.*/, ""));
      else invalid.push(store.url.replace("/us/", "/ca/"));
      if (store.id === "asus") invalid.push(store.url + "?config=123");
      if (store.id === "americaneagle") invalid.push(`https://www.americaneagle.com/products/product?variant=${store.sku}`, store.url.replace(/\?sku=.*/, ""));
      for (const url of invalid) assert.equal((await query(sql, [store.id, store.sku, url])).rows[0]?.accepted, false, `${boundary}: rejects ${url}`);
      assert.equal((await query(sql, [store.id, "WRONG-SKU", store.url])).rows[0]?.accepted, false);
    }
  }
}
