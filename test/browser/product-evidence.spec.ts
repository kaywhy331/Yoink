import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:33993(?:\/|$))/, route => route.abort());
  page.on("pageerror", error => { throw error; });
});

async function productEvidence(page: Page, changes: Array<Record<string, unknown>>) {
  const { items } = await (await page.request.get("/api/v1/user/library/products?q=Browser+product+205")).json();
  const product = items[0];
  product.listings = changes.map((change, index) => ({ ...product.listings[0], listingId: `evidence_listing_${index}`, ...change }));
  product.stores = product.listings.map((listing: any) => ({
    retailerId: listing.retailerId, retailerName: listing.retailerName, primary: listing, alternates: []
  }));
  product.storeCount = changes.length;
  await page.route("**/api/v1/user/library/products?**", route => route.fulfill({ json: { items: [product], total: 1, limit: 100, offset: 0, stores: [] } }));
  await page.goto("/#products?q=Browser+product+205");
  return page.locator("#productList .product-card");
}

test("History MSRP references show their category, amount, source and date without changing stock", async ({ page }, testInfo) => {
  const reference = { kind: "approximate_msrp", priceCents: 9397, currency: "USD", label: "In Stock (~ MSRP)",
    sourceUrl: "https://www.trackalacker.com/products/showcase/fixture/listings/901/item?page=2",
    reportedAt: "6/20/2026, 2:18:44 AM", timeZone: "PDT", sampleCount: 6, observedAt: new Date().toISOString() };
  const card = await productEvidence(page, [{ msrpCents: null, estimatedMsrpCents: 9397, msrpReference: reference,
    currentPriceCents: 19999, status: "out_of_stock", purchasable: false,
    observedAvailability: "out_of_stock", availabilityObservedAt: new Date().toISOString()
  }]);
  await card.getByRole("button", { name: "Details: Browser product 205", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Browser product 205" });
  await expect(dialog).toContainText("Estimated MSRP $93.97");
  await expect(dialog).toContainText("In Stock (~ MSRP)");
  await expect(dialog).toContainText("6/20/2026, 2:18:44 AM PDT");
  await expect(dialog.locator(".detail-price > strong")).toHaveText("$199.99");
  await expect(dialog.locator("[data-stock-status]")).not.toHaveClass(/good/);
  await expect(dialog.getByRole("link", { name: "TrackaLacker History ↗" })).toHaveAttribute("href", reference.sourceUrl);
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("history-msrp-mobile.png"), fullPage: true });
});

