import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";

test.use({ screenshot: "off", trace: "off", video: "off" });

test("packaged Athleta runner adds both captured One Size products across the two store hosts", async ({ page }) => {
  const products = await Promise.all(["scrunchie", "headband"].map(async name => ({
    ...JSON.parse(await readFile(`docs/store-evidence/athleta/${name}-product-2026-09-06.json`, "utf8")), name
  })));
  const bag = JSON.parse(await readFile("docs/store-evidence/athleta/two-item-cart-2026-09-06.json", "utf8"));
  const cartUrl = "https://secure-athleta.gap.com/shopping-bag";
  const clicks: string[] = [];
  await page.exposeFunction("recordAdd", (sku: string) => { clicks.push(sku); });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    const product = products.find(p => new URL(p.url).origin === url.origin && new URL(p.url).search === url.search);
    if (product) return route.fulfill({ contentType: "text/html; charset=utf-8",
      body: gunzipSync(await readFile(`test/fixtures/capsules/athleta/${product.name}-product.html.gz`)).toString("utf8") });
    if (url.href === cartUrl) {
      const rows = bag.items.filter((item: any) => clicks.some(sku => item.html.includes(`pid=${sku}`)));
      return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body>
        <button id="shopping-bag" aria-label="${rows.length} items in your shopping bag"></button>
        ${rows.length ? `<ul>${rows.map((r: any) => r.html).join("")}</ul>` : "<p>Your bag is currently empty.</p>"}
        <button id="checkout">Checkout</button></body></html>` });
    }
    return route.abort();
  });
  const inject = async () => {
    await page.addStyleTag({ content: '[data-yoink-vis="0"], [data-assessment-visible="false"] { display: none !important; }' });
    await page.addScriptTag({ path: "apps/extension/athleta-action.js" });
  };
  for (const product of products) {
    await page.goto(cartUrl); await inject();
    const baseline = await page.evaluate(() => (globalThis as any).YoinkAthletaAction.inspectAthletaCartBaseline(document, location.href));
    expect(baseline.ok, JSON.stringify(baseline)).toBe(true);
    await page.goto(product.url); await inject();
    const result = await page.evaluate(product => {
      const runner = (globalThis as any).YoinkAthletaAction;
      const job = { adapterVersion: "athleta-add-v1", contractVersion: 1, jobId: `browser_${product.sku}`, retailerId: "athleta",
        retailerSku: product.sku, canonicalUrl: `https://athleta.gap.com/browse/product.do?pid=${product.sku}`, action: "add_to_cart", quantity: 1,
        maxUnitPriceCents: 1500, maxOrderTotalCents: 1500, currency: "USD", sellerPolicy: "first_party_only",
        expectedSeller: "Athleta", fulfillment: "shipping", expiresAt: new Date(Date.now() + 60_000).toISOString() };
      let count = 0;
      document.querySelector("#pdp-atb-btn")!.addEventListener("click", event => { event.preventDefault(); count++; void (globalThis as any).recordAdd(product.sku); });
      const rehearsal = runner.rehearseAthletaAdd(document, location.href, job), afterRehearsal = count;
      const prepared = runner.prepareAthletaAdd(document, location.href, job);
      const commit = runner.commitAthletaAdd(document, location.href, job, prepared.authorizationId);
      const duplicate = runner.commitAthletaAdd(document, location.href, job, prepared.authorizationId);
      return { rehearsal, afterRehearsal, prepared, commit, duplicate, count, job };
    }, product);
    expect(result.rehearsal.ok, JSON.stringify(result)).toBe(true); expect(result.afterRehearsal).toBe(0);
    expect(result.commit.clicked).toBe(true); expect(result.duplicate.clicked).toBe(false); expect(result.count).toBe(1);
    await expect.poll(() => clicks.includes(product.sku)).toBe(true);
    await page.goto(cartUrl); await inject();
    const verified = await page.evaluate(({ result, baseline }) => {
      let clicks = 0; document.addEventListener("click", () => { clicks++; });
      return { result: (globalThis as any).YoinkAthletaAction.verifyAthletaAddedCart(
        document, location.href, result.job, result.commit.proof, baseline.proof), clicks };
    }, { result, baseline });
    expect(verified.result.ok, JSON.stringify(verified)).toBe(true); expect(verified.result.proof.quantity).toBe(1);
    expect(verified.clicks).toBe(0);
  }
  expect(clicks).toEqual(products.map(product => product.sku));
});

test("Athleta shopper and admin setup remain inactive until qualified", async ({ page }) => {
  page.on("pageerror", error => { throw error; });
  await page.goto("/#stores?setupStore=athleta");
  const dialog = page.getByRole("dialog", { name: /athleta setup/i });
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-setup-step="permission"]').waitFor();
  expect(await dialog.locator("[data-setup-step]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-setup-step")))).toEqual(["companion", "permission", "sign_in", "pause"]);
  await expect(dialog.locator('[data-setup-step="activation"]')).toHaveCount(0);
  await expect(dialog.locator('a[href^="/admin"]')).toHaveCount(0);
  await page.goto("/admin#stores/readiness/athleta");
  await page.locator('[data-qualification-retailer="athleta"]').click();
  await expect(page.locator('[data-qualification-panel="athleta"]')).toBeVisible();
  await expect(page.locator("#activateAthletaAddButton")).toBeDisabled();
});
