import assert from "node:assert/strict";
import test from "node:test";
import {
  appDestinationUrl,
  bestBuyWaitState,
  cartReadyState,
  classifyPageContext,
  deriveContextMenuCommands,
  derivePopupView,
  errorPopupResult,
  popupPurchaseOpportunity,
  popupUpdateHandoff,
  preferredActionHandoff,
  qualificationPopupResult,
  type PopupHealthState,
  type PopupPageContext
} from "../packages/extension-ui/src/popup-state.js";

test("a Best Buy reservation wait stays visible offline and never becomes a cart-ready claim", () => {
  const now = Date.now();
  const raw = {
    schemaVersion: 1, jobId: "job_bestbuy_wait", retailerSku: "6669869", reason: "bestbuy_queue_waiting",
    clicked: true, expiresAt: new Date(now + 60_000).toISOString(), authorizationId: "private", smsCode: "private"
  };
  const wait = bestBuyWaitState(raw, now)!;
  assert.ok(wait);
  assert.equal("authorizationId" in wait, false);
  assert.equal("smsCode" in wait, false);
  const pending = derivePopupView({ health: { connected: false }, page: classifyPageContext("https://example.com/"),
    installedVersion: "1.28.3", production: false, bestBuyWait: wait, now });
  assert.equal(pending.primaryAction?.id, "open_bestbuy_wait");
  assert.match(pending.context.title, /Add triggered/);
  assert.match(pending.context.supporting, /waiting for cart confirmation/);
  assert.equal(pending.cartReady, null);
  assert.equal(pending.cartOutcome, null);
  assert.equal(pending.hardBlocker, null);
  const manual = derivePopupView({ health: { connected: false }, page: classifyPageContext(""),
    installedVersion: "1.28.3", production: false,
    bestBuyWait: bestBuyWaitState({ ...raw, reason: "manual_action_required" }, now), now });
  assert.equal(manual.primaryAction?.label, "Complete verification");
  assert.match(manual.context.supporting, /SMS code/);
  const uncertain = derivePopupView({ page: classifyPageContext(""), installedVersion: "1.28.3", production: false,
    bestBuyWait: bestBuyWaitState({ ...raw, clicked: false }, now), now });
  assert.equal(uncertain.context.title, "Checking Best Buy add");
  for (const invalid of [{ ...raw, expiresAt: new Date(now - 1).toISOString() },
    { ...raw, expiresAt: new Date(now + 600_000).toISOString() }, { ...raw, reason: "cart_ready" },
    { ...raw, jobId: "../bad" }, { ...raw, retailerSku: "unknown" }]) {
    assert.equal(bestBuyWaitState(invalid, now), null);
  }
});

test("extension app destinations resolve to distinct dashboard workspaces", () => {
  const origin = "http://127.0.0.1:32991";
  assert.deepEqual({
    dashboard: appDestinationUrl(origin),
    actions: appDestinationUrl(origin, "actions"),
    insights: appDestinationUrl(origin, "insights"),
    connections: appDestinationUrl(origin, "connections"),
    settings: appDestinationUrl(origin, "settings")
  }, {
    dashboard: `${origin}/#home`,
    actions: `${origin}/#activity`,
    insights: `${origin}/#activity/insights`,
    connections: `${origin}/#settings/chrome`,
    settings: `${origin}/#settings`
  });
  assert.throws(
    () => appDestinationUrl(origin, "unknown" as never),
    /Unknown Yoink app destination/
  );
});

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
  ["pokemoncenter", "10-12345-001", "https://www.pokemoncenter.com/product/10-12345-001/example"],
  ["aninebing", "41205281521736", "https://www.aninebing.com/products/anine-clutch-tango-red?variant=41205281521736&utm_source=example"],
  ["americaneagle", "0045503992", "https://www.ae.com/us/en/p/0427_9775_410?sku=0045503992&utm_source=example"]
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

