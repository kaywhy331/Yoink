import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

async function report(request: APIRequestContext) {
  const actions = await (await request.get("/api/v1/user/jobs")).json();
  const job = actions.items.find((item: any) => item.retailerSku === "97000204");
  expect(job).toBeTruthy();
  return { path: `/api/v1/user/checkout-reports/${job.id}`, data: await (await request.get(`/api/v1/user/checkout-reports/${job.id}`)).json() };
}
async function correct(request: APIRequestContext, changes: any) {
  const { path, data } = await report(request);
  const response = await request.post(`${path}/preview`, { data: { kind: "correction", outcome: data.report.outcome,
    actualTotalCents: data.report.actualTotalCents, refundedCents: data.report.refundedCents,
    reason: "Browser acceptance revision", expectedReportId: data.report.id, ...changes } });
  expect(response.status()).toBe(200);
  const { preview } = await response.json();
  const saved = await request.post(`${path}/corrections`, { data: { ...preview.draft, fingerprint: preview.fingerprint,
    requestId: crypto.randomUUID(), confirmation: "CORRECT_CHECKOUT_REPORT" } });
  expect(saved.status()).toBe(200);
}
async function open(page: Page, refund = false) {
  await page.goto("/#activity");
  await page.locator(refund ? "[data-checkout-refund]" : "[data-checkout-report]").first().click();
  const dialog = page.getByRole("dialog", { name: refund ? "Record refund" : "Correct checkout report", exact: true });
  await expect(dialog.locator("#checkoutReportCurrent")).toContainText("Charged");
  return page.locator("#checkoutReportDialog");
}
async function reviewChange(page: Page) {
  const [response] = await Promise.all([
    page.waitForResponse(response => response.url().includes("/checkout-reports/") && response.url().endsWith("/preview") && response.request().method() === "POST"),
    page.locator("#checkoutReportDialog").getByRole("button", { name: "Review change", exact: true }).click()
  ]);
  expect(response.status()).toBe(200);
}
test.beforeEach(async ({ page, request }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:33993(?:\/|$))/, route => route.abort());
  page.on("pageerror", error => { throw error; });
  const { data } = await report(request);
  if (data.report.outcome !== "got_it" || data.report.actualTotalCents !== 2000 || data.report.refundedCents !== 0) {
    await correct(request, { outcome: "got_it", actualTotalCents: 2000, refundedCents: 0, fulfilledQuantity: 1 });
  }
});

test("phone correction review updates Activity and refunds preserve gross charges", async ({ page }, testInfo) => {
  const dialog = await open(page);
  await dialog.getByLabel("Amount charged ($)", { exact: true }).fill("25.00");
  await dialog.getByLabel("Reason for change").fill("Corrected receipt total");
  await reviewChange(page);
  await expect(dialog.getByRole("table")).toContainText("$20.00");
  await expect(dialog.getByRole("table")).toContainText("$25.00");
  await dialog.getByLabel("I reviewed the amounts and plan progress.").check();
  await dialog.getByRole("button", { name: "Save report change" }).click();
  await expect(dialog.locator("#checkoutReportStatus")).toContainText("Report saved");
  await expect(dialog.locator("#checkoutReportCurrent")).toContainText("Charged $25.00");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator("[data-checkout-report]").first()).toBeFocused();
  await page.locator("[data-checkout-refund]").first().click();
  await dialog.getByLabel("Refund amount ($)", { exact: true }).fill("5.00");
  await dialog.getByLabel("Reason for change").fill("Partial store refund");
  await reviewChange(page);
  await expect(dialog.getByRole("table")).toContainText("Got it");
  await dialog.getByLabel("I reviewed the amounts and plan progress.").check();
  await dialog.getByRole("button", { name: "Save report change" }).click();
  await expect(dialog.locator("#checkoutReportStatus")).toContainText("Report saved");
  await expect(dialog.locator("#checkoutReportCurrent")).toContainText("Charged $25.00 · Refunded $5.00 · Net $20.00");
  await dialog.getByText("Report history", { exact: true }).click();
  await expect(dialog.locator("#checkoutReportHistory")).toContainText("Original report");
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("checkout-report-mobile.png"), fullPage: true });
});

