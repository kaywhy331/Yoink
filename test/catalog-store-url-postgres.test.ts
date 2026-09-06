import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { verifyStoreCatalogUrls } from "./helpers/catalog-store-url-postgres.js";

test("both PostgreSQL catalog boundaries accept actual ASUS, American Eagle and Athleta URLs and reject altered identities", async () => {
  const database = new PGlite();
  try { await verifyStoreCatalogUrls((sql, values) => database.query(sql, values)); }
  finally { await database.close(); }
});
