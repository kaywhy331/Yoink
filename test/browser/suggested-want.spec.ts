import { expect, test } from "@playwright/test";
import type { Server } from "node:http";
import { join } from "node:path";
import { createYoinkServer } from "../../apps/api/src/app.js";
import { YoinkDatabase } from "../../packages/database/src/database.js";
import { CatalogRepository } from "../../packages/database/src/catalog-repository.js";
import { ControlRepository } from "../../packages/database/src/control-repository.js";
import { SUGGESTED_WANT_CONFIRMATION } from "../../packages/contracts/src/index.js";

let db: YoinkDatabase;
let server: Server;
let origin: string;
let verified: string;
let unverified: string;

test.beforeEach(async ({ page }) => {
  db = new YoinkDatabase();
  const catalog = new CatalogRepository(db);
  const add = (name: string, sku: string, sellerType: "first_party" | "unknown") => catalog.upsertListing({
    source: "trackalacker", sourceConnectionId: "source_trackalacker_local", sourceProductId: name,
    sourceListingId: name, title: name, retailerId: "target", retailerSku: sku,
    canonicalUrl: `https://www.target.com/p/-/A-${sku}`, sellerType,
    listingStatus: "in_stock", observedPriceCents: 4999, msrpCents: 19999, currency: "USD"
  }).listing.id;
  verified = add("Verified store item", "95123001", "first_party");
  unverified = add("Unverified seller item", "95123002", "unknown");
  db.run("UPDATE listings SET execution_supported=1");
  server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps/web"), version: "suggested-want-browser-test" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test listener");
  origin = `http://127.0.0.1:${address.port}`;
  await page.route("**/*", (route) => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort());
  page.on("pageerror", (error) => { throw error; });
});

test.afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
});

test("Want it saves a verified suggested max in one click and remains editable", async ({ page }, testInfo) => {
  await page.goto(`${origin}/#find`);
  const button = page.locator(`#productList [data-want-listing="${verified}"]`);
  await expect(button).toHaveText("Want it");
  const saved = page.waitForResponse((response) => response.url().endsWith("/want/suggested") && response.request().method() === "POST");
  await button.click();
  expect((await saved).status()).toBe(201);
  await expect(button).toHaveText("Yoink");
  await expect(page.locator("#wantDialog")).not.toBeVisible();
  await expect(page.locator("#toast")).toContainText("$49.99 max");
  expect(db.get<{ cents: number }>("SELECT max_unit_price_cents cents FROM mission_targets WHERE enabled=1")?.cents).toBe(4999);
  expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM action_jobs")?.n).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("one-click-phone.png"), fullPage: true });
  await button.click();
  await expect(page.locator('#wantDialog [name="wantMax"]')).toHaveValue("49.99");
  await page.locator("#wantDialog [data-close-dialog]").first().click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/#cart`);
  await expect(page.locator("#suggestedPrices")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("wanted-desktop.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("bulk review applies verified prices while paused wants stay paused", async ({ page }, testInfo) => {
  const control = new ControlRepository(db);
  const result = control.saveSuggestedProductWant({ contractVersion: 1, listingId: verified, confirmation: SUGGESTED_WANT_CONFIRMATION });
  db.run("UPDATE missions SET status='paused' WHERE id=?", result.purchaseIntentId);
  db.run("UPDATE offer_observations SET unit_price_cents=3999 WHERE listing_id=?", verified);
  await page.goto(`${origin}/#cart`);
  await page.locator("#suggestedPrices").click();
  const dialog = page.locator("#suggestedPricesDialog");
  await expect(dialog.locator('input[name="suggestedPlanId"]')).toBeChecked();
  await expect(dialog).toContainText("$49.99 → $39.99");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("bulk-prices-phone.png"), fullPage: true });
  await dialog.getByRole("button", { name: "Apply 1 change" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator("#toast")).toContainText("Applied suggested prices to 1 item");
  expect(db.get<{ status: string }>("SELECT status FROM missions WHERE id=?", result.purchaseIntentId)?.status).toBe("paused");
  expect(db.get<{ cents: number }>("SELECT max_unit_price_cents cents FROM mission_targets WHERE mission_id=? AND enabled=1", result.purchaseIntentId)?.cents).toBe(3999);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("wanted-phone.png"), fullPage: true });
});

