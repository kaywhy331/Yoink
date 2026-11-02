import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Browser acceptance is isolated from real retailers and external destinations.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:33993(?:\/|$))/, (route) => route.abort());
  page.on("pageerror", (error) => { throw error; });
});

test("every Wanted page and its search work on a phone-sized screen", async ({ page }, testInfo) => {
  const overview = await (await page.request.get("/api/v1/user/overview")).json();
  expect(overview.purchaseIntents.length).toBe(20);
  expect(overview.setup.savedPlanCount).toBe(206);
  await page.goto("/#cart");
  await expect(page.locator("#planList .product-card")).toHaveCount(50);
  await expect(page.locator("#planPageStatus")).toHaveText("1–50 of 206");
  await page.getByRole("button", { name: "Next wanted items", exact: true }).click();
  await expect(page.locator("#planPageStatus")).toHaveText("51–100 of 206");
  await page.locator("#planSearch").fill("Browser product 205");
  await expect(page.locator("#planList .product-card")).toHaveCount(1);
  await expect(page.locator("#planList")).toContainText("Paused");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("wanted-mobile.png"), fullPage: true });
  await page.locator("#planSearch").fill("not-a-saved-plan");
  await expect(page.locator("#planSummary")).toHaveText("No wanted items match.");
  await page.getByRole("button", { name: "Show all", exact: true }).click();
  await expect(page.locator("#planList .product-card")).toHaveCount(50);
});

