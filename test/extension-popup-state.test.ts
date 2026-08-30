import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyPageContext,
  deriveContextMenuCommands,
  derivePopupView,
  errorPopupResult,
  qualificationPopupResult,
  type PopupHealthState,
  type PopupPageContext
} from "../packages/extension-ui/src/popup-state.js";

const PRODUCT_URLS = [
  ["target", "13331333", "https://www.target.com/p/bicycle-cards/-/A-13331333#lnk=sametab"],
  ["walmart", "20252562938", "https://www.walmart.com/ip/MTG-MARVEL/20252562938?from=/search"],
  ["amazon", "B00E4AMFKK", "https://www.amazon.com/Bicycle-Cards/dp/B00E4AMFKK/ref=sr_1_6"],
  ["bestbuy", "6685081", "https://www.bestbuy.com/product/2026-topps-football/J3ZPGXX9RP/sku/6685081"],
  ["disney", "123456789012", "https://www.disneystore.com/mickey-plush-123456789012.html"],
  ["ravensburger", "123456", "https://www.ravensburger.us/en-US/products/disney-lorcana-123456"],
  ["riot", "STAR-GUARDIAN-AHRI", "https://merch.riotgames.com/en-us/product/star-guardian-ahri/"],
  ["booksamillion", "1234567890", "https://www.booksamillion.com/p/-/1234567890"],
  ["fanatics", "1234567", "https://www.fanatics.com/league/team+item+p-1234567+z-1"],
  ["kohls", "1234567", "https://www.kohls.com/product/prd-1234567/example.jsp"],
  ["macys", "123456", "https://www.macys.com/shop/product/example?ID=123456"],
  ["pbandai", "N1234567890", "https://p-bandai.com/us/item/N1234567890"],
  ["pokemoncenter", "10-12345-001", "https://www.pokemoncenter.com/product/10-12345-001/example"]
] as const;

test("classifyPageContext recognizes exact products across all supported retailers", () => {
  for (const [retailerId, sku, url] of PRODUCT_URLS) {
    const context = classifyPageContext(url);
    assert.equal(context.kind, "product", url);
    if (context.kind !== "product") continue;
    assert.equal(context.retailerId, retailerId, url);
    assert.equal(context.sku, sku, url);
    assert.equal(context.key, `product:${retailerId}:${sku}`, url);
  }
});

test("classifyPageContext separates Walmart Draw from product pages", () => {
  assert.deepEqual(classifyPageContext("https://www.walmart.com/shop/collectibles/draw/"), {
    kind: "walmart_draw",
    key: "walmart_draw",
    retailerId: "walmart",
    retailerName: "Walmart"
  });
});

test("classifyPageContext rejects malformed URLs and retailer non-product pages", () => {
  for (const url of [
    "not a url",
    "http://www.target.com/p/example/-/A-13331333",
    "https://www.target.com/s?searchTerm=cards",
    "https://www.walmart.com/search?q=cards",
    "https://www.amazon.com/s?k=cards&asin=B00E4AMFKK",
    "https://www.bestbuy.com/site/searchpage.jsp?skuId=6685081",
    "https://example.com/dp/B00E4AMFKK"
  ]) {
    assert.notEqual(classifyPageContext(url).kind, "product", url);
  }
});

const READY: PopupHealthState = {
  connected: true,
  paired: true,
  version: "1.9.1",
  executionMode: "live",
  actionsPaused: false,
  chromeMutationEnabled: true,
  checkedAt: "2026-08-29T18:00:00.000Z",
  trackalackerPush: { ready: true, state: "ready" },
  trackalackerSync: { phase: "idle", updatedAt: "2026-08-29T18:00:00.000Z" }
};
const PRODUCT = classifyPageContext(PRODUCT_URLS[0][2]);
const IDLE: PopupPageContext = { kind: "unsupported", key: "unsupported" };

function view(health: PopupHealthState, page: PopupPageContext = PRODUCT) {
  return derivePopupView({
    health,
    page,
    installedVersion: "1.9.1",
    production: false,
    pageAccessGranted: false,
    now: new Date("2026-08-29T18:01:00.000Z").getTime()
  });
}

test("hard blockers override exact product context", () => {
  const unavailable = view({ ...READY, connected: false });
  assert.equal(unavailable.hardBlocker, "unavailable");
  assert.equal(unavailable.primaryAction?.id, "retry");

  const unpaired = view({ ...READY, paired: false });
  assert.equal(unpaired.hardBlocker, "unpaired");
  assert.equal(unpaired.context.pairing, true);
  assert.equal(unpaired.activity, null);

  const mismatch = view({ ...READY, version: "1.9.2" });
  assert.equal(mismatch.hardBlocker, "companion_update");
  assert.equal(mismatch.primaryAction?.id, "update_companion");
});

