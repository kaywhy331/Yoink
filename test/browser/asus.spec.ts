import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";

test.use({ screenshot: "off", trace: "off", video: "off" });

test("packaged ASUS runner replays both captured products and the fresh cart-section response", async ({ page }) => {
  const products = await Promise.all(["mouse", "pad"].map(async name => ({
    ...JSON.parse(await readFile(`docs/store-evidence/asus/${name}-product-2026-09-06.json`, "utf8")), name
  })));
  const captured = JSON.parse(await readFile("docs/store-evidence/asus/cart-three-2026-09-06.json", "utf8")).cart;
  const clicks: string[] = [];
  await page.exposeFunction("recordAdd", (sku: string) => { clicks.push(sku); });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    const product = products.find(p => p.url === url.href);
    if (product) return route.fulfill({ contentType: "text/html; charset=utf-8",
      body: gunzipSync(await readFile(`test/fixtures/capsules/asus/${product.name}-product.html.gz`)).toString("utf8") });
    if (url.href === "https://eshop.asus.com/us/checkout/cart/") return route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body>Your Cart</body></html>" });
    if (url.href === "https://eshop.asus.com/us/customer/section/load/?sections=cart&force_new_section_timestamp=true") {
      expect(route.request().method()).toBe("GET");
      const items = captured.items.filter((item: any) => clicks.includes(item.product_sku)).map((item: any) => ({ ...item, qty: 1, product_origin_price: item.product_price_value }));
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ cart: { ...captured, items, summary_count: items.length,
        subtotalAmount: items.reduce((total: number, item: any) => total + item.product_price_value, 0) } }) });
    }
    return route.abort();
  });
  const inject = async () => {
    await page.addStyleTag({ content: '[data-yoink-vis="0"] { display: none !important; }' });
    await page.addScriptTag({ path: "apps/extension/asus-action.js" });
  };
  for (const product of products) {
    await page.goto("https://eshop.asus.com/us/checkout/cart/"); await inject();
    const baseline = await page.evaluate(() => (globalThis as any).YoinkAsusAction.inspectAsusCartBaseline(document, location.href));
    expect(baseline.ok, JSON.stringify(baseline)).toBe(true);
    await page.goto(product.url); await inject();
    const result = await page.evaluate(product => {
      const runner = (globalThis as any).YoinkAsusAction;
      const job = { adapterVersion: "asus-add-v1", contractVersion: 1, jobId: `browser_${product.sku}`, retailerId: "asus",
        retailerSku: product.sku, canonicalUrl: location.href, action: "add_to_cart", quantity: 1,
        maxUnitPriceCents: product.priceCents, maxOrderTotalCents: product.priceCents, currency: "USD",
        sellerPolicy: "first_party_only", expectedSeller: "ASUS", fulfillment: "shipping", expiresAt: new Date(Date.now() + 60_000).toISOString() };
      let count = 0;
      document.querySelector("#product-addtocart-button")!.addEventListener("click", event => { event.preventDefault(); count++; void (globalThis as any).recordAdd(product.sku); });
      const rehearsal = runner.rehearseAsusAdd(document, location.href, job), afterRehearsal = count;
      const prepared = runner.prepareAsusAdd(document, location.href, job);
      const commit = runner.commitAsusAdd(document, location.href, job, prepared.authorizationId);
      const duplicate = runner.commitAsusAdd(document, location.href, job, prepared.authorizationId);
      return { rehearsal, afterRehearsal, prepared, commit, duplicate, count, job };
    }, product);
    expect(result.rehearsal.ok, JSON.stringify(result)).toBe(true); expect(result.afterRehearsal).toBe(0);
    expect(result.commit.clicked).toBe(true); expect(result.duplicate.clicked).toBe(false); expect(result.count).toBe(1);
    await expect.poll(() => clicks.includes(product.sku)).toBe(true);
    await page.goto("https://eshop.asus.com/us/checkout/cart/"); await inject();
    const verified = await page.evaluate(({ result, baseline }) => (globalThis as any).YoinkAsusAction.verifyAsusAddedCart(
      document, location.href, result.job, result.commit.proof, baseline.proof), { result, baseline });
    expect(verified.ok, JSON.stringify(verified)).toBe(true); expect(verified.proof.quantity).toBe(1);
  }
  expect(clicks).toEqual(products.map(product => product.sku));
});

test("ASUS shopper and admin setup remain inactive until qualified", async ({ page }) => {
  page.on("pageerror", error => { throw error; });
  await page.goto("/#stores?setupStore=asus");
  const dialog = page.getByRole("dialog", { name: /asus setup/i });
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-setup-step="permission"]').waitFor();
  expect(await dialog.locator("[data-setup-step]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-setup-step")))).toEqual(["companion", "permission", "sign_in", "pause"]);
  await expect(dialog.locator('[data-setup-step="activation"]')).toHaveCount(0);
  await expect(dialog.locator('a[href^="/admin"]')).toHaveCount(0);
  await page.goto("/admin#stores/readiness/asus");
  await page.locator('[data-qualification-retailer="asus"]').click();
  await expect(page.locator('[data-qualification-panel="asus"]')).toBeVisible();
  await expect(page.locator("#activateAsusAddButton")).toBeDisabled();
});