test("Best Buy product-code links offer inspection while paused without inventing a SKU", () => {
  for (const code of ["CJ6QGKQ8QQ", "CJ6QGKQ8Q5"]) {
    const page = classifyPageContext(`https://www.bestbuy.com/product/lorcana-playmat/${code}`);
    assert.equal(page.kind, "product_link");
    assert.equal("sku" in page, false);
    const result = view({ ...READY, actionsPaused: true }, page);
    assert.equal(result.primaryAction?.id, "inspect_product");
    assert.equal(result.context.eyebrow, "BEST BUY");
    assert.equal(result.activity?.label, "Store actions paused · Resume");
    const receipt = qualificationPopupResult({
      observation: { retailerSku: "6588149", canonicalUrl: "https://www.bestbuy.com/site/-/6588149.p", unitPriceCents: 699 }
    }, page);
    assert.equal(receipt?.contextKey, page.key);
    assert.ok(JSON.stringify(receipt).includes("SKU 6588149"));
  }
});

test("Anine Bing links resolve the selected variant and retain the store name in the popup", () => {
  const page = classifyPageContext("https://www.aninebing.com/products/anine-clutch-tango-red");
  assert.equal(page.kind, "product_link");
  assert.equal("sku" in page, false);
  const result = view(READY, page);
  assert.equal(result.context.eyebrow, "ANINE BING");
  assert.equal(result.context.title, "ANINE BING product");
  assert.equal(result.primaryAction?.id, "inspect_product");
  const receipt = qualificationPopupResult({ observation: {
    retailerSku: "41205281521736", canonicalUrl: "https://www.aninebing.com/products/anine-clutch-tango-red?variant=41205281521736",
    unitPriceCents: 45000
  } }, page);
  assert.equal(receipt?.contextKey, page.key);
  assert.ok(JSON.stringify(receipt).includes("Variant 41205281521736"));
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
  companionCompatible: true,
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

test("connection blockers override exact product context while patch updates stay compatible", () => {
  const unavailable = view({ ...READY, connected: false });
  assert.equal(unavailable.hardBlocker, "unavailable");
  assert.equal(unavailable.primaryAction?.id, "retry");

  const unpaired = view({ ...READY, paired: false });
  assert.equal(unpaired.hardBlocker, "unpaired");
  assert.equal(unpaired.context.pairing, true);
  assert.equal(unpaired.context.supporting, "Enter the code from Yoink › Settings › Chrome.");
  assert.equal(unpaired.activity, null);

  const mismatch = view({ ...READY, version: "1.9.2" });
  assert.equal(mismatch.hardBlocker, null);
  assert.equal(mismatch.primaryAction?.id, "update_companion");
  assert.equal(mismatch.context.title, "Update Chrome companion");
  assert.equal(mismatch.primaryAction?.label, "Update Chrome companion");

  const incompatible = view({ ...READY, version: "2.0.0", companionCompatible: false });
  assert.equal(incompatible.hardBlocker, "companion_update");
  assert.equal(incompatible.primaryAction?.id, "update_companion");
});

test("a sanitized cart-ready handoff remains the pending action across control-plane blockers", () => {
  const now = new Date("2026-08-29T18:01:00.000Z").getTime();
  const cartReady = cartReadyState({
    schemaVersion: 1,
    items: [{
      schemaVersion: 1,
      jobId: "job_target_fixture",
      retailerId: "target",
      retailerName: "Spoofed store",
      identityLabel: "Spoofed ID",
      retailerSku: "13331333",
      tabId: 17,
      recordedAt: "2026-08-29T18:00:30.000Z",
      openedAt: "2026-08-29T18:00:45.000Z",
      reviewedMaximumCents: 3_999,
      latency: {
        leaseToCartReadyMs: 8_240,
        leaseToBaselineMs: 2_500,
        baselineToOfferMs: 4_000,
        offerToClickMs: 110,
        clickToSettleMs: 410,
        clickToCartReadyMs: 1_630,
        settleToCartReadyMs: 1_220,
        secret: "discarded"
      }
    }, {
      schemaVersion: 1,
      jobId: "expired_job",
      retailerId: "target",
      retailerSku: "99999999",
      tabId: 18,
      recordedAt: "2026-08-27T18:00:00.000Z"
    }]
  }, now);
  assert.equal(cartReady.items.length, 1);
  assert.equal(cartReady.items[0]?.retailerName, "Target");
  assert.equal(cartReady.items[0]?.identityLabel, "TCIN");
  assert.equal(cartReady.items[0]?.kind, "cart_ready");
  assert.equal(cartReady.items[0]?.openedAt, "2026-08-29T18:00:45.000Z");
  assert.equal(cartReady.items[0]?.reviewedMaximumCents, 3_999);
  assert.deepEqual(cartReady.items[0]?.latency, {
    leaseToCartReadyMs: 8_240,
    leaseToBaselineMs: 2_500,
    baselineToOfferMs: 4_000,
    offerToClickMs: 110,
    clickToSettleMs: 410,
    clickToCartReadyMs: 1_630,
    settleToCartReadyMs: 1_220
  });

  const pending = derivePopupView({
    health: READY,
    page: PRODUCT,
    installedVersion: "1.9.1",
    production: false,
    cartReady,
    now
  });
  assert.equal(pending.statusLabel, "Needs attention");
  assert.equal(pending.context.title, "Target cart ready");
  assert.equal(pending.context.supporting, "TCIN 13331333");
  assert.equal(pending.primaryAction?.id, "open_cart");
  assert.equal(pending.primaryAction?.label, "Return to cart");
  assert.equal(pending.cartReady?.jobId, "job_target_fixture");
  assert.deepEqual(pending.cartOutcome, {
    jobId: "job_target_fixture",
    stage: "choice",
    reviewedMaximumCents: 3_999,
    error: ""
  });

  const closeout = derivePopupView({
    health: READY,
    page: PRODUCT,
    installedVersion: "1.9.1",
    production: false,
    cartReady,
    cartOutcome: { jobId: "job_target_fixture", stage: "amount", error: "  Check\u0000 amount  " },
    now
  });
  assert.equal(closeout.cartReady?.jobId, "job_target_fixture");
  assert.deepEqual(closeout.cartOutcome, {
    jobId: "job_target_fixture",
    stage: "amount",
    reviewedMaximumCents: 3_999,
    error: "Check amount"
  });

  const disconnected = derivePopupView({
    health: { ...READY, connected: false },
    page: PRODUCT,
    installedVersion: "1.9.1",
    production: false,
    cartReady,
    cartOutcome: { jobId: "job_target_fixture", stage: "choice" },
    now
  });
  assert.equal(disconnected.hardBlocker, null);
  assert.equal(disconnected.primaryAction?.id, "open_cart");
  assert.equal(disconnected.cartOutcome?.jobId, "job_target_fixture");
});

test("a fresh Walmart purchase opportunity is primary only when the current page has no exact action", () => {
  const now = new Date("2026-08-29T18:01:00.000Z").getTime();
  const opportunity = popupPurchaseOpportunity({
    schemaVersion: 1,
    deliveryId: "notification_walmart_popup",
    kind: "walmart_review_order",
    retailerId: "walmart",
    retailerName: "Spoofed retailer",
    identityLabel: "Spoofed identity",
    retailerSku: "19988614228",
    title: "  Walmart\u0000 Direct Cart Fixture  ",
    expiresAt: "2026-08-29T18:02:00.000Z"
  }, now);
  assert.deepEqual(opportunity, {
    schemaVersion: 1,
    deliveryId: "notification_walmart_popup",
    kind: "walmart_review_order",
    retailerId: "walmart",
    retailerName: "Walmart",
    identityLabel: "Item",
    retailerSku: "19988614228",
    title: "Walmart Direct Cart Fixture",
    expiresAt: "2026-08-29T18:02:00.000Z"
  });

  const idle = derivePopupView({
    health: READY,
    page: IDLE,
    installedVersion: "1.9.1",
    production: false,
    purchaseOpportunity: opportunity,
    now
  });
  assert.equal(idle.status, "attention");
  assert.equal(idle.primaryAction?.id, "open_purchase");
  assert.equal(idle.primaryAction?.label, "Buy at Walmart");
  assert.equal(idle.context.supporting, "Item 19988614228 · Ready to add");

  const product = derivePopupView({
    health: READY,
    page: PRODUCT,
    installedVersion: "1.9.1",
    production: false,
    purchaseOpportunity: opportunity,
    now
  });
  assert.equal(product.primaryAction?.id, "inspect_product");
  assert.equal(product.activity?.id, "purchase");
  assert.equal(product.activity?.action, "open_purchase");
  assert.equal(product.status, "attention");

  const blocked = derivePopupView({
    health: { ...READY, connected: false },
    page: IDLE,
    installedVersion: "1.9.1",
    production: false,
    purchaseOpportunity: opportunity,
    now
  });
  assert.equal(blocked.primaryAction?.id, "retry");
  assert.equal(blocked.activity, null);
  assert.equal(popupPurchaseOpportunity({ ...opportunity, expiresAt: "2026-08-29T18:00:59.999Z" }, now), null);
});

test("Needs-you handoffs outrank cart-ready handoffs without exposing raw failure detail", () => {
  const now = new Date("2026-08-29T18:01:00.000Z").getTime();
  const handoffs = cartReadyState({
    schemaVersion: 1,
    items: [{
      schemaVersion: 1,
      kind: "cart_ready",
      jobId: "job_walmart_ready",
      retailerId: "walmart",
      retailerSku: "20252562938",
      tabId: 21,
      recordedAt: "2026-08-29T18:00:50.000Z"
    }, {
      schemaVersion: 1,
      kind: "needs_you",
      jobId: "job_target_review",
      retailerId: "target",
      retailerSku: "94972381",
      tabId: 22,
      recordedAt: "2026-08-29T18:00:30.000Z",
      reasonCode: "cart_unverified",
      message: "RAW PAGE TOKEN DO_NOT_SEND"
    }]
  }, now);
  const pending = derivePopupView({
    health: READY,
    page: PRODUCT,
    installedVersion: "1.9.1",
    production: false,
    cartReady: handoffs,
    now
  });
  assert.equal(pending.cartReady?.kind, "needs_you");
  assert.equal(pending.context.eyebrow, "NEEDS YOU");
  assert.equal(pending.context.title, "Target needs review");
  assert.equal(pending.context.supporting, "TCIN 94972381 · Check the store cart or session");
  assert.equal(pending.primaryAction?.label, "Review store");
  assert.doesNotMatch(JSON.stringify(pending), /DO_NOT_SEND/);
});

test("an opened handoff awaiting its checkout outcome outranks newer unopened handoffs", () => {
  const now = new Date("2026-08-29T18:01:00.000Z").getTime();
  const handoffs = cartReadyState({
    schemaVersion: 1,
    items: [{
      schemaVersion: 1,
      kind: "cart_ready",
      jobId: "job_cart_opened",
      retailerId: "target",
      retailerSku: "94972381",
      tabId: 21,
      recordedAt: "2026-08-29T18:00:10.000Z",
      openedAt: "2026-08-29T18:00:20.000Z",
      reviewedMaximumCents: 3_999
    }, {
      schemaVersion: 1,
      kind: "cart_ready",
      jobId: "job_cart_newer",
      retailerId: "walmart",
      retailerSku: "20252562938",
      tabId: 22,
      recordedAt: "2026-08-29T18:00:40.000Z"
    }]
  }, now);
  assert.equal(preferredActionHandoff(handoffs, now)?.jobId, "job_cart_opened",
    "A pending Did-you-check-out prompt must not hide behind a newer handoff.");
  const pending = derivePopupView({
    health: READY,
    page: PRODUCT,
    installedVersion: "1.9.1",
    production: false,
    cartReady: handoffs,
    now
  });
  assert.equal(pending.cartReady?.jobId, "job_cart_opened");
  assert.equal(pending.primaryAction?.label, "Return to cart");
  assert.deepEqual(pending.cartOutcome, {
    jobId: "job_cart_opened",
    stage: "choice",
    reviewedMaximumCents: 3_999,
    error: ""
  });

  const closed = {
    schemaVersion: 1 as const,
    items: handoffs.items.filter((item) => item.jobId !== "job_cart_opened")
  };
  assert.equal(preferredActionHandoff(closed, now)?.jobId, "job_cart_newer");
  const next = derivePopupView({
    health: READY,
    page: PRODUCT,
    installedVersion: "1.9.1",
    production: false,
    cartReady: closed,
    now
  });
  assert.equal(next.cartReady?.jobId, "job_cart_newer");
  assert.equal(next.primaryAction?.label, "Open cart");
  assert.equal(next.cartOutcome, null);
});

test("Needs-you priority holds within each tier and the shortcut ranking rotates unopened handoffs first", () => {
  const now = new Date("2026-08-29T18:01:00.000Z").getTime();
  const handoffs = cartReadyState({
    schemaVersion: 1,
    items: [{
      schemaVersion: 1,
      kind: "needs_you",
      jobId: "job_review_seen",
      retailerId: "target",
      retailerSku: "94972381",
      tabId: 21,
      recordedAt: "2026-08-29T18:00:10.000Z",
      openedAt: "2026-08-29T18:00:50.000Z",
      reasonCode: "cart_unverified"
    }, {
      schemaVersion: 1,
      kind: "cart_ready",
      jobId: "job_cart_unseen",
      retailerId: "walmart",
      retailerSku: "20252562938",
      tabId: 22,
      recordedAt: "2026-08-29T18:00:20.000Z",
      openedAt: "2026-08-29T18:00:00.000Z"
    }, {
      schemaVersion: 1,
      kind: "needs_you",
      jobId: "job_review_unseen",
      retailerId: "bestbuy",
      retailerSku: "6685081",
      tabId: 23,
      recordedAt: "2026-08-29T18:00:30.000Z",
      reasonCode: "security_challenge"
    }, {
      schemaVersion: 1,
      kind: "cart_ready",
      jobId: "job_cart_seen",
      retailerId: "amazon",
      retailerSku: "B00E4AMFKK",
      tabId: 24,
      recordedAt: "2026-08-29T18:00:40.000Z",
      openedAt: "2026-08-29T18:00:55.000Z"
    }]
  }, now);
  assert.equal(handoffs.items.find((item) => item.jobId === "job_cart_unseen")?.openedAt, undefined,
    "An opened timestamp before the handoff must be discarded.");
  assert.equal(preferredActionHandoff(handoffs, now)?.jobId, "job_review_seen",
    "The popup keeps the opened Needs-you handoff until its outcome is recorded.");
  assert.equal(preferredActionHandoff(handoffs, now, "unopened_first")?.jobId, "job_review_unseen",
    "The keyboard shortcut opens the newest unseen Needs-you handoff first.");

  const afterReview = {
    schemaVersion: 1 as const,
    items: handoffs.items.map((item) => item.jobId === "job_review_unseen"
      ? { ...item, openedAt: "2026-08-29T18:00:58.000Z" }
      : item)
  };
  assert.equal(preferredActionHandoff(afterReview, now, "unopened_first")?.jobId, "job_cart_unseen",
    "An unseen ready cart must remain reachable from the shortcut after the Needs-you item was opened.");
  assert.equal(preferredActionHandoff(afterReview, now)?.jobId, "job_review_unseen",
    "The popup moves to the newest opened Needs-you handoff.");
  const viewAfterReview = derivePopupView({
    health: READY,
    page: PRODUCT,
    installedVersion: "1.9.1",
    production: false,
    cartReady: afterReview,
    now
  });
  assert.equal(viewAfterReview.cartReady?.jobId, "job_review_unseen");
  assert.equal(viewAfterReview.context.eyebrow, "NEEDS YOU");
  assert.equal(viewAfterReview.primaryAction?.label, "Return to store");
  assert.equal(viewAfterReview.cartOutcome?.jobId, "job_review_unseen");

  const allOpened = {
    schemaVersion: 1 as const,
    items: afterReview.items.map((item) => item.jobId === "job_cart_unseen"
      ? { ...item, openedAt: "2026-08-29T18:00:59.000Z" }
      : item)
  };
  assert.equal(preferredActionHandoff(allOpened, now)?.jobId, "job_review_unseen",
    "After all items are seen, the newest Needs-you handoff remains the fallback.");
  assert.equal(preferredActionHandoff(allOpened, now, "unopened_first")?.jobId, "job_review_unseen",
    "The shortcut falls back to the same opened Needs-you handoff.");
});

test("an exact, fresh update handoff replaces the mismatch action with explicit reload", () => {
  const handoff = popupUpdateHandoff({ channel: "local", releaseVersion: "1.9.2" }, new Date("2026-08-29T18:00:30.000Z").getTime());
  const ready = derivePopupView({
    health: { ...READY, version: "1.9.2" },
    page: PRODUCT,
    installedVersion: "1.9.1",
    production: false,
    updateHandoff: handoff,
    now: new Date("2026-08-29T18:01:00.000Z").getTime()
  });
  assert.equal(ready.hardBlocker, null);
  assert.equal(ready.context.title, "Replace extension files");
  assert.match(ready.context.supporting, /1\. Open Downloads.*2\. Copy.*3\. Return here/);
  assert.equal(ready.primaryAction?.id, "reload_companion");
  assert.equal(ready.primaryAction?.label, "Reload Chrome companion");

  const managed = derivePopupView({
    health: { ...READY, version: "1.9.2" },
    page: PRODUCT,
    installedVersion: "1.9.1",
    production: true,
    updateHandoff: popupUpdateHandoff({ channel: "managed", releaseVersion: "1.9.2" }, new Date("2026-08-29T18:00:30.000Z").getTime()),
    now: new Date("2026-08-29T18:01:00.000Z").getTime()
  });
  assert.equal(managed.context.title, "Reload Chrome companion");
  assert.equal(managed.primaryAction?.label, "Reload Chrome companion");

  const wrongVersion = derivePopupView({
    health: { ...READY, version: "1.9.3" },
    page: PRODUCT,
    installedVersion: "1.9.1",
    production: false,
    updateHandoff: handoff,
    now: new Date("2026-08-29T18:01:00.000Z").getTime()
  });
  assert.equal(wrongVersion.primaryAction?.id, "update_companion");
  assert.equal(popupUpdateHandoff({ channel: "other", releaseVersion: "1.9.2" }), null);
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
  assert.equal(pausedProduct.activity?.action, "resume_actions");
  assert.equal(pausedProduct.activity?.label, "Store actions paused · Resume");

  const testProduct = view({ ...READY, executionMode: "shadow" });
  assert.equal(testProduct.status, "monitoring");
  assert.equal(testProduct.primaryAction?.id, "inspect_product");
  assert.equal(testProduct.activity?.action, "review_mode");

  const monitoringProduct = view({ ...READY, chromeMutationEnabled: false });
  assert.equal(monitoringProduct.status, "monitoring");
  assert.equal(monitoringProduct.primaryAction?.id, "inspect_product");
  assert.equal(monitoringProduct.activity?.label, "Monitoring only · Open Insights");
  assert.equal(testProduct.activity?.label, "Test mode · Open Insights");
});

test("idle pages prioritize background attention and keep healthy idle quiet", () => {
  const pausedIdle = view({ ...READY, actionsPaused: true }, IDLE);
  assert.equal(pausedIdle.primaryAction?.id, "resume_actions");
  assert.equal(pausedIdle.primaryAction?.label, "Resume actions");
  assert.equal(pausedIdle.context.title, "Store actions paused");
  assert.equal(pausedIdle.activity?.label, "Calls live");

  const testIdle = view({ ...READY, executionMode: "shadow" }, IDLE);
  assert.equal(testIdle.primaryAction?.id, "review_mode");
  assert.equal(testIdle.primaryAction?.label, "Open Insights");
  assert.equal(testIdle.context.title, "Test mode");

  const disconnectedIdle = view({ ...READY, trackalackerPush: { ready: false, state: "error" } }, IDLE);
  assert.equal(disconnectedIdle.primaryAction?.id, "reconnect_trackalacker");
  assert.equal(disconnectedIdle.activity, null);

  const healthyIdle = view(READY, IDLE);
  assert.equal(healthyIdle.status, "ready");
  assert.equal(healthyIdle.context.visible, false);
  assert.equal(healthyIdle.primaryAction, null);
  assert.equal(healthyIdle.activity?.label, "Calls live");
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

test("Best Buy cannot fall back to Pickup when automatic Shipping selection is unverified", () => {
  const page = classifyPageContext("https://www.bestbuy.com/site/dragon-fire/6667316.p");
  const response = {
    workflow: "qualification",
    observation: { fulfillment: "pickup", availability: "unknown", sellerName: "Best Buy" },
    rehearsal: { ok: false, reason: "fulfillment_not_supported" }
  };
  const result = qualificationPopupResult(response, page);
  assert.match(result?.summary || "", /^Shipping not verified · /);
  assert.match(result?.details || "", /Nothing was added/);
  const view = derivePopupView({ health: READY, page, installedVersion: "1.22.5", production: false, lastResult: result });
  assert.deepEqual(view.resultStatus, { label: "Shipping not verified", tone: "warning" });
  for (const block of [{ securityChallenge: true }, { interactiveBlock: "high_demand" }]) {
    const stopped = qualificationPopupResult({ ...response, observation: { ...response.observation, ...block } }, page);
    assert.match(stopped?.summary || "", block.securityChallenge ? /^Blocked · / : /^Reservation required · /);
  }
});

test("Best Buy reservation guidance survives a product-code inspection and offers an explicit next step", () => {
  const page = classifyPageContext("https://www.bestbuy.com/product/reservation-product/J2FPJKS4SK");
  const result = qualificationPopupResult({ workflow: "qualification", shippingSelection: { ok: false },
    observation: { retailerSku: "6669869", canonicalUrl: "https://www.bestbuy.com/site/reservation-product/6669869.p",
      interactiveBlock: "high_demand", fulfillment: "unknown", availability: "unknown" },
    rehearsal: { ok: false, reason: "manual_action_required" }
  }, page);
  assert.match(result?.summary || "", /^Reservation required · Complete Best Buy’s reservation steps/);
  assert.match(result?.details || "", /then inspect the product again\. Nothing was added\./);
  const view = derivePopupView({ health: READY, page, installedVersion: "1.22.7", production: false, lastResult: result });
  assert.deepEqual(view.resultStatus, { label: "Reservation required", tone: "warning" });
});

test("persisted popup results are bounded, contextual, and redact untrusted error material", () => {
  const result = qualificationPopupResult({
    workflow: "qualification",
    productIdentity: {
      source: "catalog_exact_retailer_sku",
      retailerId: "target",
      retailerSku: "13331333",
      title: "Bicycle Standard Playing Cards\n2pk"
    },
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
  assert.equal(result?.summary, "Check passed · $5.39 · Shipping");
  assert.equal(result?.productTitle, "Bicycle Standard Playing Cards 2pk");
  assert.equal(result?.details, "TCIN 13331333 · $5.39 · Target · Shipping · Availability: In Stock · Exact offer binding verified");
  assert.doesNotMatch(result?.details || "", /store control/, "The boundary is stated once in the popup footer, not per result.");
  const identifiedView = derivePopupView({
    health: READY,
    page: PRODUCT,
    installedVersion: "1.9.1",
    production: false,
    lastResult: result
  });
  assert.equal(identifiedView.context.title, "Bicycle Standard Playing Cards 2pk");
  assert.equal(identifiedView.context.supporting, "TCIN 13331333 · $5.39 · Shipping");
  assert.equal(identifiedView.primaryAction?.label, "Inspect again");
  assert.deepEqual(identifiedView.resultStatus, { label: "Check passed", tone: "success" });

  const mismatchedIdentity = qualificationPopupResult({
    workflow: "inspection",
    productIdentity: {
      source: "catalog_exact_retailer_sku",
      retailerId: "target",
      retailerSku: "99999999",
      title: "Wrong product"
    },
    observation: { unitPriceCents: 539, fulfillment: "shipping", sellerName: "Target" }
  }, PRODUCT);
  assert.equal(mismatchedIdentity?.productTitle, undefined);

  const missingPrice = qualificationPopupResult({
    workflow: "inspection",
    observation: { unitPriceCents: null, fulfillment: "unknown", sellerName: "Best Buy" }
  }, PRODUCT);
  assert.equal(missingPrice?.summary, "Inspected · Price unavailable");

  const securityBlock = qualificationPopupResult({
    workflow: "qualification",
    observation: {
      unitPriceCents: null,
      fulfillment: "unknown",
      sellerName: "Best Buy",
      availability: "unknown",
      securityChallenge: true,
      interactiveBlock: "unknown"
    },
    rehearsal: { ok: false, reason: "manual_action_required" }
  }, PRODUCT);
  assert.match(securityBlock?.details || "", /Security check on the page/);
  assert.doesNotMatch(securityBlock?.details || "", /Manual step: Unknown/);
  assert.doesNotMatch(securityBlock?.details || "", /stopped safely|store control/);
  assert.match(securityBlock?.details || "", / · Manual Action Required$/);
  assert.equal(securityBlock?.summary, "Blocked · Manual Action Required");
  const blockedView = derivePopupView({
    health: READY,
    page: PRODUCT,
    installedVersion: "1.9.1",
    production: false,
    lastResult: securityBlock
  });
  assert.equal(blockedView.primaryAction?.label, "Inspect again");
  assert.deepEqual(blockedView.resultStatus, { label: "Blocked", tone: "warning" });

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

test("Audio Advice product links without a variant request page inspection before binding an offer", () => {
  const url = "https://www.audioadvice.com/products/audioquest-hdmi-48g-a-coupler";
  const unresolved = classifyPageContext(url);
  assert.equal(unresolved.kind, "product_link");
  if (unresolved.kind === "product_link") {
    assert.equal(unresolved.retailerId, "audioadvice");
    assert.equal(unresolved.productCode, "/products/audioquest-hdmi-48g-a-coupler");
  }
  assert.equal(classifyPageContext(`${url}?variant=41907724615764`).kind, "product");
  assert.equal(classifyPageContext(url.replace("www.audioadvice.com", "other.audioadvice.com")).kind, "unsupported");
});

test("the store-actions switch follows the paired control plane and hides behind hard blockers", () => {
  const on = view(READY, IDLE);
  assert.deepEqual(on.actionsToggle, {
    paused: false,
    pending: false,
    label: "Pause",
    title: "Store actions on",
    hint: "Yoink may add to a cart when a call matches a plan."
  });
  const paused = view({ ...READY, actionsPaused: true }, IDLE);
  assert.equal(paused.actionsToggle?.paused, true);
  assert.equal(paused.actionsToggle?.label, "Resume");
  assert.equal(paused.actionsToggle?.title, "Store actions paused");
  assert.match(paused.actionsToggle?.hint || "", /Carts stay untouched/);
  const testMode = view({ ...READY, executionMode: "shadow" }, IDLE);
  assert.equal(testMode.actionsToggle?.label, "Pause");
  assert.match(testMode.actionsToggle?.hint || "", /Test mode/);

  const pending = derivePopupView({
    health: { ...READY, actionsPaused: true }, page: IDLE, installedVersion: "1.9.1", production: false,
    actionsTogglePending: true, now: new Date("2026-08-29T18:01:00.000Z").getTime()
  });
  assert.equal(pending.actionsToggle?.label, "Resuming…");
  assert.equal(pending.actionsToggle?.pending, true);
  assert.equal(pending.primaryAction?.label, "Resuming…");
  assert.equal(pending.primaryAction?.disabled, true);

  assert.equal(view({ ...READY, connected: false }, IDLE).actionsToggle, null);
  assert.equal(view({ ...READY, paired: false }, IDLE).actionsToggle, null);
  assert.equal(view({ ...READY, version: "2.0.0", companionCompatible: false }, IDLE).actionsToggle, null);
});