test("changing outcome requires reviewed progress and dirty drafts survive background updates", async ({ page, request }) => {
  const dialog = await open(page);
  await dialog.getByLabel("Checkout result").selectOption("missed_it");
  await expect(dialog.getByLabel("Total quantity received for this plan")).toHaveValue("0");
  await dialog.getByLabel("Reason for change").fill("Reported the wrong order");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Discard this report draft?" })).toBeVisible();
  await page.locator("#confirmDialogCancel").click();
  await expect(dialog.getByLabel("Reason for change")).toHaveValue("Reported the wrong order");
  await reviewChange(page);
  await expect(dialog.locator("#checkoutReportPlanEffect")).toContainText("0 of 2 received");
  await expect(dialog.locator("#checkoutReportPlanEffect")).toContainText("paused");
  await dialog.getByLabel("I reviewed the amounts and plan progress.").check();
  await dialog.getByRole("button", { name: "Save report change" }).click();
  await expect(dialog.locator("#checkoutReportStatus")).toContainText("Report saved");
  const { data } = await report(request);
  expect(data.report.outcome).toBe("missed_it"); expect(data.plan.fulfilledQuantity).toBe(0); expect(data.plan.status).toBe("paused");
});

test("a lost save response retries the same correction without applying a refund twice", async ({ page, request }) => {
  const dialog = await open(page, true);
  const { path, data } = await report(request);
  let lost = false; const commands: any[] = [];
  await page.route(`**${path}/corrections`, async route => {
    commands.push(route.request().postDataJSON());
    if (!lost) { lost = true; await route.fetch(); await route.abort("failed"); }
    else await route.continue();
  });
  await dialog.getByLabel("Refund amount ($)", { exact: true }).fill("3.00");
  await dialog.getByLabel("Reason for change").fill("Refund retry acceptance");
  await reviewChange(page);
  await dialog.getByLabel("I reviewed the amounts and plan progress.").check();
  await dialog.getByRole("button", { name: "Save report change" }).click();
  await expect(dialog.locator("#checkoutReportStatus")).toHaveClass(/warn/);
  await dialog.getByRole("button", { name: "Save report change" }).click();
  await expect(dialog.locator("#checkoutReportStatus")).toContainText("Report saved");
  expect(commands).toHaveLength(2); expect(commands[0]).toEqual(commands[1]);
  const after = (await report(request)).data;
  expect(after.report.refundedCents).toBe(300); expect(after.history.total).toBe(data.history.total + 1);
});

test("a stale report offers reload and requires another review", async ({ page, request }) => {
  const dialog = await open(page);
  await dialog.getByLabel("Amount charged ($)", { exact: true }).fill("24.00");
  await dialog.getByLabel("Reason for change").fill("Stale draft acceptance");
  await reviewChange(page);
  await correct(request, { actualTotalCents: 2300 });
  await dialog.getByLabel("I reviewed the amounts and plan progress.").check();
  await dialog.getByRole("button", { name: "Save report change" }).click();
  await expect(dialog.locator("#checkoutReportStatus")).toContainText("report changed");
  await dialog.getByRole("button", { name: "Reload report" }).click();
  await page.locator("#confirmDialogSubmit").click();
  await expect(dialog.getByLabel("Amount charged ($)", { exact: true })).toHaveValue("23.00");
  await expect(dialog.getByRole("button", { name: "Review change", exact: true })).toBeVisible();
});

test("history pages remain available without losing an in-progress draft", async ({ page, request }) => {
  for (let index = 0; index < 26; index++) await correct(request, { actualTotalCents: index % 2 ? 2000 : 2100 });
  const dialog = await open(page);
  await dialog.getByLabel("Reason for change").fill("Keep this draft while browsing history");
  await dialog.getByText("Report history", { exact: true }).click();
  await expect(dialog.locator("#checkoutReportHistory li")).toHaveCount(25);
  await dialog.getByRole("button", { name: "Older reports" }).click();
  await expect(dialog.locator("#checkoutHistoryPage")).toContainText("26–");
  await expect(dialog.getByLabel("Reason for change")).toHaveValue("Keep this draft while browsing history");
  await dialog.getByRole("button", { name: "Newer reports" }).click();
  await expect(dialog.locator("#checkoutHistoryPage")).toContainText("1–25");
});