test("five wanted rows offer one $10 increase and leave four unchanged", async ({ page }, testInfo) => {
  const control = new ControlRepository(db);
  const changed = control.saveSuggestedProductWant({ contractVersion: 1, listingId: verified, confirmation: SUGGESTED_WANT_CONFIRMATION });
  const catalog = new CatalogRepository(db);
  for (let index = 0; index < 4; index++) {
    const sku = String(95123100 + index);
    const { listing } = catalog.upsertListing({ source: "trackalacker", sourceConnectionId: "source_trackalacker_local",
      sourceProductId: sku, sourceListingId: sku, title: `Unchanged item ${index}`, retailerId: "target", retailerSku: sku,
      canonicalUrl: `https://www.target.com/p/-/A-${sku}`, sellerType: "first_party", listingStatus: "in_stock",
      observedPriceCents: 4999, msrpCents: 19999, currency: "USD" });
    control.saveSuggestedProductWant({ contractVersion: 1, listingId: listing.id, confirmation: SUGGESTED_WANT_CONFIRMATION });
  }
  db.run("UPDATE offer_observations SET unit_price_cents=5999 WHERE listing_id=?", verified);
  await page.goto(`${origin}/#cart`);
  await page.locator("#suggestedPrices").click();
  const dialog = page.locator("#suggestedPricesDialog");
  const rows = dialog.locator('input[name="suggestedPlanId"]');
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toHaveValue(changed.purchaseIntentId);
  await expect(dialog.locator('input:checked')).toHaveCount(1);
  await expect(dialog.locator('input:disabled')).toHaveCount(4);
  await expect(dialog).toContainText("1 change · 4 unchanged");
  await expect(dialog).toContainText("Increase +$10.00");
  await page.screenshot({ path: testInfo.outputPath("five-row-review-phone.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: testInfo.outputPath("five-row-review-desktop.png"), fullPage: true });
  const saved = page.waitForResponse(response => response.url().endsWith("/suggested-prices") && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Apply 1 change" }).click();
  const response = await saved;
  expect((await response.json()).updated).toHaveLength(1);
  expect(response.request().postDataJSON().items).toHaveLength(1);
  await expect(page.locator("#toast")).toContainText("Applied suggested prices to 1 item");
  expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM mission_targets WHERE max_unit_price_cents=4999 AND enabled=1")?.n).toBe(4);
});

test("failed search offers local Retry with the same query and filters", async ({ page }, testInfo) => {
  await page.goto(`${origin}/#find`);
  await expect(page.locator("#productList .product-card")).toHaveCount(2);
  await page.locator("#inStockOnly").check();
  let fail = true;
  const queries: string[] = [];
  await page.route("**/api/v1/user/library/products?**", route => {
    const query = new URL(route.request().url());
    if (!query.searchParams.has("q")) return route.continue();
    queries.push(query.search);
    return fail ? route.fulfill({ status: 503, json: { message: "Fixture search unavailable" } }) : route.continue();
  });
  await page.locator("#productSearch").fill("Verified store");
  await expect(page.locator("#productList")).toContainText("Search didn’t load · Retry");
  await expect(page.locator("#productList")).not.toContainText("No products match");
  const failedQuery = queries.at(-1);
  await page.screenshot({ path: testInfo.outputPath("search-retry-phone.png"), fullPage: true });
  fail = false;
  await page.locator("#productList").getByRole("button", { name: "Retry" }).click();
  await expect(page.locator("#productList .product-card")).toHaveCount(1);
  expect(queries.at(-1)).toBe(failedQuery);
  expect(failedQuery).toContain("availability=in_stock");
  await expect(page.locator("#productSearch")).toHaveValue("Verified store");
  await expect(page.locator("#inStockOnly")).toBeChecked();
});

test("Connect Telegram moves focus to its pending Open Telegram step", async ({ page }, testInfo) => {
  let connections = 0;
  await page.route("**/api/v1/user/notifications", route => route.fulfill({ json: { items: [{ kind: "telegram", available: true }], deliveries: [] } }));
  await page.route("**/api/v1/user/notifications/telegram/connect", route => {
    connections++;
    expect(route.request().postDataJSON()).toEqual({ optedIn: true });
    return route.fulfill({ json: { pairing: { id: "fixture", url: "https://t.me/fixture?start=fixture", expiresAt: new Date(Date.now() + 60_000).toISOString() } } });
  });
  await page.route("**/api/v1/user/notifications/telegram/verify", route => route.fulfill({ json: { pending: true } }));
  await page.goto(`${origin}/#setup/alerts`);
  await page.getByRole("button", { name: "Connect Telegram" }).click();
  await expect(page.locator("#yoinkBotStartLink")).toBeFocused();
  await expect(page.locator("#yoinkBotStartLink")).toBeInViewport();
  await expect(page.getByRole("button", { name: "Connect Telegram" })).toHaveCount(0);
  await expect(page.locator("#yoinkBotStatus")).toContainText("Next: Open Telegram and tap Start");
  const link = await page.locator("#yoinkBotStartLink").boundingBox();
  const status = await page.locator("#yoinkBotStatus").boundingBox();
  expect(status!.y).toBeGreaterThanOrEqual(link!.y + link!.height);
  await page.screenshot({ path: testInfo.outputPath("telegram-pending-phone.png"), fullPage: true });
  expect(connections).toBe(1);
});

test("an unidentified seller never supplies the default max", async ({ page }) => {
  await page.goto(`${origin}/#find`);
  await page.locator(`#productList [data-want-listing="${unverified}"]`).click();
  const dialog = page.locator("#wantDialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("No verified store price yet");
  await expect(dialog.locator('[name="wantMax"]')).toHaveValue("");
  await expect(dialog.locator("#wantSave")).toBeDisabled();
  expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM missions")?.n).toBe(0);
});
