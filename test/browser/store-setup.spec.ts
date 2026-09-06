import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page, context }) => {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1:33993(?:\/|$))/, route => route.abort());
  page.on("pageerror", error => { throw error; });
});

test("a guarded plan opens a shareable store checklist and returns to fresh plan status", async ({ page }, testInfo) => {
  await page.goto("/#plans?q=Browser+product+203");
  await page.locator('#planList .inline-actions [data-store-setup="target"]').first().click();
  const dialog = page.getByRole("dialog", { name: "Target setup", exact: true });
  await expect(dialog.locator("[data-setup-step]")).toHaveCount(9);
  await expect(page).toHaveURL(/setupStore=target.*returnPlanId=/);
  await expect(dialog.locator('[data-setup-step="permission"]')).toContainText("Not verified here");
  await expect(dialog.locator('[data-setup-step="health"] .tag')).toHaveText("Not verified here");
  await expect(dialog.locator('[data-setup-step="activation"]')).toContainText("Administrator");
  await expect(dialog).toContainText("Browser product 203 · Active");
  await page.reload();
  await expect(dialog.locator("[data-setup-step]")).toHaveCount(9);
  await page.screenshot({ path: testInfo.outputPath("target-setup-overview-mobile.png"), fullPage: true });
  await dialog.getByRole("button", { name: "How to check permission" }).click();
  await expect(dialog.locator("#storeSetupHelp")).toBeVisible();
  await expect(dialog.locator("#storeSetupHelp")).toContainText("Check again");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("target-setup-mobile.png"), fullPage: true });
  await dialog.getByRole("button", { name: "Return to plan", exact: true }).click();
  await expect(page.locator("#planDialog")).toBeVisible();
  await expect(page.locator("#planDialogTitle")).toHaveText("Browser product 203");
  await expect(page).not.toHaveURL(/setupStore=/);
  await expect(page.locator("#toast")).toContainText("Plan rechecked:");
});

test("store directory keeps browsing available when readiness fails and setup can retry", async ({ page }) => {
  await page.route("**/api/v1/user/readiness", route => route.abort("failed"));
  await page.goto("/#stores");
  const target = page.locator('#storeDirectory [data-store="target"]');
  await expect(target.getByRole("button", { name: "Shop this store" })).toBeVisible();
  await expect(target).toContainText("Your store readiness has not loaded");
  await target.getByRole("button", { name: "Review setup" }).click();
  await expect(page.locator("#storeSetupError")).toBeVisible();
  await expect(page.locator("#storeSetupContent")).not.toContainText("Loading store checks");
  await page.unroute("**/api/v1/user/readiness");
  await page.getByRole("button", { name: "Refresh checks", exact: true }).click();
  await expect(page.locator("#storeSetupError")).toHaveCount(0);
  await expect(page.locator("[data-setup-step]")).toHaveCount(9);
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/setupStore=/);
  await expect(target).toContainText("Paired Chrome needs attention");
  await expect(target.getByRole("button", { name: "Review setup" })).toBeFocused();
});

test("Back and route departure close a pending checklist without a late response reopening it", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const pending = new Promise<void>(resolve => { entered = resolve; });
  await page.goto("/#plans?q=Browser+product+203");
  await page.route("**/api/v1/user/readiness?**", async route => { entered(); await gate; await route.continue(); });
  await page.locator('#planList .inline-actions [data-store-setup="target"]').first().click();
  await pending;
  await expect(page.locator("#storeSetupContent")).toContainText("Loading store checks");
  await page.goBack();
  await expect(page.locator("#storeSetupDialog")).not.toBeVisible();
  try {
    const response = page.waitForResponse(response => response.url().includes("/user/readiness?"));
    release(); await response;
    await expect(page.locator("#storeSetupDialog")).not.toBeVisible();
    await page.evaluate(() => { location.hash = "stores?setupStore=walmart"; });
    await expect(page.getByRole("dialog", { name: "Walmart setup" })).toBeVisible();
    await page.evaluate(() => { location.hash = "calls"; });
    await expect(page.locator("#storeSetupDialog")).not.toBeVisible();
  } finally { release(); }
});

test("returning from setup preserves an individually paused plan", async ({ page }) => {
  const { items } = await (await page.request.get("/api/v1/user/purchase-intents?q=Browser+product+205")).json();
  await page.goto(`/#plans?setupStore=target&returnPlanId=${items[0].id}`);
  await expect(page.locator("#storeSetupContent")).toContainText("Browser product 205 · Paused");
  await page.getByRole("button", { name: "Return to plan", exact: true }).click();
  await expect(page.locator('#planForm [name="status"]')).toHaveValue("paused");
  const { purchaseIntent } = await (await page.request.get(`/api/v1/user/purchase-intents/${items[0].id}`)).json();
  expect(purchaseIntent.status).toBe("paused");
});

