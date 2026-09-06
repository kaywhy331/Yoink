import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test.use({ screenshot: "off", trace: "off", video: "off" });

test("packaged American Eagle runner binds captured child SKUs and preserves exact cart deltas", async ({ page }) => {
  const products = [
    { name: "tote-product", sku: "0045503992", price: 3495, style: "0427_9775_410" },
    { name: "charm-product", sku: "0045350782", price: 1795, style: "0577_9778_900" }
  ];
  const clicks: string[] = [];
  await page.exposeFunction("recordAdd", (sku: string) => { clicks.push(sku); });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    const product = products.find(p => url.pathname === `/us/en/p/${p.style}`);
    const fixture = url.pathname === "/us/en/cart" ? ["empty-cart", "tote-cart", "two-item-cart"][clicks.length] : product?.name;
    if (fixture) return route.fulfill({ contentType: "text/html; charset=utf-8", body: await readFile(`test/fixtures/retailers/americaneagle/${fixture}.html`, "utf8") });
    return route.abort();
  });
  const inject = async () => {
    await page.addStyleTag({ content: '[data-yoink-vis="0"] { display: none !important; }' });
    await page.addScriptTag({ path: "apps/extension/americaneagle-action.js" });
  };
  for (const product of products) {
    await page.goto("https://www.ae.com/us/en/cart"); await inject();
    const baseline = await page.evaluate(() => (globalThis as any).YoinkAmericanEagleAction.inspectAmericanEagleCartBaseline(document, location.href));
    expect(baseline.ok).toBe(true);
    await page.goto(`https://www.ae.com/us/en/p/${product.style}?sku=${product.sku}`); await inject();
    const result = await page.evaluate(product => {
      const runner = (globalThis as any).YoinkAmericanEagleAction;
      const job = { adapterVersion: "americaneagle-add-v1", contractVersion: 1, jobId: `browser_${product.sku}`, retailerId: "americaneagle",
        retailerSku: product.sku, canonicalUrl: location.href, action: "add_to_cart", quantity: 1, maxUnitPriceCents: product.price,
        maxOrderTotalCents: product.price, currency: "USD", sellerPolicy: "first_party_only", expectedSeller: "American Eagle", fulfillment: "shipping",
        expiresAt: new Date(Date.now() + 60_000).toISOString() };
      let count = 0;
      document.querySelector('[data-test-psp] button[data-test-btn="addToBag"]')!.addEventListener("click", event => {
        event.preventDefault(); count++; void (globalThis as any).recordAdd(product.sku);
      });
      const rehearsal = runner.rehearseAmericanEagleAdd(document, location.href, job), afterRehearsal = count;
      const prepared = runner.prepareAmericanEagleAdd(document, location.href, job);
      const commit = runner.commitAmericanEagleAdd(document, location.href, job, prepared.authorizationId);
      const duplicate = runner.commitAmericanEagleAdd(document, location.href, job, prepared.authorizationId);
      return { rehearsal, afterRehearsal, prepared, commit, duplicate, count, job };
    }, product);
    expect(result.rehearsal.ok, JSON.stringify(result)).toBe(true); expect(result.afterRehearsal).toBe(0);
    expect(result.commit.clicked).toBe(true); expect(result.duplicate.clicked).toBe(false); expect(result.count).toBe(1);
    await expect.poll(() => clicks.includes(product.sku)).toBe(true);
    await page.goto("https://www.ae.com/us/en/cart"); await inject();
    const verified = await page.evaluate(({ result, baseline }) => (globalThis as any).YoinkAmericanEagleAction.verifyAmericanEagleAddedCart(
      document, location.href, result.job, result.commit.proof, baseline.proof), { result, baseline });
    expect(verified.ok).toBe(true); expect(verified.proof.quantity).toBe(1);
  }
  expect(clicks).toEqual(products.map(product => product.sku));
});

test("American Eagle shopper and admin setup remain inactive until qualified", async ({ page }) => {
  page.on("pageerror", error => { throw error; });
  await page.goto("/#stores?setupStore=americaneagle");
  const dialog = page.getByRole("dialog", { name: /american eagle setup/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-setup-step="activation"]')).toContainText("Needs attention");
  await page.goto("/admin#stores/readiness/americaneagle");
  await page.locator('[data-qualification-retailer="americaneagle"]').click();
  await expect(page.locator('[data-qualification-panel="americaneagle"]')).toBeVisible();
  await expect(page.locator("#activateAmericanEagleAddButton")).toBeDisabled();
});
