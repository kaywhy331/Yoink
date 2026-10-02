// Local in-memory fixture only. All non-loopback browser requests are blocked.
// Uses an already installed Chromium; never downloads or installs one.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { createYoinkServer } from "../apps/api/src/app.ts";
import { YoinkDatabase } from "../packages/database/src/database.ts";
import { CatalogRepository } from "../packages/database/src/catalog-repository.ts";
import { OfficialMsrpRepository } from "../packages/database/src/official-msrp-repository.ts";
import { officialMsrpFixture } from "../test/helpers/official-msrp.ts";

const db = new YoinkDatabase();
const listings = [
  ["target", "95111111", "https://www.target.com/p/-/A-95111111"],
  ["amazon", "B0WANTIT01", "https://www.amazon.com/dp/B0WANTIT01"]
].map(([retailerId, retailerSku, canonicalUrl]) => new CatalogRepository(db).upsertListing({
  sourceConnectionId: "source_trackalacker_local", source: "trackalacker", sourceProductId: "fixture-want-ui",
  sourceListingId: `fixture-want-ui-${retailerId}`, title: "Ordinary fixture puzzle — Standard edition",
  retailerId, retailerSku, canonicalUrl, executionSupported: true, listingStatus: "in_stock",
  observedPriceCents: 2499, msrpCents: 9999, currency: "USD", observedAt: new Date().toISOString()
}).listing);
for (const listing of listings) officialMsrpFixture(db, listing.id, Date.now(), 2999);
const server = createYoinkServer({ db, version: "fixture-only", webRoot: `${process.cwd()}/apps/web` });
let browser;
await mkdir("data/msrp-ui-fixtures", { recursive: true });
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true,
    ...(process.env.YOINK_TEST_CHROME ? { executablePath: process.env.YOINK_TEST_CHROME } : {}) });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route("**/*", route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/#find`);
  await page.locator("[data-want-listing]").first().click();
  const dialog = page.locator("#wantDialog");
  await dialog.locator("#wantSave:not([disabled])").waitFor();
  assert.equal(await dialog.locator("[name=wantQuantity]").inputValue(), "1");
  assert.equal(await dialog.locator("[name=wantQuantity]").isDisabled(), true);
  assert.equal(await dialog.locator("[name=wantMax]").inputValue(), "29.99");
  assert.match(await dialog.innerText(), /Standard single item/);
  assert.match(await dialog.innerText(), /Shipping, tax and fees are separate/);
  assert.match(await dialog.innerText(), /Official MSRP \$29.99/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: "data/msrp-ui-fixtures/phone-review.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: "data/msrp-ui-fixtures/desktop-review.png", fullPage: true });
  const saved = page.waitForResponse(response => response.url().endsWith("/api/v1/user/purchase-intents/want")
    && response.request().method() === "POST");
  await dialog.locator("#wantSave").click();
  assert.equal((await saved).status(), 201);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM missions").n, 1);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM action_jobs").n, 0);
  assert.equal(db.get("SELECT actions_paused FROM app_settings").actions_paused, 1);
  for (const listing of listings) {
    const review = new OfficialMsrpRepository(db);
    review.revoke(listing.id, review.current(listing.id).id);
  }
  await page.goto(`${origin}/#find`);
  await page.locator("[data-want-listing]").first().click();
  await dialog.locator("[name=wantMax]").waitFor();
  await page.waitForFunction(() => /Official MSRP.*evidence/i.test(document.querySelector("#wantSummary")?.textContent || ""));
  assert.equal(await dialog.locator("#wantSave").isDisabled(), true);
  await page.screenshot({ path: "data/msrp-ui-fixtures/missing-evidence.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log("PASS: local Chromium fixture, phone + desktop review, quantity one, exact variant, official cap, save, revoked evidence stop; zero action jobs or external requests allowed.");
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  db.close();
}
