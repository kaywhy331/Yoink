import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Browser acceptance is isolated from real retailers and external destinations.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:33993(?:\/|$))/, (route) => route.abort());
  page.on("pageerror", (error) => { throw error; });
});

test("all plan pages and global search work on a phone-sized screen", async ({ page }, testInfo) => {
  const overview = await (await page.request.get("/api/v1/user/overview")).json();
  expect(overview.purchaseIntents.length).toBe(20);
  expect(overview.setup.savedPlanCount).toBe(206);
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
  await page.locator("[data-product-detail]").first().click();
  await expect(page).toHaveURL(/productId=/);
  await page.goBack();
  await expect(page.locator("#productDialog")).not.toBeVisible();
  await page.goto("/#products?productId=variant_missing");
  await expect(page.getByRole("dialog", { name: "Detail unavailable" })).toBeVisible();
  await page.getByRole("button", { name: "Return to list", exact: true }).click();
  await expect(page).not.toHaveURL(/productId=/);
});

test("browser naming persists and notification history reaches older updates before removal", async ({ page }, testInfo) => {
  await page.goto("/#settings/chrome");
  await page.getByRole("button", { name: "Rename", exact: true }).first().click();
  await page.getByRole("textbox", { name: "Browser name", exact: true }).fill("Travel laptop");
  await page.getByRole("button", { name: "Save browser name", exact: true }).click();
  await expect(page.locator("#pairedDevices")).toContainText("Travel laptop");
  await page.reload();
  await expect(page.locator("#pairedDevices")).toContainText("Travel laptop");
  await page.route("**/api/v1/user/connectors/deliveries?**", (route) => route.abort("failed"));
  await page.goto("/#settings/notifications");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("#notificationHistory summary").click();
  await expect(page.locator("#deliveryHistoryError")).toBeVisible();
  await expect(page.locator('[data-panel="preferences"] [data-route-load-error]')).toHaveCount(0);
  await page.locator('[data-settings-view="chrome"]').click();
  await expect(page.getByRole("button", { name: "Rename", exact: true }).first()).toBeVisible();
  await page.locator('[data-settings-view="notifications"]').click();
  await page.unroute("**/api/v1/user/connectors/deliveries?**");
  await page.getByRole("button", { name: "Retry history", exact: true }).click();
  await expect(page.locator("#deliveryHistoryError")).not.toBeVisible();
  await expect(page.locator("#deliveryPageStatus")).toHaveText("1–50 of 55");
  await page.getByRole("button", { name: "Next updates", exact: true }).click();
  await expect(page.locator("#deliveryPageStatus")).toHaveText("51–55 of 55");
  await page.evaluate(async () => { window.scrollTo(0, 0); await new Promise(requestAnimationFrame); });
  await page.screenshot({ path: testInfo.outputPath("notifications-mobile.png"), fullPage: true });
  await page.locator("[data-connector-remove]").first().click();
  await page.getByRole("button", { name: "Remove destination", exact: true }).click();
  await expect(page.locator("#connectorList")).not.toContainText("Browser acceptance updates");
  await expect(page.locator("#deliveryPageStatus")).toHaveText("0–0 of 0");
});

test("Insights filters survive reload and follow the user into Activity and CSV", async ({ page }) => {
  await page.goto("/#activity/insights");
  await page.locator('#insightsFilters [name="window"]').selectOption("7d");
  await page.locator('#insightsFilters [name="product"]').fill("No matching product");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect(page.locator("#insightsScope")).toContainText("0 matching actions");
  await expect(page.locator("#analyticsCsv")).toHaveAttribute("href", /product=No\+matching\+product/);
  await page.reload();
  await expect(page.locator('#insightsFilters [name="product"]')).toHaveValue("No matching product");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "View matching actions", exact: true }).click();
  await expect(page.locator("#activityFilterSummary")).toContainText("No matching product");
  await page.getByRole("button", { name: "Show all activity", exact: true }).click();
  await expect(page.locator("#activityFilterSummary")).not.toBeVisible();
  await expect(page).not.toHaveURL(/product=/);
});

