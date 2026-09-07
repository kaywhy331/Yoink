import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { BESTBUY_ADD_ADAPTER_VERSION } from "../../packages/contracts/src/index.js";

test.use({ screenshot: "off", trace: "off", video: "off" });

for (const delayed of [false, true]) {
  test(`packaged Best Buy observes ${delayed ? "a delayed" : "an immediate"} post-Add queue and verifies the eventual cart without repeating Add`, async ({ page, context }) => {
    const productUrl = "https://www.bestbuy.com/site/normal-product/6588149.p";
    const cartUrl = "https://www.bestbuy.com/cart";
    let added = false;
    await context.route("**/*", async route => {
      const url = route.request().url();
      const name = url === productUrl ? "bestbuy-first-party.html"
        : url === cartUrl ? added ? "bestbuy-cart-single.html" : "bestbuy-cart-empty.html" : null;
      if (!name) return route.abort();
      return route.fulfill({ contentType: "text/html", body: await readFile(join(process.cwd(), "test/fixtures/retailers", name)) });
    });
    const job = {
      contractVersion: 1, jobId: `job_browser_queue_${delayed}`, retailerId: "bestbuy", retailerSku: "6588149",
      canonicalUrl: productUrl, action: "add_to_cart", quantity: 1, maxUnitPriceCents: 699,
      maxOrderTotalCents: 699, currency: "USD", sellerPolicy: "first_party_only", expectedSeller: "Best Buy",
      fulfillment: "shipping", expiresAt: new Date(Date.now() + 60_000).toISOString(), adapterVersion: BESTBUY_ADD_ADAPTER_VERSION
    };
    const cart = await context.newPage();
    await cart.goto(cartUrl);
    await cart.addScriptTag({ path: join(process.cwd(), "apps/extension/bestbuy-action.js") });
    const baseline = await cart.evaluate(() => (globalThis as any).YoinkBestBuyAction.inspectBestBuyCartBaseline(document, location.href));
    expect(baseline.ok).toBe(true);
    await page.goto(productUrl);
    await page.addScriptTag({ path: join(process.cwd(), "apps/extension/bestbuy-action.js") });
    const committed = await page.evaluate(({ job, delayed }) => {
      const host = globalThis as any;
      const action = host.YoinkBestBuyAction;
      host.addClicks = 0;
      host.showQueue = () => {
        document.querySelector("[data-testid='buy-box'] button")!.textContent = "Please Wait…";
        document.body.insertAdjacentHTML("afterbegin", '<dialog open id="queue">You’re in line. Please don’t refresh or leave this page.</dialog>');
      };
      document.querySelector("[data-testid='buy-box'] button")!.addEventListener("click", () => {
        host.addClicks++;
        if (!delayed) host.showQueue();
      });
      const prepared = action.prepareBestBuyAdd(document, location.href, job);
      if (!prepared.ok) return { prepared, commit: null };
      host.authorizationId = prepared.authorizationId;
      return { prepared, commit: action.commitBestBuyAdd(document, location.href, job, prepared.authorizationId) };
    }, { job, delayed });
    expect(committed.prepared.ok).toBe(true);
    expect(committed.commit?.clicked).toBe(true);
    if (delayed) {
      expect(await page.evaluate(job => (globalThis as any).YoinkBestBuyAction.inspectBestBuyPostAdd(document, location.href, job).state, job)).toBe("product");
      // Queue begins after the initial ordinary-page probe has already returned.
      await page.evaluate(() => (globalThis as any).showQueue());
    }
    for (let poll = 0; poll < 3; poll++) {
      expect(await page.evaluate(job => (globalThis as any).YoinkBestBuyAction.inspectBestBuyPostAdd(document, location.href, job).state, job)).toBe("queue");
    }
    expect(page.url()).toBe(productUrl);
    expect(await page.evaluate(() => (globalThis as any).addClicks)).toBe(1);
    const pending = await cart.evaluate(({ job, proof, baseline }) => (globalThis as any).YoinkBestBuyAction.verifyBestBuyAddedCart(document, location.href, job, proof, baseline),
      { job, proof: committed.commit.proof, baseline: baseline.proof });
    expect(pending).toMatchObject({ ok: false, reason: "cart_delta_unverified", pending: true });
    // Admission presents a manual step; the observer cannot complete it.
    await page.locator("#queue").evaluate(el => {
      el.innerHTML = '<label>Enter the SMS verification code<input autocomplete="one-time-code"></label>';
    });
    expect(await page.evaluate(job => (globalThis as any).YoinkBestBuyAction.inspectBestBuyPostAdd(document, location.href, job).state, job)).toBe("user_action");
    expect(await page.locator("input[autocomplete='one-time-code']").inputValue()).toBe("");
    expect(await page.evaluate(() => (globalThis as any).addClicks)).toBe(1);
    await page.evaluate(() => {
      document.querySelector("#queue")!.remove();
      document.querySelector("[data-testid='buy-box'] button")!.textContent = "Add to cart";
    });
    added = true;
    await cart.reload();
    await cart.addScriptTag({ path: join(process.cwd(), "apps/extension/bestbuy-action.js") });
    const verified = await cart.evaluate(({ job, proof, baseline }) => (globalThis as any).YoinkBestBuyAction.verifyBestBuyAddedCart(document, location.href, job, proof, baseline),
      { job, proof: committed.commit.proof, baseline: baseline.proof });
    expect(verified.ok).toBe(true);
    const repeated = await page.evaluate(job => {
      const host = globalThis as any;
      return { state: host.YoinkBestBuyAction.inspectBestBuyPostAdd(document, location.href, job).state,
        repeat: host.YoinkBestBuyAction.commitBestBuyAdd(document, location.href, job, host.authorizationId), clicks: host.addClicks };
    }, job);
    expect(repeated.state).toBe("product");
    expect(repeated.repeat.clicked).toBe(false);
    expect(repeated.clicks).toBe(1);
    expect(page.url()).toBe(productUrl);
    await cart.close();
  });
}