test("a fresh stock report cannot refresh an old price, and ages while detail stays open", async ({ page }, testInfo) => {
  const now = Date.now();
  await page.clock.install({ time: new Date(now) });
  const card = await productEvidence(page, [{
    observedAvailability: "in_stock", availabilityObservedAt: new Date(now - 60_000).toISOString(), availabilitySource: "browser",
    currentPriceCents: 1999, priceObservedAt: new Date(now - 2 * 86_400_000).toISOString(), priceSource: "trackalacker"
  }]);
  await expect(card.locator("[data-stock-status]")).toHaveText("Reported in stock");
  await expect(card).toContainText("Chrome companion");
  await expect(card.locator(".product-price small")).toContainText("Last price at Target");
  await card.getByRole("button", { name: "Details: Browser product 205", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Browser product 205" });
  await expect(dialog).toContainText("Price seen 2 days ago · TrackaLacker");
  await expect(dialog).toContainText("a report over 2 hours old is marked stale");
  await expect(dialog.getByRole("button", { name: "Yoink: edit what Yoink does for Browser product 205", exact: true })).toBeVisible();
  const link = dialog.getByRole("link", { name: "Check Target ↗", exact: true });
  await expect(link).toHaveAttribute("data-store-canonical", "https://www.target.com/p/-/A-97000205");
  await expect(link).toHaveAttribute("target", "_blank");
  await link.focus();
  await expect(dialog.locator("[data-stock-status]")).toHaveClass(/good/);
  await page.clock.fastForward(5 * 60_000);
  await expect(dialog.locator("[data-stock-status]")).toHaveText("Reported in stock");
  await expect(dialog.locator("[data-stock-status]")).toHaveAttribute("data-freshness", "aging");
  await expect(dialog.locator("[data-stock-status]")).not.toHaveClass(/good/);
  await expect(link).toBeFocused();
  await expect(dialog).toContainText("6 min ago");
  // 9855f2f: five minutes ends green availability; two hours ends the reported label.
  await page.clock.fastForward(114 * 60_000);
  await expect(dialog.locator("[data-stock-status]")).toHaveText("Stock info stale");
  await expect(dialog.locator("[data-stock-status]")).toHaveAttribute("data-freshness", "stale");
  await expect(dialog.locator("[data-stock-status]")).not.toHaveClass(/good/);
  await expect(dialog).toContainText("Price seen 2 days ago · TrackaLacker");
  await expect(link).toBeFocused();
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
  await expect(card).toContainText("Reported 2 days ago · in stock · TrackaLacker");
  await expect(card.locator(".product-price small")).toContainText("Last price at Target");
  await page.screenshot({ path: testInfo.outputPath("stock-card-mobile.png"), fullPage: true });
  await card.getByRole("button", { name: "Details: Browser product 205", exact: true }).click();
  const rows = page.locator("#productDialogBody .detail-row");
  const target = page.locator('#productDialogBody [data-offer-listing="evidence_listing_0"]');
  const walmart = page.locator('#productDialogBody [data-offer-listing="evidence_listing_1"]');
  const amazon = page.locator('#productDialogBody [data-offer-listing="evidence_listing_2"]');
  await expect(rows).toHaveCount(3);
  await expect(target.locator(".detail-price")).toContainText("Chrome companion");
  await expect(target.locator("[data-stock-status]")).toHaveAttribute("data-freshness", "stale");
  await expect(walmart).toContainText("No stock update recorded");
  await expect(walmart).toContainText("Catalog price");
  await expect(walmart.locator("[data-stock-status]")).toHaveText("Stock unknown");
  await expect(amazon.locator("[data-stock-status]")).toHaveText("Stock unknown");
  await expect(amazon).toContainText("Time unknown");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("the cheapest offer leads before stock freshness, and a newer unknown report is not relabeled in stock", async ({ page }) => {
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
  await expect(card).toHaveAttribute("data-store", "amazon");
  await expect(card.locator("[data-stock-status]")).toHaveText("Stock unknown");
  await expect(card.locator(".product-price > strong")).toHaveText("$5.99");
  await card.getByRole("button", { name: "Details: Browser product 205", exact: true }).click();
  await expect(page.locator('[data-offer-listing="evidence_listing_2"] [data-stock-status]')).toHaveText("Stock unknown");
  await expect(page.locator("#productDialogBody .detail-row")).toHaveCount(3);
  expect(await page.locator("#productDialogBody .detail-row").evaluateAll(rows => rows.map(row => row.getAttribute("data-offer-listing"))))
    .toEqual(["evidence_listing_2", "evidence_listing_0", "evidence_listing_1"]);
  await expect(page.locator('[data-offer-listing="evidence_listing_1"] [data-stock-status]')).toHaveText("Reported preorder");
  await expect(page.locator('[data-offer-listing="evidence_listing_0"] [data-stock-status]')).toHaveText("Stock info stale");
  await page.keyboard.press("Escape");
  // 1ca49cd replaced Grid/List with one responsive compact layout.
  await expect(page.getByRole("group", { name: "Product layout", exact: true })).toHaveCount(0);
  await expect(card).toHaveClass(/compact-product-card/);
  await expect(card.locator("[data-stock-status]")).toHaveText("Stock unknown");
  await page.setViewportSize({ width: 1440, height: 960 });
  await expect(card).toHaveAttribute("data-store", "amazon");
  await expect(card.locator("[data-stock-status]")).toHaveText("Stock unknown");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
