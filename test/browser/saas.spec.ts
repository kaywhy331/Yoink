import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Browser acceptance is isolated from real retailers and external destinations.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:33993(?:\/|$))/, (route) => route.abort());
  page.on("pageerror", (error) => { throw error; });
});

test("all plan pages and global search work on a phone-sized screen", async ({ page }, testInfo) => {
  await page.goto("/#plans");
  await expect(page.locator("#planList .plan-card")).toHaveCount(50);
  await expect(page.locator("#planPageStatus")).toHaveText("1–50 of 206");
  await page.getByRole("button", { name: "Next plans", exact: true }).click();
  await expect(page.locator("#planPageStatus")).toHaveText("51–100 of 206");
  await page.locator("#planSearch").fill("Browser product 205");
  await expect(page.locator("#planList .plan-card")).toHaveCount(1);
  await expect(page.locator("#planList")).toContainText("Paused");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("plans-mobile.png"), fullPage: true });
  await page.locator("#planSearch").fill("not-a-saved-plan");
  await expect(page.locator("#planSummary")).toHaveText("No plans match this search or filter.");
  await page.getByRole("button", { name: "Clear plan search and filter" }).click();
  await expect(page.locator("#planList .plan-card")).toHaveCount(50);
});

test("search is shareable and clear restores products; route changes close named product details", async ({ page }) => {
  await page.goto("/#products?q=Browser+product+205&sort=newest");
  await expect(page.locator("#productSearch")).toHaveValue("Browser product 205");
  await page.locator("[data-product-detail]").first().click();
  const dialog = page.getByRole("dialog", { name: "Browser product 205" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Plan paused");
  await page.evaluate(() => { location.hash = "calls"; });
  await expect(dialog).not.toBeVisible();
  await page.goto("/#products?q=no-such-product&sort=newest");
  await page.getByRole("button", { name: "Clear search and filters" }).click();
  await expect(page.locator("#productSearch")).toHaveValue("");
  await expect(page.locator("#productList .product-card").first()).toBeVisible();
  await expect(page).not.toHaveURL(/q=no-such-product/);
});

test("a failed initial request has an immediate retry that recovers", async ({ page }) => {
  await page.route("**/api/v1/user/library/products?**", (route) => route.abort("failed"));
  await page.goto("/#products");
  const retry = page.locator('[data-panel="products"] [data-retry-route="products"]');
  await expect(retry).toBeVisible();
  await expect(page.locator("#productList .skeleton-list")).toHaveCount(0);
  await page.unroute("**/api/v1/user/library/products?**");
  await retry.click();
  await expect(page.locator("#productList .product-card").first()).toBeVisible();
  await expect(retry).toHaveCount(0);
});

test("spending drafts survive background refresh and named dialogs return keyboard focus", async ({ page }) => {
  await page.goto("/#settings");
  await expect(page.locator('#spendForm [name="revision"]')).not.toHaveValue("");
  await page.locator('#spendForm [name="daily"]').fill("123.45");
  await page.locator('#spendForm [name="timezone"]').selectOption("America/New_York");
  await page.locator('[data-settings-view="purchase"]').focus();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator('#spendForm [name="daily"]')).toHaveValue("123.45");
  await expect(page.locator('#spendForm [name="timezone"]')).toHaveValue("America/New_York");
  await page.locator("#newProfileButton").click();
  await expect(page.getByRole("dialog", { name: "New setup" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#newProfileButton")).toBeFocused();
});

test("expired pairing codes stop looking usable and can be regenerated", async ({ page }) => {
  let codeRequests = 0;
  await page.route("**/api/v1/user/devices/pairing-code", (route) => {
    codeRequests += 1;
    return route.fulfill({ json: { pairing: { code: "ABCD-EFGH-JKLM", expiresAt: new Date(Date.now() + 1000).toISOString() } } });
  });
  await page.goto("/#settings/chrome");
  await page.getByRole("button", { name: "Create pairing code", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copy code" })).toBeVisible();
  await expect(page.locator("#pairing")).toContainText("Pairing code expired");
  await expect(page.locator("#copyPairing")).toHaveCount(0);
  await page.getByRole("button", { name: "Create a new code" }).click();
  await expect(page.getByRole("button", { name: "Copy code" })).toBeVisible();
  expect(codeRequests).toBe(2);
});