test("packaged Best Buy checks hand reservation pages to the shopper and still verify ordinary Shipping", async ({ page }) => {
  const fixtures = new Map([
    ["https://www.bestbuy.com/site/reservation-product/6669869.p", "bestbuy-high-velocity-reservation.html"],
    ["https://www.bestbuy.com/site/normal-product/6588149.p", "bestbuy-first-party.html"]
  ]);
  await page.route("**/*", async route => {
    const fixture = fixtures.get(route.request().url());
    if (!fixture) return route.abort();
    return route.fulfill({ contentType: "text/html", body: await readFile(join(process.cwd(), "test/fixtures/retailers", fixture)) });
  });
  for (const [url] of fixtures) {
    const reservation = url.includes("6669869");
    await page.goto(url);
    for (const file of ["add-lanes.js", "retailer-shadow.js", "bestbuy-action.js", "popup-state.js"]) {
      await page.addScriptTag({ path: join(process.cwd(), "apps/extension", file) });
    }
    const result = await page.evaluate(async ({ reservation }) => {
      const host = globalThis as any;
      let clicks = 0;
      document.addEventListener("click", () => { clicks += 1; });
      const sku = reservation ? "6669869" : "6588149";
      const selection = await host.YoinkBestBuyAction.selectBestBuyShipping(document, location.href, sku);
      const attempt = host.YoinkRetailerShadow.collectRetailerShadowAttempt(document, location.href, "bestbuy", "shipping");
      const popup = host.YoinkPopupStateModule.qualificationPopupResult({ workflow: "qualification", observation: attempt.observation,
        shippingSelection: selection, rehearsal: { ok: false, reason: "manual_action_required" } }, host.YoinkPopupStateModule.classifyPageContext(location.href));
      return { selection, diagnostic: attempt.diagnostic, observation: attempt.observation, popup, clicks };
    }, { reservation });
    expect(result.clicks).toBe(0);
    if (reservation) {
      expect(result.selection).toEqual({ ok: false, reason: "manual_action_required", selectionClicked: false });
      expect(result.diagnostic.reasonCode).toBe("interactive_high_demand");
      expect(result.observation.addControlActionable).toBe(false);
      expect(result.popup.summary).toContain("Reservation required · Complete Best Buy’s reservation steps");
    } else {
      expect(result.selection.ok).toBe(true);
      expect(result.diagnostic.outcome).toBe("passed");
      expect(result.observation.fulfillment).toBe("shipping");
    }
  }
});
