import { expect, test, type Page } from "@playwright/test";
import type { Server } from "node:http";
import { join } from "node:path";
import { createYoinkServer } from "../../apps/api/src/app.js";
import { YoinkDatabase } from "../../packages/database/src/database.js";
import { CatalogRepository } from "../../packages/database/src/catalog-repository.js";
import { CatalogLinkRepository } from "../../packages/database/src/catalog-link-repository.js";
import { officialMsrpFixture } from "../helpers/official-msrp.js";
import { ControlRepository } from "../../packages/database/src/control-repository.js";

let db: YoinkDatabase;
let server: Server;
let origin: string;
let listingId: string;
let variantId: string;

test.beforeEach(async ({ page }) => {
  db = new YoinkDatabase();
  const listing = new CatalogRepository(db).upsertListing({
    sourceConnectionId: "source_trackalacker_local", source: "trackalacker",
    sourceProductId: "first-plan", sourceListingId: "first-plan-target",
    title: "First plan exact product", retailerId: "target", retailerSku: "97000999",
    canonicalUrl: "https://www.target.com/p/-/A-97000999", listingStatus: "in_stock",
    executionSupported: true, observedPriceCents: 1999, currency: "USD"
  }).listing;
  listingId = listing.id;
  variantId = listing.variantId;
  officialMsrpFixture(db, listingId, Date.now(), 2499);
  server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps/web"), version: "browser-test" });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test listener");
  origin = `http://127.0.0.1:${address.port}`;
  await page.route("**/*", route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort());
  page.on("pageerror", error => { throw error; });
});

test.afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  db.close();
});

// bbd5bff replaced Review first plan with Want it; full consent remains under More options.
async function reviewFirstPlan(page: Page) {
  await page.locator("#productList [data-want-listing]").click();
  await expect(page.locator("#wantDialog")).toBeVisible();
  await expect(page.locator("#wantStores")).toContainText("97000999");
  await page.getByRole("button", { name: "More options", exact: true }).click();
}

for (const intent of ["notify", "add_to_cart"] as const) {
  test(`first ${intent} plan is reviewed and saved before Chrome, with honest phone handoff`, async ({ page }, testInfo) => {
    const started = Date.now();
    await page.goto(`${origin}/#home`);
    await expect(page.locator("#homeHeadline")).toHaveText("Make your first plan");
    await expect(page.locator('[data-setup-action="download_companion"]')).toHaveCount(0);
    await page.locator(`[data-first-plan-intent="${intent}"]`).click();
    await expect(page.locator(`[data-first-plan-intent="${intent}"]`)).toHaveAttribute("aria-pressed", "true");
    expect((await (await page.request.get(`${origin}/api/v1/user/overview`)).json()).counts.purchaseIntents).toBe(0);
    await page.screenshot({ path: testInfo.outputPath(`first-${intent}-choose-phone.png`), fullPage: true });
    const homeWords = (await page.locator("#homeFallback").innerText()).trim().split(/\s+/).length;
    expect(homeWords).toBeLessThan(150);
    await page.getByRole("button", { name: "Choose a product", exact: true }).click();
    await reviewFirstPlan(page);
    const form = page.locator("#setupForm");
    await expect(form.locator('[name="actionCeiling"]:checked')).toHaveValue(intent);
    await expect(form.locator('[name="targetQuantity"]')).toHaveValue("1");
    await expect(form.locator('[name="fulfillment"]')).toHaveValue("shipping");
    await expect(page.locator("#setupProductSummary")).toContainText("97000999");
    await expect(page.locator("#createPlanButton")).toBeDisabled();
    await expect(form.locator('[name="reviewed"]')).toBeEnabled();
    await form.locator('[name="reviewed"]').check();
    const saved = page.waitForResponse(response => response.url() === `${origin}/api/v1/user/purchase-intents` && response.request().method() === "POST");
    await page.locator("#createPlanButton").click();
    expect((await saved).status()).toBe(201);
    await page.goto(`${origin}/#home`);
    await expect(page.locator("#homeHeadline")).toContainText("Plan saved");
    // 7c691f6 shows setup progress only before saving; the saved list and next step carry it now.
    await expect(page.locator("#planSummary")).toHaveText(intent === "notify" ? "1 item · 1 alert only" : "1 item · 1 add to cart");
    await expect(page.locator("#homeNextActionTitle")).toHaveText("Install and pair Chrome");
    await expect(page.getByRole("switch", { name: "Auto-cart is off", exact: true })).toBeDisabled();
    await expect(page.locator("#planList .card-plan-state")).toHaveText(intent === "notify" ? "Alerts" : "Alerts for now");
    const overview = await (await page.request.get(`${origin}/api/v1/user/overview`)).json();
    expect(overview.setup.savedPlanCount).toBe(1);
    expect(overview.setup.readyForMonitoring).toBe(false);
    expect(overview.setup.guardedCartPlanCount).toBe(intent === "notify" ? 0 : 1);
    expect(overview.setup.readyForGuardedAdds).toBe(false);
    expect(overview.purchaseIntents[0].actionCeiling).toBe(intent);
    expect(overview.counts.actions).toBe(0);
    expect((await page.locator("#homeFallback").innerText()).trim().split(/\s+/).length).toBeLessThan(180);
    await page.evaluate(() => history.replaceState(null, "", "/?pairingCode=DO-NOT-COPY&token=DO-NOT-COPY#home"));
    await page.getByRole("button", { name: "Copy desktop setup link" }).click();
    await expect(page.getByRole("textbox", { name: "Desktop setup link" })).toHaveValue(`${origin}/#cart`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`first-${intent}-saved-phone.png`), fullPage: true });
    await testInfo.attach("scripted-time-to-saved-plan", { body: `${Date.now() - started}ms; scripted local fixture, not human usability timing`, contentType: "text/plain" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${origin}/#home`);
    await expect(page.locator("#homeHeadline")).toContainText("Plan saved");
    await expect(page.locator("[data-first-plan-intent]")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`first-${intent}-saved-desktop.png`), fullPage: true });
  });
}

