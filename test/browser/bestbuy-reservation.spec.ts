import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

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