test("saving a separate setup keeps the original limits for existing plans", async ({ page }) => {
  const created = await page.request.post("/api/v1/user/purchase-profiles", { headers: { Origin: "http://127.0.0.1:33993" }, data: { name: "Existing browser setup", targetQuantity: 1, actionCeiling: "notify", priceMode: "fixed_cap", maxUnitPriceCents: 2000, isDefault: true } });
  expect(created.ok()).toBe(true);
  const original = (await created.json()).items.find((item: any) => item.name === "Existing browser setup");
  const plans = await (await page.request.get("/api/v1/user/purchase-intents?limit=10")).json();
  // Keep the store-setup fixture intact when report corrections change plan ordering.
  const planId = plans.items.find((item: any) => item.status === "active" && item.actionCeiling === "notify").id;
  const applied = await page.request.post("/api/v1/user/purchase-profiles/apply", { headers: { Origin: "http://127.0.0.1:33993" }, data: { profileId: original.id, missionIds: [planId], confirmation: "APPLY_PROFILE_TO_SELECTED_PURCHASE_PLANS" } });
  expect(applied.ok()).toBe(true);
  const beforePlan = await (await page.request.get(`/api/v1/user/purchase-intents/${planId}`)).json();
  await page.goto("/#settings");
  await page.locator(`[data-profile-edit="${original.id}"]`).click();
  await page.getByRole("button", { name: "Save a separate setup", exact: true }).click();
  await page.locator('#profileForm [name="name"]').fill("Future browser setup");
  await page.locator('#profileForm [name="maxUnitPrice"]').fill("35.00");
  await page.getByRole("button", { name: "Save new setup", exact: true }).click();
  await expect(page.locator("#profileDialog")).not.toBeVisible();
  const saved = await (await page.request.get("/api/v1/user/purchase-profiles")).json();
  expect(saved.items.find((item: any) => item.id === original.id).maxUnitPriceCents).toBe(2000);
  expect(saved.items.find((item: any) => item.name === "Future browser setup").maxUnitPriceCents).toBe(3500);
  const afterPlan = await (await page.request.get(`/api/v1/user/purchase-intents/${planId}`)).json();
  expect(afterPlan.purchaseIntent.intentPolicy).toEqual(beforePlan.purchaseIntent.intentPolicy);
  expect(saved.items.find((item: any) => item.id === original.id).linkedMissionCount).toBe(1);
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
  } finally { release(); }
});

test("an older detail response cannot close the detail restored by a later route load", async ({ page }) => {
  const products = await (await page.request.get("/api/v1/user/library/products?q=Browser+product+205")).json();
  const planId = products.items[0].purchaseIntent.id;
  let first = true;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/api/v1/user/purchase-intents/${planId}`, async (route) => {
    const response = await route.fetch();
    if (first) { first = false; await gate; }
    await route.fulfill({ response });
  });
  try {
    await page.goto(`/#plans?planId=${planId}`);
    await expect(page.locator("#planDialog")).toBeVisible();
    const staleResponse = page.waitForResponse((response) => response.url().endsWith(`/purchase-intents/${planId}`));
    release();
    await (await staleResponse).finished();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    await expect(page).toHaveURL(new RegExp(`planId=${planId}`));
    await expect(page.locator("#planDialog")).toBeVisible();
  } finally { release(); }
});