test("reload restores only actor-scoped intent; edits and expired server checks require fresh consent", async ({ page }) => {
  await page.goto(`${origin}/#home`);
  await page.locator('[data-first-plan-intent="add_to_cart"]').click();
  await page.reload();
  await expect(page.locator('[data-first-plan-intent="add_to_cart"]')).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Choose a product", exact: true }).click();
  await reviewFirstPlan(page);
  const reviewed = page.locator('#setupForm [name="reviewed"]');
  await expect(reviewed).toBeEnabled();
  await reviewed.check();
  await page.locator('#setupForm [name="maxUnitPrice"]').fill("21.00");
  await expect(reviewed).not.toBeChecked();
  await page.locator('#setupForm [name="maxUnitPrice"]').blur();
  await expect(reviewed).toBeEnabled();
  await reviewed.check();
  let rejected = false;
  await page.route(`${origin}/api/v1/user/purchase-intents`, async route => {
    if (route.request().method() === "POST" && !rejected) {
      rejected = true;
      await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "purchase_intent_preflight_stale", message: "Review a fresh price check." }) });
    } else await route.continue();
  });
  const recheck = page.waitForResponse(response => response.url().endsWith("/purchase-intents/preflight") && response.request().method() === "POST");
  await page.locator("#createPlanButton").click();
  await recheck;
  await expect(reviewed).not.toBeChecked();
  await expect(page.locator("#createPlanButton")).toBeDisabled();
  await page.reload();
  await expect(page.locator("#setupDialog")).not.toBeVisible();
  expect((await (await page.request.get(`${origin}/api/v1/user/overview`)).json()).counts.purchaseIntents).toBe(0);
  await page.evaluate(() => {
    const key = "yoinkFirstPlanIntent:user_local";
    sessionStorage.setItem(key, JSON.stringify({ intent: "add_to_cart", savedAt: Date.now() - 25 * 60 * 60 * 1000 }));
  });
  await page.goto(`${origin}/#home`);
  await page.reload();
  await expect(page.locator('[data-first-plan-intent="add_to_cart"]')).toHaveAttribute("aria-pressed", "false");
  await page.locator('[data-first-plan-intent="add_to_cart"]').click();
  await page.route(`${origin}/api/v1/user/overview`, async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.actor.userId = "different-account";
    await route.fulfill({ response, json: data });
  });
  await page.goto(`${origin}/#home`);
  await page.reload();
  await expect(page.locator('[data-first-plan-intent="add_to_cart"]')).toHaveAttribute("aria-pressed", "false");
});

test("unsupported store offers notify-only review even when cart intent was selected", async ({ page }) => {
  db.run("UPDATE listings SET execution_supported = 0 WHERE id = ?", listingId);
  await page.goto(`${origin}/#home`);
  await page.locator('[data-first-plan-intent="add_to_cart"]').click();
  await page.getByRole("button", { name: "Choose a product", exact: true }).click();
  await reviewFirstPlan(page);
  await expect(page.locator('#setupForm [value="add_to_cart"]')).toBeDisabled();
  await expect(page.locator('#setupForm [value="notify"]')).toBeChecked();
  await expect(page.locator('#setupForm [name="reviewed"]')).not.toBeChecked();
  await expect(page.locator("#setupExecutionNote")).toContainText("notifications only");
});

