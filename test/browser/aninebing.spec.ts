import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test.use({ screenshot: "off", trace: "off" });

test("packaged Anine Bing runner adds each captured variant once and reads exact cart deltas", async ({ page }) => {
  const products = [
    { handle: "anine-clutch-tango-red", id: "41205281521736", price: 45000 },
    { handle: "york-scarf-anine-bing-tango-red", id: "41205281194056", price: 15000 }
  ];
  const cart: Array<Record<string, unknown>> = [];
  const cartRequests: string[] = [];
  const submits: string[] = [];
  await page.exposeFunction("recordProductSubmit", (id: string) => {
    const product = products.find(product => product.id === id)!;
    submits.push(id);
    cart.push({ id: Number(id), variant_id: Number(id), quantity: 1, final_price: product.price,
      url: `/products/${product.handle}?variant=${id}`, requires_shipping: true, gift_card: false });
  });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/cart.js") {
      cartRequests.push(route.request().method());
      return route.fulfill({ contentType: "text/javascript; charset=utf-8", body: JSON.stringify({
        currency: "USD", item_count: cart.length, items: cart
      }) });
    }
    if (url.pathname === "/cart") return route.fulfill({ contentType: "text/html", body: "<main><h1>Your Shopping Cart</h1></main>" });
    const product = products.find(product => url.pathname === `/products/${product.handle}`);
    if (product) return route.fulfill({ contentType: "text/html", body:
      await readFile(`test/fixtures/retailers/aninebing/${product.handle}.html`, "utf8") });
    return route.abort();
  });
  const inject = async () => {
    await page.addStyleTag({ content: '[data-yoink-vis="0"] { display: none !important; }' });
    await page.addScriptTag({ path: "apps/extension/aninebing-action.js" });
  };
  for (const product of products) {
    await page.goto("https://www.aninebing.com/cart"); await inject();
    const baseline = await page.evaluate(() => (globalThis as any).YoinkAnineBingAction.inspectAnineBingCartBaseline(document, location.href));
    expect(baseline.ok).toBe(true);
    await page.goto(`https://www.aninebing.com/products/${product.handle}`); await inject();
    const result = await page.evaluate(product => {
      const runner = (globalThis as any).YoinkAnineBingAction;
      const job = { adapterVersion: "aninebing-add-v1", contractVersion: 1, jobId: `browser_${product.id}`,
        retailerId: "aninebing", retailerSku: product.id, canonicalUrl: `${location.href}?variant=${product.id}`,
        action: "add_to_cart", quantity: 1, maxUnitPriceCents: product.price, maxOrderTotalCents: product.price,
        currency: "USD", sellerPolicy: "first_party_only", expectedSeller: "ANINE BING", fulfillment: "shipping",
        expiresAt: new Date(Date.now() + 60_000).toISOString() };
      let clicks = 0;
      document.addEventListener("click", () => { clicks++; });
      document.querySelector("form")!.addEventListener("submit", event => {
        event.preventDefault();
        void (globalThis as any).recordProductSubmit((document.querySelector('[name="id"]') as HTMLInputElement).value);
      });
      const rehearsal = runner.rehearseAnineBingAdd(document, location.href, job);
      const afterRehearsal = clicks;
      const prepared = runner.prepareAnineBingAdd(document, location.href, job);
      const commit = runner.commitAnineBingAdd(document, location.href, job, prepared.authorizationId);
      const duplicate = runner.commitAnineBingAdd(document, location.href, job, prepared.authorizationId);
      return { rehearsal, afterRehearsal, prepared, commit, duplicate, clicks, job };
    }, product);
    expect(result.rehearsal.ok).toBe(true);
    expect(result.afterRehearsal).toBe(0);
    expect(result.commit.clicked).toBe(true);
    expect(result.duplicate.clicked).toBe(false);
    expect(result.clicks).toBe(1);
    await expect.poll(() => submits.includes(product.id)).toBe(true);
    await page.goto("https://www.aninebing.com/cart"); await inject();
    const verified = await page.evaluate(({ result, baseline }) => (globalThis as any).YoinkAnineBingAction.verifyAnineBingAddedCart(
      document, location.href, result.job, result.commit.proof, baseline.proof), { result, baseline });
    expect(verified.ok).toBe(true);
    expect(verified.proof.quantity).toBe(1);
  }
  expect(submits).toEqual(products.map(product => product.id));
  expect(cartRequests).toEqual(["GET", "GET", "GET", "GET"]);
});

test("Anine Bing shopper and admin setup require activation", async ({ page }) => {
  page.on("pageerror", error => { throw error; });
  await page.goto("/#stores?setupStore=aninebing");
  const dialog = page.getByRole("dialog", { name: /anine bing setup/i });
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-setup-step="permission"]').waitFor();
  expect(await dialog.locator("[data-setup-step]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-setup-step")))).toEqual(["companion", "permission", "sign_in", "pause"]);
  await expect(dialog.locator('[data-setup-step="activation"]')).toHaveCount(0);
  await expect(dialog.locator('a[href^="/admin"]')).toHaveCount(0);
  await page.goto("/admin#stores/readiness/aninebing");
  await page.locator('[data-qualification-retailer="aninebing"]').click();
  await expect(page.locator('[data-qualification-panel="aninebing"]')).toBeVisible();
  await expect(page.locator("#activateAnineBingAddButton")).toBeDisabled();
});
