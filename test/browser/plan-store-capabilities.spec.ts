import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:33993(?:\/|$))/, route => route.abort());
  page.on("pageerror", error => { throw error; });
});

async function mixedPlan(page: Page) {
  const { items } = await (await page.request.get("/api/v1/user/purchase-intents?q=Browser+product+203")).json();
  const path = `/api/v1/user/purchase-intents/${items[0].id}`;
  const { purchaseIntent: plan } = await (await page.request.get(path)).json();
  plan.intentPolicy.actionCeiling = "notify";
  plan.automationReadiness.configuredAction = "notify";
  plan.targets.push({ ...plan.targets[0], id: "target_notification_only", retailerId: "disney", retailerName: "Disney Store",
    executionSupported: false, enabled: true, canonicalUrl: "https://www.disneystore.com/", fulfillment: "pickup" });
  const updates: any[] = [];
  await page.route(`**${path}`, route => {
    if (route.request().method() === "PATCH") {
      const update = route.request().postDataJSON();
      updates.push(update);
      plan.targets = plan.targets.map((target: any) => ({ ...target, ...update.targets.find((item: any) => item.id === target.id) }));
      plan.intentPolicy = { ...plan.intentPolicy, ...update.policy };
      plan.automationReadiness.configuredAction = update.policy.actionCeiling;
    }
    return route.fulfill({ json: { purchaseIntent: plan } });
  });
  await page.goto(`/#plans?planId=${plan.id}`);
  await expect(page.locator("#planDialog")).toBeVisible();
  return { plan, path, updates, notificationStore: page.locator('[data-target-id="target_notification_only"]') };
}

for (const change of ["select", "prepare"] as const) {
  test(`switching via ${change} restores notification-only stores without losing their choices`, async ({ page }, testInfo) => {
    const { notificationStore, updates } = await mixedPlan(page);
    const checkbox = notificationStore.getByRole("checkbox", { name: "Use store" });
    const action = page.locator('#planForm [name="actionCeiling"]');
    await notificationStore.locator('[data-field="maxPrice"]').fill("31.25");
    await expect(checkbox).toBeChecked();
    if (change === "select") await action.selectOption("add_to_cart");
    else await page.getByRole("button", { name: "Switch to cart mode", exact: true }).click();
    await expect(checkbox).toBeDisabled();
    await expect(checkbox).not.toBeChecked();
    await expect(notificationStore.locator("[data-cart-exclusion]")).toContainText("Switch back to Notify only before saving to restore this store");
    await action.selectOption("notify");
    await expect(checkbox).toBeEnabled();
    await expect(checkbox).toBeChecked();
    await expect(notificationStore.locator('[data-field="maxPrice"]')).toHaveValue("31.25");
    await expect(notificationStore.locator('[data-field="fulfillment"]')).toHaveValue("pickup");
    await checkbox.uncheck();
    await action.selectOption("add_to_cart");
    await action.selectOption("notify");
    await expect(checkbox).not.toBeChecked();
    expect(updates).toHaveLength(0);
    await expect(notificationStore.locator(".target-capability")).toHaveText("Browse and notifications supported. Cart adds unavailable.");
    await expect(notificationStore.locator(".target-readiness")).toContainText("Saved plan:");
    await expect(page.locator(".target-capability.good")).toHaveCount(0);
    await expect(page.locator('#planStoreSetup [data-store-setup="target"]')).toBeVisible();
    expect(await page.locator("#planDialog").evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.locator("#planDialog").evaluate(node => { node.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath(`plan-capabilities-${change}-mobile.png`) });
  });
}

for (const action of ["notify", "add_to_cart"] as const) {
  test(`saving ${action} uses only the displayed selections and reopened plans do not inherit temporary choices`, async ({ page }) => {
    const { plan, notificationStore, updates } = await mixedPlan(page);
    const actionSelect = page.locator('#planForm [name="actionCeiling"]');
    await page.getByRole("button", { name: "Switch to cart mode", exact: true }).click();
    if (action === "notify") await actionSelect.selectOption("notify");
    await page.getByRole("button", { name: "Save plan", exact: true }).click();
    await expect(page.locator("#planDialog")).not.toBeVisible();
    expect(updates).toHaveLength(1);
    expect(updates[0].policy.actionCeiling).toBe(action);
    expect(updates[0].targets.find((item: any) => item.id === "target_notification_only").enabled).toBe(action === "notify");
    await page.goto(`/#plans?planId=${plan.id}`);
    await expect(page.locator("#planDialog")).toBeVisible();
    await actionSelect.selectOption("notify");
    await expect(notificationStore.getByRole("checkbox", { name: "Use store" })).toBeChecked({ checked: action === "notify" });
    if (action === "add_to_cart") {
      await expect(page.locator('[data-retailer-id="target"] .target-readiness')).not.toContainText("Ready for calls");
      await expect(page.locator('[data-retailer-id="target"] .target-capability')).toContainText("cart adds supported");
    }
  });
}