test("pending product review is visible without Chrome and creates no plan", async ({ page }) => {
  // Keep a clean catalog while exercising the real proposal repository and API projection.
  const cleanDb = new YoinkDatabase();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  db.close();
  db = cleanDb;
  new CatalogLinkRepository(db).propose({ url: "https://www.target.com/p/-/A-97000998", title: "Awaiting review", confirmation: "PROPOSE_EXACT_PRODUCT_LINK" });
  server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps/web"), version: "browser-test" });
  await new Promise<void>(resolve => server.listen(Number(new URL(origin).port), "127.0.0.1", resolve));
  await page.goto(`${origin}/#home`);
  await expect(page.locator("#homeHeadline")).toHaveText("Your product link is in review");
  await expect(page.locator("#heroState")).toContainText("No stock claim or purchase plan was created");
  await expect(page.locator(".setup-progress")).toContainText("Plan: Not saved");
});

test("inactive saved plans are not treated as first use or resumed", async ({ page }) => {
  const control = new ControlRepository(db);
  const mission = control.ensureUserMission(variantId, listingId).mission;
  db.run("UPDATE missions SET status = 'paused' WHERE id = ?", mission.id);
  await page.goto(`${origin}/#home`);
  await expect(page.locator("[data-first-plan-intent]")).toHaveCount(0);
  await expect(page.locator("#homeHeadline")).toHaveText("Review your saved plans");
  await page.getByRole("button", { name: "Review plans", exact: true }).click();
  await expect(page.locator("#planList")).toContainText("Paused");
  const overview = await (await page.request.get(`${origin}/api/v1/user/overview`)).json();
  expect(overview.counts.purchaseIntents).toBe(1);
  expect(overview.setup.savedPlanCount).toBe(1);
  expect(overview.purchaseIntents[0].status).toBe("paused");
});

for (const intent of ["notify", "add_to_cart"] as const) {
  test(`Want it saves a first ${intent} plan only after explicit confirmation of the server preview`, async ({ page }, testInfo) => {
    await page.goto(`${origin}/#home`);
    await page.locator(`[data-first-plan-intent="${intent}"]`).click();
    await page.getByRole("button", { name: "Choose a product", exact: true }).click();
    const previewResponse = page.waitForResponse(response => response.url().endsWith("/purchase-intents/want/preview"));
    await page.locator("#productList [data-want-listing]").click();
    await previewResponse;
    const form = page.locator("#wantForm");
    await expect(page.locator("#wantSave")).toBeDisabled();
    expect((await (await page.request.get(`${origin}/api/v1/user/overview`)).json()).counts.purchaseIntents).toBe(0);
    const freshPreview = page.waitForResponse(response => response.url().endsWith("/purchase-intents/want/preview")
      && response.request().postDataJSON().maxUnitPriceCents === 1999
      && (intent === "notify" || response.request().postDataJSON().confirmedMsrpCents === 1999));
    await form.locator('[name="wantMax"]').fill("19.99");
    if (intent === "add_to_cart") {
      await form.locator('[name="wantAnyPrice"]').uncheck();
      await form.locator('[name="wantMsrp"]').fill("19.99");
      await expect(form.locator('[name="wantAnyPrice"]')).not.toBeChecked();
    }
    const { preview } = await (await freshPreview).json();
    await form.locator('[name="wantMax"]').blur();
    if (intent === "add_to_cart") await form.locator('[name="wantMsrp"]').blur();
    await expect(form.locator('[name="wantMode"]:checked')).toHaveValue(intent);
    await expect(form.locator('[name="wantQuantity"]')).toHaveValue("1");
    await expect(form).toContainText("Sold by the store itself · Shipping · This exact item only.");
    await expect(page.locator("#wantStores")).toContainText("97000999");
    await expect(page.locator("#wantStores")).toContainText(intent === "notify" ? "Alerts you" : "Alerts for now");
    await expect(page.locator("#wantSave")).toBeEnabled();
    expect((await (await page.request.get(`${origin}/api/v1/user/overview`)).json()).counts.purchaseIntents).toBe(0);
    const saved = page.waitForResponse(response => response.url() === `${origin}/api/v1/user/purchase-intents/want` && response.request().method() === "POST");
    await page.locator("#wantSave").click();
    const response = await saved;
    expect(response.status()).toBe(201);
    expect(response.request().postDataJSON()).toMatchObject({
      confirmation: "SAVE_PRODUCT_WANT", mode: intent, listingId, targetQuantity: 1,
      maxUnitPriceCents: 1999, previewFingerprint: preview.previewFingerprint, previewedAt: preview.previewedAt
    });
    await expect(page.locator("#wantDialog")).not.toBeVisible();
    const overview = await (await page.request.get(`${origin}/api/v1/user/overview`)).json();
    expect(overview.setup.savedPlanCount).toBe(1);
    expect(overview.purchaseIntents[0].actionCeiling).toBe(intent);
    expect(overview.setup.readyForGuardedAdds).toBe(false);
    expect(overview.counts.actions).toBe(0);
    await page.goto(`${origin}/#home`);
    await expect(page.locator("#homeHeadline")).toContainText("Plan saved");
    await page.screenshot({ path: testInfo.outputPath(`want-${intent}-saved-phone.png`), fullPage: true });
  });
}
