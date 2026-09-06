import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { ADD_LANES } from "../../packages/contracts/src/index.js";

test.use({ screenshot: "off", trace: "off", video: "off" });

const stores = [
  { id: "audioadvice", names: ["coupler", "caps"] },
  { id: "bananarepublic", names: ["bandana", "beanie"] },
  { id: "bananarepublicfactory", names: ["mixed-media", "patterned"] }
] as const;

for (const store of stores) {
  const lane = ADD_LANES[store.id];
  test(`${lane.name} packaged runner adds both captured offers and verifies unchanged existing cart lines`, async ({ page }) => {
    const products = await Promise.all(store.names.map(async name => {
      const metadata = JSON.parse(await readFile(`docs/store-evidence/${store.id}/${name}-product-2026-09-06.json`, "utf8"));
      if (store.id === "audioadvice") {
        metadata.sku = String(metadata.variantId);
        metadata.product = JSON.parse(await readFile(`docs/store-evidence/${store.id}/${name}-schema-2026-09-06.json`, "utf8")).product;
      }
      return { ...metadata, name, priceCents: Math.round(Number(metadata.product.offers[0].price) * 100) };
    }));
    const bag = JSON.parse(await readFile(`docs/store-evidence/${store.id}/two-item-cart-2026-09-06.json`, "utf8"));
    const clicks: string[] = [];
    await page.exposeFunction("recordAdd", (sku: string) => { clicks.push(sku); });
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      const product = products.find(p => new URL(p.url).origin === url.origin
        && new URL(p.url).pathname === url.pathname && new URL(p.url).search === url.search);
      if (product) return route.fulfill({ contentType: "text/html; charset=utf-8",
        body: gunzipSync(await readFile(`test/fixtures/capsules/${store.id}/${product.name}-product.html.gz`)).toString("utf8") });
      if (store.id === "audioadvice" && url.href === "https://www.audioadvice.com/cart.js") {
        const items = bag.cart.items.filter((item: any) => clicks.includes(String(item.variant_id)));
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...bag.cart, items,
          item_count: items.length, total_price: items.reduce((sum: number, item: any) => sum + item.final_line_price, 0) }) });
      }
      if (url.href === lane.cartUrl) {
        const rows = store.id === "audioadvice" ? [] : bag.items.filter((item: any) => clicks.some(sku => item.html.includes(`pid=${sku}`)));
        return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body>
          <button id="shopping-bag" aria-label="${rows.length} items in your shopping bag"></button>
          ${rows.length ? `<ul>${rows.map((r: any) => r.html).join("")}</ul>` : "<p>Your bag is currently empty.</p>"}
          <button id="checkout">Checkout</button></body></html>` });
      }
      return route.abort();
    });
    const inject = async () => {
      await page.addStyleTag({ content: '[data-yoink-vis="0"], [data-assessment-visible="false"] { display: none !important; }' });
      await page.addScriptTag({ path: `apps/extension/${lane.runnerFile}` });
    };
    for (const product of products) {
      await page.goto(lane.cartUrl); await inject();
      const baseline = await page.evaluate(lane => (globalThis as any)[lane.runnerGlobal][lane.operations.baseline](document, location.href), lane);
      expect(baseline.ok, JSON.stringify(baseline)).toBe(true);
      await page.goto(product.url); await inject();
      const result = await page.evaluate(({ product, lane }) => {
        const runner = (globalThis as any)[lane.runnerGlobal];
        const url = new URL(product.url); url.search = ""; url.hash = "";
        url.searchParams.set(lane.id === "audioadvice" ? "variant" : "pid", product.sku);
        const job = { adapterVersion: lane.contractVersion, contractVersion: 1, jobId: `browser_${product.sku}`, retailerId: lane.id,
          retailerSku: product.sku, canonicalUrl: url.href, action: "add_to_cart", quantity: 1,
          maxUnitPriceCents: product.priceCents, maxOrderTotalCents: product.priceCents, currency: "USD", sellerPolicy: "first_party_only",
          expectedSeller: lane.firstPartySeller, fulfillment: "shipping", expiresAt: new Date(Date.now() + 60_000).toISOString() };
        let count = 0;
        document.querySelector(lane.id === "audioadvice" ? "#add-to-cart" : "#pdp-atb-btn")!.addEventListener("click", event => {
          event.preventDefault(); count++; void (globalThis as any).recordAdd(product.sku);
        });
        const rehearsal = runner[lane.operations.rehearse](document, location.href, job), afterRehearsal = count;
        const prepared = runner[lane.operations.prepare](document, location.href, job);
        const commit = runner[lane.operations.commit](document, location.href, job, prepared.authorizationId);
        const duplicate = runner[lane.operations.commit](document, location.href, job, prepared.authorizationId);
        return { rehearsal, afterRehearsal, prepared, commit, duplicate, count, job };
      }, { product, lane });
      expect(result.rehearsal.ok, JSON.stringify(result)).toBe(true); expect(result.afterRehearsal).toBe(0);
      expect(result.commit.clicked).toBe(true); expect(result.duplicate.clicked).toBe(false); expect(result.count).toBe(1);
      await expect.poll(() => clicks.includes(product.sku)).toBe(true);
      await page.goto(lane.cartUrl); await inject();
      const verified = await page.evaluate(async ({ result, baseline, lane }) => {
        let clicks = 0; document.addEventListener("click", () => { clicks++; });
        return { result: await (globalThis as any)[lane.runnerGlobal][lane.operations.verifyCart](
          document, location.href, result.job, result.commit.proof, baseline.proof), clicks };
      }, { result, baseline, lane });
      expect(verified.result.ok, JSON.stringify(verified)).toBe(true); expect(verified.result.proof.quantity).toBe(1);
      expect(verified.result.proof.unitPriceCents).toBe(store.id === "bananarepublicfactory" ? 1500 : product.priceCents);
      expect(verified.clicks).toBe(0);
    }
    expect(clicks).toEqual(products.map(product => product.sku));
  });

  test(`${lane.name} shopper and admin setup stay inactive until qualification`, async ({ page }) => {
    page.on("pageerror", error => { throw error; });
    await page.goto(`/#stores?setupStore=${store.id}`);
    const dialog = page.getByRole("dialog", { name: `${lane.name} setup`, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-setup-step="activation"]')).toContainText("Needs attention");
    await page.goto(`/admin#stores/readiness/${store.id}`);
    await page.locator(`[data-qualification-retailer="${store.id}"]`).click();
    await expect(page.locator(`[data-qualification-panel="${store.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-qualification-panel="${store.id}"] button[id^=activate]`)).toBeDisabled();
  });
}
