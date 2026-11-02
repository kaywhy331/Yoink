import { expect, test } from '@playwright/test';

test('admin Wanted join confirms, scopes feedback and preserves pending approval', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route('**/api/v1/admin/snapshot?*', async route => {
    const response = await route.fetch(); const snapshot = await response.json();
    snapshot.counts.onlineDevices = 1;
    snapshot.targetQualification = { ...snapshot.targetQualification, qualificationEvidenceReady: true };
    await route.fulfill({ response, json: snapshot });
  });
  const posted: unknown[] = []; let pending = false;
  await page.route('**/api/v1/admin/stores/target/turn-on', async route => {
    posted.push(route.request().postDataJSON());
    await route.fulfill({ status: pending ? 202 : 200, json: pending ? { disposition: 'pending_approval' }
      : { disposition: 'turned_on', wants: { updated: 2, skipped: [{ id: 'fixture_review', title: 'Review item', reason: 'needs_review' }] } } });
  });
  await page.goto('/admin#stores/qualification/target');
  const button = page.locator('[data-admin-store-join="target"]');
  await expect(button).toBeEnabled(); await button.scrollIntoViewIfNeeded(); await button.click();
  await expect(page.locator('#confirmDialog')).toContainText('Enable Target Wanted cart adds?');
  await expect(page.locator('#confirmDialog')).toContainText('Test mode ends, so matches can add to cart.');
  await page.screenshot({ path: testInfo.outputPath('admin-store-confirmation.png'), fullPage: true });
  await page.locator('#confirmDialogCancel').click(); expect(posted).toHaveLength(0);
  await button.click(); await page.locator('#confirmDialogSubmit').click();
  const status = page.locator('[data-admin-store-join-status="target"]');
  await expect(status).toContainText('Target is enabled. 2 Wanted items now include this store. 1 item kept its stores.');
  await expect(status).toContainText('Review item: Needs review');
  await expect(status).toContainText('Edit it in Wanted to add Target.');
  expect(posted).toEqual([{ confirmation: 'TURN_ON_STORE_CART_ADDS' }]);
  await expect(page.locator('[data-admin-store-join-status="walmart"]')).toHaveText('');
  await page.screenshot({ path: testInfo.outputPath('admin-store-result.png'), fullPage: true });
  pending = true;
  await button.click(); await page.locator('#confirmDialogSubmit').click();
  await expect(page).toHaveURL(/#approvals$/);
  await page.evaluate(() => { location.hash = 'stores/qualification/target'; });
  await expect(status).toBeVisible();
  // The pending result is retained for the target store, with no earned-success claim.
  await expect(status).toContainText('Pending approval. No store or Wanted items changed.');
  await expect(status).not.toContainText('is enabled');
  await page.screenshot({ path: testInfo.outputPath('admin-store-pending.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('admin retry saves actual four-try twelve-minute policy and reloads it', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/admin#settings/automation');
  await page.getByText('Sold-out retries', { exact: true }).click();
  const form = page.locator('#adminRestockRetryForm');
  await form.locator('[name="enabled"]').check();
  await form.locator('[name="attempts"]').fill('4');
  await form.locator('[name="windowMinutes"]').fill('12');
  await expect(page.locator('#adminRestockRetrySummary')).toHaveText('Up to 4 more tries, about every 3 min, within 12 minutes of the first. Each try checks the price, seller and stock again before adding, and never adds a second one.');
  const saved = page.waitForRequest(request => request.url().endsWith('/api/v1/admin/settings/restock-retry') && request.method() === 'PATCH');
  await form.getByRole('button', { name: 'Save retry policy' }).click();
  expect((await saved).postDataJSON()).toEqual({ enabled: true, attempts: 4, windowMinutes: 12 });
  await expect(page.locator('#adminRetryStatus')).toHaveText('Retry policy saved.');
  await expect(page.locator('#toast')).toContainText('Retry when sold out is on.');
  await page.screenshot({ path: testInfo.outputPath('admin-retry-on-four-twelve.png'), fullPage: true });
  await page.reload(); await page.getByText('Sold-out retries', { exact: true }).click();
  await expect(form.locator('[name="enabled"]')).toBeChecked();
  await expect(form.locator('[name="attempts"]')).toHaveValue('4');
  await expect(form.locator('[name="windowMinutes"]')).toHaveValue('12');
  await expect(form.locator('.restock-retry-fields')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('admin-retry-persisted.png'), fullPage: true });
  expect(errors).toEqual([]);
});