test("plan filters restore through reload and reviewed bulk pause/resume only changes the selected plans", async ({ page }, testInfo) => {
  await page.goto("/#plans?q=Browser+product+00&store=target&action=notify&sort=title");
  await expect(page.locator("#planList .plan-card")).toHaveCount(10);
  await expect(page.locator("#planList .plan-card").first()).toContainText("Browser product 000");
  await page.getByRole("button", { name: "Select plans", exact: true }).click();
  await page.getByLabel("Select shown", { exact: true }).check();
  await page.getByRole("button", { name: "Pause selected", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Pause 10 plans?" })).toBeVisible();
  await page.getByRole("button", { name: "Pause selected plans", exact: true }).click();
  await expect(page.locator("#planBatchResult")).toContainText("10 plans paused");
  await expect(page.locator("#planList .plan-summary-top .tag")).toHaveText(Array(10).fill("Paused"));
  await page.locator("#planStatus").selectOption("paused");
  await page.reload();
  await expect(page.locator("#planStore")).toHaveValue("target");
  await expect(page.locator("#planStatus")).toHaveValue("paused");
  await expect(page.locator("#planSort")).toHaveValue("title");
  await expect(page.locator("#planList .plan-card")).toHaveCount(10);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("plan-management-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Select plans", exact: true }).click();
  await page.getByLabel("Select shown", { exact: true }).check();
  await page.getByRole("button", { name: "Resume selected", exact: true }).click();
  await page.getByRole("button", { name: "Resume selected plans", exact: true }).click();
  await expect(page.locator("#planBatchResult")).toContainText("10 plans resumed");
  await expect(page.locator("#planList .plan-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear plan search and filter", exact: true }).click();
  await expect(page.locator("#planList .plan-card")).toHaveCount(50);
  await expect(page).not.toHaveURL(/store=|status=|action=|q=/);

});

test("setup edits review changed and skipped plans without saving, page their impact and preserve a stale draft", async ({ page }, testInfo) => {
  const headers = { Origin: "http://127.0.0.1:33993" };
  const response = await page.request.post("/api/v1/user/purchase-profiles", { headers, data: { name: "Impact browser setup", targetQuantity: 1, actionCeiling: "notify", priceMode: "fixed_cap", maxUnitPriceCents: 2000 } });
  expect(response.ok()).toBe(true);
  const profile = (await response.json()).items.find((item: any) => item.name === "Impact browser setup");
  const plans = await (await page.request.get("/api/v1/user/purchase-intents?limit=26&sort=title")).json();
  expect((await page.request.post("/api/v1/user/purchase-profiles/apply", { headers, data: { profileId: profile.id, missionIds: plans.items.map((item: any) => item.id), confirmation: "APPLY_PROFILE_TO_SELECTED_PURCHASE_PLANS" } })).ok()).toBe(true);
  await page.goto("/#settings");
  await page.locator(`[data-profile-edit="${profile.id}"]`).click();
  await page.locator('#profileForm [name="priceMode"]').selectOption("msrp");
  await page.locator('#profileForm [name="actionCeiling"]').selectOption("add_to_cart");
  await page.locator('#profileForm [name="targetQuantity"]').fill("2");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator("#profileImpactSummary")).toContainText("13 plans will update; 13 keep their current limits");
  await expect(page.locator("#profileImpactList")).toContainText("MSRP is unavailable");
  await expect(page.locator("#profileImpactList .impact-plan")).toHaveCount(20);
  const before = await (await page.request.get("/api/v1/user/purchase-profiles")).json();
  expect(before.items.find((item: any) => item.id === profile.id).targetQuantity).toBe(1);
  await page.locator("#nextProfileImpact").click();
  await expect(page.locator("#profileImpactList .impact-plan")).toHaveCount(6);
  await page.screenshot({ path: testInfo.outputPath("setup-impact-mobile.png") });
  expect((await page.request.post("/api/v1/user/purchase-profiles", { headers, data: { ...profile, name: "Changed in another session" } })).ok()).toBe(true);
  await page.getByRole("button", { name: "Confirm and save", exact: true }).click();
  await expect(page.locator("#profileImpactReview")).not.toBeVisible();
  await expect(page.locator('#profileForm [name="targetQuantity"]')).toHaveValue("2");
  await page.getByRole("button", { name: "Review changes", exact: true }).click();
  await expect(page.locator("#profileImpactSummary")).toContainText("13 plans will update");
  await page.getByRole("button", { name: "Confirm and save", exact: true }).click();
  await expect(page.locator("#profileDialog")).not.toBeVisible();
  const savedPlans = await (await page.request.get("/api/v1/user/purchase-intents?limit=26&sort=title")).json();
  expect(savedPlans.items.filter((item: any) => item.actionCeiling === "add_to_cart")).toHaveLength(13);
  await page.goto("/#plans?action=add_to_cart&q=Browser+product+0");
  await expect(page.locator("#planList .plan-card")).toHaveCount(13);
  await expect(page.locator("#planAction")).toHaveValue("add_to_cart");
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