test("multi-store recovery opens the selected store and gives non-admins an honest handoff", async ({ page }) => {
  const { items } = await (await page.request.get("/api/v1/user/purchase-intents?q=Browser+product+203")).json();
  const writes: string[] = [];
  page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
  await page.route("**/api/v1/user/readiness?**", async route => {
    const response = await route.fetch(); const data = await response.json();
    data.purchaseIntent.targets.push({ retailerId: "walmart", retailerName: "Walmart", canonicalUrl: "https://www.walmart.com/ip/123456789", enabled: true });
    const walmart = data.stores.find((store: any) => store.retailerId === "walmart");
    walmart.canActivate = false; walmart.canManageExecution = false;
    walmart.nextAction = "activation"; walmart.nextOwner = "Administrator";
    await route.fulfill({ json: data });
  });
  await page.goto(`/#plans?setupStore=walmart&returnPlanId=${items[0].id}`);
  const dialog = page.getByRole("dialog", { name: "Walmart setup" });
  await expect(dialog.getByRole("link", { name: "Open Walmart in Chrome ↗" })).toHaveAttribute("data-store-canonical", "https://www.walmart.com/ip/123456789");
  await expect(dialog.locator('a[href^="/admin"]')).toHaveCount(0);
  await dialog.locator(".store-setup-next").getByRole("button", { name: "Administrator handoff" }).click();
  await expect(dialog.locator("#storeSetupHelp")).toContainText("for your account");
  await expect(dialog.locator("#storeSetupHelp")).toContainText("No request has been sent");
  expect(writes.filter(url => /qualifications|settings\/actions/.test(url))).toEqual([]);
});

test("refresh shows newly passed evidence without claiming activation or clearing a failed refresh", async ({ page }) => {
  let refreshed = false;
  await page.route("**/api/v1/user/readiness", async route => {
    const response = await route.fetch(); const data = await response.json();
    if (refreshed) for (const step of data.stores[0].steps) if (["evidence", "rehearsal"].includes(step.id)) step.state = "passed";
    await route.fulfill({ json: data });
  });
  await page.goto("/#stores?setupStore=target");
  const dialog = page.locator("#storeSetupDialog");
  await expect(dialog.locator('[data-setup-step="evidence"] .tag')).toHaveText("Needs attention");
  refreshed = true;
  await page.getByRole("button", { name: "Refresh checks", exact: true }).click();
  await expect(dialog.locator('[data-setup-step="evidence"] .tag')).toHaveText("Passed");
  await expect(dialog.locator('[data-setup-step="activation"] .tag')).toHaveText("Needs attention");
  await page.route("**/api/v1/user/readiness", route => route.abort("failed"));
  await page.getByRole("button", { name: "Refresh checks", exact: true }).click();
  await expect(page.locator("#storeSetupError")).toContainText("These checks may be out of date");
  await expect(dialog.locator('[data-setup-step="evidence"] .tag')).toHaveText("Passed");
});

test("plan drafts cannot be lost by opening setup, and missing plan links recover", async ({ page }) => {
  const { items } = await (await page.request.get("/api/v1/user/purchase-intents?q=Browser+product+203")).json();
  await page.goto(`/#plans?planId=${items[0].id}`);
  await page.locator('#planForm [name="maxAllIn"]').fill("42.00");
  await page.locator('#planStoreSetup [data-store-setup="target"]').click();
  await expect(page.locator("#planDialog")).toBeVisible();
  await expect(page.locator('#planForm [name="maxAllIn"]')).toHaveValue("42.00");
  await expect(page.locator("#toast")).toContainText("Save or close your plan draft");
  await page.keyboard.press("Escape");
  await page.locator("#confirmDialogSubmit").click();
  await expect(page.locator("#planDialog")).not.toBeVisible();
  await page.goto("/#plans?setupStore=target&returnPlanId=mission_missing");
  await expect(page.locator("#storeSetupError")).toContainText("This plan is unavailable");
  await expect(page.locator("#returnStoreSetupPlan")).toBeHidden();
  await page.getByRole("button", { name: "Close store setup" }).click();
  await expect(page.locator("#storeSetupDialog")).not.toBeVisible();
});

test("a direct setup link waits for affiliate routing before exposing store navigation", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/v1/affiliate-routing", async route => { await pending; await route.continue(); });
  await page.goto("/#stores?setupStore=walmart");
  try {
    await expect(page.locator("#storeSetupContent")).toContainText("Loading store checks");
    await expect(page.locator("#storeSetupContent a[data-store-link]")).toHaveCount(0);
    release();
    const link = page.locator('#storeSetupContent a[data-store-canonical="https://www.walmart.com/"]');
    await expect(link).toHaveAttribute("data-store-route", "affiliate");
    expect(new URL((await link.getAttribute("href"))!).searchParams.get("url")).toBe("https://www.walmart.com/");
  } finally { release(); }
});


test("authorized setup links reach the selected qualification and Chrome settings without changing gates", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/#stores?setupStore=target");
  const dialog = page.getByRole("dialog", { name: "Target setup" });
  await expect(dialog.locator("[data-setup-step]")).toHaveCount(9);
  await page.screenshot({ path: testInfo.outputPath("target-setup-desktop.png") });
  const activationPopup = page.waitForEvent("popup");
  await dialog.getByRole("link", { name: "Review Target activation ↗" }).click();
  const admin = await activationPopup;
  await expect(admin).toHaveURL(/admin#stores\/qualification\/target$/);
  await expect(admin.getByRole("heading", { name: "Target add-only qualification" })).toBeVisible();
  await expect(admin.locator("#activateTargetAddButton")).toBeDisabled();
  await admin.close();
  const chromePopup = page.waitForEvent("popup");
  await dialog.getByRole("link", { name: "Open Chrome setup ↗" }).click();
  const chrome = await chromePopup;
  await expect(chrome).toHaveURL(/#settings\/chrome$/);
  await expect(chrome.getByRole("button", { name: "Create pairing code", exact: true })).toBeVisible();
  await chrome.close();
  await expect(dialog.locator('[data-setup-step="activation"] .tag')).toHaveText("Needs attention");
});
