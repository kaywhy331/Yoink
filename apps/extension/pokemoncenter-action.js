"use strict";
var YoinkPokemonCenterActionModule = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // apps/extension/src/pokemoncenter-action.ts
  var pokemoncenter_action_exports = {};
  __export(pokemoncenter_action_exports, {
    abandonPokemonCenterAdd: () => abandonPokemonCenterAdd,
    commitPokemonCenterAdd: () => commitPokemonCenterAdd,
    inspectPokemonCenterCartBaseline: () => inspectPokemonCenterCartBaseline,
    preparePokemonCenterAdd: () => preparePokemonCenterAdd,
    rehearsePokemonCenterAdd: () => rehearsePokemonCenterAdd,
    verifyPokemonCenterAddedCart: () => verifyPokemonCenterAddedCart
  });

  // packages/contracts/src/amazon-approved-test.ts
  var AMAZON_APPROVED_TEST = Object.freeze({
    id: "amazon_test_20261002_B0D9ZTW7PS",
    approvalId: "owner_approved_amazon_cart_test_20261002",
    deviceId: "device_4ff8c709625244a89427e8c170d6baa7",
    retailerId: "amazon",
    retailerSku: "B0D9ZTW7PS",
    canonicalUrl: "https://www.amazon.com/dp/B0D9ZTW7PS",
    title: 'Schylling NeeDoh Nice Ice Baby - 1.25" Cube - Color May Vary (Pack of 1)',
    desiredVariant: "1.25-inch single cube; pack of 1; color may vary",
    unitPriceCents: 699,
    quantity: 1,
    seller: "Amazon.com",
    shipper: "Amazon.com",
    sourceEventId: "signal_event_6b16d83b73f04df8a34bd0c7c0a722a3",
    sourceObservedAt: "2026-10-02T14:34:12.075Z",
    approvalExpiresAt: "2026-10-03T00:00:00.000Z",
    maxDurationMs: 3e5
  });
  function amazonApprovedTestReason(job, now) {
    const a = job.approvedTest, s = AMAZON_APPROVED_TEST;
    if (!a) return "approved_amazon_test_missing";
    const issued = Date.parse(a.issuedAt), end = Date.parse(a.expiresAt);
    return a.version === 1 && a.approvalId === s.approvalId && a.jobId === s.id && job.jobId === s.id && a.deviceId === s.deviceId && a.desiredVariant === s.desiredVariant && a.sourceEventId === s.sourceEventId && a.sourceObservedAt === s.sourceObservedAt && JSON.stringify(a.exceptions) === JSON.stringify(["owner_approved_TEST_above_MSRP", "owner_approved_TEST_stale_signal"]) && a.noOrderAuthorization === true && !job.officialMsrp && Number.isFinite(issued) && issued <= now && issued >= Date.parse(s.sourceObservedAt) && Number.isFinite(end) && end > now && end - issued <= s.maxDurationMs && end <= Date.parse(s.approvalExpiresAt) && job.expiresAt === a.expiresAt && job.retailerId === s.retailerId && job.retailerSku === s.retailerSku && job.canonicalUrl === s.canonicalUrl && job.action === "add_to_cart" && job.quantity === 1 && job.maxUnitPriceCents === s.unitPriceCents && job.maxOrderTotalCents === s.unitPriceCents && job.currency === "USD" && job.sellerPolicy === "first_party_only" && job.expectedSeller === s.seller && job.fulfillment === "shipping" ? "" : "approved_amazon_test_invalid";
  }

  // packages/contracts/src/official-msrp.ts
  var MSRP_GUARDED_RETAILERS = Object.freeze(["amazon", "target", "walmart", "bestbuy"]);
  var OFFICIAL_MSRP_SIGNAL_MAX_AGE_MS = 12e4;
  var GUARDED_CART_MAX_QUANTITY = 10;
  function guardedCartQuantity(value) {
    return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= GUARDED_CART_MAX_QUANTITY;
  }
  var RESTOCK_RETRY_MAX_WINDOW_MS = 70 * 6e4;
  var RESTOCK_RETRY_REASONS = Object.freeze([
    "out_of_stock",
    "stock_unverified",
    "add_control_unavailable",
    "price_unavailable",
    "third_party_seller",
    "seller_unverified",
    "signal_seller_mismatch"
  ]);
  function restockRetryAuthorizes(signalObservedAt, retryUntil, now) {
    const observed = Date.parse(String(signalObservedAt || ""));
    const until = Date.parse(String(retryUntil || ""));
    return Number.isFinite(observed) && Number.isFinite(until) && observed <= now && now <= until && until - observed <= RESTOCK_RETRY_MAX_WINDOW_MS;
  }

  // packages/browser-safety/src/index.ts
  var BROWSER_SAFETY_CONTRACT_VERSION = 1;
  var LIVE_OFFER_MAX_AGE_MS = 3e4;
  var CART_PROOF_MAX_AGE_MS = 5 * 6e4;
  var CHECKOUT_EVIDENCE_MAX_AGE_MS = 2 * 6e4;
  var CART_BASELINE_MAX_LINES = 25;
  var RETAILER_DOMAINS = Object.freeze({
    target: ["target.com"],
    walmart: ["walmart.com"],
    amazon: ["amazon.com"],
    bestbuy: ["bestbuy.com"],
    disney: ["disneystore.com"],
    ravensburger: ["ravensburger.us"],
    riot: ["merch.riotgames.com"],
    booksamillion: ["booksamillion.com"],
    fanatics: ["fanatics.com"],
    kohls: ["kohls.com"],
    macys: ["macys.com"],
    pbandai: ["p-bandai.com"],
    pokemoncenter: ["pokemoncenter.com"],
    americaneagle: ["ae.com"],
    asus: ["eshop.asus.com"],
    athleta: ["athleta.gap.com"],
    audioadvice: ["www.audioadvice.com"],
    bananarepublic: ["bananarepublic.gap.com"],
    bananarepublicfactory: ["bananarepublicfactory.gapfactory.com"],
    aninebing: ["aninebing.com"]
  });
  function rejected(reason) {
    return { ok: false, reason };
  }
  function timestampAge(value, now) {
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp) || timestamp > now + 5e3) return null;
    return now - timestamp;
  }
  function cleanSeller(value) {
    return String(value || "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  }
  function sellerIdentity(value) {
    return cleanSeller(value).toLocaleLowerCase("en-US").replace(/^(?:sold\s+(?:and\s+shipped\s+)?by|seller\s*:?|merchant\s*:?)\s*/i, "").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  }
  function retailerUrlAllowed(retailerId, value) {
    const domains = RETAILER_DOMAINS[retailerId] ?? [];
    try {
      const url = new URL(value);
      const hostname = url.hostname.toLocaleLowerCase("en-US");
      return url.protocol === "https:" && !url.username && !url.password && domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
    } catch {
      return false;
    }
  }
  function sellerAllowed(job, sellerName, sellerType) {
    const seller = cleanSeller(sellerName);
    if (sellerType === "unknown") return "seller_unverified";
    if (job.sellerPolicy === "first_party_only" && sellerType !== "first_party") return "third_party_seller";
    if (sellerType === "third_party") {
      if (!seller) return "seller_unverified";
      const expected = sellerIdentity(job.expectedSeller);
      if (expected && sellerIdentity(seller) !== expected) return "signal_seller_mismatch";
    }
    return "";
  }
  function fulfillmentAllowed(required, observed) {
    if (!["shipping", "pickup"].includes(observed)) return false;
    return required === observed;
  }
  function validJob(job, now) {
    if (job.approvedTest) {
      const rejected2 = amazonApprovedTestReason(job, now);
      if (rejected2) return rejected2;
    }
    if (job.contractVersion !== BROWSER_SAFETY_CONTRACT_VERSION) return "contract_version_mismatch";
    if (!job.jobId || !job.retailerId || !job.retailerSku) return "job_identity_invalid";
    if (!retailerUrlAllowed(job.retailerId, job.canonicalUrl)) return "canonical_url_invalid";
    if (!Number.isInteger(job.quantity) || job.quantity < 1 || job.quantity > 99) return "quantity_invalid";
    if (!Number.isSafeInteger(job.maxUnitPriceCents) || job.maxUnitPriceCents <= 0) return "unit_cap_invalid";
    if (!Number.isSafeInteger(job.maxOrderTotalCents) || job.maxOrderTotalCents <= 0) return "total_cap_invalid";
    if (job.fulfillment !== "shipping" && job.fulfillment !== "pickup") return "fulfillment_not_supported";
    const expiresAt = new Date(job.expiresAt).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= now) return "job_expired";
    if (MSRP_GUARDED_RETAILERS.includes(job.retailerId) && job.officialMsrp) {
      if (job.action !== "add_to_cart" || !guardedCartQuantity(job.quantity) || job.sellerPolicy !== "first_party_only" || job.fulfillment !== "shipping") return "official_msrp_cart_policy_invalid";
      const proof = job.officialMsrp;
      const age = timestampAge(proof.signalObservedAt, now);
      const evidenceExpiry = Date.parse(proof.expiresAt);
      const retrying = restockRetryAuthorizes(proof.signalObservedAt, job.restockRetryUntil, now);
      if (proof.version !== 1 || !/^official_msrp_[a-f0-9]{32}$/.test(proof.evidenceId) || !/^[a-f0-9]{64}$/.test(proof.evidenceHash) || !/^[a-f0-9]{64}$/.test(proof.listingIdentityHash) || proof.retailerId !== job.retailerId || proof.retailerSku !== job.retailerSku || typeof proof.desiredVariant !== "string" || !proof.desiredVariant.trim() || !proof.variantAttributes || typeof proof.variantAttributes !== "object" || Array.isArray(proof.variantAttributes) || proof.currency !== "USD" || job.currency !== "USD" || !Number.isSafeInteger(proof.msrpCents) || proof.msrpCents <= 0 || !Number.isSafeInteger(proof.unitPriceCents) || proof.unitPriceCents <= 0 || proof.unitPriceCents > proof.msrpCents || proof.unitPriceCents > job.maxUnitPriceCents || job.maxUnitPriceCents > proof.msrpCents || age === null || age < 0 || !retrying && age > OFFICIAL_MSRP_SIGNAL_MAX_AGE_MS || !Number.isFinite(evidenceExpiry) || !retrying && evidenceExpiry <= now) return "official_msrp_authorization_invalid";
    }
    return "";
  }
  function verifyLiveOffer(job, observation, now = Date.now()) {
    const invalidJob = validJob(job, now);
    if (invalidJob) return rejected(invalidJob);
    if (observation.contractVersion !== BROWSER_SAFETY_CONTRACT_VERSION) return rejected("contract_version_mismatch");
    const age = timestampAge(observation.observedAt, now);
    if (age === null || age > LIVE_OFFER_MAX_AGE_MS) return rejected("offer_stale");
    if (observation.retailerId !== job.retailerId || observation.retailerSku !== job.retailerSku) return rejected("listing_mismatch");
    if (!retailerUrlAllowed(job.retailerId, observation.url) || observation.pageKind !== "product") return rejected("product_page_unverified");
    if (observation.securityChallenge || observation.interactiveBlock) return rejected("manual_action_required");
    if (!["in_stock", "preorder"].includes(observation.availability)) return rejected("out_of_stock");
    if (!observation.addControlActionable) return rejected("add_control_unavailable");
    if (observation.currency !== job.currency) return rejected("currency_mismatch");
    const sellerReason = sellerAllowed(job, observation.sellerName, observation.sellerType);
    if (sellerReason) return rejected(sellerReason);
    if (!Number.isSafeInteger(observation.unitPriceCents) || Number(observation.unitPriceCents) <= 0) return rejected("price_unavailable");
    if (job.approvedTest && (observation.unitPriceCents !== 699 || observation.availability !== "in_stock" || observation.sellerName !== "Amazon.com" || observation.sellerType !== "first_party" || observation.fulfillment !== "shipping")) return rejected("approved_amazon_test_offer_changed");
    if (job.officialMsrp) {
      const selection = observation.selectedOffer;
      if (selection?.schemaVersion !== 1 || selection.selectionState !== "exact" || selection.childOfferKey !== job.retailerSku) return rejected("desired_variant_unverified");
      const normalize = (value) => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
      const actual = selection.attributes;
      const expected = job.officialMsrp.variantAttributes;
      if (Object.keys(actual).length !== Object.keys(expected).length || Object.entries(expected).some(([key, value]) => typeof value !== "string" || typeof actual[key] !== "string" || normalize(value) !== normalize(actual[key]))) return rejected("desired_variant_changed");
      if (observation.availability !== "in_stock") return rejected("stock_unverified");
    }
    if (Number(observation.unitPriceCents) > job.maxUnitPriceCents) return rejected("over_unit_cap");
    if (Number(observation.unitPriceCents) * job.quantity > job.maxOrderTotalCents) return rejected("over_total_cap");
    if (!fulfillmentAllowed(job.fulfillment, observation.fulfillment)) return rejected("fulfillment_unverified");
    return {
      ok: true,
      reason: "verified",
      proof: {
        contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
        jobId: job.jobId,
        retailerId: job.retailerId,
        retailerSku: job.retailerSku,
        observedAt: observation.observedAt,
        unitPriceCents: Number(observation.unitPriceCents),
        currency: observation.currency,
        sellerName: cleanSeller(observation.sellerName),
        sellerType: observation.sellerType,
        fulfillment: observation.fulfillment
      }
    };
  }
  function normalizedCartLines(inventory) {
    if (!inventory.complete || !inventory.independentlyCounted || inventory.independentLineCount !== inventory.lines.length || inventory.lines.length > CART_BASELINE_MAX_LINES) return null;
    const lines = [];
    const seen = /* @__PURE__ */ new Set();
    for (const line of inventory.lines) {
      const retailerSku = String(line.retailerSku || "").normalize("NFKC").trim().toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9._-]{0,119}$/.test(retailerSku) || !Number.isInteger(line.quantity) || Number(line.quantity) < 1 || Number(line.quantity) > 99 || seen.has(retailerSku)) return null;
      seen.add(retailerSku);
      lines.push({ retailerSku, quantity: Number(line.quantity) });
    }
    return lines.sort((left, right) => left.retailerSku.localeCompare(right.retailerSku, "en-US"));
  }
  function captureCartBaseline(retailerId, inventory, now = Date.now()) {
    if (!Object.hasOwn(RETAILER_DOMAINS, retailerId)) return rejected("retailer_not_supported");
    if (inventory.contractVersion !== BROWSER_SAFETY_CONTRACT_VERSION) return rejected("contract_version_mismatch");
    const age = timestampAge(inventory.observedAt, now);
    if (age === null || age > LIVE_OFFER_MAX_AGE_MS) return rejected("cart_evidence_stale");
    const lines = normalizedCartLines(inventory);
    if (!lines) return rejected("cart_unverified");
    return {
      ok: true,
      reason: "verified",
      proof: {
        contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
        retailerId,
        observedAt: inventory.observedAt,
        lineCount: lines.length,
        lines
      }
    };
  }
  function verifyCartAddDelta(job, baseline, inventory, offerProof, now = Date.now()) {
    const invalidJob = validJob(job, now);
    if (invalidJob) return rejected(invalidJob);
    if (baseline.contractVersion !== BROWSER_SAFETY_CONTRACT_VERSION || baseline.retailerId !== job.retailerId || baseline.lineCount !== baseline.lines.length || baseline.lines.length > CART_BASELINE_MAX_LINES) return rejected("cart_baseline_invalid");
    const baselineAge = timestampAge(baseline.observedAt, now);
    const cartAge = timestampAge(inventory.observedAt, now);
    const offerAge = timestampAge(offerProof.observedAt, now);
    if (baselineAge === null || baselineAge > CART_PROOF_MAX_AGE_MS) return rejected("cart_baseline_stale");
    if (cartAge === null || cartAge > LIVE_OFFER_MAX_AGE_MS || offerAge === null || offerAge > CART_PROOF_MAX_AGE_MS) return rejected("cart_evidence_stale");
    if (new Date(baseline.observedAt).getTime() > new Date(inventory.observedAt).getTime()) {
      return rejected("cart_baseline_invalid");
    }
    if (offerProof.jobId !== job.jobId || offerProof.retailerId !== job.retailerId || offerProof.retailerSku !== job.retailerSku) return rejected("offer_proof_mismatch");
    const baselineLines = normalizedCartLines({
      contractVersion: baseline.contractVersion,
      observedAt: baseline.observedAt,
      complete: true,
      independentlyCounted: true,
      independentLineCount: baseline.lineCount,
      lines: baseline.lines.map((line2) => ({
        retailerSku: line2.retailerSku,
        quantity: line2.quantity,
        unitPriceCents: null,
        sellerName: "",
        sellerType: "unknown"
      }))
    });
    const afterLines = normalizedCartLines(inventory);
    if (!baselineLines || !afterLines) return rejected("cart_unverified");
    const expectedSku = job.retailerSku.toUpperCase();
    const before = new Map(baselineLines.map((line2) => [line2.retailerSku, line2.quantity]));
    const after = new Map(afterLines.map((line2) => [line2.retailerSku, line2.quantity]));
    if (after.size !== before.size + (before.has(expectedSku) ? 0 : 1)) return rejected("cart_delta_unverified");
    for (const [retailerSku, quantity2] of before) {
      const expectedQuantity = quantity2 + (retailerSku === expectedSku ? job.quantity : 0);
      if (after.get(retailerSku) !== expectedQuantity) return rejected("cart_delta_unverified");
    }
    if (!before.has(expectedSku) && after.get(expectedSku) !== job.quantity) return rejected("cart_delta_unverified");
    for (const retailerSku of after.keys()) {
      if (retailerSku !== expectedSku && !before.has(retailerSku)) return rejected("cart_delta_unverified");
    }
    const line = inventory.lines.find((candidate) => String(candidate.retailerSku || "").normalize("NFKC").trim().toUpperCase() === expectedSku);
    if (!line) return rejected("quantity_unavailable");
    const unitPriceCents = line.unitPriceCents ?? offerProof.unitPriceCents;
    const sellerName = line.sellerName || offerProof.sellerName;
    const sellerType = line.sellerType === "unknown" ? offerProof.sellerType : line.sellerType;
    const sellerReason = sellerAllowed(job, sellerName, sellerType);
    if (sellerReason) return rejected(sellerReason);
    if (!Number.isSafeInteger(unitPriceCents) || Number(unitPriceCents) <= 0) return rejected("price_unavailable");
    if (Number(unitPriceCents) > job.maxUnitPriceCents) return rejected("over_unit_cap");
    return {
      ok: true,
      reason: "verified",
      proof: {
        contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
        jobId: job.jobId,
        retailerId: job.retailerId,
        retailerSku: job.retailerSku,
        observedAt: inventory.observedAt,
        quantity: job.quantity,
        unitPriceCents: Number(unitPriceCents),
        sellerName: cleanSeller(sellerName),
        sellerType
      }
    };
  }

  // packages/browser-adapters/src/dom.ts
  function renderedVisible(element, environment) {
    if (environment?.isVisible) {
      try {
        return environment.isVisible(element);
      } catch {
        return false;
      }
    }
    for (let node = element; node; node = node.parentElement) {
      if (node.hasAttribute("hidden") || node.hasAttribute("inert") || node.getAttribute("aria-hidden") === "true") return false;
      const style = node.ownerDocument.defaultView?.getComputedStyle(node);
      if (style && (style.display === "none" || ["hidden", "collapse"].includes(style.visibility) || style.opacity === "0")) return false;
    }
    return true;
  }
  var GENERIC_QUANTITY_SELECTORS = Object.freeze([
    "select[name*='quantity' i]",
    "select[name*='qty' i]",
    "select[aria-label*='quantity' i]",
    "input[name*='quantity' i]",
    "input[name*='qty' i]",
    "input[aria-label*='quantity' i]",
    "[role='spinbutton']",
    "button[aria-label*='quantity' i]",
    "[role='combobox'][aria-label*='quantity' i]"
  ]);

  // packages/contracts/src/add-lanes.ts
  function lane(definition) {
    return Object.freeze({
      ...definition,
      ...definition.pageHosts ? { pageHosts: Object.freeze([...definition.pageHosts]) } : {},
      capability: Object.freeze({ ...definition.capability }),
      operations: Object.freeze({ ...definition.operations }),
      supportedFulfillment: Object.freeze([...definition.supportedFulfillment]),
      rehearsalGuidance: Object.freeze({ ...definition.rehearsalGuidance })
    });
  }
  var ADD_LANES = Object.freeze({
    target: lane({
      id: "target",
      name: "Target",
      domain: "target.com",
      contractVersion: "target-add-v12",
      packVersion: "target-pack-v1",
      observerVersion: "target-observer-v9",
      activationConfirmation: "ENABLE_TARGET_ADD_V12",
      firstPartySeller: "Target",
      capability: { enabled: "targetAddOnly", version: "targetAddAdapterVersion" },
      rehearsalEvidenceNamespace: "target-add-rehearsal-v1",
      qualificationEvidenceNamespace: "target-add-qualification-evidence-v1",
      cartUrl: "https://www.target.com/cart",
      checkoutUrl: "https://www.target.com/checkout",
      runnerFile: "target-action.js",
      runnerGlobal: "YoinkTargetAction",
      operations: {
        rehearse: "rehearseTargetAdd",
        baseline: "inspectTargetCartBaseline",
        prepare: "prepareTargetAdd",
        commit: "commitTargetAdd",
        verifyCart: "verifyTargetAddedCart",
        raiseCart: "raiseTargetCartQuantity"
      },
      skuPattern: "^\\d{6,20}$",
      supportedFulfillment: ["shipping", "pickup"],
      trialRouteSlug: "target-add",
      rehearsalPolicy: "first_party_shipping",
      rehearsalGuidance: {
        default: "Open an available Target-sold product with Shipping or same-day Delivery available before running the no-click rehearsal."
      }
    }),
    walmart: lane({
      id: "walmart",
      name: "Walmart",
      domain: "walmart.com",
      contractVersion: "walmart-add-v10",
      packVersion: "walmart-pack-v1",
      observerVersion: "walmart-observer-v8",
      activationConfirmation: "ENABLE_WALMART_ADD_V10",
      firstPartySeller: "Walmart",
      capability: { enabled: "walmartAddOnly", version: "walmartAddAdapterVersion" },
      rehearsalEvidenceNamespace: "walmart-add-rehearsal-v1",
      qualificationEvidenceNamespace: "walmart-add-qualification-evidence-v1",
      cartUrl: "https://www.walmart.com/cart",
      checkoutUrl: "https://www.walmart.com/checkout",
      runnerFile: "walmart-action.js",
      runnerGlobal: "YoinkWalmartAction",
      operations: {
        rehearse: "rehearseWalmartAdd",
        baseline: "inspectWalmartCartBaseline",
        prepare: "prepareWalmartAdd",
        commit: "commitWalmartAdd",
        verifyCart: "verifyWalmartAddedCart",
        raiseCart: "raiseWalmartCartQuantity"
      },
      skuPattern: "^\\d{5,20}$",
      supportedFulfillment: ["shipping", "pickup"],
      trialRouteSlug: "walmart-add",
      rehearsalPolicy: "first_party_shipping",
      rehearsalGuidance: {
        default: "Open an available Walmart-sold product with shipping explicitly available before running the no-click rehearsal."
      }
    }),
    amazon: lane({
      id: "amazon",
      name: "Amazon",
      domain: "amazon.com",
      contractVersion: "amazon-add-v11",
      packVersion: "amazon-pack-v2",
      observerVersion: "amazon-observer-v9",
      activationConfirmation: "ENABLE_AMAZON_ADD_V11",
      firstPartySeller: "Amazon.com",
      capability: { enabled: "amazonAddOnly", version: "amazonAddAdapterVersion" },
      rehearsalEvidenceNamespace: "amazon-add-rehearsal-v4",
      qualificationEvidenceNamespace: "amazon-add-qualification-evidence-v1",
      cartUrl: "https://www.amazon.com/gp/cart/view.html",
      checkoutUrl: "https://www.amazon.com/gp/buy/spc/handlers/display.html?hasWorkingJavascript=1",
      runnerFile: "amazon-action.js",
      runnerGlobal: "YoinkAmazonAction",
      operations: {
        rehearse: "rehearseAmazonAdd",
        baseline: "inspectAmazonCartBaseline",
        prepare: "prepareAmazonAdd",
        commit: "commitAmazonAdd",
        verifyCart: "verifyAmazonAddedCart"
      },
      skuPattern: "^[A-Z0-9]{10}$",
      supportedFulfillment: ["shipping"],
      trialRouteSlug: "amazon-add",
      rehearsalPolicy: "first_party_exact_route",
      rehearsalGuidance: {
        default: "Open an available Amazon.com-sold product with a unique shipping offer before running the no-click rehearsal."
      }
    }),
    bestbuy: lane({
      id: "bestbuy",
      name: "Best Buy",
      domain: "bestbuy.com",
      contractVersion: "bestbuy-add-v18",
      packVersion: "bestbuy-pack-v2",
      observerVersion: "bestbuy-observer-v14",
      activationConfirmation: "ENABLE_BESTBUY_ADD_V18",
      firstPartySeller: "Best Buy",
      capability: { enabled: "bestBuyAddOnly", version: "bestBuyAddAdapterVersion" },
      rehearsalEvidenceNamespace: "bestbuy-add-rehearsal-v1",
      qualificationEvidenceNamespace: "bestbuy-add-qualification-evidence-v1",
      cartUrl: "https://www.bestbuy.com/cart",
      checkoutUrl: "https://www.bestbuy.com/checkout/r/fast-track",
      runnerFile: "bestbuy-action.js",
      runnerGlobal: "YoinkBestBuyAction",
      operations: {
        rehearse: "rehearseBestBuyAdd",
        baseline: "inspectBestBuyCartBaseline",
        prepare: "prepareBestBuyAdd",
        commit: "commitBestBuyAdd",
        verifyCart: "verifyBestBuyAddedCart",
        raiseCart: "raiseBestBuyCartQuantity"
      },
      skuPattern: "^\\d{5,20}$",
      supportedFulfillment: ["shipping", "pickup"],
      trialRouteSlug: "bestbuy-add",
      rehearsalPolicy: "first_party_shipping",
      rehearsalGuidance: {
        default: "Yoink selects Shipping before checking an available Best Buy-sold offer and its Add to cart or Pre-order control. No cart action occurs during the check.",
        highDemand: "Complete Best Buy\u2019s reservation or queue steps in this tab, then inspect the product again. Yoink has not added the item.",
        securityChallenge: "Complete the visible Best Buy security check in this tab, then retry qualification.",
        auth: "Sign in to Best Buy in this tab, confirm your location, then retry qualification.",
        mfa: "Complete Best Buy account verification in this tab, then retry qualification.",
        location: "Confirm your Best Buy location and select Shipping, then retry qualification.",
        pickup: "Yoink could not verify Shipping on this Best Buy offer. Nothing was added; Pickup will not be used."
      }
    }),
    pokemoncenter: lane({
      id: "pokemoncenter",
      name: "Pok\xE9mon Center",
      domain: "pokemoncenter.com",
      contractVersion: "pokemoncenter-add-v1",
      packVersion: "retailers-pack-v1",
      observerVersion: "pokemoncenter-observer-v4",
      activationConfirmation: "ENABLE_POKEMONCENTER_ADD_V1",
      firstPartySeller: "Pok\xE9mon Center",
      capability: { enabled: "pokemonCenterAddOnly", version: "pokemonCenterAddAdapterVersion" },
      rehearsalEvidenceNamespace: "pokemoncenter-add-rehearsal-v1",
      qualificationEvidenceNamespace: "pokemoncenter-add-qualification-evidence-v1",
      cartUrl: "https://www.pokemoncenter.com/cart",
      runnerFile: "pokemoncenter-action.js",
      runnerGlobal: "YoinkPokemonCenterAction",
      operations: {
        rehearse: "rehearsePokemonCenterAdd",
        baseline: "inspectPokemonCenterCartBaseline",
        prepare: "preparePokemonCenterAdd",
        commit: "commitPokemonCenterAdd",
        verifyCart: "verifyPokemonCenterAddedCart"
      },
      skuPattern: "^\\d{2,3}-\\d{5}(?:-\\d{3})?$",
      supportedFulfillment: ["shipping"],
      trialRouteSlug: "pokemoncenter-add",
      rehearsalPolicy: "first_party_shipping",
      rehearsalGuidance: {
        default: "Open an available Pok\xE9mon Center product with its exact SKU, USD price, quantity one, and shipping shown before checking.",
        securityChallenge: "Complete Pok\xE9mon Center\u2019s security check in this tab, then inspect again.",
        auth: "Sign in to Pok\xE9mon Center in this tab, then inspect again."
      }
    }),
    aninebing: lane({
      id: "aninebing",
      name: "ANINE BING",
      domain: "aninebing.com",
      contractVersion: "aninebing-add-v1",
      packVersion: "retailers-pack-v1",
      observerVersion: "aninebing-observer-v1",
      activationConfirmation: "ENABLE_ANINEBING_ADD_V1",
      firstPartySeller: "ANINE BING",
      capability: { enabled: "anineBingAddOnly", version: "anineBingAddAdapterVersion" },
      rehearsalEvidenceNamespace: "aninebing-add-rehearsal-v1",
      qualificationEvidenceNamespace: "aninebing-add-qualification-evidence-v1",
      cartUrl: "https://www.aninebing.com/cart",
      runnerFile: "aninebing-action.js",
      runnerGlobal: "YoinkAnineBingAction",
      operations: {
        rehearse: "rehearseAnineBingAdd",
        baseline: "inspectAnineBingCartBaseline",
        prepare: "prepareAnineBingAdd",
        commit: "commitAnineBingAdd",
        verifyCart: "verifyAnineBingAddedCart"
      },
      skuPattern: "^\\d{10,20}$",
      supportedFulfillment: ["shipping"],
      trialRouteSlug: "aninebing-add",
      rehearsalPolicy: "first_party_shipping",
      rehearsalGuidance: {
        default: "Open an available ANINE BING product with its selected variant, USD price, quantity one, and shipping shown before checking.",
        securityChallenge: "Complete ANINE BING\u2019s security check in this tab, then inspect again.",
        auth: "Sign in to ANINE BING in this tab, then inspect again."
      }
    }),
    americaneagle: lane({
      id: "americaneagle",
      name: "American Eagle",
      domain: "ae.com",
      contractVersion: "americaneagle-add-v1",
      packVersion: "retailers-pack-v1",
      observerVersion: "americaneagle-observer-v1",
      activationConfirmation: "ENABLE_AMERICANEAGLE_ADD_V1",
      firstPartySeller: "American Eagle",
      capability: { enabled: "americanEagleAddOnly", version: "americanEagleAddAdapterVersion" },
      rehearsalEvidenceNamespace: "americaneagle-add-rehearsal-v1",
      qualificationEvidenceNamespace: "americaneagle-add-qualification-evidence-v1",
      cartUrl: "https://www.ae.com/us/en/cart",
      runnerFile: "americaneagle-action.js",
      runnerGlobal: "YoinkAmericanEagleAction",
      operations: {
        rehearse: "rehearseAmericanEagleAdd",
        baseline: "inspectAmericanEagleCartBaseline",
        prepare: "prepareAmericanEagleAdd",
        commit: "commitAmericanEagleAdd",
        verifyCart: "verifyAmericanEagleAddedCart"
      },
      skuPattern: "^\\d{10}$",
      supportedFulfillment: ["shipping"],
      trialRouteSlug: "americaneagle-add",
      rehearsalPolicy: "first_party_shipping",
      rehearsalGuidance: {
        default: "Open an available American Eagle product with One Size selected and its exact child SKU, USD price, quantity one, and shipping shown before checking.",
        securityChallenge: "Complete American Eagle\u2019s security check in this tab, then inspect again.",
        auth: "Sign in to American Eagle in this tab, then inspect again."
      }
    }),
    asus: lane({
      id: "asus",
      name: "ASUS",
      domain: "eshop.asus.com",
      contractVersion: "asus-add-v1",
      packVersion: "retailers-pack-v1",
      observerVersion: "asus-observer-v1",
      activationConfirmation: "ENABLE_ASUS_ADD_V1",
      firstPartySeller: "ASUS",
      capability: { enabled: "asusAddOnly", version: "asusAddAdapterVersion" },
      rehearsalEvidenceNamespace: "asus-add-rehearsal-v1",
      qualificationEvidenceNamespace: "asus-add-qualification-evidence-v1",
      cartUrl: "https://eshop.asus.com/us/checkout/cart/",
      runnerFile: "asus-action.js",
      runnerGlobal: "YoinkAsusAction",
      operations: {
        rehearse: "rehearseAsusAdd",
        baseline: "inspectAsusCartBaseline",
        prepare: "prepareAsusAdd",
        commit: "commitAsusAdd",
        verifyCart: "verifyAsusAddedCart"
      },
      skuPattern: "^[A-Z0-9]{8}-[A-Z0-9]{6}$",
      supportedFulfillment: ["shipping"],
      trialRouteSlug: "asus-add",
      rehearsalPolicy: "first_party_shipping",
      rehearsalGuidance: {
        default: "Open an available ASUS product with its fixed part number, USD price, quantity one, and shipping shown before checking.",
        securityChallenge: "Complete ASUS\u2019s security check in this tab, then inspect again.",
        auth: "Sign in to ASUS in this tab, then inspect again."
      }
    }),
    athleta: lane({
      id: "athleta",
      name: "Athleta",
      domain: "athleta.gap.com",
      contractVersion: "athleta-add-v1",
      packVersion: "retailers-pack-v1",
      observerVersion: "athleta-observer-v1",
      activationConfirmation: "ENABLE_ATHLETA_ADD_V1",
      firstPartySeller: "Athleta",
      capability: { enabled: "athletaAddOnly", version: "athletaAddAdapterVersion" },
      rehearsalEvidenceNamespace: "athleta-add-rehearsal-v1",
      qualificationEvidenceNamespace: "athleta-add-qualification-evidence-v1",
      cartUrl: "https://secure-athleta.gap.com/shopping-bag",
      pageHosts: ["athleta.gap.com", "secure-athleta.gap.com"],
      runnerFile: "athleta-action.js",
      runnerGlobal: "YoinkAthletaAction",
      operations: {
        rehearse: "rehearseAthletaAdd",
        baseline: "inspectAthletaCartBaseline",
        prepare: "prepareAthletaAdd",
        commit: "commitAthletaAdd",
        verifyCart: "verifyAthletaAddedCart"
      },
      skuPattern: "^\\d{9}0000$",
      supportedFulfillment: ["shipping"],
      trialRouteSlug: "athleta-add",
      rehearsalPolicy: "first_party_shipping",
      rehearsalGuidance: {
        default: "Open an available Athleta product with One Size selected and its exact child SKU, USD price, quantity one, and shipping shown before checking.",
        securityChallenge: "Complete Athleta\u2019s security check in this tab, then inspect again.",
        auth: "Sign in to Athleta in this tab, then inspect again."
      }
    }),
    audioadvice: lane({
      id: "audioadvice",
      name: "Audio Advice",
      domain: "www.audioadvice.com",
      contractVersion: "audioadvice-add-v1",
      packVersion: "retailers-pack-v1",
      observerVersion: "audioadvice-observer-v1",
      activationConfirmation: "ENABLE_AUDIOADVICE_ADD_V1",
      firstPartySeller: "Audio Advice",
      capability: { enabled: "audioadviceAddOnly", version: "audioadviceAddAdapterVersion" },
      rehearsalEvidenceNamespace: "audioadvice-add-rehearsal-v1",
      qualificationEvidenceNamespace: "audioadvice-add-qualification-evidence-v1",
      cartUrl: "https://www.audioadvice.com/cart",
      runnerFile: "audioadvice-action.js",
      runnerGlobal: "YoinkAudioAdviceAction",
      operations: {
        rehearse: "rehearseAudioAdviceAdd",
        baseline: "inspectAudioAdviceCartBaseline",
        prepare: "prepareAudioAdviceAdd",
        commit: "commitAudioAdviceAdd",
        verifyCart: "verifyAudioAdviceAddedCart"
      },
      skuPattern: "^\\d{10,20}$",
      supportedFulfillment: ["shipping"],
      trialRouteSlug: "audioadvice-add",
      rehearsalPolicy: "first_party_shipping",
      rehearsalGuidance: {
        default: "Open an available Audio Advice product with its selected variant, USD price, quantity one, and shipping shown before checking.",
        securityChallenge: "Complete Audio Advice\u2019s security check in this tab, then inspect again.",
        auth: "Sign in to Audio Advice in this tab, then inspect again."
      }
    }),
    bananarepublic: lane({
      id: "bananarepublic",
      name: "Banana Republic",
      domain: "bananarepublic.gap.com",
      contractVersion: "bananarepublic-add-v1",
      packVersion: "retailers-pack-v1",
      observerVersion: "bananarepublic-observer-v1",
      activationConfirmation: "ENABLE_BANANAREPUBLIC_ADD_V1",
      firstPartySeller: "Banana Republic",
      capability: { enabled: "bananarepublicAddOnly", version: "bananarepublicAddAdapterVersion" },
      rehearsalEvidenceNamespace: "bananarepublic-add-rehearsal-v1",
      qualificationEvidenceNamespace: "bananarepublic-add-qualification-evidence-v1",
      cartUrl: "https://secure-bananarepublic.gap.com/shopping-bag",
      pageHosts: ["bananarepublic.gap.com", "secure-bananarepublic.gap.com"],
      runnerFile: "bananarepublic-action.js",
      runnerGlobal: "YoinkBananaRepublicAction",
      operations: {
        rehearse: "rehearseBananaRepublicAdd",
        baseline: "inspectBananaRepublicCartBaseline",
        prepare: "prepareBananaRepublicAdd",
        commit: "commitBananaRepublicAdd",
        verifyCart: "verifyBananaRepublicAddedCart"
      },
      skuPattern: "^\\d{9}0000$",
      supportedFulfillment: ["shipping"],
      trialRouteSlug: "bananarepublic-add",
      rehearsalPolicy: "first_party_shipping",
      rehearsalGuidance: {
        default: "Open an available Banana Republic product with One Size selected and its exact child SKU, USD price, quantity one, and shipping shown before checking.",
        securityChallenge: "Complete Banana Republic\u2019s security check in this tab, then inspect again.",
        auth: "Sign in to Banana Republic in this tab, then inspect again."
      }
    }),
    bananarepublicfactory: lane({
      id: "bananarepublicfactory",
      name: "Banana Republic Factory",
      domain: "bananarepublicfactory.gapfactory.com",
      contractVersion: "bananarepublicfactory-add-v1",
      packVersion: "retailers-pack-v1",
      observerVersion: "bananarepublicfactory-observer-v1",
      activationConfirmation: "ENABLE_BANANAREPUBLICFACTORY_ADD_V1",
      firstPartySeller: "Banana Republic Factory",
      capability: { enabled: "bananarepublicfactoryAddOnly", version: "bananarepublicfactoryAddAdapterVersion" },
      rehearsalEvidenceNamespace: "bananarepublicfactory-add-rehearsal-v1",
      qualificationEvidenceNamespace: "bananarepublicfactory-add-qualification-evidence-v1",
      cartUrl: "https://secure-bananarepublicfactory.gapfactory.com/shopping-bag",
      pageHosts: ["bananarepublicfactory.gapfactory.com", "secure-bananarepublicfactory.gapfactory.com"],
      runnerFile: "bananarepublicfactory-action.js",
      runnerGlobal: "YoinkBananaRepublicFactoryAction",
      operations: {
        rehearse: "rehearseBananaRepublicFactoryAdd",
        baseline: "inspectBananaRepublicFactoryCartBaseline",
        prepare: "prepareBananaRepublicFactoryAdd",
        commit: "commitBananaRepublicFactoryAdd",
        verifyCart: "verifyBananaRepublicFactoryAddedCart"
      },
      skuPattern: "^\\d{10}0000$",
      supportedFulfillment: ["shipping"],
      trialRouteSlug: "bananarepublicfactory-add",
      rehearsalPolicy: "first_party_shipping",
      rehearsalGuidance: {
        default: "Open an available Banana Republic Factory product with One Size selected and its exact child SKU, USD price, quantity one, and shipping shown before checking.",
        securityChallenge: "Complete Banana Republic Factory\u2019s security check in this tab, then inspect again.",
        auth: "Sign in to Banana Republic Factory in this tab, then inspect again."
      }
    })
  });

  // packages/contracts/src/index.ts
  var POKEMONCENTER_ADD_ADAPTER_VERSION = "pokemoncenter-add-v1";
  var EVIDENCE_CAPSULE_MAX_SNAPSHOT_BYTES = 3 * 1024 * 1024;

  // packages/browser-adapters/src/audioadvice.ts
  var VARIANT = /^\d{10,20}$/;
  function text(element, environment) {
    const parts = [];
    const visit = (node) => {
      if (node.nodeType === 3) parts.push(node.textContent || "");
      else if (node.nodeType === 1 && !["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"].includes(node.tagName) && renderedVisible(node, environment)) for (const child of node.childNodes) visit(child);
    };
    visit(element);
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }
  function audioAdviceUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.port && url.hostname === "www.audioadvice.com" ? url : null;
    } catch {
      return null;
    }
  }
  function audioAdvicePageKind(value) {
    const url = audioAdviceUrl(value);
    if (!url) return "other";
    if (/^\/account(?:\/|$)/.test(url.pathname)) return "auth";
    if (/^\/cart\/?$/.test(url.pathname)) return "cart";
    if (/^\/checkouts?(?:\/|$)/.test(url.pathname)) return "checkout";
    return /^\/products\/[a-z0-9][a-z0-9-]*\/?$/.test(url.pathname) ? "product" : "other";
  }
  function audioAdviceUrlSku(value) {
    const url = audioAdviceUrl(value);
    const variant = url?.searchParams.get("variant") || "";
    return url && audioAdvicePageKind(value) === "product" && url.searchParams.getAll("variant").length === 1 && VARIANT.test(variant) ? variant : "";
  }
  function audioAdviceSecurityChallenge(document, environment) {
    return /(?:verify|confirm) (?:that )?you are (?:a )?human|access denied|you have been blocked|security check|captcha challenge/i.test(text(document.body, environment)) || [...document.querySelectorAll("iframe[src*='captcha'], iframe[src*='challenge']")].some((e) => renderedVisible(e, environment));
  }
  function audioAdviceInteractiveBlock(document, url, environment) {
    if (audioAdvicePageKind(url) === "auth") return "auth";
    if (audioAdviceSecurityChallenge(document, environment)) return "unknown";
    if (/you(?:'|’)re in line|waiting room|please wait in (?:the )?queue/i.test(text(document.body, environment))) return "queue";
    if ([...document.querySelectorAll("dialog[open], [aria-modal='true'], input[type='password']")].some((e) => renderedVisible(e, environment))) return "unknown";
    return "";
  }
  function audioAdviceOfferBinding(document, urlValue, variantId, environment) {
    const url = audioAdviceUrl(urlValue);
    if (!url || document.URL !== urlValue || audioAdvicePageKind(urlValue) !== "product" || !VARIANT.test(variantId) || url.searchParams.has("variant") && (url.searchParams.getAll("variant").length !== 1 || url.searchParams.get("variant") !== variantId) || audioAdviceInteractiveBlock(document, urlValue, environment)) return null;
    const scoped = [...document.querySelectorAll("product-form .product-column-right")].filter((e) => renderedVisible(e, environment));
    if (scoped.length !== 1) return null;
    const root = scoped[0];
    const controls = [...root.querySelectorAll("form[action='/cart/add'] button#add-to-cart[name=add][type=submit]")].filter((e) => renderedVisible(e, environment));
    if (controls.length !== 1 || text(controls[0], environment).toUpperCase() !== "ADD TO CART") return null;
    const control = controls[0];
    const form = control.closest("form");
    if (form.getAttribute("method")?.toLowerCase() !== "post" || control.matches(":disabled") || control.closest("[aria-disabled=true], [aria-busy=true]")) return null;
    const fields = (name) => [...form.querySelectorAll(`input[name="${name}"]`)];
    const ids = fields("id"), quantities = fields("quantity"), products = fields("product-id"), sections = fields("section-id");
    if (ids.length !== 1 || ids[0].disabled || ids[0].value !== variantId || quantities.length !== 1 || quantities[0].disabled || quantities[0].value !== "1" || !renderedVisible(quantities[0], environment) || products.length !== 1 || !/^\d{10,20}$/.test(products[0].value) || products[0].disabled || sections.length !== 1 || !/^template--\d+__main$/.test(sections[0].value) || sections[0].disabled || form.getAttribute("id") !== `product-form-${sections[0].value}-${products[0].value}`) return null;
    for (const attr of ["min", "max"]) {
      const value = quantities[0].getAttribute(attr);
      if (value !== null && (!/^\d+$/.test(value) || (attr === "min" ? Number(value) > 1 : Number(value) < 1))) return null;
    }
    if (root.querySelector("variant-picker, variant-selects, select[name=id], input[name=selling_plan], input[name^='properties[']")) return null;
    const visibleNodes = (selector) => [...root.querySelectorAll(selector)].filter((e) => renderedVisible(e, environment));
    const prices = visibleNodes(".price-container .price__default .price__current"), stock = visibleNodes(".product-inventory-text");
    const title = visibleNodes("h1.product-title"), subtitle = visibleNodes(".product-subtitle"), mpn = visibleNodes(".product-mpn__value");
    if (prices.length !== 1 || stock.length !== 1 || title.length !== 1 || subtitle.length > 1 || mpn.length !== 1 || !/^In Stock: Free (?:2-Day )?Shipping$/i.test(text(stock[0], environment))) return null;
    const match = text(prices[0], environment).match(/^\$(\d[\d,]*)\.(\d{2})$/);
    if (!match) return null;
    const unitPriceCents = Number(match[1].replace(/,/g, "")) * 100 + Number(match[2]);
    if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents <= 0) return null;
    const schemas = [];
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const p = JSON.parse(script.textContent || "null");
        if (p?.["@type"] === "Product") schemas.push(p);
      } catch {
      }
    }
    if (schemas.length !== 1) return null;
    const product = schemas[0];
    const expectedName = [text(title[0], environment), ...subtitle.map((e) => text(e, environment))].join(" ");
    const primaryTitle = text(title[0], environment);
    if (typeof product.name !== "string" || !(product.name === primaryTitle || product.name.startsWith(`${primaryTitle} `)) || audioAdviceUrl(String(product.url))?.pathname !== url.pathname || typeof product.sku !== "string" || product.sku.split(":").at(-1) !== text(mpn[0], environment) || !Array.isArray(product.offers) || product.offers.length !== 1) return null;
    const offer = product.offers[0];
    const offerUrl = audioAdviceUrl(String(offer?.url));
    if (!offer || offer.sku !== product.sku || offer.priceCurrency !== "USD" || !/^https?:\/\/schema.org\/InStock$/.test(String(offer.availability)) || offer.seller?.name !== "Audio Advice" || !offerUrl || offerUrl.pathname !== url.pathname || offerUrl.searchParams.getAll("variant").length !== 1 || offerUrl.searchParams.get("variant") !== variantId || Math.abs(Number(offer.price) * 100 - unitPriceCents) > 1e-6 || !Number.isFinite(Number(offer.price))) return null;
    const fingerprint = JSON.stringify([
      variantId,
      products[0].value,
      sections[0].value,
      form.getAttribute("id"),
      product.sku,
      product.name,
      expectedName,
      unitPriceCents,
      text(stock[0], environment),
      quantities[0].value,
      product.offers
    ]);
    return { root, control, variantId, unitPriceCents, fingerprint };
  }

  // packages/browser-adapters/src/bananarepublic.ts
  var CHILD_SKU = /^\d{9}0000$/;
  function bananarepublicUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.port && ["bananarepublic.gap.com", "secure-bananarepublic.gap.com"].includes(url.hostname) ? url : null;
    } catch {
      return null;
    }
  }
  function bananarepublicUrlSku(value) {
    const url = bananarepublicUrl(value);
    const sku = url?.searchParams.get("pid") || "";
    return url?.hostname === "bananarepublic.gap.com" && url.pathname === "/browse/product.do" && url.searchParams.getAll("pid").length === 1 && CHILD_SKU.test(sku) && (!url.searchParams.has("vid") || url.searchParams.getAll("vid").length === 1 && url.searchParams.get("vid") === "1") ? sku : "";
  }

  // packages/browser-adapters/src/bananarepublicfactory.ts
  var CHILD_SKU2 = /^\d{10}0000$/;
  function bananarepublicfactoryUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.port && ["bananarepublicfactory.gapfactory.com", "secure-bananarepublicfactory.gapfactory.com"].includes(url.hostname) ? url : null;
    } catch {
      return null;
    }
  }
  function bananarepublicfactoryUrlSku(value) {
    const url = bananarepublicfactoryUrl(value);
    const sku = url?.searchParams.get("pid") || "";
    return url?.hostname === "bananarepublicfactory.gapfactory.com" && url.pathname === "/browse/product.do" && url.searchParams.getAll("pid").length === 1 && CHILD_SKU2.test(sku) && (!url.searchParams.has("vid") || url.searchParams.getAll("vid").length === 1 && url.searchParams.get("vid") === "1") ? sku : "";
  }

  // packages/browser-adapters/src/athleta.ts
  var CHILD_SKU3 = /^\d{9}0000$/;
  function athletaUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.port && ["athleta.gap.com", "secure-athleta.gap.com"].includes(url.hostname) ? url : null;
    } catch {
      return null;
    }
  }
  function athletaUrlSku(value) {
    const url = athletaUrl(value);
    const sku = url?.searchParams.get("pid") || "";
    return url?.hostname === "athleta.gap.com" && url.pathname === "/browse/product.do" && url.searchParams.getAll("pid").length === 1 && CHILD_SKU3.test(sku) && (!url.searchParams.has("vid") || url.searchParams.getAll("vid").length === 1 && url.searchParams.get("vid") === "1") ? sku : "";
  }

  // packages/browser-adapters/src/asus.ts
  function asusUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname === "eshop.asus.com" && !url.port && !url.username && !url.password && url.pathname.startsWith("/us/") ? url : null;
    } catch {
      return null;
    }
  }
  function asusUrlSku(value) {
    const url = asusUrl(value);
    if (!url || url.searchParams.has("config")) return "";
    return url.pathname.match(/^\/us\/([a-z0-9]{8}-[a-z0-9]{6})-[a-z0-9-]+\.html$/)?.[1]?.toUpperCase() || "";
  }

  // packages/browser-adapters/src/americaneagle.ts
  var CHILD_SKU4 = /^\d{10}$/;
  function elements(root, selector, environment) {
    return [...root.querySelectorAll(selector)].filter((e) => renderedVisible(e, environment));
  }
  function text2(element, environment) {
    if (!environment && typeof element.innerText === "string") return element.innerText.replace(/\s+/g, " ").trim();
    const parts = [];
    const visit = (node) => {
      if (node.nodeType === 3) parts.push(node.textContent || "");
      else if (node.nodeType === 1 && !["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"].includes(node.tagName) && renderedVisible(node, environment)) for (const child of node.childNodes) visit(child);
    };
    visit(element);
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }
  function cents(value) {
    const match = value.match(/^\$(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$/);
    if (!match) return null;
    const price2 = Number(match[1].replace(/,/g, "")) * 100 + Number(match[2]);
    return Number.isSafeInteger(price2) && price2 > 0 ? price2 : null;
  }
  function americanEagleUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.port && ["ae.com", "www.ae.com"].includes(url.hostname) && /^\/us\/en(?:\/|$)/.test(url.pathname) ? url : null;
    } catch {
      return null;
    }
  }
  function americanEagleStyleColor(value) {
    const url = americanEagleUrl(value);
    return url?.pathname.match(/^\/us\/en\/p\/(?:[a-z0-9-]+\/)*(\d{4}_\d{4}_\d{3})\/?$/)?.[1] || "";
  }
  function americanEagleUrlSku(value) {
    const url = americanEagleUrl(value);
    const sku = url?.searchParams.get("sku") || "";
    return americanEagleStyleColor(value) && url?.searchParams.getAll("sku").length === 1 && CHILD_SKU4.test(sku) ? sku : "";
  }
  function americanEaglePageKind(value) {
    const url = americanEagleUrl(value);
    if (!url) return "other";
    if (/^\/us\/en\/(?:login|account|signin)(?:\/|$)/.test(url.pathname)) return "auth";
    if (/^\/us\/en\/cart\/?$/.test(url.pathname)) return "cart";
    if (/^\/us\/en\/checkout(?:\/|$)/.test(url.pathname)) return "checkout";
    return americanEagleStyleColor(value) ? "product" : "other";
  }
  function americanEagleSecurityChallenge(document, environment) {
    return /(?:verify|confirm) (?:that )?you are (?:a )?human|access denied|you have been blocked|security check|captcha challenge/i.test(text2(document.body, environment)) || elements(document, "iframe[src*='captcha'], iframe[src*='challenge']", environment).length > 0;
  }
  function americanEagleInteractiveBlock(document, url, environment) {
    if (americanEaglePageKind(url) === "auth") return "auth";
    if (americanEagleSecurityChallenge(document, environment)) return "unknown";
    if (/you(?:'|’)re in line|waiting room|please wait in (?:the )?queue/i.test(text2(document.body, environment))) return "queue";
    if (elements(document, "dialog[open], [aria-modal='true'], input[type='password']", environment).length) return "unknown";
    return "";
  }
  function americanEagleOfferBinding(document, urlValue, expectedSku, environment) {
    const url = americanEagleUrl(urlValue);
    const styleColor = americanEagleStyleColor(urlValue);
    if (!url || !styleColor || document.URL !== urlValue || americanEagleInteractiveBlock(document, urlValue, environment)) return null;
    const panels = elements(document, "[data-test-psp]", environment);
    if (panels.length !== 1) return null;
    const panel = panels[0];
    const root = panel.closest("[data-test-sticky-content]");
    if (!root || !renderedVisible(root, environment)) return null;
    const buttons = elements(panel, "button[data-test-btn='addToBag'][type='button']", environment);
    if (buttons.length !== 1) return null;
    const control = buttons[0];
    if (!/^Add to Bag(?: \(Before It's Gone\))?$/i.test(text2(control, environment)) || control.matches(":disabled") || control.closest("[aria-disabled='true']")) return null;
    const sizes = elements(panel, "[data-test-select-size]", environment);
    if (sizes.length !== 1 || sizes[0].getAttribute("data-test-sizes-count") !== "1") return null;
    const size = sizes[0];
    const selectedText = elements(size, "[data-test-dropdown-toggle][aria-label='Size'] [data-test-text]", environment);
    if (selectedText.length !== 1 || text2(selectedText[0], environment) !== "One Size") return null;
    const options = [...size.querySelectorAll("li[data-value]")];
    if (options.length !== 1 || !options[0].classList.contains("active") || options[0].textContent?.replace(/\s+/g, " ").trim() !== "One Size") return null;
    const retailerSku = options[0].getAttribute("data-value") || "";
    if (!CHILD_SKU4.test(retailerSku) || expectedSku !== void 0 && retailerSku !== expectedSku || url.searchParams.has("sku") && americanEagleUrlSku(urlValue) !== retailerSku) return null;
    const quantities = elements(panel, "[data-test-select-quantity] [data-testid='quantity-value']", environment);
    if (quantities.length !== 1 || text2(quantities[0], environment) !== "1") return null;
    if (elements(panel, "input:checked, [aria-checked='true'], [aria-pressed='true']", environment).length || /pre[ -]?order|subscription|pick ?up (?:at|in store)|ship to store/i.test(text2(panel, environment)) || elements(root, "[data-testid='modal-link-shipping-returns']", environment).length !== 1) return null;
    const prices = elements(root, "[data-test-product-sku-price]", environment);
    const names = elements(root, "h1[data-testid='product-name']", environment);
    if (prices.length !== 1 || names.length !== 1) return null;
    const unitPriceCents = cents(text2(prices[0], environment));
    if (unitPriceCents === null) return null;
    const products = [];
    for (const script of document.querySelectorAll("script[type='application/ld+json']")) {
      try {
        const value = JSON.parse(script.textContent || "null");
        for (const item of Array.isArray(value) ? value : [value]) if (item?.["@type"] === "Product") products.push(item);
      } catch {
      }
    }
    if (products.length !== 1) return null;
    const product = products[0];
    const offer = product.offers;
    if (product.sku !== styleColor || product.name !== text2(names[0], environment) || !offer || Array.isArray(offer) || offer.priceCurrency !== "USD" || !/\/InStock$/.test(String(offer.availability)) || americanEagleStyleColor(String(offer.url)) !== styleColor || cents(`$${offer.price}`) !== unitPriceCents || /\b(?:CAD|GBP|EUR|AUD)\b|CA\$|C\$|[£€]|sold (?:and shipped )?by/i.test(text2(root, environment))) return null;
    const fingerprint = JSON.stringify([
      styleColor,
      retailerSku,
      unitPriceCents,
      product.name,
      "One Size",
      text2(root.querySelector("[data-test-extras='colors']") || names[0], environment),
      control.getAttribute("name")
    ]);
    return { root, control, retailerSku, styleColor, unitPriceCents, fingerprint };
  }

  // packages/browser-adapters/packs/amazon.json
  var amazon_default = {
    packVersion: "amazon-pack-v2",
    retailerId: "amazon",
    fields: {
      addControl: { selectors: ["#add-to-cart-button", "input[name='submit.add-to-cart']", "button[name='submit.add-to-cart']"] },
      price: { selectors: ["#corePrice_feature_div .a-offscreen", "#priceblock_ourprice", "#priceblock_dealprice", ".a-price .a-offscreen", "meta[itemprop='price']"] },
      seller: { selectors: ["#merchant-info", "#sellerProfileTriggerId", "[data-feature-name='shipsFromSoldBy']", "#tabular-buybox"] },
      availability: { selectors: ["#availability", "[data-testid*='availability' i]", "[itemprop='availability']", "button[disabled]"] },
      fulfillmentRoot: { selectors: ["#buybox", "#desktop_buybox", "[data-feature-name='buybox']", "form"] },
      fulfillmentTile: { selectors: ["[aria-selected='true']", "[aria-checked='true']", "[data-selected='true']", "[data-state='selected']", "input:checked"] },
      quantity: { selectors: ["select#quantity", "select[name='quantity']", "input[name='quantity']", "input[name='items[0.base][quantity]']"] },
      primaryScope: { selectors: ["#qualifiedBuybox", "#desktop_qualifiedBuyBox", "[data-feature-name*='qualifiedBuyBox' i]", "#buybox", "#desktop_buybox", "[data-feature-name='buybox']"] },
      merchandisingScope: { selectors: ["[data-cel-widget*='recommend' i]", "[data-feature-name*='recommend' i]", "[aria-label*='sponsored' i]", "[class*='carousel' i]", "#similarities_feature_div", "#sp_detail"] },
      secondaryActionScope: { selectors: [] },
      structuredData: { selectors: [] },
      offerInput: { selectors: ["input[name='offerListingID']", "input[name='offerListingId']", "input[name='items[0.base][offerListingID]']", "input[name='items[0.base][offerListingId]']", "input[name='offeringID.1']", "input[name='ASIN']", "input[name='asin']", "input[name='items[0.base][asin]']"] }
    }
  };

  // packages/browser-adapters/packs/bestbuy.json
  var bestbuy_default = {
    packVersion: "bestbuy-pack-v2",
    retailerId: "bestbuy",
    fields: {
      addControl: { selectors: ["button.add-to-cart-button", "button[data-button-state='ADD_TO_CART']", "button[data-testid*='add-to-cart' i]", "button[data-test-id*='add-to-cart' i]", "button[data-automation-id*='add-to-cart' i]", "button[name*='add-to-cart' i]", "button[aria-label*='add to cart' i]", "input[type='submit'][value*='add to cart' i]", "button"] },
      price: { selectors: ["[data-testid='customer-price']", "[data-testid*='customer-price' i]", ".priceView-customer-price", ".priceView-hero-price", "meta[itemprop='price']", "[itemprop='price']"] },
      seller: { selectors: ["[data-testid='sold-by']", "[data-testid*='sold-by' i]", "[data-testid*='seller' i]", "[class*='seller' i]", "[data-track*='marketplace' i]"] },
      availability: { selectors: ["[data-testid*='availability' i]", "[data-testid*='out-of-stock' i]", "[aria-label*='out of stock' i]", "[itemprop='availability']", "button[disabled]"] },
      fulfillmentRoot: { selectors: [] },
      fulfillmentTile: { selectors: ["[aria-selected='true']", "[aria-checked='true']", "[data-selected='true']", "[data-state='selected']", "input:checked"] },
      quantity: { selectors: ["select[name*='quantity' i]", "select[aria-label*='quantity' i]", "input[name*='quantity' i]", "input[aria-label*='quantity' i]"] },
      primaryScope: { selectors: ["[data-testid*='buy-box' i]", "[data-testid*='fulfillment' i]", "[data-testid*='purchase' i]", "[class*='fulfillment-add-to-cart' i]", "[class*='buy-box' i]", "[class*='purchase' i]"] },
      merchandisingScope: { selectors: ["[data-testid^='carousel-']", "[data-testid*='recommend' i]", "[aria-label*='similar' i]", "[aria-label*='sponsored' i]", "[class*='carousel' i]", "[class*='related-products' i]", "[class*='recommend' i]"] },
      secondaryActionScope: { selectors: ["[data-testid*='sticky' i]", "[data-automation-id*='sticky' i]", "[class*='sticky' i]", "[class*='floating' i]", "[class*='mobile-drawer' i]"] },
      structuredData: { selectors: [] },
      offerInput: { selectors: ["[data-sku-id]", "[data-sku]", "[data-product-id]", "input[name*='sku' i]"] }
    }
  };

  // packages/browser-adapters/packs/retailers.json
  var retailers_default = {
    packVersion: "retailers-pack-v1",
    retailers: {
      disney: {
        addControl: [
          "button[data-testid*='add-to-cart' i]",
          "button[data-testid*='add-to-bag' i]",
          "button[name*='add-to-cart' i]",
          "button[aria-label*='add to bag' i]",
          "button[aria-label*='add to cart' i]",
          "button"
        ],
        price: [
          "meta[itemprop='price']",
          "meta[property='product:price:amount']",
          "[itemprop='price']",
          "[data-testid*='product-price' i]",
          "[class*='product-price' i]"
        ],
        seller: []
      },
      ravensburger: {
        addControl: [
          "button[data-testid*='add-to-cart' i]",
          "button[name*='add-to-cart' i]",
          "button[aria-label*='add to cart' i]",
          "button[class*='add-to-cart' i]",
          "button"
        ],
        price: [
          "meta[itemprop='price']",
          "meta[property='product:price:amount']",
          "[itemprop='price']",
          "[data-testid*='price' i]",
          "[class*='product-price' i]"
        ],
        seller: []
      },
      riot: {
        addControl: [
          "button[data-testid*='add-to-cart' i]",
          "button[name*='add-to-cart' i]",
          "button[aria-label*='add to cart' i]",
          "button[class*='add-to-cart' i]",
          "button"
        ],
        price: [
          "meta[itemprop='price']",
          "meta[property='product:price:amount']",
          "[itemprop='price']",
          "[data-testid*='price' i]",
          "[class*='product-price' i]"
        ],
        seller: []
      },
      booksamillion: {
        addControl: [
          "button[data-testid*='add-to-cart' i]",
          "button[name*='add-to-cart' i]",
          "button[aria-label*='add to cart' i]",
          "input[type='submit'][value*='add to cart' i]",
          "button"
        ],
        price: [
          "meta[itemprop='price']",
          "meta[property='product:price:amount']",
          "[itemprop='price']",
          "[data-testid*='price' i]",
          "[class*='our-price' i]",
          "[class*='sale-price' i]"
        ],
        seller: []
      },
      fanatics: {
        addControl: [
          "button[data-testid*='add-to-cart' i]",
          "button[name*='add-to-cart' i]",
          "button[aria-label*='add to cart' i]",
          "button[class*='add-to-cart' i]",
          "button"
        ],
        price: [
          "[data-talos='pdpProductPrice'] .money-value",
          "[data-trk-id='pdp-price'] .money-value",
          "meta[itemprop='price']",
          "meta[property='product:price:amount']",
          "[itemprop='price']",
          "[data-testid*='price' i]",
          "[class*='current-price' i]",
          "[class*='sale-price' i]"
        ],
        seller: [
          "[data-testid*='seller' i]",
          "[class*='seller' i]",
          "[class*='shipping' i]"
        ]
      },
      kohls: {
        addControl: [
          "button[data-testid*='add-to-cart' i]",
          "button[name*='add-to-cart' i]",
          "button[aria-label*='add to cart' i]",
          "button[class*='add-to-cart' i]",
          "button"
        ],
        price: [
          "meta[itemprop='price']",
          "meta[property='product:price:amount']",
          "[itemprop='price']",
          "[data-testid*='sale-price' i]",
          "[data-testid*='price' i]",
          "[class*='sale-price' i]"
        ],
        seller: [
          "[data-testid*='seller' i]",
          "[class*='seller' i]"
        ]
      },
      macys: {
        addControl: [
          "button[data-testid*='add-to-bag' i]",
          "button[name*='add-to-bag' i]",
          "button[aria-label*='add to bag' i]",
          "button[class*='add-to-bag' i]",
          "button"
        ],
        price: [
          "meta[itemprop='price']",
          "meta[property='product:price:amount']",
          "[itemprop='price']",
          "[data-testid*='sale-price' i]",
          "[data-testid*='price' i]",
          "[class*='sale-price' i]"
        ],
        seller: [
          "[data-testid*='seller' i]",
          "[class*='seller' i]",
          "[class*='marketplace' i]"
        ]
      },
      pbandai: {
        addControl: [
          "button[data-testid*='add-to-cart' i]",
          "button[data-automation-id*='add-to-cart' i]",
          "button[aria-label*='add to cart' i]",
          "button[class*='add-cart' i]",
          "button[class*='pre-order' i]",
          "a[class*='add-cart' i]",
          "a[class*='pre-order' i]",
          "button",
          "a[role='button']"
        ],
        price: [
          "meta[itemprop='price']",
          "meta[property='product:price:amount']",
          "[itemprop='price']",
          "[data-testid*='price' i]",
          "[class*='item-price' i]",
          "[class*='product-price' i]"
        ],
        seller: []
      },
      pokemoncenter: {
        addControl: [
          "button[data-testid*='add-to-cart' i]",
          "button[data-automation-id*='add-to-cart' i]",
          "button[name*='add-to-cart' i]",
          "button[aria-label*='add to cart' i]",
          "button[class*='add-to-cart' i]",
          "button"
        ],
        price: [
          "meta[itemprop='price']",
          "meta[property='product:price:amount']",
          "[itemprop='price']",
          "[data-testid*='price' i]",
          "[class*='product-price' i]",
          "[class*='sales-price' i]"
        ],
        seller: []
      },
      asus: {
        addControl: [
          ".product-info-main form#product_addtocart_form button#product-addtocart-button"
        ],
        price: [
          ".product-info-main [data-price-type='finalPrice'][data-price-amount]"
        ],
        seller: []
      },
      athleta: {
        addControl: [
          "#buy-box-wrapper-id button#pdp-atb-btn[type=button]"
        ],
        price: [
          "#buy-box-wrapper-id .fds__core-web-purchase-price"
        ],
        seller: []
      },
      americaneagle: {
        addControl: [
          "[data-test-psp] button[data-test-btn='addToBag']"
        ],
        price: [
          "[data-test-sticky-content] [data-test-product-sku-price]"
        ],
        seller: []
      },
      aninebing: {
        addControl: [
          "form[data-product-id] button[name='add']"
        ],
        price: [
          "form[data-product-id] .price--final .price__value"
        ],
        seller: []
      },
      audioadvice: {
        addControl: [
          "product-form .product-column-right button#add-to-cart[name=add]"
        ],
        price: [
          "product-form .product-column-right .price__default .price__current"
        ],
        seller: []
      },
      bananarepublic: {
        addControl: [
          "#buy-box-wrapper-id button#pdp-atb-btn[type=button]"
        ],
        price: [
          "#buy-box-wrapper-id .fds__core-web-purchase-price"
        ],
        seller: []
      },
      bananarepublicfactory: {
        addControl: [
          "#buy-box-wrapper-id button#pdp-atb-btn[type=button]"
        ],
        price: [
          "#buy-box-wrapper-id .fds__core-web-purchase-price"
        ],
        seller: []
      }
    }
  };

  // packages/browser-adapters/packs/target.json
  var target_default = {
    packVersion: "target-pack-v1",
    retailerId: "target",
    fields: {
      addControl: { selectors: ["button[id^='addToCartButtonOrTextIdFor']", "button[data-test='shipItButton']", "button[data-test='shippingButton']", "button[data-test='orderPickupButton']", "button[data-test*='addToCart' i]"] },
      price: { selectors: ["[data-test='product-price']", "[data-test*='current-price' i]", "meta[itemprop='price']", "[itemprop='price']", "[data-module-type='ProductDetailPrice']"] },
      seller: { selectors: ["[data-test*='sold-by' i]", "[data-test*='seller' i]", "[data-testid*='seller' i]"] },
      availability: { selectors: ["[data-test*='availability' i]", "[data-testid*='availability' i]", "[data-test*='out-of-stock' i]", "[data-testid*='out-of-stock' i]", "[itemprop='availability']", "button[disabled]"] },
      fulfillmentRoot: { selectors: ["[data-test='module-product-detail-fulfillment-v1'][aria-label='Fulfillment']", "[data-module-type='ProductDetailFulfillment'] [aria-label='Fulfillment']", "[aria-label='Fulfillment']"] },
      fulfillmentTile: { selectors: ["button[data-test='fulfillment-cell-pickup']", "button[data-test='fulfillment-cell-delivery']", "button[data-test='fulfillment-cell-shipping']", "button#PICKUP", "button#DELIVERY", "button#SHIPPING", "button[aria-label]"] },
      quantity: { selectors: ["select[name*='quantity' i]", "input[name*='quantity' i]", "[data-test*='quantity' i]"] },
      primaryScope: { selectors: ["[data-test*='buy-box' i]", "[data-test='product-detail']", "main"] },
      merchandisingScope: { selectors: ["[data-test*='recommend' i]", "[data-testid*='carousel' i]", "[aria-label*='similar items' i]", "[data-test*='productCard' i]", "[data-strategy-id]", "[data-module-type*='Recommended' i]"] },
      secondaryActionScope: { selectors: [] },
      structuredData: { selectors: [] },
      offerInput: { selectors: ["[data-tcin]", "button[id^='addToCartButtonOrTextIdFor']"] }
    }
  };

  // packages/browser-adapters/packs/walmart.json
  var walmart_default = {
    packVersion: "walmart-pack-v1",
    retailerId: "walmart",
    fields: {
      addControl: { selectors: ["button[data-automation-id='atc']", "button[data-testid='add-to-cart-button']", "button[aria-label*='add to cart' i]"] },
      price: { selectors: ["[data-automation-id='product-price']", "[data-testid='price-wrap']", "meta[itemprop='price']", "[itemprop='price']"] },
      seller: { selectors: ["[data-testid='seller-display-name']", "[data-automation-id='seller-name']", "[data-testid*='seller' i]"] },
      availability: { selectors: ["[data-testid*='availability' i]", "[data-automation-id*='availability' i]", "[data-testid*='fulfillment' i]", "[data-automation-id*='fulfillment' i]", "[data-testid*='out-of-stock' i]", "[data-automation-id*='out-of-stock' i]", "[aria-label*='out of stock' i]", "[itemprop='availability']", "button[disabled]"] },
      fulfillmentRoot: { selectors: [] },
      fulfillmentTile: { selectors: ["[aria-selected='true']", "[data-selected='true']", "input:checked"] },
      quantity: { selectors: ["select[name*='quantity' i]", "select[aria-label*='quantity' i]", "input[name*='quantity' i]", "input[aria-label*='quantity' i]"] },
      primaryScope: { selectors: ["[data-testid*='buy-box' i]", "[data-automation-id*='buy-box' i]", "[data-testid*='purchase' i]", "[data-automation-id*='purchase' i]", "[data-testid*='add-to-cart-section' i]"] },
      merchandisingScope: { selectors: ["[data-testid*='recommend' i]", "[data-automation-id*='recommend' i]", "[aria-label*='similar' i]", "[aria-label*='sponsored' i]", "[data-testid*='sponsored' i]", "[class*='carousel' i]", "[class*='related-products' i]"] },
      secondaryActionScope: { selectors: ["[data-testid*='sticky' i]", "[data-automation-id*='sticky' i]", "[class*='sticky' i]", "[class*='floating' i]", "[class*='mobile-drawer' i]"] },
      structuredData: { selectors: ["script#__NEXT_DATA__"] },
      offerInput: { selectors: ["[data-us-item-id]", "[data-item-id]", "[data-product-id]"] }
    }
  };

  // packages/browser-adapters/src/selector-packs.ts
  var SELECTOR_PACK_FIELDS = [
    "addControl",
    "price",
    "seller",
    "availability",
    "fulfillmentRoot",
    "fulfillmentTile",
    "quantity",
    "primaryScope",
    "merchandisingScope",
    "secondaryActionScope",
    "structuredData",
    "offerInput"
  ];
  function selectorList(value) {
    return Object.freeze(Array.isArray(value) ? value.map(String) : []);
  }
  function freezePack(value) {
    const fields = Object.fromEntries(SELECTOR_PACK_FIELDS.map((field) => [
      field,
      selectorList(value.fields[field]?.selectors)
    ]));
    return Object.freeze({
      packVersion: value.packVersion,
      retailerId: value.retailerId,
      fields: Object.freeze(fields)
    });
  }
  var ADD_SELECTOR_PACKS = Object.freeze({
    target: freezePack(target_default),
    walmart: freezePack(walmart_default),
    amazon: freezePack(amazon_default),
    bestbuy: freezePack(bestbuy_default)
  });
  var observeOnlyRetailers = Object.fromEntries(Object.entries(retailers_default.retailers).map(([retailerId, fields]) => [
    retailerId,
    Object.freeze({
      addControl: selectorList(fields.addControl),
      price: selectorList(fields.price),
      seller: selectorList(fields.seller)
    })
  ]));
  var OBSERVE_ONLY_SELECTOR_PACK = Object.freeze({
    packVersion: retailers_default.packVersion,
    retailers: Object.freeze(observeOnlyRetailers)
  });
  var OBSERVE_ONLY_FULFILLMENT_TILES = Object.freeze([
    "[aria-selected='true']",
    "[data-selected='true']",
    "input:checked"
  ]);
  var SELECTOR_PACK_VERSIONS = Object.freeze({
    target: ADD_SELECTOR_PACKS.target.packVersion,
    walmart: ADD_SELECTOR_PACKS.walmart.packVersion,
    amazon: ADD_SELECTOR_PACKS.amazon.packVersion,
    bestbuy: ADD_SELECTOR_PACKS.bestbuy.packVersion,
    disney: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
    ravensburger: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
    riot: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
    booksamillion: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
    fanatics: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
    kohls: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
    macys: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
    pbandai: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
    pokemoncenter: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
    asus: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
    audioadvice: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
    bananarepublic: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
    bananarepublicfactory: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
    athleta: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
    americaneagle: OBSERVE_ONLY_SELECTOR_PACK.packVersion,
    aninebing: OBSERVE_ONLY_SELECTOR_PACK.packVersion
  });
  function selectorsFor(retailerId, field) {
    if (retailerId in ADD_SELECTOR_PACKS) {
      return ADD_SELECTOR_PACKS[retailerId].fields[field];
    }
    if (field === "fulfillmentTile") return OBSERVE_ONLY_FULFILLMENT_TILES;
    if (field !== "addControl" && field !== "price" && field !== "seller") return Object.freeze([]);
    return OBSERVE_ONLY_SELECTOR_PACK.retailers[retailerId][field];
  }

  // packages/browser-adapters/src/bestbuy-identity.ts
  function bestBuyProductCode(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.port || !(url.hostname === "bestbuy.com" || url.hostname.endsWith(".bestbuy.com"))) return "";
      const code = url.pathname.match(/^\/product\/[^/]+\/([a-z0-9]{10})(?:\/sku\/\d{5,20})?\/?$/i)?.[1] || "";
      return /[a-z]/i.test(code) ? code.toUpperCase() : "";
    } catch {
      return "";
    }
  }
  function bestBuyPageSku(document, urlValue) {
    const code = bestBuyProductCode(urlValue);
    if (!code) return "";
    const skus = /* @__PURE__ */ new Set();
    const add = (value) => {
      const sku = String(value ?? "").trim();
      if (/^\d{5,20}$/.test(sku)) skus.add(sku);
    };
    const fromUrl = (value) => {
      try {
        const url = new URL(value, urlValue);
        if (bestBuyProductCode(url.href) !== code) return;
        add(url.pathname.match(/\/sku\/(\d{5,20})\/?$/i)?.[1]);
        for (const sku of url.searchParams.getAll("skuId")) add(sku);
      } catch {
      }
    };
    for (const element of document.querySelectorAll("link[rel='canonical'], meta[property='og:url']")) {
      fromUrl(element.getAttribute("href") || element.getAttribute("content") || "");
    }
    let visited = 0;
    const visit = (value, depth = 0) => {
      if (++visited > 2e3 || depth > 12 || !value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        for (const entry of value) visit(entry, depth + 1);
        return;
      }
      const item = value;
      const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
      if (types.includes("Product") && [item.url, item["@id"]].some((url) => typeof url === "string" && bestBuyProductCode(url) === code)) add(item.sku);
      if (item["@graph"]) visit(item["@graph"], depth + 1);
      if (item.mainEntity) visit(item.mainEntity, depth + 1);
    };
    for (const script of document.querySelectorAll("script[type='application/ld+json']")) {
      if ((script.textContent || "").length > 512e3) continue;
      try {
        visit(JSON.parse(script.textContent || ""));
      } catch {
      }
    }
    for (const element of document.querySelectorAll(
      ":is(main, [role='main'], #shop-main) :is([itemprop='sku'], .sku, .sku-value, .sku-label, [data-testid='sku'])"
    )) {
      if (element.closest(["aside", ...selectorsFor("bestbuy", "merchandisingScope")].join(", "))) continue;
      let hidden = false;
      for (let current = element; current; current = current.parentElement) {
        const style = document.defaultView?.getComputedStyle(current);
        if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden") === "true" || style?.display === "none" || style?.visibility === "hidden" || style?.opacity === "0") hidden = true;
      }
      if (hidden) continue;
      const text6 = String(element.textContent || "").trim();
      add(text6.match(/^(?:SKU\s*:?\s*)?(\d{5,20})\s*$/i)?.[1]);
    }
    return skus.size === 1 ? [...skus][0] : "";
  }

  // packages/browser-adapters/src/aninebing.ts
  var VARIANT2 = /^\d{10,20}$/;
  function text3(element, environment) {
    const parts = [];
    const visit = (node) => {
      if (node.nodeType === 3) parts.push(node.textContent || "");
      else if (node.nodeType === 1 && !["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"].includes(node.tagName) && renderedVisible(node, environment)) for (const child of node.childNodes) visit(child);
    };
    visit(element);
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }
  function anineBingUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.port && ["aninebing.com", "www.aninebing.com"].includes(url.hostname) ? url : null;
    } catch {
      return null;
    }
  }
  function anineBingPageKind(value) {
    const url = anineBingUrl(value);
    if (!url) return "other";
    if (/^\/account(?:\/|$)/.test(url.pathname)) return "auth";
    if (/^\/cart\/?$/.test(url.pathname)) return "cart";
    if (/^\/checkouts?(?:\/|$)/.test(url.pathname)) return "checkout";
    return /^\/products\/[a-z0-9][a-z0-9-]*\/?$/.test(url.pathname) ? "product" : "other";
  }
  function anineBingSecurityChallenge(document, environment) {
    return /(?:verify|confirm) (?:that )?you are (?:a )?human|access denied|you have been blocked|security check|captcha challenge/i.test(text3(document.body, environment)) || [...document.querySelectorAll("iframe[src*='captcha'], iframe[src*='challenge']")].some((e) => renderedVisible(e, environment));
  }
  function anineBingInteractiveBlock(document, url, environment) {
    if (anineBingPageKind(url) === "auth") return "auth";
    if (anineBingSecurityChallenge(document, environment)) return "unknown";
    if (/you(?:'|’)re in line|waiting room|please wait in (?:the )?queue/i.test(text3(document.body, environment))) return "queue";
    if ([...document.querySelectorAll("dialog[open], [aria-modal='true'], input[type='password']")].some((e) => renderedVisible(e, environment))) return "unknown";
    return "";
  }
  function anineBingOfferBinding(document, urlValue, variantId, environment) {
    const url = anineBingUrl(urlValue);
    if (!url || document.URL !== urlValue || anineBingPageKind(urlValue) !== "product" || !VARIANT2.test(variantId) || url.searchParams.has("variant") && url.searchParams.get("variant") !== variantId || anineBingInteractiveBlock(document, urlValue, environment)) return null;
    const forms = [...document.querySelectorAll("form[action='/cart/add'][data-product-id]")].filter((form) => renderedVisible(form, environment));
    if (forms.length !== 1) return null;
    const root = forms[0];
    if (root.getAttribute("method")?.toLowerCase() !== "post") return null;
    const controls = [...root.querySelectorAll("button[name='add'][type='submit']")].filter((button) => renderedVisible(button, environment) && /^add to cart$/i.test(text3(button, environment)));
    if (controls.length !== 1) return null;
    const control = controls[0];
    if (control.matches(":disabled") || control.closest("[aria-disabled='true']")) return null;
    const ids = [...root.querySelectorAll("input[name='id']")];
    const quantities = [...root.querySelectorAll("input[name='quantity']")];
    if (ids.length !== 1 || ids[0].disabled || ids[0].value !== variantId || quantities.length !== 1 || quantities[0].disabled || quantities[0].value !== "1") return null;
    for (const attr of ["min", "max"]) {
      const value = quantities[0].getAttribute(attr);
      if (value !== null && (!/^\d+$/.test(value) || (attr === "min" ? Number(value) > 1 : Number(value) < 1))) return null;
    }
    if ([...root.querySelectorAll("[name='selling_plan'], [name='properties[Pre Order]']")].some((input) => !input.disabled && input.value !== "" && input.value !== "false")) return null;
    const selections = [...root.querySelectorAll("label[data-variant-id].is-selected")].filter((e) => renderedVisible(e, environment));
    if (selections.length !== 1) return null;
    const selected = selections[0];
    const productId = root.getAttribute("data-product-id");
    const handle = url.pathname.split("/")[2];
    if (!productId || selected.getAttribute("data-product-handle") !== handle || [selected, control].some((e) => e.getAttribute("data-variant-id") !== variantId || e.getAttribute("data-product-id") !== productId) || selected.getAttribute("data-preorder") !== "false" || selected.getAttribute("data-appexclusive") !== "false" || !/^\d+$/.test(selected.getAttribute("data-variant-qty") || "") || Number(selected.getAttribute("data-variant-qty")) < 1 || !/^\d+$/.test(selected.getAttribute("data-qty-limit") || "") || Number(selected.getAttribute("data-qty-limit")) < 1) return null;
    const priceNodes = [...root.querySelectorAll(".price--final .price__value")].filter((e) => renderedVisible(e, environment));
    if (priceNodes.length !== 1) return null;
    const match = text3(priceNodes[0], environment).match(/^\$(\d[\d,]*)(?:\.(\d{2}))?$/);
    if (!match) return null;
    const unitPriceCents = Number(match[1].replace(/,/g, "")) * 100 + Number(match[2] || "0");
    if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents <= 0 || Number(selected.getAttribute("data-price")) !== unitPriceCents || Math.round(Number(control.getAttribute("data-price")) * 100) !== unitPriceCents) return null;
    const products = [];
    for (const script of document.querySelectorAll("script[type='application/ld+json']")) {
      try {
        const value = JSON.parse(script.textContent || "null");
        for (const item of Array.isArray(value) ? value : [value]) if (item?.["@type"] === "Product") products.push(item);
      } catch {
      }
    }
    const matches = products.filter((p) => anineBingUrl(String(p.url))?.pathname === url.pathname);
    if (matches.length !== 1 || !Array.isArray(matches[0].offers)) return null;
    const offers = matches[0].offers.filter((o) => {
      const offerUrl = anineBingUrl(String(o.url));
      return offerUrl?.pathname === url.pathname && offerUrl.searchParams.get("variant") === variantId;
    });
    const offer = offers[0];
    if (offers.length !== 1 || !offer || offer.priceCurrency !== "USD" || !/\/InStock$/.test(String(offer.availability)) || Math.round(Number(offer.price) * 100) !== unitPriceCents || offer.sku !== control.getAttribute("data-sku") || offer.sku !== selected.getAttribute("data-current-sku")) return null;
    const pageText = text3(document.body, environment);
    if (!/free standard shipping (?:to the united states )?on all orders/i.test(pageText) || /\b(?:CAD|GBP|EUR|AUD)\b|CA\$|C\$|[£€]/.test(text3(root, environment))) return null;
    const fingerprint = JSON.stringify([
      productId,
      handle,
      variantId,
      offer.sku,
      unitPriceCents,
      selected.getAttribute("data-current-variant-option"),
      [...root.querySelectorAll("input")].filter((input) => !input.disabled).map((input) => [input.name, input.type, input.value, input.checked])
    ]);
    return { root, control, variantId, unitPriceCents, fingerprint };
  }

  // packages/browser-adapters/src/retailers.ts
  var activeAdapterEnvironment;
  function withAdapterEnvironment(environment, work) {
    const previous = activeAdapterEnvironment;
    activeAdapterEnvironment = environment;
    try {
      return work();
    } finally {
      activeAdapterEnvironment = previous;
    }
  }
  function recordTrace(entry) {
    activeAdapterEnvironment?.trace?.record(entry);
  }
  function selectorTrace(step, root, selector, options = {}) {
    if (!activeAdapterEnvironment?.trace) return;
    let matches = [];
    try {
      matches = [...root.querySelectorAll(selector)];
    } catch {
      recordTrace({ step, selector, matched: 0, visible: 0, scoped: 0, reject: "pattern_mismatch", ...options });
      return;
    }
    const visibleMatches = matches.filter(visible);
    recordTrace({
      step,
      selector,
      matched: matches.length,
      visible: visibleMatches.length,
      scoped: root.nodeType === 9 ? 0 : visibleMatches.length,
      ...matches.length > 0 && visibleMatches.length === 0 ? { reject: "not_visible" } : {},
      ...options
    });
  }
  function selectorListTrace(step, root, selectors) {
    for (const selector of selectors) selectorTrace(step, root, selector);
  }
  function fanaticsProductId(url) {
    return url.pathname.replace(/%2B/gi, "+").match(/(?:^|\+)p-(\d{6,20})(?:\+|$)/i)?.[1] || "";
  }
  var CONFIGS = {
    asus: {
      retailerId: "asus",
      domains: ["eshop.asus.com"],
      skuPattern: /^[A-Z0-9]{8}-[A-Z0-9]{6}$/,
      skuFromUrl: (url) => asusUrlSku(url.href),
      addSelectors: selectorsFor("asus", "addControl"),
      priceSelectors: selectorsFor("asus", "price"),
      sellerSelectors: selectorsFor("asus", "seller"),
      firstPartyPattern: /asus/i,
      marketplacePattern: /sold by (?!asus)/i,
      shippingPattern: /shipping/i,
      pickupPattern: /pickup/i,
      defaultShipping: true,
      implicitFirstParty: true,
      firstPartyName: "ASUS"
    },
    audioadvice: {
      retailerId: "audioadvice",
      domains: ["www.audioadvice.com"],
      skuPattern: /^\d{10,20}$/,
      skuFromUrl: (url) => audioAdviceUrlSku(url.href),
      addSelectors: selectorsFor("audioadvice", "addControl"),
      priceSelectors: selectorsFor("audioadvice", "price"),
      sellerSelectors: selectorsFor("audioadvice", "seller"),
      firstPartyPattern: /audio advice/i,
      marketplacePattern: /sold by (?!audio advice)/i,
      shippingPattern: /shipping/i,
      pickupPattern: /pickup/i,
      defaultShipping: true,
      implicitFirstParty: true,
      firstPartyName: "Audio Advice"
    },
    bananarepublic: {
      retailerId: "bananarepublic",
      domains: ["bananarepublic.gap.com"],
      skuPattern: /^\d{9}0000$/,
      skuFromUrl: (url) => bananarepublicUrlSku(url.href),
      addSelectors: selectorsFor("bananarepublic", "addControl"),
      priceSelectors: selectorsFor("bananarepublic", "price"),
      sellerSelectors: selectorsFor("bananarepublic", "seller"),
      firstPartyPattern: /banana republic/i,
      marketplacePattern: /sold by (?!banana republic)/i,
      shippingPattern: /shipping/i,
      pickupPattern: /pickup/i,
      defaultShipping: true,
      implicitFirstParty: true,
      firstPartyName: "Banana Republic"
    },
    bananarepublicfactory: {
      retailerId: "bananarepublicfactory",
      domains: ["bananarepublicfactory.gapfactory.com"],
      skuPattern: /^\d{10}0000$/,
      skuFromUrl: (url) => bananarepublicfactoryUrlSku(url.href),
      addSelectors: selectorsFor("bananarepublicfactory", "addControl"),
      priceSelectors: selectorsFor("bananarepublicfactory", "price"),
      sellerSelectors: selectorsFor("bananarepublicfactory", "seller"),
      firstPartyPattern: /banana republic factory/i,
      marketplacePattern: /sold by (?!banana republic factory)/i,
      shippingPattern: /shipping/i,
      pickupPattern: /pickup/i,
      defaultShipping: true,
      implicitFirstParty: true,
      firstPartyName: "Banana Republic Factory"
    },
    athleta: {
      retailerId: "athleta",
      domains: ["athleta.gap.com"],
      skuPattern: /^\d{9}0000$/,
      skuFromUrl: (url) => athletaUrlSku(url.href),
      addSelectors: selectorsFor("athleta", "addControl"),
      priceSelectors: selectorsFor("athleta", "price"),
      sellerSelectors: selectorsFor("athleta", "seller"),
      firstPartyPattern: /athleta/i,
      marketplacePattern: /sold by (?!athleta)/i,
      shippingPattern: /shipping/i,
      pickupPattern: /pickup/i,
      defaultShipping: true,
      implicitFirstParty: true,
      firstPartyName: "Athleta"
    },
    americaneagle: {
      retailerId: "americaneagle",
      domains: ["ae.com"],
      skuPattern: /^\d{10}$/,
      skuFromUrl: (url) => americanEagleUrlSku(url.href),
      addSelectors: selectorsFor("americaneagle", "addControl"),
      priceSelectors: selectorsFor("americaneagle", "price"),
      sellerSelectors: selectorsFor("americaneagle", "seller"),
      firstPartyPattern: /american eagle/i,
      marketplacePattern: /sold by (?!american eagle)/i,
      shippingPattern: /shipping/i,
      pickupPattern: /pickup/i,
      defaultShipping: true,
      implicitFirstParty: true,
      firstPartyName: "American Eagle"
    },
    aninebing: {
      retailerId: "aninebing",
      domains: ["aninebing.com"],
      skuPattern: /^\d{10,20}$/,
      skuFromUrl: (url) => /^\/products\/[a-z0-9-]+\/?$/.test(url.pathname) ? url.searchParams.get("variant") || "" : "",
      addSelectors: selectorsFor("aninebing", "addControl"),
      priceSelectors: selectorsFor("aninebing", "price"),
      sellerSelectors: selectorsFor("aninebing", "seller"),
      firstPartyPattern: /anine bing/i,
      marketplacePattern: /sold by (?!anine bing)/i,
      shippingPattern: /shipping/i,
      pickupPattern: /pickup/i,
      defaultShipping: true,
      implicitFirstParty: true,
      firstPartyName: "ANINE BING"
    },
    walmart: {
      retailerId: "walmart",
      domains: ["walmart.com"],
      skuPattern: /^\d{5,20}$/,
      skuFromUrl: (url) => url.pathname.match(/\/ip\/(?:[^/?#]+\/)?(\d{5,20})(?:\/|$)/i)?.[1] || url.searchParams.get("items")?.match(/^\d{5,20}$/)?.[0] || "",
      addSelectors: selectorsFor("walmart", "addControl"),
      priceSelectors: selectorsFor("walmart", "price"),
      sellerSelectors: selectorsFor("walmart", "seller"),
      firstPartyPattern: /sold\s+(?:and|&)\s+shipped\s+by\s+walmart(?:\.com)?|sold\s+by\s+walmart(?:\.com)?(?:\s+(?:and|&)\s+(?:shipped|fulfilled)\s+by\s+walmart(?:\.com)?)?/i,
      marketplacePattern: /sold\s+(?:and|&)\s+shipped\s+by\s+(?!walmart\b)|sold\s+by\s+(?!walmart\b)|marketplace\s+seller/i,
      shippingPattern: /shipping|ship to|delivery/i,
      pickupPattern: /pickup|pick-up/i,
      defaultShipping: false,
      implicitFirstParty: false,
      firstPartyName: "Walmart"
    },
    amazon: {
      retailerId: "amazon",
      domains: ["amazon.com"],
      skuPattern: /^[A-Z0-9]{10}$/,
      skuFromUrl: (url) => (url.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1] || url.searchParams.get("asin")?.match(/^[A-Z0-9]{10}$/i)?.[0] || "").toUpperCase(),
      addSelectors: selectorsFor("amazon", "addControl"),
      priceSelectors: selectorsFor("amazon", "price"),
      sellerSelectors: selectorsFor("amazon", "seller"),
      // "Ships from and sold by Amazon.com." is the classic one-line form. The
      // name must end at "Amazon" or "Amazon.com": "Amazon Resale" is not it.
      firstPartyPattern: /ships\s+from\s+and\s+sold\s+by\s+amazon(?:\.com)?(?!\.?[\w-]|\s+(?:resale|warehouse|export|renewed)\b)|ships\s+from\s+amazon(?:\.com)?(?!\.?[\w-]|\s+(?:resale|warehouse|export|renewed)\b)[\s\S]{0,160}sold\s+by\s+amazon(?:\.com)?(?!\.?[\w-]|\s+(?:resale|warehouse|export|renewed)\b)|sold\s+by\s+amazon(?:\.com)?(?!\.?[\w-]|\s+(?:resale|warehouse|export|renewed)\b)[\s\S]{0,160}ships\s+from\s+amazon(?:\.com)?(?!\.?[\w-]|\s+(?:resale|warehouse|export|renewed)\b)/i,
      marketplacePattern: /sold\s+by\s+(?!amazon(?:\.com)?\b)|seller:\s*(?!amazon(?:\.com)?\b)/i,
      shippingPattern: /shipping|delivery|ships from/i,
      pickupPattern: /pickup|pick-up/i,
      defaultShipping: false,
      implicitFirstParty: false,
      firstPartyName: "Amazon.com"
    },
    bestbuy: {
      retailerId: "bestbuy",
      domains: ["bestbuy.com"],
      skuPattern: /^\d{5,20}$/,
      skuFromUrl: (url) => url.pathname.match(/^\/product\/[^/]+\/(?:[^/]+\/sku\/)?(\d{5,20})(?:\/|$)/i)?.[1] || url.pathname.match(/^\/site\/[^/]+\/(\d{5,20})\.p(?:\/|$)/i)?.[1] || url.searchParams.get("skuId")?.match(/^\d{5,20}$/)?.[0] || "",
      addSelectors: selectorsFor("bestbuy", "addControl"),
      addIntentPattern: /\b(?:add(?:\s+(?:item\s+)?to)?\s+(?:cart|bag)|pre[ -]?order(?:\s+now|\s+(?:item\s+)?to\s+(?:cart|bag))?|atc)\b/i,
      priceSelectors: selectorsFor("bestbuy", "price"),
      sellerSelectors: selectorsFor("bestbuy", "seller"),
      firstPartyPattern: /sold\s+(?:and|&)\s+shipped\s+by\s+best\s*buy|sold\s+by\s+best\s*buy/i,
      marketplacePattern: /sold\s+(?:and|&)\s+shipped\s+by\s+(?!best\s*buy\b)|sold\s+by\s+(?!best\s*buy\b)|marketplace\s+seller/i,
      shippingPattern: /shipping|ship to|delivery/i,
      pickupPattern: /pickup|pick-up|get it today/i,
      defaultShipping: false,
      implicitFirstParty: false,
      firstPartyName: "Best Buy"
    },
    disney: {
      retailerId: "disney",
      domains: ["disneystore.com"],
      skuPattern: /^\d{10,20}$/,
      skuFromUrl: (url) => url.pathname.match(/-(\d{10,20})\.html(?:\/|$)/i)?.[1] || "",
      addSelectors: selectorsFor("disney", "addControl"),
      priceSelectors: selectorsFor("disney", "price"),
      sellerSelectors: selectorsFor("disney", "seller"),
      firstPartyPattern: /sold\s+by\s+disney\s*store/i,
      marketplacePattern: /sold\s+by\s+(?!disney\s*store\b)/i,
      shippingPattern: /shipping|ship to|delivery/i,
      pickupPattern: /pickup|pick-up/i,
      defaultShipping: true,
      implicitFirstParty: true,
      firstPartyName: "Disney Store"
    },
    ravensburger: {
      retailerId: "ravensburger",
      domains: ["ravensburger.us"],
      skuPattern: /^\d{5,20}$/,
      skuFromUrl: (url) => /^\/en-US\/products\//i.test(url.pathname) ? url.pathname.match(/-(\d{5,20})(?:\/|$)/i)?.[1] || "" : "",
      addSelectors: selectorsFor("ravensburger", "addControl"),
      priceSelectors: selectorsFor("ravensburger", "price"),
      sellerSelectors: selectorsFor("ravensburger", "seller"),
      firstPartyPattern: /sold\s+by\s+ravensburger/i,
      marketplacePattern: /sold\s+by\s+(?!ravensburger\b)/i,
      shippingPattern: /shipping|ship to|delivery/i,
      pickupPattern: /pickup|pick-up/i,
      defaultShipping: true,
      implicitFirstParty: true,
      firstPartyName: "Ravensburger"
    },
    riot: {
      retailerId: "riot",
      domains: ["merch.riotgames.com"],
      skuPattern: /^[A-Z0-9](?:[A-Z0-9-]{1,118}[A-Z0-9])?$/,
      skuFromUrl: (url) => url.pathname.match(/^\/en-us\/product\/([a-z0-9](?:[a-z0-9-]{1,118}[a-z0-9])?)\/?$/i)?.[1] || "",
      addSelectors: selectorsFor("riot", "addControl"),
      priceSelectors: selectorsFor("riot", "price"),
      sellerSelectors: selectorsFor("riot", "seller"),
      firstPartyPattern: /sold\s+by\s+riot\s+games/i,
      marketplacePattern: /sold\s+by\s+(?!riot\s+games\b)/i,
      shippingPattern: /shipping|ships|delivery|fulfillment/i,
      pickupPattern: /pickup|pick-up/i,
      defaultShipping: true,
      implicitFirstParty: true,
      firstPartyName: "Riot Games Merch"
    },
    booksamillion: {
      retailerId: "booksamillion",
      domains: ["booksamillion.com"],
      skuPattern: /^[A-Z0-9]{10,20}$/,
      skuFromUrl: (url) => url.pathname.match(/^\/p\/-\/([a-z0-9]{10,20})(?:\/|$)/i)?.[1] || url.pathname.match(/^\/p\/([a-z0-9]{10,20})(?:\/|$)/i)?.[1] || "",
      addSelectors: selectorsFor("booksamillion", "addControl"),
      priceSelectors: selectorsFor("booksamillion", "price"),
      sellerSelectors: selectorsFor("booksamillion", "seller"),
      firstPartyPattern: /sold\s+by\s+(?:bam!?|books-a-million|books\s+a\s+million)/i,
      marketplacePattern: /sold\s+by\s+(?!(?:bam!?|books-a-million|books\s+a\s+million)\b)/i,
      shippingPattern: /shipping|ship to|delivery/i,
      pickupPattern: /pickup|pick-up|pick up in store/i,
      defaultShipping: false,
      implicitFirstParty: true,
      firstPartyName: "Books-A-Million"
    },
    fanatics: {
      retailerId: "fanatics",
      domains: ["fanatics.com"],
      skuPattern: /^\d{6,20}$/,
      skuFromUrl: fanaticsProductId,
      addSelectors: selectorsFor("fanatics", "addControl"),
      priceSelectors: selectorsFor("fanatics", "price"),
      sellerSelectors: selectorsFor("fanatics", "seller"),
      firstPartyPattern: /sold\s+by\s+fanatics|ships?\s+(?:from|by)\s+fanatics/i,
      marketplacePattern: /ships?\s+directly\s+from\s+a\s+trusted\s+partner|sold\s+by\s+(?!fanatics\b)/i,
      shippingPattern: /shipping|ships|delivery/i,
      pickupPattern: /pickup|pick-up/i,
      defaultShipping: true,
      implicitFirstParty: false,
      firstPartyName: "Fanatics"
    },
    kohls: {
      retailerId: "kohls",
      domains: ["kohls.com"],
      skuPattern: /^\d{5,12}$/,
      skuFromUrl: (url) => url.pathname.match(/^\/product\/prd-(\d{5,12})\//i)?.[1] || "",
      addSelectors: selectorsFor("kohls", "addControl"),
      priceSelectors: selectorsFor("kohls", "price"),
      sellerSelectors: selectorsFor("kohls", "seller"),
      firstPartyPattern: /sold\s+by\s+kohl'?s|ships?\s+(?:from|by)\s+kohl'?s/i,
      marketplacePattern: /sold\s+by\s+(?!kohl'?s\b)|marketplace\s+seller/i,
      shippingPattern: /ship to me|shipping|delivery/i,
      pickupPattern: /free store pickup|pickup|pick-up/i,
      defaultShipping: false,
      implicitFirstParty: false,
      firstPartyName: "Kohl's"
    },
    macys: {
      retailerId: "macys",
      domains: ["macys.com"],
      skuPattern: /^\d{5,20}$/,
      skuFromUrl: (url) => /^\/shop\/product\//i.test(url.pathname) ? url.searchParams.get("ID")?.match(/^\d{5,20}$/)?.[0] || url.searchParams.get("id")?.match(/^\d{5,20}$/)?.[0] || "" : "",
      addSelectors: selectorsFor("macys", "addControl"),
      priceSelectors: selectorsFor("macys", "price"),
      sellerSelectors: selectorsFor("macys", "seller"),
      firstPartyPattern: /(?:shipped\s+and\s+)?sold\s+by\s+macy'?s/i,
      marketplacePattern: /(?:shipped\s+and\s+)?sold\s+by\s+(?!macy'?s\b)/i,
      shippingPattern: /shipping|ship to|delivery/i,
      pickupPattern: /pickup|pick-up/i,
      defaultShipping: false,
      implicitFirstParty: false,
      firstPartyName: "Macy's"
    },
    pbandai: {
      retailerId: "pbandai",
      domains: ["p-bandai.com"],
      skuPattern: /^[A-Z]\d{10}$/,
      skuFromUrl: (url) => url.pathname.match(/^\/us\/item\/([a-z]\d{10})(?:\/|$)/i)?.[1] || "",
      addSelectors: selectorsFor("pbandai", "addControl"),
      addIntentPattern: /\b(?:add(?:\s+(?:item\s+)?to)?\s+(?:cart|bag)|pre[ -]?order(?:\s+now|\s+(?:item\s+)?to\s+(?:cart|bag))?|atc)\b/i,
      priceSelectors: selectorsFor("pbandai", "price"),
      sellerSelectors: selectorsFor("pbandai", "seller"),
      firstPartyPattern: /sold\s+by\s+premium\s+bandai/i,
      marketplacePattern: /sold\s+by\s+(?!premium\s+bandai\b)/i,
      shippingPattern: /shipping|ships|delivery/i,
      pickupPattern: /pickup|pick-up/i,
      defaultShipping: true,
      implicitFirstParty: true,
      firstPartyName: "Premium Bandai"
    },
    pokemoncenter: {
      retailerId: "pokemoncenter",
      domains: ["pokemoncenter.com"],
      skuPattern: /^\d{2,3}-\d{5}(?:-\d{3})?$/,
      skuFromUrl: (url) => url.pathname.match(/^\/product\/(\d{2,3}-\d{5}(?:-\d{3})?)(?:\/|$)/i)?.[1] || "",
      addSelectors: selectorsFor("pokemoncenter", "addControl"),
      priceSelectors: selectorsFor("pokemoncenter", "price"),
      sellerSelectors: selectorsFor("pokemoncenter", "seller"),
      firstPartyPattern: /sold\s+by\s+pok[eé]mon\s+center/i,
      marketplacePattern: /sold\s+by\s+(?!pok[eé]mon\s+center\b)/i,
      shippingPattern: /shipping|ships|delivery/i,
      pickupPattern: /pickup|pick-up/i,
      defaultShipping: true,
      implicitFirstParty: true,
      firstPartyName: "Pok\xE9mon Center"
    }
  };
  function text4(value, maximum = 2e3) {
    return String(value?.textContent || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
  }
  function observableText(value, maximum = 2e3, renderedOnly = false) {
    if (!value || maximum < 1) return "";
    const fragments = [];
    let length = 0;
    const append = (candidate) => {
      if (length >= maximum) return;
      const fragment = String(candidate || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
      if (!fragment) return;
      const bounded = fragment.slice(0, maximum - length);
      fragments.push(bounded);
      length += bounded.length + 1;
    };
    const visit = (node) => {
      if (length >= maximum) return;
      if (node.nodeType === 3) {
        append(node.textContent);
        return;
      }
      if (node.nodeType === 1) {
        const element = node;
        if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(element.tagName) || element.classList.contains("aok-hidden") || !(renderedOnly ? renderedVisible2(element) : visible(element))) return;
      }
      for (const child of [...node.childNodes]) visit(child);
    };
    visit(value);
    return fragments.join(" ").replace(/\s+/g, " ").trim().slice(0, maximum);
  }
  function visible(element) {
    if (!element) return false;
    if (activeAdapterEnvironment?.isVisible) {
      try {
        return activeAdapterEnvironment.isVisible(element);
      } catch {
        return false;
      }
    }
    let current = element;
    while (current) {
      if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden") === "true") return false;
      const inlineStyle = current.getAttribute("style");
      const style = inlineStyle ? inlineStyle.replace(/\s+/g, "").toLocaleLowerCase("en-US") : "";
      if (/(?:^|;)display:none(?:;|$)|(?:^|;)visibility:hidden(?:;|$)/.test(style)) return false;
      current = current.parentElement;
    }
    return true;
  }
  function renderedVisible2(element) {
    if (!visible(element)) return false;
    if (activeAdapterEnvironment?.isVisible) return true;
    const view = element.ownerDocument.defaultView;
    if (!view?.getComputedStyle) return true;
    let current = element;
    while (current) {
      const computed = view.getComputedStyle(current);
      if (computed.display === "none" || computed.visibility === "hidden" || computed.visibility === "collapse" || computed.opacity === "0") return false;
      current = current.parentElement;
    }
    return true;
  }
  function actionable(element) {
    return visible(element) && !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true" && !/sold out|out of stock|unavailable|currently unavailable|pre[ -]?order closed|order(?:ing)? period (?:has )?ended|sales? ended/i.test(text4(element, 300));
  }
  function queryVisible(root, selectors) {
    for (const selector of selectors) {
      const found = [...root.querySelectorAll(selector)].find(visible);
      if (found) return found;
    }
    return null;
  }
  function queryRendered(root, selectors) {
    for (const selector of selectors) {
      const found = [...root.querySelectorAll(selector)].find(renderedVisible2);
      if (found) return found;
    }
    return null;
  }
  function parseUsPrice(value) {
    const source = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!source || /(?:C|CA|MX|SG|HK|AU|A|R)\s*\$/i.test(source)) return null;
    const match = source.match(/(?:US\s*)?\$\s*([0-9]{1,7}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/i) ?? (/^[0-9]{1,7}(?:\.[0-9]{1,2})?$/.test(source) ? [source, source] : null);
    if (!match?.[1]) return null;
    const dollars = Number(match[1].replaceAll(",", ""));
    return Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : null;
  }
  function explicitFraction(value) {
    const source = String(value ?? "").replace(/\s+/g, " ").trim();
    return /(?:^|\$\s*)[0-9]{1,7}(?:,[0-9]{3})*\.[0-9]{1,2}(?:\D|$)/.test(source);
  }
  function priceFragments(element) {
    const fragments = [];
    const visit = (node) => {
      if (node.nodeType === 3) {
        const fragment = String(node.textContent || "").replace(/\s+/g, " ").trim();
        if (fragment) fragments.push(fragment);
        return;
      }
      if (node.nodeType !== 1) return;
      if (node !== element && nonCurrentPriceMarker(node)) return;
      for (const child of [...node.childNodes]) visit(child);
    };
    visit(element);
    return fragments;
  }
  function splitDollarPrice(element) {
    const segmented = priceFragments(element).join("");
    const match = segmented.match(/(?:US\s*)?\$\s*(?:\u001f\s*)?([0-9]{1,7}(?:,[0-9]{3})*)\s*\u001f\s*([0-9]{2})(?!\d)/i);
    if (!match?.[1] || !match[2]) return null;
    const dollars = Number(match[1].replaceAll(",", ""));
    const cents2 = Number(match[2]);
    return Number.isSafeInteger(dollars) && dollars >= 0 && Number.isSafeInteger(cents2) ? dollars * 100 + cents2 : null;
  }
  var STRUCK_PRICE_SELECTOR = "del, s, strike, [data-a-strike='true'], .a-text-price:not(.apexPriceToPay):not(.priceToPay)";
  var NON_CURRENT_PRICE_WORDS = /* @__PURE__ */ new Set([
    "was",
    "strike",
    "strikethrough",
    "struck",
    "strikeout",
    "through",
    "linethrough",
    "compare",
    "save",
    "savings",
    "msrp",
    "original",
    "regular",
    "unit",
    "per"
  ]);
  var NON_CURRENT_PRICE_TEXT = /\b(?:was|save|savings|reg\.?|regular|list(?:\s+price)?|compare\s+(?:at|value)|comp\.?\s*value|msrp|typical)\b|\$\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?\s*off\b|\/\s*(?:oz|fl\s*oz|ounce|ct|count|lb|pound|each|ea|item|unit|kg|g|ml|l)\b|\bper\s+(?:oz|ounce|count|ct|lb|pound|item|unit|each)\b/i;
  function markerWords(value) {
    return String(value || "").replace(/([a-z])([A-Z])/g, "$1 $2").split(/[\s_-]+/).map((word) => word.toLocaleLowerCase("en-US")).filter(Boolean);
  }
  function nonCurrentPriceMarker(node) {
    if (node.matches(STRUCK_PRICE_SELECTOR)) return true;
    return [node.getAttribute("class"), node.getAttribute("data-testid"), node.getAttribute("data-test"), node.getAttribute("data-automation-id")].some((value) => markerWords(value).some((word) => NON_CURRENT_PRICE_WORDS.has(word)));
  }
  function excludedPriceNode(node, root) {
    for (let current = node; current && current !== root; current = current.parentElement) {
      if (nonCurrentPriceMarker(current)) return true;
    }
    return false;
  }
  var STRUCTURED_CURRENT_PRICE_SELECTOR = [
    "[itemprop='price']",
    ".apexPriceToPay",
    ".priceToPay",
    "[data-testid*='current-price' i]",
    "[data-test*='current-price' i]",
    "[data-testid='customer-price']",
    "[data-automation-id='product-price']",
    "[data-test='product-price']"
  ].join(", ");
  function structuredCurrentPrice(element) {
    const values = /* @__PURE__ */ new Set();
    for (const node of element.querySelectorAll(STRUCTURED_CURRENT_PRICE_SELECTOR)) {
      if (excludedPriceNode(node, element)) continue;
      const content = node.getAttribute("content");
      const parsed = content?.trim() ? parseUsPrice(content) : parseRetailerPriceElement(node);
      if (parsed !== null) values.add(parsed);
    }
    return values.size === 1 ? [...values][0] ?? null : null;
  }
  function parseRetailerPriceElement(element) {
    if (element.closest(STRUCK_PRICE_SELECTOR)) return null;
    if (markerWords(`${element.getAttribute("class") || ""} ${element.getAttribute("data-testid") || ""} ${element.getAttribute("data-test") || ""}`).some((word) => word !== "unit" && word !== "per" && NON_CURRENT_PRICE_WORDS.has(word))) return null;
    const nodes = [element, ...[...element.querySelectorAll("*")].filter((node) => !excludedPriceNode(node, element))];
    const semanticCandidates = nodes.flatMap((node) => [
      node.getAttribute("content"),
      node.getAttribute("value"),
      node.getAttribute("aria-label"),
      node.getAttribute("data-price"),
      node.getAttribute("data-value")
    ]).filter((candidate) => Boolean(candidate?.trim()) && !NON_CURRENT_PRICE_TEXT.test(String(candidate)));
    const leafCandidates = nodes.filter((node) => node.childElementCount === 0).filter((node) => {
      const parent = node.parentElement;
      const parentText = parent && parent !== element && element.contains(parent) ? text4(parent, 200) : "";
      const context = parentText.length <= 40 ? parentText : "";
      return !NON_CURRENT_PRICE_TEXT.test(text4(node, 300)) && !NON_CURRENT_PRICE_TEXT.test(context);
    }).map((node) => text4(node, 300)).filter(Boolean);
    const ownTextCandidates = nodes.filter((node) => node.childElementCount > 0).map((node) => [...node.childNodes].filter((child) => child.nodeType === 3).map((child) => String(child.textContent || "")).join(" ").replace(/\s+/g, " ").trim()).filter((candidate) => candidate && !NON_CURRENT_PRICE_TEXT.test(candidate));
    const explicit = /* @__PURE__ */ new Set();
    for (const candidate of [...semanticCandidates, ...leafCandidates, ...ownTextCandidates]) {
      if (!explicitFraction(candidate)) continue;
      const parsed = parseUsPrice(candidate);
      if (parsed !== null) explicit.add(parsed);
    }
    if (explicit.size > 1) return structuredCurrentPrice(element);
    if (explicit.size === 1) return [...explicit][0] ?? null;
    const split = splitDollarPrice(element);
    if (split !== null) return split;
    for (const candidate of semanticCandidates) {
      const parsed = parseUsPrice(candidate);
      if (parsed !== null) return parsed;
    }
    if (element.childElementCount === 0) return parseUsPrice(text4(element, 300));
    return null;
  }
  function config(retailerId) {
    return retailerId === "target" ? null : CONFIGS[retailerId];
  }
  function hostAllowed(url, domains) {
    return url.protocol === "https:" && !url.username && !url.password && domains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  }
  function extractRetailerSku(retailerId, urlValue, document) {
    try {
      const retailer = config(retailerId);
      const url = new URL(urlValue);
      if (!retailer || !hostAllowed(url, retailer.domains)) return "";
      const formVariant = (retailerId === "aninebing" || retailerId === "audioadvice") && document ? [...document.querySelectorAll("form[action='/cart/add'] input[name='id']")].map((input) => input.value).find((value) => (retailerId === "audioadvice" ? audioAdviceOfferBinding : anineBingOfferBinding)(document, urlValue, value, activeAdapterEnvironment)) || "" : "";
      const americanEagleSku = retailerId === "americaneagle" && document ? americanEagleOfferBinding(document, urlValue, void 0, activeAdapterEnvironment)?.retailerSku || "" : "";
      const sku = (americanEagleSku || retailer.skuFromUrl(url) || formVariant || (retailerId === "bestbuy" && document ? bestBuyPageSku(document, urlValue) : "")).toUpperCase();
      return retailer.skuPattern.test(sku) ? sku : "";
    } catch {
      return "";
    }
  }
  function retailerSecurityChallenge(document, retailerId) {
    const title = String(document.title || "").replace(/\s+/g, " ").trim();
    if (/^(?:access denied(?:\s*-\s*.*)?|just a moment(?:\.\.\.)?)$/i.test(title)) return true;
    const queryChallenge = retailerId === "bestbuy" ? queryRendered : queryVisible;
    const challengeText = observableText(
      document.body,
      8e4,
      retailerId === "bestbuy"
    );
    return Boolean(queryChallenge(document, [
      "iframe[src*='captcha' i]",
      "iframe[src*='_Incapsula_Resource' i]",
      "[data-testid*='captcha' i]",
      "[id*='captcha' i]",
      "[class*='captcha' i]",
      "#challenge-running",
      "#challenge-stage",
      "[class*='cf-chl-' i]"
    ])) || /verify you are human|robot or human|activate and hold the button|unusual traffic|security challenge|additional security check is required|protected and accelerated by imperva|enter the characters you see|checking your browser|performing security verification|enable javascript and cookies to continue|sorry, you have been blocked/i.test(challengeText);
  }
  function retailerUnavailableShell(document) {
    const title = String(document.title || "").replace(/\s+/g, " ").trim();
    if (/^page not available(?:\s*[|｜-].*)?$/i.test(title)) return true;
    return /\bpage you have attempted to access can not be displayed\b|\bpage (?:is|was) temporarily unavailable\b/i.test(text4(document.body, 2e4));
  }
  function bestBuyReservationPanel(document, sku) {
    if (!/^\d{5,20}$/.test(sku)) return null;
    const headers = [...document.querySelectorAll(`[data-testid='pdp-high-velocity-sku-header-${sku}']`)].filter((element) => renderedVisible2(element) && !element.closest(BESTBUY_MERCHANDISING_SCOPE));
    if (headers.length !== 1 || !/\bhigh[ -]demand product\b/i.test(observableText(headers[0], 200))) return null;
    const panel = headers[0]?.closest("[data-component-name='FulfillmentSelector']");
    if (!panel || !renderedVisible2(panel)) return null;
    const message = queryRendered(panel, [`[data-testid='pdp-high-velocity-sku-messaging-${sku}']`]);
    return message && /\breservation process\b/i.test(observableText(message, 1e3)) ? panel : null;
  }
  function bestBuyReservationFlow(document, urlValue) {
    const sku = extractRetailerSku("bestbuy", urlValue, document);
    const panel = bestBuyReservationPanel(document, sku);
    const availability = panel && queryRendered(panel, [
      `[data-testid='pdp-high-velocity-sku-shipping-available-${sku}']`,
      `[data-testid='pdp-high-velocity-sku-pickup-available-${sku}']`
    ]);
    const required = Boolean(availability);
    recordTrace({
      step: "interactive_block",
      condition: "bestbuy.reservationFlow",
      expected: "exact visible reservation panel",
      actual: required ? "present" : "absent",
      passed: required
    });
    return required;
  }
  var BESTBUY_RESERVATION_PARTS = /* @__PURE__ */ new Set(["header", "messaging", "learn-more-link", "pickup-unavailable", "shipping-available"]);
  var BESTBUY_RESERVATION_STOP = /\b(?:temporarily unavailable|unavailable|not available|not eligible|sold out|out of stock|in line|queue|waiting room|please wait|try again|account (?:is )?required)\b/i;
  function bestBuyReservationShipping(document, sku, environment) {
    if (environment) return withAdapterEnvironment(environment, () => bestBuyReservationShipping(document, sku));
    const panel = bestBuyReservationPanel(document, sku);
    if (!panel) return null;
    const parts = [...panel.querySelectorAll("[data-testid^='pdp-high-velocity-sku-']")].filter(renderedVisible2);
    for (const part of parts) {
      const match = /^pdp-high-velocity-sku-([a-z-]+)-(\d{5,20})$/.exec(part.getAttribute("data-testid") || "");
      if (!match || match[2] !== sku || !BESTBUY_RESERVATION_PARTS.has(match[1] || "")) return null;
    }
    const tiles = parts.filter((part) => part.getAttribute("data-testid") === `pdp-high-velocity-sku-shipping-available-${sku}`);
    const tile = tiles[0];
    if (tiles.length !== 1 || !tile || !/\bship/i.test(observableText(tile, 300))) return null;
    let words = observableText(panel, 3e4, true);
    for (const part of parts) {
      if (part.getAttribute("data-testid") === `pdp-high-velocity-sku-pickup-unavailable-${sku}`) {
        words = words.replace(observableText(part, 1e3, true), " ");
      }
    }
    if (BESTBUY_RESERVATION_STOP.test(words)) return null;
    if (queryRendered(document, ["[role='dialog']", "[role='alertdialog']", "dialog[open]", "[aria-modal='true']"])) return null;
    const controls = [...document.querySelectorAll(`[data-testid='pdp-add-to-cart-${sku}']`)].filter((element) => renderedVisible2(element) && !element.closest(BESTBUY_MERCHANDISING_SCOPE));
    const control = controls[0];
    if (controls.length !== 1 || !control || control.tagName !== "BUTTON" || !actionable(control) || !/\badd to cart\b/i.test(observableText(control, 200))) return null;
    recordTrace({
      step: "fulfillment",
      condition: "bestbuy.reservationShipping",
      expected: "Shipping available in the exact reservation panel",
      actual: "present",
      passed: true
    });
    return { panel, tile, control };
  }
  function retailerInteractiveBlock(document, urlValue, environment) {
    if (environment) return withAdapterEnvironment(environment, () => retailerInteractiveBlock(document, urlValue));
    selectorListTrace("interactive_block", document, [
      "input[autocomplete='one-time-code']",
      "input[name*='otp' i]",
      "form[action*='login' i] input[type='password']",
      "input[autocomplete='current-password']",
      "[role='dialog']",
      "dialog[open]",
      "[data-testid*='high-demand-gate' i]",
      "[data-testid*='demand-gate' i]",
      "[data-automation-id*='high-demand-gate' i]",
      "[class*='high-demand-gate' i]",
      "[data-testid^='pdp-high-velocity-sku-header-']",
      "[data-component-name='FulfillmentSelector']"
    ]);
    const bestBuyPage = (() => {
      try {
        const url = new URL(urlValue);
        return hostAllowed(url, CONFIGS.bestbuy.domains);
      } catch {
        return false;
      }
    })();
    const queryBlock = bestBuyPage ? queryRendered : queryVisible;
    const page = observableText(document.body, 1e5, bestBuyPage);
    if (retailerUnavailableShell(document)) return "unknown";
    if (queryBlock(document, ["input[autocomplete='one-time-code']", "input[name*='otp' i]"])) return "mfa";
    if (queryBlock(document, ["form[action*='login' i] input[type='password']", "input[autocomplete='current-password']"])) return "auth";
    if (bestBuyPage && /\baccount required\b/i.test(page) && /\ban account is required to (?:purchase|buy|reserve) this item\b/i.test(page)) return "auth";
    const dialog = queryBlock(document, ["[role='dialog']", "dialog[open]"]);
    const dialogText = text4(dialog, 12e3);
    if (dialog && /choose|select|set/i.test(dialogText) && /store|location|zip code/i.test(dialogText)) return "location";
    if (bestBuyPage && /\b(?:available\s+)?in[ -]store only\b/i.test(page) && genericAddIntentControls(document).length === 0) return "location";
    const membershipEvidence = dialogText || page;
    if (/membership (?:is )?(?:required|needed)|invitation[- ]only|invite required|(?:prime|walmart\+) members? only|requires? (?:a )?(?:prime|walmart\+) membership/i.test(membershipEvidence) || dialog && /\bjoin (?:walmart\+|prime)\b/i.test(dialogText) || /\bjoin (?:walmart\+|prime)\b.{0,80}\b(?:to|in order to)\b.{0,80}\b(?:add|buy|purchase|continue)\b/i.test(page)) return "membership";
    if (/you(?:’|')?re in line|virtual queue|waiting room|place in line/i.test(page) || (() => {
      try {
        return new URL(urlValue).pathname === "/qp";
      } catch {
        return false;
      }
    })()) return "queue";
    if (bestBuyPage && bestBuyReservationFlow(document, urlValue) && !bestBuyReservationShipping(document, extractRetailerSku("bestbuy", urlValue, document))) return "high_demand";
    const bestBuyDemandGate = bestBuyPage ? queryRendered(document, [
      "[role='dialog']",
      "dialog[open]",
      "[data-testid*='high-demand-gate' i]",
      "[data-testid*='demand-gate' i]",
      "[data-automation-id*='high-demand-gate' i]",
      "[class*='high-demand-gate' i]"
    ]) : null;
    const bestBuyDemandGateText = observableText(bestBuyDemandGate, 12e3);
    if (bestBuyDemandGate && /\b(?:high[ -]demand product|this item is (?:currently )?in high demand|due to high demand)\b/i.test(bestBuyDemandGateText) && (bestBuyDemandGate.matches("[role='dialog'], dialog[open]") || /\b(?:continue|verify|access|try again|temporarily unavailable|reserve)\b/i.test(bestBuyDemandGateText))) {
      return "high_demand";
    }
    if (retailerSecurityChallenge(document, bestBuyPage ? "bestbuy" : void 0)) return "unknown";
    return "";
  }
  var GENERIC_ADD_CONTROL_INTENT = /\b(?:add|pre[ -]?order)(?:\s+(?:item\s+)?to)?\s+(?:cart|bag)\b|\bpre[ -]?order(?:\s+now)?\b|\batc\b/i;
  var MERCHANDISING_CONTROL_SCOPE = [
    "nav",
    "header",
    "footer",
    "[data-testid*='recommend' i]",
    "[data-automation-id*='recommend' i]",
    "[data-feature-name*='recommend' i]",
    "[data-feature-name*='bundle' i]",
    "[aria-label*='similar' i]",
    "[aria-label*='sponsored' i]",
    "[aria-label*='add all' i]",
    "[class*='carousel' i]",
    "[class*='related-products' i]"
  ].join(", ");
  function controlIntent(element) {
    const raw = [
      element.getAttribute("aria-label"),
      element.getAttribute("name"),
      element.getAttribute("id"),
      element.getAttribute("data-testid"),
      element.getAttribute("data-test-id"),
      element.getAttribute("data-automation-id"),
      element.getAttribute("data-button-state"),
      element.getAttribute("value"),
      text4(element, 300)
    ].filter(Boolean).join(" ");
    return `${raw} ${raw.replace(/[-_.:]+/g, " ")}`;
  }
  function merchandisingControl(element) {
    return Boolean(element.closest(MERCHANDISING_CONTROL_SCOPE));
  }
  function genericAddIntentControls(root) {
    return [...root.querySelectorAll("button, input[type='submit'], input[type='button'], [role='button']")].filter((element) => visible(element) && GENERIC_ADD_CONTROL_INTENT.test(controlIntent(element)) && !merchandisingControl(element));
  }
  var REPAIR_LANDMARK_ATTRIBUTES = [
    "data-testid",
    "data-test-id",
    "data-automation-id",
    "data-button-state",
    "name",
    "itemprop"
  ];
  var REPAIR_STRUCTURAL_SELECTOR = REPAIR_LANDMARK_ATTRIBUTES.map((attribute) => `[${attribute}]`).join(", ");
  var WALMART_PRIMARY_SCOPE = selectorsFor("walmart", "primaryScope").join(", ");
  var WALMART_MERCHANDISING_SCOPE = selectorsFor("walmart", "merchandisingScope").join(", ");
  var WALMART_SECONDARY_ACTION_SCOPE = selectorsFor("walmart", "secondaryActionScope").join(", ");
  var AMAZON_MERCHANDISING_SCOPE = selectorsFor("amazon", "merchandisingScope").join(", ");
  var BESTBUY_PRIMARY_SCOPE = selectorsFor("bestbuy", "primaryScope").join(", ");
  var BESTBUY_MERCHANDISING_SCOPE = selectorsFor("bestbuy", "merchandisingScope").join(", ");
  var AMAZON_OFFER_INPUT_SELECTORS = selectorsFor("amazon", "offerInput");
  var AMAZON_CANONICAL_OFFER_INPUT_SELECTOR = AMAZON_OFFER_INPUT_SELECTORS.slice(0, 4).join(", ");
  var AMAZON_ALTERNATE_OFFER_INPUT_SELECTOR = AMAZON_OFFER_INPUT_SELECTORS[4] ?? "input:not(*)";
  var AMAZON_EXPLICIT_ASIN_SELECTOR = AMAZON_OFFER_INPUT_SELECTORS.slice(5).join(", ");
  var AMAZON_INACTIVE_ROW = "[data-a-accordion-row-name]:not(.a-accordion-active)";
  var AMAZON_INACTIVE_ACCORDION = `${AMAZON_INACTIVE_ROW} .a-accordion-inner`;
  var AMAZON_UNSHOWN = `.a-popover-preload, .a-popover-content, .aok-hidden, .a-hidden, [hidden], template, ${AMAZON_INACTIVE_ACCORDION}`;
  var BESTBUY_SECONDARY_ACTION_SCOPE = selectorsFor("bestbuy", "secondaryActionScope").join(", ");

  // packages/browser-adapters/src/pokemoncenter.ts
  var SKU = /^\d{2,3}-\d{5}(?:-\d{3})?$/;
  var PRODUCT_ROOT = "[data-testid='product-detail'], [data-testid='product-details'], .product-detail, .product-details, [itemtype$='/Product'], main";
  var QUANTITY = "input[name*='quantity' i], select[name*='quantity' i], input[aria-label*='quantity' i], select[aria-label*='quantity' i], input[type='number'], [role='spinbutton']";
  var PRICE = "[data-testid='product-price'], [data-testid='unit-price'], [itemprop='price']:not(meta), .product-price, .sales-price";
  var MERCHANDISING = "aside, [data-testid*='recommend' i], [class*='recommend' i], [data-testid*='saved' i], [class*='saved-for-later' i]";
  function elements2(root, selector, environment) {
    return [...root.querySelectorAll(selector)].filter((el) => renderedVisible(el, environment));
  }
  function text5(root, environment) {
    const parts = [];
    const visit = (node) => {
      if (node.nodeType === 3) parts.push(node.textContent || "");
      else if (node.nodeType === 1 && !["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"].includes(node.tagName) && renderedVisible(node, environment)) for (const child of node.childNodes) visit(child);
    };
    visit(root);
    return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 4e4);
  }
  function allowedUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.port && ["www.pokemoncenter.com", "pokemoncenter.com"].includes(url.hostname) ? url : null;
    } catch {
      return null;
    }
  }
  function pokemonCenterPageKind(value) {
    const url = allowedUrl(value);
    if (!url) return "other";
    if (/^\/(?:login|signin|sign-in|account)(?:\/|$)/i.test(url.pathname)) return "auth";
    if (/^\/(?:queue|waiting-room)(?:\/|$)/i.test(url.pathname)) return "queue";
    if (/^\/cart\/?$/.test(url.pathname)) return "cart";
    if (/^\/(?:checkout|payment|order)(?:\/|$)/i.test(url.pathname)) return "checkout";
    return extractRetailerSku("pokemoncenter", value) ? "product" : "other";
  }
  function pokemonCenterInteractiveBlock(document, url, environment) {
    if (retailerSecurityChallenge(document, "pokemoncenter")) return "unknown";
    const kind = pokemonCenterPageKind(url);
    if (kind === "auth" || kind === "queue") return kind;
    const generic = retailerInteractiveBlock(document, url, environment);
    if (generic) return generic;
    if (elements2(document, "dialog[open], [role='dialog'][aria-modal='true']", environment).length) return "unknown";
    return "";
  }
  function exactSku(root, links, environment) {
    const candidates = [];
    const nodes = [root, ...elements2(root, "[data-sku], [data-product-id], [itemprop='sku']", environment)];
    for (const node of nodes) {
      for (const name of ["data-sku", "data-product-id"]) {
        const value = node.getAttribute(name);
        if (value) candidates.push(value.trim());
      }
      if (node.getAttribute("itemprop") === "sku") candidates.push(node.getAttribute("content") || text5(node, environment));
    }
    for (const match of text5(root, environment).matchAll(/\b(?:SKU|Item\s+(?:Number|No\.?|#))\s*:?\s*(\d[\d-]+)/gi)) candidates.push(match[1]);
    if (links) for (const link of elements2(root, "a[href*='/product/']", environment)) {
      const href = new URL(link.getAttribute("href"), "https://www.pokemoncenter.com").href;
      candidates.push(allowedUrl(href) ? extractRetailerSku("pokemoncenter", href) : "");
    }
    const unique = [...new Set(candidates)];
    return unique.length === 1 && SKU.test(unique[0]) ? unique[0] : "";
  }
  function quantity(root, environment) {
    const controls = elements2(root, QUANTITY, environment);
    if (controls.length !== 1) return null;
    const control = controls[0];
    const value = control.getAttribute("role") === "spinbutton" ? control.getAttribute("aria-valuenow") : control.value;
    if (!/^\d{1,2}$/.test(value || "")) return null;
    const count = Number(value);
    for (const [attribute, lower] of [["min", true], ["max", false], ["aria-valuemin", true], ["aria-valuemax", false]]) {
      const bound = control.getAttribute(attribute);
      if (bound !== null && (!/^\d{1,2}$/.test(bound) || (lower ? count < Number(bound) : count > Number(bound)))) return null;
    }
    return count >= 1 && count <= 99 ? count : null;
  }
  function price(root, environment) {
    const nodes = elements2(root, PRICE, environment).filter((node) => !node.closest("del, s"));
    const values = nodes.map((node) => /(?:\$|USD)/.test(text5(node, environment)) ? parseRetailerPriceElement(node) : null);
    return values.length > 0 && values.every((value) => value !== null && value === values[0]) ? values[0] : null;
  }
  function usd(root, environment) {
    const currencies = [...root.querySelectorAll("[itemprop='priceCurrency'], [data-currency]")].map((node) => node.getAttribute("content") || node.getAttribute("data-currency") || text5(node, environment));
    return currencies.every((value) => value.trim() === "USD") && !/\b(?:CAD|GBP|EUR|AUD)\b|CA\$|C\$|[£€]/.test(text5(root, environment));
  }
  function firstParty(root, environment) {
    const value = text5(root, environment);
    return !/\b(?:sold|fulfilled|shipped)\s+(?:and\s+shipped\s+)?by\s+(?!pok[eé]mon\s+center\b)/i.test(value) && !/\b(?:marketplace|third[ -]party seller)\b/i.test(value);
  }
  function pokemonCenterOfferBinding(document, url, sku, environment) {
    if (document.URL !== url || pokemonCenterPageKind(url) !== "product" || extractRetailerSku("pokemoncenter", url) !== sku || pokemonCenterInteractiveBlock(document, url, environment)) return null;
    const controls = elements2(document, "button, input[type='submit'], [role='button']", environment).filter((node) => !node.closest(MERCHANDISING) && /^add\s+to\s+(?:cart|bag)$/i.test((node.tagName === "INPUT" ? node.value : text5(node, environment)).trim()));
    if (controls.length !== 1) return null;
    const control = controls[0];
    if (control.matches(":disabled") || control.closest("[aria-disabled='true']")) return null;
    let root = control.closest(PRODUCT_ROOT);
    while (root && !exactSku(root, false, environment)) root = root.parentElement?.closest(PRODUCT_ROOT) || null;
    if (!root || exactSku(root, false, environment) !== sku || quantity(root, environment) !== 1) return null;
    const unitPriceCents = price(root, environment);
    const content = text5(root, environment);
    if (!unitPriceCents || !usd(root, environment) || !usd(document.documentElement, environment) || !firstParty(root, environment) || /sold out|out of stock|unavailable|pre[ -]?order|subscription|subscribe|pickup|pick-up/i.test(content) || !/\b(?:shipping|ships|delivery)\b/i.test(content) || /(?:shipping|delivery)\s+(?:is\s+)?(?:not available|unavailable)|cannot (?:be )?ship/i.test(content)) return null;
    const variants = elements2(root, "select, input[type='radio']", environment).filter((node) => !node.matches(QUANTITY));
    if (variants.some((node) => node.tagName === "SELECT" && (!node.value || node.selectedOptions[0]?.disabled))) return null;
    const radios = variants.filter((node) => node.tagName === "INPUT");
    if ([...new Set(radios.map((node) => node.name))].some((name) => !name || radios.filter((node) => node.name === name && node.checked).length !== 1)) return null;
    const fingerprint = JSON.stringify([sku, unitPriceCents, 1, variants.map((node) => [
      node.name,
      node.value,
      node.checked ?? null
    ])]);
    return { control, root, unitPriceCents, fingerprint };
  }
  function observePokemonCenterOffer(document, url, sku, fulfillment, observedAt = (/* @__PURE__ */ new Date()).toISOString(), environment) {
    const binding = fulfillment === "shipping" ? pokemonCenterOfferBinding(document, url, sku, environment) : null;
    return {
      contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
      observedAt,
      url,
      pageKind: pokemonCenterPageKind(url),
      retailerId: "pokemoncenter",
      retailerSku: extractRetailerSku("pokemoncenter", url),
      availability: binding ? "in_stock" : "unknown",
      unitPriceCents: binding?.unitPriceCents ?? null,
      currency: "USD",
      sellerName: binding ? "Pok\xE9mon Center" : "",
      sellerType: binding ? "first_party" : "unknown",
      fulfillment: binding ? "shipping" : "unknown",
      addControlActionable: Boolean(binding),
      securityChallenge: retailerSecurityChallenge(document, "pokemoncenter"),
      interactiveBlock: pokemonCenterInteractiveBlock(document, url, environment)
    };
  }
  function observePokemonCenterCart(document, observedAt = (/* @__PURE__ */ new Date()).toISOString(), environment) {
    const roots = elements2(document, "[data-testid='cart-items'], [data-testid='shopping-cart'], .shopping-cart, main", environment);
    const scoped = roots.filter((candidate) => !roots.some((other) => other !== candidate && candidate.contains(other)));
    const root = scoped.length === 1 ? scoped[0] : null;
    const empty = { contractVersion: 1, observedAt, complete: false, independentlyCounted: false, independentLineCount: 0, lines: [] };
    if (!root || !usd(root, environment)) return empty;
    const candidates = elements2(root, "[data-testid='cart-item'], [data-testid^='cart-item-'], .cart-item, [data-cart-item]", environment).filter((node) => !node.closest(MERCHANDISING));
    const rows = candidates.filter((node) => !candidates.some((parent) => parent !== node && parent.contains(node)));
    const lines = rows.map((row) => ({
      retailerSku: exactSku(row, true, environment),
      quantity: quantity(row, environment),
      unitPriceCents: price(row, environment),
      sellerName: firstParty(row, environment) ? "Pok\xE9mon Center" : "",
      sellerType: firstParty(row, environment) ? "first_party" : "unknown"
    }));
    const counters = elements2(document, "[data-cart-quantity], [data-testid='cart-count'], [data-testid='cart-item-count']", environment);
    const counts = counters.map((node) => {
      const raw = node.getAttribute("data-cart-quantity") ?? text5(node, environment);
      const match = raw.match(/^\s*(?:(?:shopping )?(?:cart|bag)\s*\(?\s*)?(\d{1,3})(?:\s*items?)?\)?\s*$/i);
      return match ? Number(match[1]) : null;
    });
    const total = lines.reduce((sum, line) => sum + (line.quantity || 0), 0);
    const independentlyCounted = counts.length > 0 && counts.every((count) => count === total);
    const unboundLinks = elements2(root, "a[href*='/product/']", environment).some((link) => !link.closest(MERCHANDISING) && !rows.some((row) => row.contains(link)));
    const complete = independentlyCounted && !unboundLinks && lines.length <= 25 && lines.every((line) => line.retailerSku && line.quantity !== null && line.unitPriceCents !== null && line.sellerType === "first_party") && (rows.length > 0 || /(?:your (?:shopping )?)?(?:cart|bag) is empty|no items in (?:your )?(?:cart|bag)/i.test(text5(root, environment)));
    return { contractVersion: 1, observedAt, complete, independentlyCounted, independentLineCount: rows.length, lines };
  }

  // apps/extension/src/pokemoncenter-action.ts
  var AUTHORIZATION_MAX_AGE_MS = 1e4;
  var sequence = 0;
  var pending = null;
  function traceElement(environment, condition, element) {
    if (!environment?.trace) return;
    const attributes = ["id", "name", "type", "role", "data-test", "data-testid", "data-test-id", "data-automation-id", "aria-label"].map((name) => element?.hasAttribute(name) ? `${name}=${JSON.stringify(String(element.getAttribute(name)).slice(0, 80))}` : "").filter(Boolean).join(" ");
    const content = String(element?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
    environment.trace.record({ step: "add_control", condition, actual: element ? `${element.tagName.toLowerCase()} ${attributes} ${content}`.trim() : "missing" });
  }
  function pokemonCenterJobReason(job) {
    if (job?.adapterVersion !== POKEMONCENTER_ADD_ADAPTER_VERSION) return "adapter_version_mismatch";
    if (job?.retailerId !== "pokemoncenter" || job?.action !== "add_to_cart") return "unsupported_action";
    if (job?.quantity !== 1) return "quantity_not_supported";
    if (job?.sellerPolicy !== "first_party_only") return "seller_policy_not_supported";
    if (job?.fulfillment !== "shipping") return "fulfillment_not_supported";
    if (pokemonCenterPageKind(job.canonicalUrl) !== "product" || extractRetailerSku("pokemoncenter", job.canonicalUrl) !== job.retailerSku) return "listing_mismatch";
    if (job.currency !== "USD") return "currency_mismatch";
    if (job.expectedSeller && job.expectedSeller !== "Pok\xE9mon Center") return "seller_unverified";
    return "";
  }
  function authorizationId(now) {
    sequence += 1;
    return `pokemoncenter_add_${now.toString(36)}_${sequence.toString(36)}`;
  }
  function abandonPokemonCenterAdd(value) {
    if (!pending || pending.id !== value) return false;
    pending = null;
    return true;
  }
  function preparePokemonCenterAdd(documentValue, urlValue, job, now = Date.now(), environment) {
    pending = null;
    const invalid = pokemonCenterJobReason(job);
    if (invalid) return { ok: false, reason: invalid };
    if (extractRetailerSku("pokemoncenter", urlValue) !== job.retailerSku) return { ok: false, reason: "listing_mismatch" };
    const observation = observePokemonCenterOffer(
      documentValue,
      urlValue,
      job.retailerSku,
      job.fulfillment,
      new Date(now).toISOString(),
      environment
    );
    const verified = verifyLiveOffer(job, observation, now);
    if (!verified.ok) return { ok: false, reason: verified.reason === "out_of_stock" && observation.availability === "unknown" ? "add_control_unavailable" : verified.reason };
    const binding = pokemonCenterOfferBinding(documentValue, urlValue, job.retailerSku, environment);
    const control = binding?.control;
    if (!control || !binding) return { ok: false, reason: "add_control_unavailable" };
    const id = authorizationId(now);
    pending = {
      id,
      jobId: job.jobId,
      createdAt: now,
      control,
      proof: verified.proof,
      document: documentValue,
      root: binding.root,
      fingerprint: binding.fingerprint,
      jobSnapshot: JSON.stringify(job)
    };
    return { ok: true, reason: "verified", authorizationId: id, proof: verified.proof };
  }
  function rehearsePokemonCenterAdd(documentValue, urlValue, job, now = Date.now(), environment) {
    const prepared = preparePokemonCenterAdd(documentValue, urlValue, job, now, environment);
    if (!prepared.ok) return prepared;
    abandonPokemonCenterAdd(prepared.authorizationId);
    return { ok: true, reason: "verified", proof: prepared.proof, wouldClick: true };
  }
  function commitPokemonCenterAdd(documentValue, urlValue, job, value, now = Date.now(), environment) {
    const authorization = pending;
    pending = null;
    if (!authorization || authorization.id !== value || authorization.jobId !== job.jobId) {
      return { ok: false, reason: "authorization_missing", clicked: false };
    }
    if (now < authorization.createdAt || now - authorization.createdAt > AUTHORIZATION_MAX_AGE_MS) {
      return { ok: false, reason: "authorization_expired", clicked: false };
    }
    if (documentValue !== authorization.document || JSON.stringify(job) !== authorization.jobSnapshot) {
      return { ok: false, reason: "offer_binding_changed", clicked: false };
    }
    const invalid = pokemonCenterJobReason(job);
    if (invalid) return { ok: false, reason: invalid, clicked: false };
    if (extractRetailerSku("pokemoncenter", urlValue) !== job.retailerSku) return { ok: false, reason: "listing_mismatch", clicked: false };
    const observation = observePokemonCenterOffer(
      documentValue,
      urlValue,
      job.retailerSku,
      job.fulfillment,
      new Date(now).toISOString(),
      environment
    );
    const verified = verifyLiveOffer(job, observation, now);
    if (!verified.ok) return { ok: false, clicked: false, reason: verified.reason === "out_of_stock" && observation.availability === "unknown" ? "add_control_unavailable" : verified.reason };
    const binding = pokemonCenterOfferBinding(documentValue, urlValue, job.retailerSku, environment);
    const control = binding?.control;
    if (!binding || !control || control !== authorization.control || binding.root !== authorization.root) {
      traceElement(environment, "authorized", authorization.control);
      traceElement(environment, "rebound", control ?? null);
      return { ok: false, reason: "add_control_changed", clicked: false };
    }
    if (binding.fingerprint !== authorization.fingerprint) return { ok: false, reason: "offer_binding_changed", clicked: false };
    try {
      control.click();
      return { ok: true, reason: "clicked", clicked: true, proof: verified.proof };
    } catch {
      return { ok: false, reason: "click_failed", clicked: false };
    }
  }
  function pokemonCenterCartUrl(value) {
    return pokemonCenterPageKind(value) === "cart";
  }
  function inspectPokemonCenterCartBaseline(documentValue, urlValue, now = Date.now()) {
    if (!pokemonCenterCartUrl(urlValue) || documentValue.URL !== urlValue) return { ok: false, reason: "cart_page_unverified" };
    if (pokemonCenterInteractiveBlock(documentValue, urlValue)) {
      return { ok: false, reason: "manual_action_required" };
    }
    return captureCartBaseline(
      "pokemoncenter",
      observePokemonCenterCart(documentValue, new Date(now).toISOString()),
      now
    );
  }
  function verifyPokemonCenterAddedCart(documentValue, urlValue, job, proof, baseline, now = Date.now()) {
    if (!pokemonCenterCartUrl(urlValue) || documentValue.URL !== urlValue) return { ok: false, reason: "cart_page_unverified" };
    if (pokemonCenterInteractiveBlock(documentValue, urlValue)) {
      return { ok: false, reason: "manual_action_required" };
    }
    const invalid = pokemonCenterJobReason(job);
    if (invalid) return { ok: false, reason: invalid };
    const inventory = observePokemonCenterCart(documentValue, new Date(now).toISOString());
    const verified = verifyCartAddDelta(job, baseline, inventory, proof, now);
    if (!verified.ok) return verified;
    const nextBaseline = captureCartBaseline("pokemoncenter", inventory, now);
    return {
      ...verified,
      ...nextBaseline.ok ? { cartBaseline: nextBaseline.proof } : {}
    };
  }
  Object.defineProperty(globalThis, "YoinkPokemonCenterAction", {
    value: Object.freeze({
      abandonPokemonCenterAdd,
      commitPokemonCenterAdd,
      inspectPokemonCenterCartBaseline,
      preparePokemonCenterAdd,
      rehearsePokemonCenterAdd,
      verifyPokemonCenterAddedCart
    }),
    configurable: true
  });
  return __toCommonJS(pokemoncenter_action_exports);
})();
