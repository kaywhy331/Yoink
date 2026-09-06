import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:33993(?:\/|$))/, route => route.abort());
  page.on("pageerror", error => { throw error; });
});

async function productEvidence(page: Page, changes: Array<Record<string, unknown>>) {
  const { items } = await (await page.request.get("/api/v1/user/library/products?q=Browser+product+205")).json();
  const product = items[0];
  product.listings = changes.map((change, index) => ({ ...product.listings[0], listingId: `evidence_listing_${index}`, ...change }));
  product.storeCount = changes.length;
  await page.route("**/api/v1/user/library/products?**", route => route.fulfill({ json: { items: [product], total: 1, limit: 100, offset: 0, stores: [] } }));
  await page.goto("/#products?q=Browser+product+205");
  return page.locator("#productList .product-card");
}

test("a fresh stock report cannot refresh an old price, and ages while detail stays open", async ({ page }, testInfo) => {
  const now = Date.now();
  await page.clock.install({ time: new Date(now) });
  const card = await productEvidence(page, [{
    observedAvailability: "in_stock", availabilityObservedAt: new Date(now - 60_000).toISOString(), availabilitySource: "browser",
    currentPriceCents: 1999, priceObservedAt: new Date(now - 2 * 86_400_000).toISOString(), priceSource: "trackalacker"
  }]);
  await expect(card.locator("[data-stock-status]")).toHaveText("Reported in stock");
  await expect(card).toContainText("Chrome companion");
  await expect(card).toContainText("Price seen 2 days ago · TrackaLacker");
  await card.getByRole("button", { name: "Details", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Browser product 205" });
  await expect(dialog).toContainText("five minutes old are marked stale");
  await expect(dialog).toContainText("Inspect product");
  const link = dialog.getByRole("link", { name: "Check Target ↗", exact: true });
  await expect(link).toHaveAttribute("data-store-canonical", "https://www.target.com/p/-/A-97000205");
  await expect(link).toHaveAttribute("target", "_blank");
  await link.focus();
  await page.clock.fastForward(5 * 60_000);
  await expect(dialog.locator("[data-stock-status]")).toHaveText("Stock info stale");
  await expect(dialog.locator("[data-stock-status]")).not.toHaveClass(/good/);
  await expect(link).toBeFocused();
  await expect(dialog).toContainText("6 minutes ago");
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("stock-detail-mobile.png"), fullPage: true });
});

test("old stock stays stale when the price was recently reported; missing and future evidence stay unknown", async ({ page }, testInfo) => {
  const now = Date.now();
  const card = await productEvidence(page, [{
    observedAvailability: "in_stock", availabilityObservedAt: new Date(now - 2 * 86_400_000).toISOString(), availabilitySource: "trackalacker",
    priceObservedAt: new Date(now - 60_000).toISOString(), priceSource: "browser"
  }, {
    retailerId: "walmart", retailerName: "Walmart", observedAvailability: "in_stock", availabilityObservedAt: null,
    priceObservedAt: null, currentPriceCents: null, msrpCents: 2499
  }, {
    retailerId: "amazon", retailerName: "Amazon", observedAvailability: "in_stock", availabilityObservedAt: new Date(now + 86_400_000).toISOString(),
    priceObservedAt: "bad-time", currentPriceCents: 1999
  }]);
  await expect(card.locator("[data-stock-status]")).toHaveText("Stock info stale");
  await expect(card).toContainText("Last report: in stock · 2 days ago · TrackaLacker");
  await expect(card).toContainText("Chrome companion");
  await page.screenshot({ path: testInfo.outputPath("stock-card-mobile.png"), fullPage: true });
  await card.getByRole("button", { name: "Details", exact: true }).click();
  const rows = page.locator("#productDialogBody .detail-row");
  await expect(rows.nth(0).locator("[data-stock-status]")).toHaveAttribute("data-freshness", "stale");
  await expect(rows.nth(1)).toContainText("No stock update recorded");
  await expect(rows.nth(1)).toContainText("Catalog price");
  await expect(rows.nth(1).locator("[data-stock-status]")).toHaveText("Stock unknown");
  await expect(rows.nth(2).locator("[data-stock-status]")).toHaveText("Stock unknown");
  await expect(rows.nth(2)).toContainText("Time unknown");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a recent preorder outranks an old in-stock listing, and a newer unknown report is not relabeled in stock", async ({ page }) => {
  const now = Date.now();
  const card = await productEvidence(page, [{
    observedAvailability: "in_stock", availabilityObservedAt: new Date(now - 86_400_000).toISOString(), currentPriceCents: 999
  }, {
    retailerId: "walmart", retailerName: "Walmart", status: "preorder", purchasable: true,
    observedAvailability: "preorder", availabilityObservedAt: new Date(now - 60_000).toISOString(), currentPriceCents: 2499
  }, {
    retailerId: "amazon", retailerName: "Amazon", status: "in_stock", purchasable: true,
    observedAvailability: "unknown", availabilityObservedAt: new Date(now - 30_000).toISOString(), currentPriceCents: 599
  }]);
  await expect(card).toHaveAttribute("data-store", "walmart");
  await expect(card.locator("[data-stock-status]")).toHaveText("Reported preorder");
  await expect(card.locator(".product-price > strong")).toHaveText("$24.99");
  await card.getByRole("button", { name: "Details", exact: true }).click();
  await expect(page.locator('[data-offer-listing="evidence_listing_2"] [data-stock-status]')).toHaveText("Stock unknown");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(card.locator("[data-stock-status]")).toHaveText("Reported preorder");
  await page.setViewportSize({ width: 1440, height: 960 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