test("search is shareable and clear restores products; route changes close named product details", async ({ page }, testInfo) => {
  await page.goto("/#products?q=Browser+product+205&sort=newest");
  await expect(page.locator("#productSearch")).toHaveValue("Browser product 205");
  await page.locator("#productList [data-product-detail]").first().click();
  const dialog = page.getByRole("dialog", { name: "Browser product 205" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Paused · Alerts");
  await page.evaluate(() => { location.hash = "calls"; });
  await expect(dialog).not.toBeVisible();
  await page.goto("/#products?q=no-such-product&sort=newest");
  await page.getByRole("button", { name: "Clear search and filters" }).click();
  await expect(page.locator("#productSearch")).toHaveValue("");
  await expect(page.locator("#productList .product-card").first()).toBeVisible();
  await expect(page).not.toHaveURL(/q=no-such-product/);
  await expect(page).toHaveURL("http://127.0.0.1:33993/#find");
  await page.screenshot({ path: testInfo.outputPath("clear-search-restored.png"), fullPage: true });
});

test("a failed initial request has an immediate retry that recovers", async ({ page }) => {
  await page.route("**/api/v1/user/library/products?**", (route) => route.abort("failed"));
  await page.goto("/#find");
  const retry = page.locator('[data-panel="find"] [data-retry-route="find"]');
  await expect(retry).toBeVisible();
  await expect(page.locator("#productList .skeleton-list")).toHaveCount(0);
  await page.unroute("**/api/v1/user/library/products?**");
  await retry.click();
  await expect(page.locator("#productList .product-card").first()).toBeVisible();
  await expect(retry).toHaveCount(0);
});

test("spending drafts survive background refresh and named dialogs return keyboard focus", async ({ page }) => {
  await page.goto("/#setup/limits");
  await expect(page.locator('#spendForm [name="revision"]')).not.toHaveValue("");
  await page.locator('#spendForm [name="daily"]').fill("123.45");
  await page.locator('#spendForm [name="timezone"]').selectOption("America/New_York");
  await page.locator('[data-setup-section="limits"]').focus();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator('#spendForm [name="daily"]')).toHaveValue("123.45");
  await expect(page.locator('#spendForm [name="timezone"]')).toHaveValue("America/New_York");
  await page.locator('[data-setup-section="stores"]').click();
  const details = page.getByRole("button", { name: "Target details", exact: true });
  await details.click();
  await expect(page.getByRole("dialog", { name: "Target setup" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(details).toBeFocused();
  await page.locator('[data-setup-section="limits"]').click();
  await expect(page.locator('#spendForm [name="daily"]')).toHaveValue("123.45");
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


test("product and plan links restore off-page details; Back closes detail and missing records recover", async ({ page }) => {
  const response = await page.request.get("/api/v1/user/library/products?q=Browser+product+205");
  const { items } = await response.json();
  const product = items[0];
  await page.goto(`/#products?productId=${product.variantId}`);
  await expect(page.getByRole("dialog", { name: "Browser product 205" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Browser product 205" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/productId=/);
  await page.goto(`/#plans?planId=${product.purchaseIntent.id}`);
  await expect(page.locator("#planDialog")).toBeVisible();
  await page.reload();
  await expect(page.locator("#planDialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/planId=/);
  await page.goto("/#products?q=Browser+product+205");
  await page.locator("#productList [data-product-detail]").first().click();
  await expect(page).toHaveURL(/productId=/);
  await page.goBack();
  await expect(page.locator("#productDialog")).not.toBeVisible();
  await page.goto("/#products?productId=variant_missing");
  await expect(page.getByRole("dialog", { name: "Detail unavailable" })).toBeVisible();
  await page.getByRole("button", { name: "Return to list", exact: true }).click();
  await expect(page).not.toHaveURL(/productId=/);
});

test("browser naming persists and notification history reaches older updates before removal", async ({ page }, testInfo) => {
  await page.goto("/#setup/chrome");
  await page.getByRole("button", { name: "Rename", exact: true }).first().click();
  await page.getByRole("textbox", { name: "Browser name", exact: true }).fill("Travel laptop");
  await page.getByRole("button", { name: "Save browser name", exact: true }).click();
  await expect(page.locator("#pairedDevices")).toContainText("Travel laptop");
  await page.reload();
  await expect(page.locator("#pairedDevices")).toContainText("Travel laptop");
  await page.goto("/#setup/alerts");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator("#notificationHistory, #connectorForm")).toHaveCount(0);
  await expect(page.locator("#yoinkBotSetup")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Telegram", exact: true })).toBeDisabled();
  await expect(page.locator(".notification-choice").filter({ hasText: "Telegram" })).toContainText("Unavailable");
  await page.screenshot({ path: testInfo.outputPath("notifications-mobile.png"), fullPage: true });
});

test("History filters from an old Activity link survive reload and clear back to all", async ({ page }) => {
  // Insights moved to Admin; its old shopper links still land on History with their filters.
  await page.goto("/#activity?window=7d&product=No+matching+product");
  await expect(page).toHaveURL(/#cart\/history\?.*product=No\+matching\+product/);
  await expect(page.locator("#activityFilterSummary")).toContainText("No matching product");
  await page.reload();
  await expect(page.locator("#activityFilterSummary")).toContainText("No matching product");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Show all activity", exact: true }).click();
  await expect(page.locator("#activityFilterSummary")).not.toBeVisible();
  await expect(page).not.toHaveURL(/product=/);
});

test("a delayed settings refresh cannot overwrite a confirmed browser rename", async ({ page }) => {
  await page.goto("/#settings/chrome");
  await expect(page.locator("[data-rename-browser]").first()).toBeVisible();
  let holdNext = true;
  let captured = false;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/v1/user/devices", async (route) => {
    const response = await route.fetch();
    if (holdNext) { holdNext = false; captured = true; await gate; }
    await route.fulfill({ response });
  });
  try {
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect.poll(() => captured).toBe(true);
    await page.locator("[data-rename-browser]").first().click();
    await page.getByRole("textbox", { name: "Browser name", exact: true }).fill("Office browser");
    await page.getByRole("button", { name: "Save browser name", exact: true }).click();
    await expect(page.locator("#pairedDevices")).toContainText("Office browser");
    const staleResponse = page.waitForResponse((response) => response.url().endsWith("/api/v1/user/devices"));
    release();
    await (await staleResponse).finished();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    await expect(page.locator("#pairedDevices")).toContainText("Office browser");
  } finally {
    release();
    // Setup reloads its devices after a rename; let a reload still in flight end with the page.
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});

test("an older detail response cannot close the detail restored by a later route load", async ({ page }) => {
  const products = await (await page.request.get("/api/v1/user/library/products?q=Browser+product+205")).json();
  const planId = products.items[0].purchaseIntent.id;
  let first = true;
  let entered!: () => void;
  const firstRequest = new Promise<void>((resolve) => { entered = resolve; });
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/api/v1/user/purchase-intents/${planId}`, async (route) => {
    const response = await route.fetch();
    if (first) { first = false; entered(); await gate; }
    await route.fulfill({ response });
  });
  try {
    await page.goto(`/#cart?planId=${planId}`);
    await firstRequest;
    // Re-enter the route deliberately. Reapplying the same pending route at
    // startup now keeps its request instead of issuing a duplicate.
    await page.evaluate(() => { location.hash = "find"; });
    await expect(page.locator('[data-panel="find"]')).toHaveClass(/active/);
    await page.evaluate((id) => { location.hash = `cart?planId=${id}`; }, planId);
    await expect(page.locator("#planDialog")).toBeVisible();
    const staleResponse = page.waitForResponse((response) => response.url().endsWith(`/purchase-intents/${planId}`));
    release();
    await (await staleResponse).finished();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    await expect(page).toHaveURL(new RegExp(`planId=${planId}`));
    await expect(page.locator("#planDialog")).toBeVisible();
  } finally { release(); }
});

test("Wanted filters restore through reload and old plan links keep their filter", async ({ page }, testInfo) => {
  await page.goto("/#plans?q=Browser+product+00&store=target&action=notify&sort=title");
  await expect(page).toHaveURL(/#cart\?q=Browser\+product\+00&view=notify$/);
  await expect(page.locator("#planList .product-card")).toHaveCount(10);
  await expect(page.locator('[data-plan-view="notify"]')).toHaveAttribute("aria-pressed", "true");
  // Other journeys pause their own fixture items; 205 is the one paused from the start.
  await page.locator("#planSearch").fill("Browser product 205");
  await page.locator('[data-plan-view="paused"]').click();
  await expect(page.locator("#planList .product-card")).toHaveCount(1);
  await expect(page.locator("#planList .product-card")).toContainText("Browser product 205");
  await expect(page).toHaveURL(/#cart\?q=Browser\+product\+205&view=paused$/);
  await page.reload();
  await expect(page.locator("#planSearch")).toHaveValue("Browser product 205");
  await expect(page.locator('[data-plan-view="paused"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#planList .product-card")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("wanted-filters-mobile.png"), fullPage: true });
  await page.locator('[data-plan-view="all"]').click();
  await page.locator("#planSearch").fill("");
  await expect(page.locator("#planList .product-card")).toHaveCount(50);
  await expect(page).not.toHaveURL(/view=|q=/);
});
test("old product reviews can be corrected and the unconfirmed correction draft survives reload", async ({ page }) => {
  await page.goto("/#products");
  await page.route("**/api/v1/user/catalog/proposals?limit=25&**", route => route.abort("failed"));
  await page.getByRole("button", { name: "All reviews", exact: true }).click();
  await expect(page.locator("#reviewHistoryError")).toBeVisible();
  await page.unroute("**/api/v1/user/catalog/proposals?limit=25&**");
  await page.locator("#retryReviewHistory").click();
  await expect(page.locator("#reviewHistoryPage")).toHaveText("1–25 of 61");
  await page.getByRole("button", { name: "Next reviews", exact: true }).click();
  await page.getByRole("button", { name: "Next reviews", exact: true }).click();
  await expect(page.locator("#reviewHistoryPage")).toHaveText("51–61 of 61");
  await expect(page.locator("#reviewHistoryList")).toContainText("Review fixture 000");
  await page.locator("#reviewHistoryList .impact-plan").filter({ hasText: "Review fixture 000" }).getByRole("button", { name: "Correct and resubmit", exact: true }).click();
  await expect(page.locator("#reviewHistoryDialog")).not.toBeVisible();
  await expect(page.locator('#productLinkForm [name="url"]')).toHaveValue("https://www.target.com/p/-/A-98700000");
  await page.locator('#productLinkForm [name="title"]').fill("Corrected review product");
  await expect(page.locator("#submitProductLinkButton")).toBeDisabled();
  page.once("dialog", dialog => dialog.accept());
  await page.reload();
  await expect(page.locator("#productList .product-card").first()).toBeVisible();
  await page.locator("#addProductButton").click();
  await expect(page.locator('#productLinkForm [name="title"]')).toHaveValue("Corrected review product");
  await expect(page.locator('#productLinkForm [name="confirmed"]')).not.toBeChecked();
  await page.locator("#checkProductLinkButton").click();
  await expect(page.locator("#productLinkPreview")).toContainText("Name supplied by you; offer data is not verified");
  await page.locator('#productLinkForm [name="confirmed"]').check();
  await page.locator("#submitProductLinkButton").click();
  await expect(page.locator("#productLinkDialog")).not.toBeVisible();
  const proposals = await (await page.request.get("/api/v1/user/catalog/proposals?limit=100")).json();
  expect(proposals.total).toBe(62);
  expect(proposals.items.find((item: any) => item.payload.title === "Corrected review product").status).toBe("pending");
  expect(proposals.items.find((item: any) => item.payload.title === "Review fixture 000").status).toBe("rejected");
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("yoinkLinkDraft:")).length)).toBe(0);
});
