import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

test.use({ screenshot: "off", trace: "off" });

test("packaged Pokémon Center runner rehearses, adds once, and verifies the cart in Chromium", async ({ page }) => {
  const productUrl = "https://www.pokemoncenter.com/product/10-10320-101/binder";
  const cartUrl = "https://www.pokemoncenter.com/cart";
  const product = await readFile("test/fixtures/retailers/pokemoncenter-add-product.html", "utf8");
  let added = false;
  await page.route("**/*", async route => {
    if (route.request().url() === productUrl) return route.fulfill({ contentType: "text/html", body: product });
    if (route.request().url() === cartUrl) return route.fulfill({ contentType: "text/html", body: `<main>
      <h1>Shopping cart</h1><span data-cart-quantity="${added ? 1 : 0}">${added ? 1 : 0} items</span>
      ${added ? '<article class="cart-item" data-sku="10-10320-101"><a href="/product/10-10320-101/binder">Binder</a><span data-testid="unit-price">$29.99</span><input name="quantity" value="1"></article>' : '<p>Your cart is empty</p>'}
      <button>Checkout</button></main>` });
    return route.abort();
  });
  const inject = () => page.addScriptTag({ path: join(process.cwd(), "apps/extension/pokemoncenter-action.js") });
  await page.goto(cartUrl); await inject();
  const baseline = await page.evaluate(() => (globalThis as any).YoinkPokemonCenterAction.inspectPokemonCenterCartBaseline(document, location.href));
  expect(baseline.ok).toBe(true);
  await page.goto(productUrl); await inject();
  const result = await page.evaluate(() => {
    const runner = (globalThis as any).YoinkPokemonCenterAction;
    const job = { adapterVersion: "pokemoncenter-add-v1", contractVersion: 1, jobId: "job_browser_pokemoncenter",
      retailerId: "pokemoncenter", retailerSku: "10-10320-101", canonicalUrl: location.href, action: "add_to_cart",
      quantity: 1, maxUnitPriceCents: 2999, maxOrderTotalCents: 5999, currency: "USD", sellerPolicy: "first_party_only",
      expectedSeller: "", fulfillment: "shipping", expiresAt: new Date(Date.now() + 60_000).toISOString() };
    let clicks = 0;
    document.addEventListener("click", () => { clicks++; });
    const rehearsal = runner.rehearsePokemonCenterAdd(document, location.href, job);
    const afterRehearsal = clicks;
    const prepared = runner.preparePokemonCenterAdd(document, location.href, job);
    const commit = runner.commitPokemonCenterAdd(document, location.href, job, prepared.authorizationId);
    const duplicate = runner.commitPokemonCenterAdd(document, location.href, job, prepared.authorizationId);
    return { rehearsal, afterRehearsal, prepared, commit, duplicate, clicks, job };
  });
  expect(result.rehearsal.ok).toBe(true);
  expect(result.afterRehearsal).toBe(0);
  expect(result.prepared.ok).toBe(true);
  expect(result.commit.clicked).toBe(true);
  expect(result.duplicate.clicked).toBe(false);
  expect(result.clicks).toBe(1);
  added = true;
  await page.goto(cartUrl); await inject();
  const verified = await page.evaluate(({ result, baseline }) => {
    let clicks = 0; document.addEventListener("click", () => { clicks++; });
    return { result: (globalThis as any).YoinkPokemonCenterAction.verifyPokemonCenterAddedCart(
      document, location.href, result.job, result.commit.proof, baseline.proof), clicks };
  }, { result, baseline });
  expect(verified.result.ok).toBe(true);
  expect(verified.result.proof.quantity).toBe(1);
  expect(verified.clicks).toBe(0);
});

test("Pokémon Center is available in shopper setup and the admin qualification panel", async ({ page }) => {
  page.on("pageerror", error => { throw error; });
  await page.goto("/#stores?setupStore=pokemoncenter");
  const dialog = page.getByRole("dialog", { name: "Pokémon Center setup", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-setup-step="permission"]').waitFor();
  expect(await dialog.locator("[data-setup-step]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-setup-step")))).toEqual(["companion", "permission", "sign_in", "pause"]);
  await expect(dialog.locator('[data-setup-step="activation"]')).toHaveCount(0);
  await expect(dialog.locator('a[href^="/admin"]')).toHaveCount(0);
  await page.goto("/admin#stores/readiness/pokemoncenter");
  await page.locator('[data-qualification-retailer="pokemoncenter"]').click();
  await expect(page.locator('[data-qualification-panel="pokemoncenter"]')).toBeVisible();
  await expect(page.locator("#activatePokemonCenterAddButton")).toBeDisabled();
});