test("TrackaLacker disconnection does not replace a product inspection", () => {
  const result = view({ ...READY, trackalackerPush: { ready: false, state: "error" } });
  assert.equal(result.status, "attention");
  assert.equal(result.primaryAction?.id, "inspect_product");
  assert.equal(result.activity?.action, "reconnect_trackalacker");
});

test("paused and test modes do not replace product inspection", () => {
  const pausedProduct = view({ ...READY, actionsPaused: true });
  assert.equal(pausedProduct.status, "paused");
  assert.equal(pausedProduct.primaryAction?.id, "inspect_product");
  assert.equal(pausedProduct.activity?.action, "review_pause");

  const testProduct = view({ ...READY, executionMode: "shadow" });
  assert.equal(testProduct.status, "monitoring");
  assert.equal(testProduct.primaryAction?.id, "inspect_product");
  assert.equal(testProduct.activity?.action, "review_mode");

  const monitoringProduct = view({ ...READY, chromeMutationEnabled: false });
  assert.equal(monitoringProduct.status, "monitoring");
  assert.equal(monitoringProduct.primaryAction?.id, "inspect_product");
  assert.equal(monitoringProduct.activity?.label, "Monitoring only · Review");
});

test("idle pages prioritize background attention and keep healthy idle quiet", () => {
  const pausedIdle = view({ ...READY, actionsPaused: true }, IDLE);
  assert.equal(pausedIdle.primaryAction?.id, "review_pause");
  assert.equal(pausedIdle.activity?.label, "Signals live");

  const testIdle = view({ ...READY, executionMode: "shadow" }, IDLE);
  assert.equal(testIdle.primaryAction?.id, "review_mode");

  const disconnectedIdle = view({ ...READY, trackalackerPush: { ready: false, state: "error" } }, IDLE);
  assert.equal(disconnectedIdle.primaryAction?.id, "reconnect_trackalacker");
  assert.equal(disconnectedIdle.activity, null);

  const healthyIdle = view(READY, IDLE);
  assert.equal(healthyIdle.status, "ready");
  assert.equal(healthyIdle.context.visible, false);
  assert.equal(healthyIdle.primaryAction, null);
  assert.equal(healthyIdle.activity?.label, "Signals live");
});

test("community sharing is conditional on exact page eligibility and consent", () => {
  const hidden = view(READY);
  assert.equal(hidden.menu.shareEvidence, false);
  const visible = derivePopupView({
    health: { ...READY, communitySharingRetailers: ["target"] },
    page: PRODUCT,
    installedVersion: "1.9.1",
    production: false
  });
  assert.equal(visible.menu.shareEvidence, true);
});

test("persisted popup results are bounded, contextual, and redact untrusted error material", () => {
  const result = qualificationPopupResult({
    workflow: "qualification",
    observation: {
      unitPriceCents: 539,
      fulfillment: "shipping",
      sellerName: "Target",
      availability: "in_stock",
      purchaseRouteReady: true
    },
    rehearsal: { ok: true }
  }, PRODUCT, 1_788_037_200_000);
  assert.equal(result?.outcome, "qualified");
  assert.equal(result?.summary, "Qualified · $5.39 · Shipping");
  assert.match(result?.details || "", /final pre-click boundary/);

  const missingPrice = qualificationPopupResult({
    workflow: "inspection",
    observation: { unitPriceCents: null, fulfillment: "unknown", sellerName: "Best Buy" }
  }, PRODUCT);
  assert.equal(missingPrice?.summary, "Inspected · Price unavailable");

  const secret = "S".repeat(48);
  const error = errorPopupResult(PRODUCT.key, new Error(
    `RAW_BROWSER_ERROR token=${secret} url=https://www.target.com/p/example?secret=DO_NOT_SEND`
  ));
  assert.equal(error.contextKey, PRODUCT.key);
  assert.equal(error.details.includes(secret), false);
  assert.equal(error.details.includes("target.com"), false);
  assert.equal(error.details.includes("DO_NOT_SEND"), false);
  assert.ok(error.details.length <= 300);
});

test("context menu commands reuse the same blocker, page, and signal state", () => {
  const base = {
    installedVersion: "1.9.1",
    production: false
  };
  assert.deepEqual(deriveContextMenuCommands({ ...base, health: READY, page: PRODUCT }), [
    "open_yoink", "inspect_product", "sync_products", "settings"
  ]);
  assert.deepEqual(deriveContextMenuCommands({
    ...base,
    health: { ...READY, trackalackerPush: { ready: false, state: "error" } },
    page: PRODUCT
  }), ["open_yoink", "inspect_product", "reconnect_trackalacker", "settings"]);
  assert.deepEqual(deriveContextMenuCommands({
    ...base,
    health: READY,
    page: classifyPageContext("https://www.walmart.com/shop/collectibles/draw")
  }), ["open_yoink", "inspect_drawings", "sync_products", "settings"]);
  assert.deepEqual(deriveContextMenuCommands({
    ...base,
    health: { ...READY, connected: false },
    page: IDLE
  }), ["open_yoink", "settings"]);
});
