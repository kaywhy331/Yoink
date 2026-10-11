"use strict";
var YoinkTargetActionModule = (() => {
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

  // apps/extension/src/target-action.ts
  var target_action_exports = {};
  __export(target_action_exports, {
    abandonTargetAdd: () => abandonTargetAdd,
    commitTargetAdd: () => commitTargetAdd,
    inspectTargetCartBaseline: () => inspectTargetCartBaseline,
    prepareTargetAdd: () => prepareTargetAdd,
    raiseTargetCartQuantity: () => raiseTargetCartQuantity,
    rehearseTargetAdd: () => rehearseTargetAdd,
    verifyTargetAddedCart: () => verifyTargetAddedCart
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
      if (proof.version !== 1 || !/^official_msrp_[a-f0-9]{32}$/.test(proof.evidenceId) || !/^[a-f0-9]{64}$/.test(proof.evidenceHash) || !/^[a-f0-9]{64}$/.test(proof.listingIdentityHash) || proof.retailerId !== job.retailerId || proof.retailerSku !== job.retailerSku || typeof proof.desiredVariant !== "string" || !proof.desiredVariant.trim() || !proof.variantAttributes || typeof proof.variantAttributes !== "object" || Array.isArray(proof.variantAttributes) || proof.currency !== "USD" || job.currency !== "USD" || !Number.isSafeInteger(proof.msrpCents) || proof.msrpCents <= 0 || !Number.isSafeInteger(proof.unitPriceCents) || proof.unitPriceCents <= 0 || proof.unitPriceCents > proof.msrpCents || proof.unitPriceCents !== job.maxUnitPriceCents || age === null || age < 0 || !retrying && age > OFFICIAL_MSRP_SIGNAL_MAX_AGE_MS || !Number.isFinite(evidenceExpiry) || !retrying && evidenceExpiry <= now) return "official_msrp_authorization_invalid";
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
      if (job.priceAtOrBelow === true ? Number(observation.unitPriceCents) > job.officialMsrp.unitPriceCents : observation.unitPriceCents !== job.officialMsrp.unitPriceCents) return rejected("listed_price_changed");
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
    for (const [retailerSku, quantity] of before) {
      const expectedQuantity = quantity + (retailerSku === expectedSku ? job.quantity : 0);
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
  var TARGET_ADD_ADAPTER_VERSION = "target-add-v12";
  var EVIDENCE_CAPSULE_MAX_SNAPSHOT_BYTES = 3 * 1024 * 1024;
  var SELECTED_OFFER_SCOPE_VERSION = 1;

  // packages/browser-adapters/src/dom.ts
  var QUANTITY_TEXT = /^\s*(?:qty|quantity)?\s*:?\s*(\d{1,2})(?!\d)[^\d]{0,24}$/i;
  function parseQuantityText(value) {
    const match = String(value ?? "").replace(/\s+/g, " ").match(QUANTITY_TEXT);
    const quantity = Number(match?.[1]);
    return Number.isInteger(quantity) && quantity >= 1 && quantity <= 99 ? quantity : null;
  }
  var STEPPER_TEXT = /\b(?:increase|decrease|increment|decrement|add one|remove one|plus|minus)\b(?:\s+(?:the\s+)?(?:quantity|qty))?|[+\-\u2212\u2013]/gi;
  function parseStepperText(value) {
    return parseQuantityText(String(value ?? "").replace(STEPPER_TEXT, " "));
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
  var FORM_CONTROL = "select, input:not([type='checkbox']):not([type='radio']):not([type='submit']):not([type='button'])";
  var STEPPER_LABEL = /\b(?:increase|decrease|increment|decrement|add one|remove one|plus|minus)\b/i;
  function controlLike(element) {
    const role = String(element.getAttribute("role") || "").toLocaleLowerCase("en-US");
    return element.matches(FORM_CONTROL) || element.tagName === "BUTTON" || ["spinbutton", "combobox", "button", "listbox"].includes(role) || element.hasAttribute("aria-valuenow") || Boolean(element.querySelector(FORM_CONTROL));
  }
  var QUANTITY_HINT = /qty|quantity/i;
  function indicatesQuantity(element) {
    return ["name", "id", "aria-label", "data-test", "data-testid", "data-automation-id"].some((attribute) => QUANTITY_HINT.test(element.getAttribute(attribute) || ""));
  }
  function hiddenInput(element) {
    return element.tagName === "INPUT" && String(element.getAttribute("type") || "").toLocaleLowerCase("en-US") === "hidden";
  }
  function rawFormValue(element) {
    return String(element.value ?? "").trim();
  }
  function emptyHiddenQuantity(element) {
    return hiddenInput(element) && rawFormValue(element) === "";
  }
  function formValue(element) {
    const value = rawFormValue(element);
    return /^\d{1,2}$/.test(value) ? parseQuantityText(value) : null;
  }
  function innerQuantity(element) {
    const controls = [...element.querySelectorAll(FORM_CONTROL)];
    const named = controls.filter(indicatesQuantity);
    const pool = named.length ? named : controls.filter((control) => !hiddenInput(control));
    if (!pool.length) return void 0;
    const readable = pool.filter((control) => !emptyHiddenQuantity(control));
    if (!readable.length) return null;
    const values = readable.map(formValue);
    return values.every((value) => value !== null && value === values[0]) ? values[0] ?? null : null;
  }
  function readControlQuantity(element) {
    if (!element) return null;
    if (element.matches(FORM_CONTROL)) return formValue(element);
    const inner = innerQuantity(element);
    if (inner !== void 0) return inner;
    const valueNow = element.getAttribute("aria-valuenow") ?? element.querySelector("[aria-valuenow]")?.getAttribute("aria-valuenow") ?? null;
    if (valueNow !== null && valueNow.trim()) return parseQuantityText(valueNow);
    const value = element.getAttribute("value");
    if (value && /^\s*\d+\s*$/.test(value)) return parseQuantityText(value);
    const labelled = parseQuantityText(element.getAttribute("aria-label"));
    if (labelled !== null) return labelled;
    return parseStepperText(String(element.textContent || "").slice(0, 100));
  }
  function quantityIsOne(root, selectors, isVisible, exclude = () => false, generic = true) {
    const selector = [.../* @__PURE__ */ new Set([...selectors, ...generic ? GENERIC_QUANTITY_SELECTORS : []])].join(", ");
    let candidates;
    try {
      candidates = [...root.querySelectorAll(selector)];
    } catch {
      return false;
    }
    candidates = [...new Set(candidates)].filter((element) => (element.tagName === "INPUT" || isVisible(element)) && !exclude(element) && controlLike(element));
    let steppers = 0;
    let placeholders = 0;
    const readings = [];
    for (const candidate of candidates) {
      if (candidate.tagName === "BUTTON" || candidate.getAttribute("role") === "button") {
        if (STEPPER_LABEL.test(`${candidate.getAttribute("aria-label") || ""} ${candidate.textContent || ""}`)) {
          steppers += 1;
          continue;
        }
      }
      if (emptyHiddenQuantity(candidate)) {
        placeholders += 1;
        continue;
      }
      const reading = readControlQuantity(candidate);
      if (reading === null) return false;
      readings.push(reading);
    }
    if ((steppers > 0 || placeholders > 0) && readings.length === 0) return false;
    return readings.every((reading) => reading === 1);
  }

  // packages/browser-adapters/src/selected-offer.ts
  var EXACT_RETAILER_SKUS = /* @__PURE__ */ new Set([
    "target",
    "walmart",
    "amazon",
    "bestbuy",
    "ravensburger",
    "booksamillion",
    "pbandai",
    "pokemoncenter"
  ]);
  var DIMENSIONS = [
    ["size", /(?:^|[^a-z])size(?:$|[^a-z])/i],
    ["color", /(?:^|[^a-z])colou?r(?:$|[^a-z])/i],
    ["edition", /(?:^|[^a-z])edition(?:$|[^a-z])/i],
    ["language", /(?:^|[^a-z])language(?:$|[^a-z])/i],
    ["pack", /(?:^|[^a-z])(?:pack(?:\s*count)?|multipack)(?:$|[^a-z])/i],
    ["condition", /(?:^|[^a-z])condition(?:$|[^a-z])/i],
    ["finish", /(?:^|[^a-z])finish(?:$|[^a-z])/i],
    ["style", /(?:^|[^a-z])style(?:$|[^a-z])/i]
  ];
  var CONTROL_SELECTOR = "select, input[type='radio'], [role='radio'], [role='option'], button[aria-pressed], [aria-selected], [aria-checked], [data-selected]";
  function visible(element) {
    if (element.closest("[hidden], [aria-hidden='true']")) return false;
    const style = element.style;
    return style?.display !== "none" && style?.visibility !== "hidden";
  }
  function clean(value, maximum = 120) {
    return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
  }
  function associatedLabel(element) {
    const id = clean(element.getAttribute("id"), 100);
    const explicit = id ? [...element.ownerDocument.querySelectorAll("label[for]")].find((label) => label.getAttribute("for") === id) : null;
    return clean(explicit?.textContent || element.closest("label")?.textContent, 240);
  }
  function dimension(element) {
    const fieldset = element.closest("fieldset");
    const context = [
      element.getAttribute("name"),
      element.getAttribute("id"),
      element.getAttribute("aria-label"),
      element.getAttribute("data-testid"),
      element.getAttribute("data-attribute"),
      fieldset?.querySelector("legend")?.textContent,
      associatedLabel(element)
    ].map((value) => clean(value, 240)).filter(Boolean).join(" ");
    return DIMENSIONS.find(([, pattern]) => pattern.test(context))?.[0] ?? null;
  }
  function isSelected(element) {
    if (element.tagName === "SELECT") return true;
    if (element.tagName === "INPUT") return element.checked;
    return element.getAttribute("aria-selected") === "true" || element.getAttribute("aria-checked") === "true" || element.getAttribute("aria-pressed") === "true" || element.getAttribute("data-selected") === "true";
  }
  function selectedValue(element) {
    if (element.tagName === "SELECT") {
      const select = element;
      return clean(select.selectedOptions.length === 1 ? select.selectedOptions[0]?.textContent || select.value : "");
    }
    const inputValue = element.tagName === "INPUT" ? element.value : "";
    return clean(
      element.getAttribute("data-value") || element.getAttribute("aria-label") || inputValue || associatedLabel(element) || element.textContent
    );
  }
  function selectedOfferScope(document, retailerId, retailerSku, root = document) {
    const observed = /* @__PURE__ */ new Map();
    for (const control of [...root.querySelectorAll(CONTROL_SELECTOR)].filter(visible).slice(0, 200)) {
      const key = dimension(control);
      if (!key) continue;
      const state = observed.get(key) ?? { controls: 0, values: /* @__PURE__ */ new Set() };
      state.controls += 1;
      if (isSelected(control)) {
        const value = selectedValue(control);
        if (value) state.values.add(value);
      }
      observed.set(key, state);
    }
    const attributes = {};
    let unresolved = false;
    for (const [key, state] of [...observed].sort(([left], [right]) => left.localeCompare(right))) {
      if (state.values.size !== 1) {
        unresolved = true;
        continue;
      }
      attributes[key] = [...state.values][0];
    }
    const hasAttributes = Object.keys(attributes).length > 0;
    return {
      schemaVersion: SELECTED_OFFER_SCOPE_VERSION,
      selectionState: unresolved ? "unresolved" : hasAttributes || EXACT_RETAILER_SKUS.has(retailerId) ? "exact" : "listing_only",
      childOfferKey: clean(retailerSku, 120),
      attributes
    };
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

  // packages/browser-adapters/src/target.ts
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
  function selectorTrace(step, root, selector) {
    if (!activeAdapterEnvironment?.trace) return;
    let matches = [];
    try {
      matches = [...root.querySelectorAll(selector)];
    } catch {
      recordTrace({ step, selector, matched: 0, visible: 0, scoped: 0, reject: "pattern_mismatch" });
      return;
    }
    const visibleMatches = matches.filter(visible2);
    recordTrace({
      step,
      selector,
      matched: matches.length,
      visible: visibleMatches.length,
      scoped: root.nodeType === 9 ? 0 : visibleMatches.length,
      ...matches.length > 0 && visibleMatches.length === 0 ? { reject: "not_visible" } : {}
    });
  }
  function selectorListTrace(step, root, selectors) {
    for (const selector of selectors) selectorTrace(step, root, selector);
  }
  var MARKETPLACE_PATTERN = /sold\s+(?:and|&)\s+shipped\s+by\s+(?!target\b)|sold\s+by\s+(?!target\b)|target\s*plus|marketplace\s+seller/i;
  var FIRST_PARTY_PATTERN = /sold\s+(?:and|&)\s+shipped\s+by\s+target\b|sold\s+by\s+target\b/i;
  var TARGET_PRICE_SELECTORS = selectorsFor("target", "price");
  var TARGET_CURRENT_PRICE_SELECTORS = TARGET_PRICE_SELECTORS.slice(0, -1);
  var TARGET_PRICE_MODULE_SELECTOR = TARGET_PRICE_SELECTORS.at(-1) ?? "meta:not(*)";
  var TARGET_ADD_CONTROL_SELECTORS = selectorsFor("target", "addControl");
  var TARGET_SELLER_SELECTORS = selectorsFor("target", "seller");
  var TARGET_AVAILABILITY_SELECTORS = selectorsFor("target", "availability");
  var TARGET_QUANTITY_SELECTORS = selectorsFor("target", "quantity");
  var TARGET_PRIMARY_SCOPE_SELECTOR = selectorsFor("target", "primaryScope").join(", ");
  var TARGET_RECOMMENDATION_SCOPE_SELECTOR = selectorsFor("target", "merchandisingScope").join(", ");
  var TARGET_OFFER_INPUT_SELECTOR = selectorsFor("target", "offerInput").join(", ");
  function text(value, maximum = 2e3) {
    return String(value?.textContent || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
  }
  function observableText(value, maximum = 2e3, skip = () => false) {
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
        if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(element.tagName) || !visible2(element) || skip(element)) return;
      }
      for (const child of [...node.childNodes]) visit(child);
    };
    visit(value);
    return fragments.join(" ").replace(/\s+/g, " ").trim().slice(0, maximum);
  }
  function visible2(element) {
    if (!element) return false;
    if (activeAdapterEnvironment?.isVisible) {
      try {
        return activeAdapterEnvironment.isVisible(element);
      } catch {
        return false;
      }
    }
    const view = element.ownerDocument.defaultView;
    let current = element;
    while (current) {
      if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden") === "true") return false;
      const inlineStyle = current.getAttribute("style");
      const style = inlineStyle ? inlineStyle.replace(/\s+/g, "").toLocaleLowerCase("en-US") : "";
      if (/(?:^|;)display:none(?:;|$)|(?:^|;)visibility:hidden(?:;|$)/.test(style)) return false;
      const computed = view?.getComputedStyle?.(current);
      if (computed?.display === "none" || computed?.visibility === "hidden") return false;
      current = current.parentElement;
    }
    return true;
  }
  function actionable(element) {
    return visible2(element) && !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true" && !/sold out|out of stock|unavailable/i.test(text(element, 300));
  }
  function queryVisible(root, selectors) {
    for (const selector of selectors) {
      const match = [...root.querySelectorAll(selector)].find(visible2);
      if (match) return match;
    }
    return null;
  }
  function extractTargetSku(urlValue) {
    try {
      const url = new URL(urlValue);
      if (url.protocol !== "https:" || url.username || url.password || !(url.hostname === "target.com" || url.hostname.endsWith(".target.com"))) return "";
      const pathMatch = url.pathname.match(/(?:^|\/)A-(\d{6,})(?:\/|$)/i);
      if (pathMatch?.[1]) return pathMatch[1];
      for (const key of ["preselect", "tcin"]) {
        const value = String(url.searchParams.get(key) || "");
        if (/^\d{6,}$/.test(value)) return value;
      }
      return "";
    } catch {
      return "";
    }
  }
  function parseUsPrice(value) {
    const source = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!source || /(?:C|CA|MX|SG|HK|AU|A|R)\s*\$/i.test(source)) return null;
    const match = source.match(/(?:US\s*)?\$\s*([0-9]{1,7}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/i) ?? (/^[0-9]{1,7}(?:\.[0-9]{1,2})?$/.test(source) ? [source, source] : null);
    if (!match?.[1]) return null;
    const dollars = Number(match[1].replaceAll(",", ""));
    return Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : null;
  }
  function readPrice(root, selectors) {
    for (const selector of selectors) {
      for (const element of root.querySelectorAll(selector)) {
        if (!visible2(element) || recommendationControl(element)) continue;
        for (const candidate of [element.getAttribute("content"), element.getAttribute("value"), text(element, 300)]) {
          const price = parseUsPrice(candidate);
          if (price !== null) return price;
        }
      }
    }
    return null;
  }
  function adaptiveTargetPrice(root, selectors) {
    selectorListTrace("price", root, selectors);
    selectorTrace("price", root, TARGET_PRICE_MODULE_SELECTOR);
    const packaged = readPrice(root, selectors);
    if (packaged !== null) return packaged;
    const modulePrices = [...root.querySelectorAll(TARGET_PRICE_MODULE_SELECTOR)].filter((element) => visible2(element) && !recommendationControl(element)).map((element) => readPrice(element, selectors) ?? parseUsPrice(observableText(element, 1200))).filter((price) => price !== null);
    const uniqueModulePrices = [...new Set(modulePrices)];
    if (uniqueModulePrices.length === 1) return uniqueModulePrices[0] ?? null;
    const candidates = [...root.querySelectorAll("[data-test], [data-testid], [itemprop], [aria-label]")].slice(0, 500).filter((element) => visible2(element) && !recommendationControl(element)).filter((element) => /(?:price|amount)/i.test([
      element.getAttribute("data-test"),
      element.getAttribute("data-testid"),
      element.getAttribute("itemprop"),
      element.getAttribute("aria-label")
    ].filter(Boolean).join(" "))).map((element) => ({
      element,
      price: [element.getAttribute("content"), element.getAttribute("value"), text(element, 300)].map(parseUsPrice).find((value) => value !== null) ?? null
    })).filter((entry) => entry.price !== null);
    return candidates.length === 1 && candidates[0] ? candidates[0].price : null;
  }
  function targetSecurityChallenge(document) {
    return Boolean(queryVisible(document, [
      "iframe[src*='captcha' i]",
      "[data-test*='captcha' i]",
      "[data-testid*='captcha' i]",
      "[id*='captcha' i]"
    ])) || /verify you are human|unusual traffic|security challenge/i.test(observableText(document.body, 5e4));
  }
  function targetInteractiveBlock(document, environment) {
    if (environment) return withAdapterEnvironment(environment, () => targetInteractiveBlock(document));
    selectorListTrace("interactive_block", document, [
      "input[autocomplete='one-time-code']",
      "input[name*='otp' i]",
      "[role='dialog']",
      "dialog[open]",
      "form[action*='login' i] input[type='password']",
      "input[autocomplete='current-password']"
    ]);
    const visibleText = observableText(document.body, 8e4);
    if (queryVisible(document, ["input[autocomplete='one-time-code']", "input[name*='otp' i]"])) return "mfa";
    const dialog = queryVisible(document, ["[role='dialog']", "dialog[open]"]);
    const dialogText = text(dialog, 1e4);
    if (dialog && /choose|select|set/.test(dialogText.toLocaleLowerCase("en-US")) && /pickup store|my store|location/.test(dialogText.toLocaleLowerCase("en-US"))) return "location";
    if (dialog && /target circle 360|membership|free trial/i.test(dialogText)) return "membership";
    if (dialog && /something went wrong|please try again in a bit|loading screen/i.test(dialogText)) return "unknown";
    if (queryVisible(document, ["form[action*='login' i] input[type='password']", "input[autocomplete='current-password']"])) return "auth";
    if (/you(?:’|')?re in line|virtual queue|waiting room/i.test(visibleText)) return "queue";
    if (targetSecurityChallenge(document)) return "unknown";
    return "";
  }
  function targetPageKind(urlValue) {
    try {
      const path = new URL(urlValue).pathname.toLocaleLowerCase("en-US");
      if (/order-confirm|thank.?you|confirmation/.test(path)) return "confirmation";
      if (/\/(?:login|signin|sign-in|verify|challenge|mfa|otp)(?:\/|$)|\/account(?:\/|$)|\/co-(?:login|signin)(?:\/|$)/.test(path)) return "auth";
      if (/checkout|co-(?:delivery|fulfillment|pickup|payment|review)/.test(path)) return "checkout";
      if (/\/(?:cart|co-cart)(?:\/|$)/.test(path)) return "cart";
      return extractTargetSku(urlValue) ? "product" : "other";
    } catch {
      return "other";
    }
  }
  var TARGET_FULFILLMENT_ROOT_SELECTOR = selectorsFor("target", "fulfillmentRoot").join(", ");
  var TARGET_FULFILLMENT_TILE_SELECTOR = selectorsFor("target", "fulfillmentTile").join(", ");
  var TARGET_FULFILLMENT_UNAVAILABLE_PATTERN = /\b(?:not available|unavailable|out of stock|sold out|loading|check availability|choose (?:a |your )?(?:store|location|address)|select (?:a |your )?(?:store|location|address)|set (?:a |your )?(?:store|location|address))\b/i;
  var TARGET_FULFILLMENT_AVAILABLE_PATTERN = /\b(?:arrives?|ready|available|get it|same[ -]?day|today|tomorrow|within|deliver(?:ed|y) by)\b/i;
  function fulfillmentKind(element) {
    const marker = [
      element.getAttribute("data-test"),
      element.getAttribute("data-fulfillment"),
      element.getAttribute("id")
    ].filter(Boolean).join(" ");
    if (/shipping|shipit|delivery|same[ -]?day/i.test(marker)) return "shipping";
    if (/pickup|pick-up/i.test(marker)) return "pickup";
    const label = `${element.getAttribute("aria-label") || ""} ${text(element, 300)}`;
    if (/^\s*(?:ship it|shipping|delivery|same[ -]?day delivery)\b/i.test(label)) return "shipping";
    if (/^\s*(?:pick it up|pickup|pick-up)\b/i.test(label)) return "pickup";
    return "unknown";
  }
  function fulfillmentTileSelected(element) {
    const ariaLabel = String(element.getAttribute("aria-label") || "");
    return element.getAttribute("aria-selected") === "true" || element.getAttribute("aria-checked") === "true" || element.getAttribute("aria-pressed") === "true" || element.getAttribute("data-selected") === "true" || /\bselected\b/i.test(ariaLabel) && !/\bunselected\b/i.test(ariaLabel) || /(?:^|[_\s-])(?:is-)?active(?:[_\s-]|$)/i.test(String(element.getAttribute("class") || ""));
  }
  function fulfillmentTileAvailable(element) {
    if (!visible2(element) || element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") return false;
    const evidence = `${element.getAttribute("aria-label") || ""} ${text(element, 500)}`;
    if (TARGET_FULFILLMENT_UNAVAILABLE_PATTERN.test(evidence)) return false;
    return fulfillmentTileSelected(element) || TARGET_FULFILLMENT_AVAILABLE_PATTERN.test(evidence);
  }
  function controlFulfillment(control, root) {
    selectorTrace("fulfillment", root, TARGET_FULFILLMENT_TILE_SELECTOR);
    selectorListTrace("fulfillment", root, ["[aria-selected='true']", "[data-selected='true']", "input:checked"]);
    const own = fulfillmentKind(control);
    const selectedTiles = [...root.querySelectorAll(TARGET_FULFILLMENT_TILE_SELECTOR)].filter((element) => visible2(element) && fulfillmentKind(element) !== "unknown" && fulfillmentTileSelected(element));
    if (selectedTiles.length === 1 && selectedTiles[0]) {
      const selected2 = fulfillmentKind(selectedTiles[0]);
      return own !== "unknown" && own !== selected2 ? "unknown" : selected2;
    }
    if (selectedTiles.length > 1) return "unknown";
    if (own !== "unknown") return own;
    const selected = [...root.querySelectorAll("[aria-selected='true'], [data-selected='true'], input:checked")].filter((element) => visible2(element)).map((element) => text(element.closest("label, [role='tab'], [data-test*='fulfillment' i]") || element, 500));
    const shipping = selected.some((value) => /ship it|shipping|delivery/i.test(value));
    const pickup = selected.some((value) => /pick it up|pickup|pick-up/i.test(value));
    return shipping === pickup ? "unknown" : shipping ? "shipping" : "pickup";
  }
  function directControlFulfillment(control, root) {
    const own = fulfillmentKind(control);
    if (own !== "unknown") return own;
    const methodScope = control.closest([
      "[data-test*='AddToCart/Fulfillment/Shipping' i]",
      "[data-test*='AddToCart/Fulfillment/Delivery' i]",
      "[data-test*='AddToCart/Fulfillment/Pickup' i]",
      "[data-fulfillment]",
      "[data-fulfillment-type]"
    ].join(", "));
    return methodScope && root.contains(methodScope) ? fulfillmentKind(methodScope) : "unknown";
  }
  function recommendationControl(candidate) {
    return Boolean(candidate.closest(TARGET_RECOMMENDATION_SCOPE_SELECTOR));
  }
  function exactAddControls(root, sku) {
    if (!/^\d{6,}$/.test(sku)) return [];
    selectorTrace("add_control", root, `button[id='addToCartButtonOrTextIdFor${sku}']`);
    return [...root.querySelectorAll(`button[id='addToCartButtonOrTextIdFor${sku}']`)].filter((candidate) => visible2(candidate) && !recommendationControl(candidate));
  }
  var TARGET_ADD_MODULE_SELECTOR = "[data-module-type='ProductDetailAddToCart'], [data-test='module-product-detail-add-to-cart']";
  var TARGET_ADD_INTENT_PATTERN = /\badd(?:\s+(?:item\s+)?to)?\s+cart\b/i;
  function targetAddIntent(control) {
    if (!control) return false;
    return TARGET_ADD_INTENT_PATTERN.test(`${control.getAttribute("aria-label") || ""} ${text(control, 300)}`);
  }
  function targetAddModule(document) {
    const modules = [...new Set(document.querySelectorAll(TARGET_ADD_MODULE_SELECTOR))].filter((module) => visible2(module) && !recommendationControl(module));
    const outermost = modules.filter((module) => !modules.some((other) => other !== module && other.contains(module)));
    return outermost.length === 1 && outermost[0] ? outermost[0] : null;
  }
  function moduleAddControl(document, sku) {
    const module = targetAddModule(document);
    selectorTrace("add_control", document, TARGET_ADD_MODULE_SELECTOR);
    if (!module) return null;
    const exact = exactAddControls(module, sku);
    if (exact.length === 1 && exact[0]) return { control: exact[0], exact: true };
    if (exact.length > 1) return null;
    const placeholders = [...module.querySelectorAll("button[id^='AddToCart.'], button[data-test^='AddToCart.']")].filter((candidate) => visible2(candidate) && !recommendationControl(candidate));
    return placeholders.length === 1 && placeholders[0] ? { control: placeholders[0], exact: false } : null;
  }
  function shipOnlyRegion(root) {
    const evidence = `${root.getAttribute("aria-label") || ""} ${observableText(root, 800)}`;
    return /\bship(?:s|ping)? to\b/i.test(evidence) && /\barrives?\b/i.test(evidence) && !TARGET_FULFILLMENT_UNAVAILABLE_PATTERN.test(evidence) && !/\b(?:pickup|pick it up|same[ -]?day delivery)\b/i.test(evidence) ? "shipping" : "unknown";
  }
  function targetOfferOwnsControl(offerRoot, control, sku) {
    if (!offerRoot || !control) return false;
    if (offerRoot.contains(control)) return true;
    const module = moduleAddControl(control.ownerDocument, sku);
    return Boolean(module?.exact && module.control === control);
  }
  function targetSkuEvidence(root) {
    const skus = /* @__PURE__ */ new Set();
    const elements = [
      ...root.nodeType === 1 ? [root] : [],
      ...root.querySelectorAll(TARGET_OFFER_INPUT_SELECTOR)
    ];
    for (const element of elements) {
      const dataTcin = String(element.getAttribute("data-tcin") || "").trim();
      const idTcin = String(element.getAttribute("id") || "").match(/^addToCartButtonOrTextIdFor(\d{6,})$/)?.[1] || "";
      if (/^\d{6,}$/.test(dataTcin)) skus.add(dataTcin);
      if (idTcin) skus.add(idTcin);
    }
    return skus;
  }
  function semanticTargetAddControls(root, sku) {
    const skus = targetSkuEvidence(root);
    if ([...skus].some((candidate) => candidate !== sku)) return [];
    const candidates = [...root.querySelectorAll("button, input[type='submit'], input[type='button'], [role='button']")].filter((candidate) => visible2(candidate) && !recommendationControl(candidate)).filter((candidate) => /\badd(?:\s+(?:item\s+)?to)?\s+cart\b/i.test([
      candidate.getAttribute("aria-label"),
      candidate.getAttribute("name"),
      candidate.getAttribute("value"),
      candidate.getAttribute("data-test"),
      candidate.getAttribute("data-testid"),
      text(candidate, 300)
    ].filter(Boolean).join(" ")));
    recordTrace({
      step: "add_control",
      selector: "semantic:add-intent",
      matched: candidates.length,
      visible: candidates.length,
      scoped: root.nodeType === 9 ? 0 : candidates.length,
      chosen: candidates.length === 1 ? 1 : 0,
      ...candidates.length === 1 ? {} : { reject: "ambiguous" }
    });
    return candidates.length === 1 ? candidates : [];
  }
  function addControls(document, sku) {
    selectorListTrace("add_control", document, [
      `button[id='addToCartButtonOrTextIdFor${sku}']`,
      ...TARGET_ADD_CONTROL_SELECTORS
    ]);
    const candidates = [
      ...exactAddControls(document, sku),
      ...document.querySelectorAll(TARGET_ADD_CONTROL_SELECTORS.join(", "))
    ];
    return [...new Set(candidates)].filter((candidate) => {
      if (!visible2(candidate)) return false;
      if (recommendationControl(candidate)) return false;
      const idSku = candidate.getAttribute("id")?.match(/^addToCartButtonOrTextIdFor(\d{6,})$/)?.[1];
      if (idSku && idSku !== sku) return false;
      const scopedSku = candidate.closest("[data-tcin]")?.getAttribute("data-tcin");
      return idSku === sku || scopedSku === sku;
    });
  }
  function targetQuantityOne(roots, addControl = null) {
    const traceRoot = roots.find(Boolean);
    if (traceRoot) selectorListTrace("quantity", traceRoot, TARGET_QUANTITY_SELECTORS);
    const exclude = (element) => element === addControl || recommendationControl(element);
    const passed = [...new Set(roots.filter((root) => Boolean(root)))].every((root) => quantityIsOne(root, TARGET_QUANTITY_SELECTORS, visible2, exclude));
    recordTrace({
      step: "quantity",
      condition: "target.quantityOne",
      expected: "1",
      passed,
      ...passed ? {} : { reject: "condition_failed" }
    });
    return passed;
  }
  function emptyTargetAddBinding() {
    return { control: null, fulfillmentControl: null, fulfillment: "unknown", selectionRequired: false, offerRoot: null };
  }
  function modernTargetAddBinding(document, sku, required) {
    selectorTrace("offer_scope", document, TARGET_FULFILLMENT_ROOT_SELECTOR);
    const visibleRoots = [...new Set(document.querySelectorAll(TARGET_FULFILLMENT_ROOT_SELECTOR))].filter((root2) => visible2(root2) && !recommendationControl(root2));
    const roots = visibleRoots.filter((root2) => !visibleRoots.some((candidate) => candidate !== root2 && root2.contains(candidate)));
    recordTrace({
      step: "offer_scope",
      condition: "target.fulfillmentRoot",
      matched: visibleRoots.length,
      visible: visibleRoots.length,
      scoped: roots.length,
      chosen: roots.length === 1 ? 1 : 0,
      passed: roots.length > 0,
      ...roots.length > 0 ? {} : { reject: "outside_offer_root" }
    });
    if (roots.length === 0) return null;
    let scoped = roots.map((root2) => {
      const exact = exactAddControls(root2, sku);
      return { root: root2, controls: exact.length > 0 ? exact : semanticTargetAddControls(root2, sku) };
    }).filter((entry) => entry.controls.length === 1 && entry.controls[0]);
    let placeholder = false;
    if (scoped.length === 0 && roots.length === 1 && roots[0]) {
      const moduleControl = moduleAddControl(document, sku);
      recordTrace({
        step: "add_control",
        selector: "module:ProductDetailAddToCart",
        matched: moduleControl ? 1 : 0,
        visible: moduleControl ? 1 : 0,
        scoped: 0,
        chosen: moduleControl ? 1 : 0,
        ...moduleControl ? {} : { reject: "outside_offer_root" }
      });
      if (moduleControl) {
        scoped = [{ root: roots[0], controls: [moduleControl.control] }];
        placeholder = !moduleControl.exact;
      }
    }
    if (scoped.length !== 1 || !scoped[0]?.controls[0]) return emptyTargetAddBinding();
    const { root } = scoped[0];
    const control = scoped[0].controls[0];
    if (!targetQuantityOne([root, control.closest(TARGET_PRIMARY_SCOPE_SELECTOR)], control)) return emptyTargetAddBinding();
    const tiles = [...root.querySelectorAll(TARGET_FULFILLMENT_TILE_SELECTOR)].filter((fulfillmentControl) => fulfillmentControl !== control && visible2(fulfillmentControl)).map((fulfillmentControl) => ({
      fulfillmentControl,
      fulfillment: fulfillmentKind(fulfillmentControl),
      selected: fulfillmentTileSelected(fulfillmentControl),
      available: fulfillmentTileAvailable(fulfillmentControl)
    })).filter((entry) => entry.fulfillment !== "unknown");
    required = required === "pickup" ? "pickup" : "shipping";
    if (tiles.length === 0) {
      if (placeholder) return emptyTargetAddBinding();
      let directFulfillment = directControlFulfillment(control, root);
      if (directFulfillment === "unknown" && !root.contains(control) && targetAddIntent(control)) {
        directFulfillment = shipOnlyRegion(root);
      }
      return directFulfillment === required ? { control, fulfillmentControl: null, fulfillment: required, selectionRequired: false, offerRoot: root } : emptyTargetAddBinding();
    }
    const selected = tiles.filter((entry) => entry.selected);
    if (selected.length !== 1 || !selected[0]) return emptyTargetAddBinding();
    const selectedEntry = selected[0];
    const alreadySelected = selectedEntry.fulfillment === required && selectedEntry.available;
    if (alreadySelected) {
      if (placeholder || !root.contains(control) && !targetAddIntent(control)) return emptyTargetAddBinding();
      return { control, fulfillmentControl: selectedEntry.fulfillmentControl, fulfillment: required, selectionRequired: false, offerRoot: root };
    }
    const available = tiles.filter((entry) => entry.fulfillment === required && entry.available);
    if (available.length === 0) return emptyTargetAddBinding();
    const preferred = required === "shipping" ? available.find((entry) => /shipping/i.test(String(entry.fulfillmentControl.getAttribute("data-test") || entry.fulfillmentControl.getAttribute("id") || ""))) ?? available[0] : available[0];
    return preferred ? { control, fulfillmentControl: preferred.fulfillmentControl, fulfillment: required, selectionRequired: true, offerRoot: root } : emptyTargetAddBinding();
  }
  var TARGET_SOLD_OUT_STATUS_PATTERN = /^(?:out of stock|sold out|currently unavailable)$/i;
  function targetSoldOutLayout(document) {
    const module = targetAddModule(document);
    if (!module) return false;
    const buttons = [...module.querySelectorAll("button, [role='button']")].filter((button) => visible2(button) && !recommendationControl(button));
    const placeholders = buttons.filter((button) => button.getAttribute("id") === "AddToCart.Disabled" || button.getAttribute("data-test") === "AddToCart.Disabled");
    const placeholder = placeholders.length === 1 ? placeholders[0] : null;
    if (!placeholder || !placeholder.hasAttribute("disabled") && placeholder.getAttribute("aria-disabled") !== "true") return false;
    if (buttons.some((button) => button !== placeholder && actionable(button) && /\b(?:add(?:\s+(?:item\s+)?to)?\s+cart|pre[ -]?order)\b/i.test(`${button.getAttribute("aria-label") || ""} ${text(button, 300)}`))) return false;
    const regions = [...new Set(document.querySelectorAll(TARGET_FULFILLMENT_ROOT_SELECTOR))].filter((region2) => visible2(region2) && !recommendationControl(region2));
    const outermost = regions.filter((region2) => !regions.some((other) => other !== region2 && other.contains(region2)));
    const region = outermost.length === 1 ? outermost[0] : null;
    if (!region) return false;
    if ([...region.querySelectorAll(TARGET_FULFILLMENT_TILE_SELECTOR)].some((tile) => fulfillmentKind(tile) !== "unknown" && fulfillmentTileAvailable(tile))) return false;
    return TARGET_SOLD_OUT_STATUS_PATTERN.test(observableText(region, 200));
  }
  function targetExplicitlyUnavailable(document) {
    return [...document.querySelectorAll(TARGET_AVAILABILITY_SELECTORS.join(", "))].filter((element) => visible2(element) && !recommendationControl(element)).some((element) => /\b(?:out of stock|sold out|currently unavailable)\b/i.test(
      `${element.getAttribute("content") || ""} ${element.getAttribute("aria-label") || ""} ${observableText(element, 500)}`
    )) || targetSoldOutLayout(document);
  }
  var TARGET_PRICE_MODULE_SELECTOR_V2 = "[data-module-type='ProductDetailPrice']";
  var TARGET_PRICE_PLACEHOLDER_SELECTOR = "[data-test='price-module-placeholder']";
  var TARGET_STICKY_SELECTOR = "[data-test='sticky-atc']";
  var TARGET_SINGLE_US_PRICE_PATTERN = /^\$\s*[0-9]{1,7}(?:,[0-9]{3})*(?:\.[0-9]{2})?$/;
  function targetPriceModuleLoading(document) {
    const modules = [...document.querySelectorAll(TARGET_PRICE_MODULE_SELECTOR_V2)].filter((module2) => visible2(module2) && !recommendationControl(module2));
    const outermost = modules.filter((module2) => !modules.some((other) => other !== module2 && other.contains(module2)));
    const module = outermost.length === 1 ? outermost[0] : null;
    return Boolean(module && [...module.querySelectorAll(TARGET_PRICE_PLACEHOLDER_SELECTOR)].some(visible2) && parseUsPrice(observableText(module, 1200)) === null);
  }
  function targetStickyPriceWhileLoading(document, sku, required) {
    const reject = (reason) => {
      recordTrace({ step: "price", selector: "sticky-atc:while-module-loading", matched: 0, visible: 0, scoped: 0, reject: reason });
      return null;
    };
    if (required === "pickup" || !/^\d{6,}$/.test(sku) || !targetPriceModuleLoading(document)) return null;
    const bars = [...document.querySelectorAll(TARGET_STICKY_SELECTOR)].filter((bar2) => !recommendationControl(bar2));
    const bar = bars.length === 1 ? bars[0] : null;
    if (!bar) return reject("ambiguous");
    const skus = targetSkuEvidence(bar);
    const exactControls = bar.querySelectorAll(`button[id='addToCartButtonOrTextIdFor${sku}']`);
    if (exactControls.length !== 1 || skus.size !== 1 || !skus.has(sku)) return reject("sku_mismatch");
    const blocks = bar.querySelectorAll("[data-test='@web/Price/PriceFull']");
    const block = blocks.length === 1 ? blocks[0] : null;
    const prices = block ? block.querySelectorAll("[data-test='product-price']") : [];
    const current = prices.length === 1 ? text(prices[0], 100) : "";
    if (!block || !TARGET_SINGLE_US_PRICE_PATTERN.test(current)) return reject("pattern_mismatch");
    const qualifier = [...block.querySelectorAll("[data-test='@web/Price/PriceHandle']")].map((handle) => text(handle, 200)).join(" ");
    if (qualifier && !/^when purchased online$/i.test(qualifier)) return reject("condition_failed");
    const price = parseUsPrice(current);
    recordTrace({ step: "price", selector: "sticky-atc:while-module-loading", matched: 1, visible: 0, scoped: 1, chosen: price === null ? 0 : 1 });
    return price;
  }
  function legacyTargetAddBinding(document, sku, required) {
    required = required === "pickup" ? "pickup" : "shipping";
    const candidates = addControls(document, sku).map((control) => ({ control, fulfillment: controlFulfillment(control, document) }));
    const matching = candidates.find((entry) => entry.fulfillment === required);
    return matching && targetQuantityOne([matching.control.closest(TARGET_PRIMARY_SCOPE_SELECTOR) ?? document.documentElement]) ? { ...matching, fulfillmentControl: null, selectionRequired: false, offerRoot: null } : emptyTargetAddBinding();
  }
  function targetAddBinding(document, urlValue, expectedSku, requiredFulfillment, environment) {
    if (environment) {
      return withAdapterEnvironment(environment, () => targetAddBinding(document, urlValue, expectedSku, requiredFulfillment));
    }
    const pageSku = extractTargetSku(urlValue);
    recordTrace({
      step: "page_identity",
      condition: "retailerSku",
      expected: expectedSku,
      actual: pageSku,
      passed: pageSku === expectedSku,
      ...pageSku === expectedSku ? {} : { reject: "sku_mismatch" }
    });
    if (pageSku !== expectedSku) return emptyTargetAddBinding();
    return modernTargetAddBinding(document, expectedSku, requiredFulfillment) ?? legacyTargetAddBinding(document, expectedSku, requiredFulfillment);
  }
  function closestOfferContainer(anchor) {
    let current = anchor?.parentElement ?? null;
    for (let depth = 0; depth < 12 && current; depth += 1) {
      const scopedText = text(current, 6e4);
      const price = adaptiveTargetPrice(current, TARGET_CURRENT_PRICE_SELECTORS);
      if (price !== null && scopedText.length < 4e4) return current;
      current = current.parentElement;
    }
    return null;
  }
  function sellerEvidence(document, anchor) {
    const cartRoot = anchor?.closest("[data-test='cart-item'], [data-test='cartItem'], [data-testid='cart-item']") ?? null;
    const offerRoot = cartRoot ? null : closestOfferContainer(anchor);
    const root = cartRoot || offerRoot || anchor?.closest(TARGET_PRIMARY_SCOPE_SELECTOR) || document;
    const region = queryVisible(root, TARGET_SELLER_SELECTORS);
    const seller = text(region, 500);
    const scope = text(root, 6e4);
    if (FIRST_PARTY_PATTERN.test(seller)) return { sellerName: "Target", sellerType: "first_party" };
    if (seller && MARKETPLACE_PATTERN.test(seller)) {
      const name = seller.replace(/^.*?sold\s+(?:and|&)\s+shipped\s+by\s*/i, "").replace(/^.*?sold\s+by\s*/i, "").trim();
      return { sellerName: name.slice(0, 160), sellerType: "third_party" };
    }
    if (MARKETPLACE_PATTERN.test(scope)) return { sellerName: seller.slice(0, 160), sellerType: "unknown" };
    if (cartRoot || offerRoot) return { sellerName: "Target", sellerType: "first_party" };
    if (!MARKETPLACE_PATTERN.test(text(document.body, 12e4))) return { sellerName: "Target", sellerType: "first_party" };
    return { sellerName: seller.slice(0, 160), sellerType: "unknown" };
  }
  function observeTargetOffer(document, urlValue, expectedSku, requiredFulfillment, observedAt = (/* @__PURE__ */ new Date()).toISOString(), environment) {
    if (environment) {
      return withAdapterEnvironment(environment, () => observeTargetOffer(
        document,
        urlValue,
        expectedSku,
        requiredFulfillment,
        observedAt
      ));
    }
    const pageSku = extractTargetSku(urlValue);
    const selected = pageSku === expectedSku ? targetAddBinding(document, urlValue, expectedSku, requiredFulfillment) : emptyTargetAddBinding();
    const seller = sellerEvidence(document, selected.control);
    const priceRoot = selected.offerRoot?.closest(TARGET_PRIMARY_SCOPE_SELECTOR) || selected.control?.closest(TARGET_PRIMARY_SCOPE_SELECTOR) || document;
    const unitPriceCents = adaptiveTargetPrice(priceRoot, TARGET_CURRENT_PRICE_SELECTORS) ?? (pageSku === expectedSku ? targetStickyPriceWhileLoading(document, expectedSku, requiredFulfillment) : null);
    const blocked = targetInteractiveBlock(document);
    const selectedControlActionable = pageSku === expectedSku && actionable(selected.control);
    const availability = blocked ? "unknown" : selectedControlActionable ? "in_stock" : pageSku === expectedSku && targetExplicitlyUnavailable(document) ? "out_of_stock" : "unknown";
    recordTrace({
      step: "availability",
      condition: "offer.availability",
      expected: "in_stock",
      actual: availability,
      passed: availability === "in_stock",
      ...availability === "in_stock" ? {} : { reject: "not_actionable" }
    });
    return {
      contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
      observedAt,
      url: urlValue,
      pageKind: targetPageKind(urlValue),
      retailerId: "target",
      retailerSku: pageSku,
      selectedOffer: selectedOfferScope(
        document,
        "target",
        pageSku,
        selected.control?.closest(TARGET_PRIMARY_SCOPE_SELECTOR) || document
      ),
      availability,
      unitPriceCents,
      currency: "USD",
      sellerName: seller.sellerName,
      sellerType: seller.sellerType,
      fulfillment: selected.fulfillment,
      addControlActionable: selectedControlActionable && !blocked,
      securityChallenge: targetSecurityChallenge(document),
      interactiveBlock: blocked
    };
  }
  function targetLimitFromText(value, line = false) {
    const patterns = [
      /\blimit(?:ed)?(?:\s+to)?\s+(\d{1,2})\s+(?:per|each|a)\s+(?:guest|order|customer|household|account|person|transaction)\b/gi,
      /\b(?:purchase|quantity|qty|order)\s+limit(?:\s+(?:of|is))?\s*:?\s*(\d{1,2})(?![\d%])/gi,
      ...line ? [
        /\blimit\s*:?\s*(\d{1,2})(?![\d%])/gi,
        /\bmax(?:imum)?(?:\s+(?:qty|quantity))?(?:\s+(?:of|is))?\s*:?\s*(\d{1,2})(?![\d%])/gi
      ] : []
    ];
    const limits = [];
    for (const pattern of patterns) {
      for (const match of value.matchAll(pattern)) {
        const limit = Number(match[1]);
        if (Number.isInteger(limit) && limit >= 1 && limit <= 99) limits.push(limit);
      }
    }
    return limits.length ? Math.min(...limits) : null;
  }
  var TARGET_NEXT_DATA_MAX_CHARS = 4e6;
  var TARGET_NEXT_DATA_MAX_NODES = 3e5;
  function purchaseLimitValue(value) {
    const limit = typeof value === "string" && /^\s*\d{1,2}\s*$/.test(value) ? Number(value) : value;
    return typeof limit === "number" && Number.isInteger(limit) && limit >= 1 && limit <= 99 ? limit : null;
  }
  function objectField(value, key) {
    return value && typeof value === "object" && !Array.isArray(value) ? value[key] : void 0;
  }
  function targetNextDataPurchaseLimit(document, sku) {
    const scripts = document.querySelectorAll("script#__NEXT_DATA__");
    const raw = scripts.length === 1 ? String(scripts[0]?.textContent || "") : "";
    if (!raw || raw.length > TARGET_NEXT_DATA_MAX_CHARS) return null;
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
    const limits = [];
    const productLimit = (product) => {
      const children = objectField(product, "children");
      for (const candidate of [product, ...Array.isArray(children) ? children : []]) {
        if (String(objectField(candidate, "tcin") ?? "") !== sku) continue;
        const limit = purchaseLimitValue(objectField(objectField(objectField(candidate, "item"), "fulfillment"), "purchase_limit"));
        if (limit !== null) limits.push(limit);
      }
    };
    let budget = TARGET_NEXT_DATA_MAX_NODES;
    const visit = (value, depth) => {
      if (!value || typeof value !== "object" || depth > 64 || budget <= 0) return;
      budget -= 1;
      if (Array.isArray(value)) {
        for (const entry of value) visit(entry, depth + 1);
        return;
      }
      if (objectField(value, "module_type") === "ProductDetailWebDatasourceCore") {
        productLimit(objectField(objectField(objectField(value, "module_data"), "data"), "product"));
        return;
      }
      for (const entry of Object.values(value)) visit(entry, depth + 1);
    };
    visit(data, 0);
    return limits.length ? Math.min(...limits) : null;
  }
  var TARGET_LIMIT_MESSAGE_SELECTOR = "[data-test*='quantityLimit' i], [data-test*='purchaseLimit' i], [data-test*='limitMessage' i], [data-testid*='quantityLimit' i], [data-testid*='purchaseLimit' i]";
  function targetBuyBoxLimitText(document) {
    const regions = [...new Set(document.querySelectorAll(TARGET_FULFILLMENT_ROOT_SELECTOR))].filter((region) => visible2(region) && !recommendationControl(region));
    const roots = [
      targetAddModule(document),
      ...regions.filter((region) => !regions.some((other) => other !== region && other.contains(region))),
      ...[...document.querySelectorAll(TARGET_LIMIT_MESSAGE_SELECTOR)].filter((element) => visible2(element) && !recommendationControl(element))
    ].filter((root) => Boolean(root));
    const limits = roots.map((root) => targetLimitFromText(observableText(root, 2e3))).filter((limit) => limit !== null);
    return limits.length ? Math.min(...limits) : null;
  }
  function targetPurchaseLimit(document, urlValue, expectedSku, environment) {
    if (environment) return withAdapterEnvironment(environment, () => targetPurchaseLimit(document, urlValue, expectedSku));
    if (!/^\d{6,}$/.test(expectedSku) || extractTargetSku(urlValue) !== expectedSku) return null;
    const limits = [targetNextDataPurchaseLimit(document, expectedSku), targetBuyBoxLimitText(document)].filter((limit2) => limit2 !== null);
    const limit = limits.length ? Math.min(...limits) : null;
    recordTrace({ step: "quantity", condition: "target.purchaseLimit", actual: limit === null ? "unknown" : String(limit), passed: true });
    return limit;
  }
  var TARGET_CART_LINE_SELECTOR = "[data-test='cart-item'], [data-test='cartItem'], [data-testid='cart-item'], [data-tcin][data-cart-line]";
  function cartLinkTcin(anchor) {
    const href = String(anchor.href || anchor.getAttribute("href") || "");
    const pathSku = extractTargetSku(href);
    if (!pathSku) return "";
    try {
      const preselect = String(new URL(href).searchParams.get("preselect") || "");
      return /^\d{6,}$/.test(preselect) ? preselect : pathSku;
    } catch {
      return "";
    }
  }
  function cartLineTcins(line) {
    const tcins = /* @__PURE__ */ new Set();
    const add = (value) => {
      const tcin = String(value ?? "").trim();
      if (/^\d{6,}$/.test(tcin)) tcins.add(tcin);
    };
    add(line.getAttribute("data-tcin"));
    for (const element of line.querySelectorAll("[data-tcin]")) {
      if (!recommendationControl(element)) add(element.getAttribute("data-tcin"));
    }
    for (const anchor of line.querySelectorAll("a[href]")) {
      if (!recommendationControl(anchor)) add(cartLinkTcin(anchor));
    }
    for (const input of line.querySelectorAll("input[name='tcin' i]")) add(input.value);
    return tcins;
  }
  function cartLineElements(document) {
    const candidates = [...document.querySelectorAll(TARGET_CART_LINE_SELECTOR)].filter(visible2);
    return candidates.filter((candidate) => !candidates.some((other) => other !== candidate && other.contains(candidate)));
  }
  function targetCartLines(document) {
    return cartLineElements(document).map((element) => {
      const tcins = [...cartLineTcins(element)];
      return { element, sku: tcins.length === 1 ? tcins[0] ?? "" : "", tcins };
    });
  }
  var CART_QUANTITY_HINT = /qty|quantity/i;
  var CART_INCREASE_PATTERN = /\b(?:increase|increment|add one|add 1|plus)\b/i;
  var CART_DECREASE_PATTERN = /\b(?:decrease|decrement|remove one|remove 1|subtract|minus)\b/i;
  var CART_LIMIT_TEXT_SKIP = (element) => element.tagName === "A" || /title|name/i.test(`${element.getAttribute("data-test") || ""} ${element.getAttribute("data-testid") || ""}`);
  var CART_OPTION_PATTERN = /^\s*(?:qty|quantity)?\s*:?\s*(\d{1,2})\s*$/i;
  function cartQuantityHinted(element) {
    return ["name", "id", "aria-label", "data-test", "data-testid", "title"].some((attribute) => CART_QUANTITY_HINT.test(element.getAttribute(attribute) || ""));
  }
  function cartQuantityLabelled(element, line) {
    if (cartQuantityHinted(element)) return true;
    const id = element.getAttribute("id");
    if (id && [...line.querySelectorAll("label[for]")].some((label) => label.getAttribute("for") === id && CART_QUANTITY_HINT.test(text(label, 100)))) return true;
    for (let node = element.parentElement; node && node !== line && line.contains(node); node = node.parentElement) {
      if (cartQuantityHinted(node) || node.tagName === "LABEL" && CART_QUANTITY_HINT.test(text(node, 100))) return true;
    }
    return false;
  }
  function boundedQuantity(value) {
    const quantity = Number(value);
    return Number.isInteger(quantity) && quantity >= 1 && quantity <= 99 ? quantity : null;
  }
  function targetCartOptionQuantity(option) {
    const sources = option.tagName === "OPTION" ? [option.value, text(option, 40)] : [text(option, 40), option.getAttribute("aria-label"), option.getAttribute("data-value")];
    for (const source of sources) {
      const quantity = boundedQuantity(CART_OPTION_PATTERN.exec(String(source ?? ""))?.[1]);
      if (quantity !== null) return quantity;
    }
    return null;
  }
  function cartQuantityText(value, loneNumber = false) {
    const normalized = String(value ?? "").replace(/[,|]/g, " ").replace(/\s+/g, " ").trim();
    const strict = parseQuantityText(normalized);
    if (strict !== null || !loneNumber) return strict;
    const numbers = [...new Set(normalized.match(/\d+(?:[.,]\d+)?/g) ?? [])];
    return numbers.length === 1 && /^\d{1,2}$/.test(numbers[0] ?? "") ? boundedQuantity(numbers[0]) : null;
  }
  function cartFieldQuantity(field) {
    if (field.tagName === "SELECT") {
      const select = field;
      const option = select.options[select.selectedIndex];
      return option ? targetCartOptionQuantity(option) : null;
    }
    if (field.tagName === "INPUT") {
      const value = String(field.value ?? "").trim();
      return /^\d{1,2}$/.test(value) ? boundedQuantity(value) : null;
    }
    const valueNow = field.getAttribute("aria-valuenow");
    return valueNow !== null && /^\s*\d{1,2}\s*$/.test(valueNow) ? boundedQuantity(valueNow.trim()) : null;
  }
  function cartFieldLimit(field) {
    if (field.tagName === "SELECT") {
      const options = [...field.options].filter((option) => !option.disabled).map(targetCartOptionQuantity).filter((quantity) => quantity !== null);
      return options.length ? Math.max(...options) : null;
    }
    const maximum = String(field.getAttribute("max") ?? field.getAttribute("aria-valuemax") ?? "").trim();
    return /^\d{1,2}$/.test(maximum) ? boundedQuantity(maximum) : null;
  }
  function cartStepperLabel(value, verbs) {
    const label = value.replace(/\s+/g, " ").trim();
    return verbs.test(label) && (CART_QUANTITY_HINT.test(label) || label.split(" ").length <= 3);
  }
  function cartStepperDirection(button) {
    const labels = [button.getAttribute("aria-label"), button.getAttribute("title"), text(button, 100)].map((label) => String(label || "")).filter(Boolean);
    const own = text(button, 10);
    if (own === "+" || labels.some((label) => cartStepperLabel(label, CART_INCREASE_PATTERN))) return "increase";
    if (/^[-\u2212\u2013]$/.test(own) || labels.some((label) => cartStepperLabel(label, CART_DECREASE_PATTERN))) return "decrease";
    return "";
  }
  function cartDisabled(element) {
    return element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";
  }
  function cartStepperRoot(button, buttons, line) {
    let hinted = null;
    for (let node = button.parentElement; node && node !== line && line.contains(node); node = node.parentElement) {
      if (buttons.some((other) => other !== button && node.contains(other))) return node;
      if (!hinted && (cartQuantityHinted(node) || node.getAttribute("role") === "group" || /stepper/i.test(`${node.getAttribute("data-test") || ""} ${node.getAttribute("data-testid") || ""}`))) hinted = node;
    }
    return hinted ?? (button.parentElement && button.parentElement !== line ? button.parentElement : line);
  }
  function cartStepperQuantity(root) {
    const fields = [...root.querySelectorAll("input:not([type='hidden']), select, [role='spinbutton'], [aria-valuenow]")].filter(visible2);
    if (fields.length) {
      const values = fields.map(cartFieldQuantity);
      return values.every((value) => value !== null && value === values[0]) ? values[0] ?? null : null;
    }
    const valueNow = root.getAttribute("aria-valuenow");
    if (valueNow !== null && valueNow.trim()) return cartQuantityText(valueNow);
    const isButton = (element) => element.tagName === "BUTTON" || element.getAttribute("role") === "button";
    return cartQuantityText(observableText(root, 300, isButton), true);
  }
  function cartDropdownTrigger(element, line) {
    if (element.tagName === "INPUT" || element.tagName === "SELECT" || cartStepperDirection(element)) return false;
    const role = element.getAttribute("role");
    const popup = String(element.getAttribute("aria-haspopup") || "").toLocaleLowerCase("en-US");
    return (role === "combobox" || (element.tagName === "BUTTON" || role === "button") && popup !== "" && popup !== "false") && (cartQuantityLabelled(element, line) || CART_QUANTITY_HINT.test(text(element, 60)));
  }
  function cartDropdownQuantity(trigger) {
    const values = [cartQuantityText(trigger.getAttribute("aria-label"), true), cartQuantityText(text(trigger, 60), true)].filter((value) => value !== null);
    return values.length && values.every((value) => value === values[0]) ? values[0] ?? null : null;
  }
  function probeCartQuantity(line) {
    const usable = (element) => visible2(element) && !recommendationControl(element);
    const lineLimit = targetLimitFromText(observableText(line, 1500, CART_LIMIT_TEXT_SKIP), true);
    const limitOf = (own) => {
      const limits = [own, lineLimit].filter((limit) => limit !== null);
      return limits.length ? Math.min(...limits) : null;
    };
    const buttons = [...line.querySelectorAll("button, [role='button']")].filter(usable);
    const stepperButtons = buttons.filter((button) => cartStepperDirection(button) !== "");
    const stepperRoots = [...new Set(stepperButtons.map((button) => cartStepperRoot(button, stepperButtons, line)))];
    const insideStepper = (element) => stepperRoots.some((root) => root.contains(element));
    const controls = [];
    for (const select of line.querySelectorAll("select")) {
      if (!usable(select) || insideStepper(select)) continue;
      const options = [...select.options];
      if (!cartQuantityLabelled(select, line) && !(options.length > 1 && options.every((option) => targetCartOptionQuantity(option) !== null))) continue;
      controls.push({ kind: "select", control: select, increase: null, quantity: cartFieldQuantity(select), storeLimit: limitOf(cartFieldLimit(select)) });
    }
    for (const input of line.querySelectorAll("input, [role='spinbutton']")) {
      const type = String(input.getAttribute("type") || "text").toLocaleLowerCase("en-US");
      if (!usable(input) || insideStepper(input) || !["text", "number", "tel", ""].includes(input.tagName === "INPUT" ? type : "")) continue;
      if (input.getAttribute("role") !== "spinbutton" && type !== "number" && !cartQuantityLabelled(input, line)) continue;
      controls.push({ kind: "input", control: input, increase: null, quantity: cartFieldQuantity(input), storeLimit: limitOf(cartFieldLimit(input)) });
    }
    for (const root of stepperRoots) {
      const own = stepperButtons.filter((button) => root.contains(button));
      const increases = own.filter((button) => cartStepperDirection(button) === "increase");
      const increase = increases.length === 1 ? increases[0] ?? null : null;
      const quantity = cartStepperQuantity(root);
      controls.push({
        kind: "stepper",
        control: root,
        increase,
        quantity: increases.length > 1 ? null : quantity,
        storeLimit: limitOf(increase && cartDisabled(increase) ? quantity : null)
      });
    }
    for (const trigger of line.querySelectorAll("button, [role='button'], [role='combobox']")) {
      if (!usable(trigger) || insideStepper(trigger) || !cartDropdownTrigger(trigger, line)) continue;
      controls.push({ kind: "dropdown", control: trigger, increase: null, quantity: cartDropdownQuantity(trigger), storeLimit: lineLimit });
    }
    if (controls.length) {
      const readings = controls.map((control) => control.quantity);
      const agreed = readings.every((reading) => reading !== null && reading === readings[0]) ? readings[0] ?? null : null;
      return { controls, quantity: agreed };
    }
    const displays = [...line.querySelectorAll("*")].filter((element) => usable(element) && cartQuantityHinted(element) && !element.querySelector("select, input, button, [role='button'], [role='combobox'], [role='spinbutton']")).map((element) => ({ element, quantity: cartQuantityText(text(element, 100)) ?? cartQuantityText(element.getAttribute("aria-label")) })).filter((entry) => entry.quantity !== null);
    if (displays.length) {
      const agreed = displays.every((entry) => entry.quantity === displays[0]?.quantity) ? displays[0]?.quantity ?? null : null;
      return {
        controls: displays.length === 1 && displays[0] ? [{ kind: "display", control: displays[0].element, increase: null, quantity: displays[0].quantity, storeLimit: lineLimit }] : [],
        quantity: agreed
      };
    }
    return { controls: [], quantity: void 0 };
  }
  function targetElementVisible(element) {
    return visible2(element);
  }
  function targetCartQuantityControl(line) {
    const { controls } = probeCartQuantity(line);
    return controls.length === 1 ? controls[0] ?? null : null;
  }
  function lineQuantity(line) {
    const probe = probeCartQuantity(line);
    if (probe.quantity !== void 0) return probe.quantity;
    return readControlQuantity(queryVisible(line, TARGET_QUANTITY_SELECTORS));
  }
  var TARGET_CART_PRICE_SELECTORS = ["[data-test*='price' i]", "[itemprop='price']"];
  var TARGET_CART_UNIT_PRICE_SELECTORS = [
    "[data-test*='unit-price' i]",
    "[data-test*='unitprice' i]",
    "[data-testid*='unit-price' i]",
    "[data-testid*='unitprice' i]"
  ];
  function targetLineUnitPrice(line, quantity) {
    const first = readPrice(line, TARGET_CART_PRICE_SELECTORS);
    if (quantity === null || quantity <= 1) return first;
    const marked = readPrice(line, TARGET_CART_UNIT_PRICE_SELECTORS);
    if (marked !== null) return marked;
    const each = observableText(line, 3e3).match(/\$\s*([0-9]{1,7}(?:,[0-9]{3})*(?:\.[0-9]{2})?)\s*(?:\/\s*)?(?:ea|each)\b/i);
    const eachPrice = each ? parseUsPrice(`$${each[1]}`) : null;
    if (eachPrice !== null) return eachPrice;
    if (first === null) return null;
    const prices = [...new Set([...line.querySelectorAll(TARGET_CART_PRICE_SELECTORS.join(", "))].filter((element) => visible2(element) && !recommendationControl(element)).map((element) => parseUsPrice(text(element, 300))).filter((price) => price !== null))];
    return prices.find((price) => prices.includes(price * quantity)) ?? first;
  }
  var TARGET_EMPTY_CART_PATTERN = /\b(?:your\s+)?(?:shopping\s+)?cart\s+is\s+(?:currently\s+)?empty\b|\byour\s+cart(?:’|')?s\s+empty\b|\bno\s+items\s+in\s+(?:your\s+)?(?:shopping\s+)?cart\b|\bcart\s+has\s+no\s+items\b|\byou\s+have\s+no\s+items\s+in\s+your\s+cart\b/i;
  function targetCartVisiblyEmpty(document) {
    const roots = [...document.querySelectorAll([
      "[data-test*='empty-cart' i]",
      "[data-testid*='empty-cart' i]",
      "[data-test*='emptycart' i]",
      "[data-testid*='emptycart' i]",
      "[data-test='cart-empty']",
      "main",
      "[role='main']"
    ].join(", "))].filter(visible2);
    return roots.some((root) => TARGET_EMPTY_CART_PATTERN.test(observableText(root, 2e4)));
  }
  function observeTargetCart(document, observedAt = (/* @__PURE__ */ new Date()).toISOString()) {
    const cartLines = targetCartLines(document);
    const lines = cartLines.map(({ element, sku }) => {
      const seller = sellerEvidence(document, element);
      const quantity = lineQuantity(element);
      return {
        retailerSku: sku,
        quantity,
        unitPriceCents: targetLineUnitPrice(element, quantity),
        sellerName: seller.sellerName,
        sellerType: seller.sellerType
      };
    });
    const independentlyCounted = cartLines.length > 0 ? new Set(cartLines.map((line) => line.element)).size === cartLines.length : targetCartVisiblyEmpty(document);
    return {
      contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
      observedAt,
      complete: independentlyCounted && lines.every((line) => Boolean(line.retailerSku)),
      independentlyCounted,
      independentLineCount: cartLines.length,
      lines
    };
  }

  // apps/extension/src/target-action.ts
  var AUTHORIZATION_MAX_AGE_MS = 1e4;
  var FULFILLMENT_SELECTION_MAX_WAIT_MS = 5e3;
  var sequence = 0;
  var pending = null;
  function traceElement(environment, condition, element) {
    if (!environment?.trace) return;
    const attributes = ["id", "name", "type", "role", "data-test", "data-testid", "data-test-id", "data-automation-id", "aria-label"].map((name) => element?.hasAttribute(name) ? `${name}=${JSON.stringify(String(element.getAttribute(name)).slice(0, 80))}` : "").filter(Boolean).join(" ");
    const content = String(element?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
    environment.trace.record({
      step: "add_control",
      condition,
      actual: element ? `${element.tagName.toLocaleLowerCase("en-US")} ${attributes} ${content}`.trim() : "missing"
    });
  }
  function targetJobReason(job) {
    if (job?.adapterVersion !== TARGET_ADD_ADAPTER_VERSION) return "adapter_version_mismatch";
    if (job?.retailerId !== "target" || job?.action !== "add_to_cart") return "unsupported_action";
    if (!guardedCartQuantity(job?.quantity)) return "quantity_not_supported";
    if (job?.sellerPolicy !== "first_party_only") return "seller_policy_not_supported";
    if (job?.fulfillment !== "shipping" && job?.fulfillment !== "pickup") return "fulfillment_not_supported";
    return "";
  }
  function authorizationId(now) {
    sequence += 1;
    return `target_add_${now.toString(36)}_${sequence.toString(36)}`;
  }
  function targetOfferReason(reason, observation) {
    return reason === "out_of_stock" && observation.availability === "unknown" ? "add_control_unavailable" : reason;
  }
  function targetQuantityPlan(documentValue, urlValue, job, environment) {
    const storeLimit = targetPurchaseLimit(documentValue, urlValue, job.retailerSku, environment);
    return { requested: job.quantity, storeLimit, add: 1, raiseTo: Math.min(job.quantity, storeLimit ?? job.quantity) };
  }
  function abandonTargetAdd(value) {
    if (!pending || pending.id !== value) return false;
    pending = null;
    return true;
  }
  function prepareTargetAdd(documentValue, urlValue, job, now = Date.now(), environment) {
    pending = null;
    const invalid = targetJobReason(job);
    if (invalid) return { ok: false, reason: invalid };
    const observation = observeTargetOffer(
      documentValue,
      urlValue,
      job.retailerSku,
      job.fulfillment,
      new Date(now).toISOString(),
      environment
    );
    const verified = verifyLiveOffer(job, observation, now);
    if (!verified.ok) return { ok: false, reason: targetOfferReason(verified.reason, observation) };
    const binding = targetAddBinding(documentValue, urlValue, job.retailerSku, job.fulfillment, environment);
    if (!binding.control || binding.fulfillment !== job.fulfillment || binding.selectionRequired && !binding.fulfillmentControl) {
      return { ok: false, reason: "add_control_unavailable" };
    }
    const id = authorizationId(now);
    pending = {
      id,
      jobId: job.jobId,
      createdAt: now,
      control: binding.control,
      fulfillmentControl: binding.fulfillmentControl,
      selectionRequired: binding.selectionRequired,
      offerRoot: binding.offerRoot,
      proof: verified.proof,
      document: documentValue,
      jobSnapshot: JSON.stringify(job)
    };
    return {
      ok: true,
      reason: "verified",
      authorizationId: id,
      proof: verified.proof,
      ...job.quantity > 1 ? { quantity: targetQuantityPlan(documentValue, urlValue, job, environment) } : {}
    };
  }
  function rehearseTargetAdd(documentValue, urlValue, job, now = Date.now(), environment) {
    const prepared = prepareTargetAdd(documentValue, urlValue, { ...job, validationMode: "rehearsal" }, now, environment);
    if (!prepared.ok) return prepared;
    abandonTargetAdd(prepared.authorizationId);
    return { ok: true, reason: "verified", proof: prepared.proof, wouldClick: true };
  }
  async function waitForSelectedFulfillmentBinding(documentValue, urlValue, job, environment) {
    const deadline = Date.now() + FULFILLMENT_SELECTION_MAX_WAIT_MS;
    while (Date.now() <= deadline) {
      if (targetSecurityChallenge(documentValue) || targetInteractiveBlock(documentValue, environment)) return null;
      const binding = targetAddBinding(documentValue, urlValue, job.retailerSku, job.fulfillment, environment);
      if (binding.control && binding.fulfillment === job.fulfillment && !binding.selectionRequired) return binding;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  }
  async function commitTargetAdd(documentValue, urlValue, job, value, now = Date.now(), environment) {
    const startedAt = Date.now();
    const authorization = pending;
    pending = null;
    if (job.validationMode === "rehearsal" || !job.officialMsrp) {
      return { ok: false, reason: "official_msrp_authorization_missing", clicked: false };
    }
    if (!authorization || authorization.id !== value || authorization.jobId !== job.jobId) {
      return { ok: false, reason: "authorization_missing", clicked: false };
    }
    if (now < authorization.createdAt || now - authorization.createdAt > AUTHORIZATION_MAX_AGE_MS) {
      return { ok: false, reason: "authorization_expired", clicked: false };
    }
    if (documentValue !== authorization.document || JSON.stringify(job) !== authorization.jobSnapshot) {
      return { ok: false, reason: "offer_binding_changed", clicked: false };
    }
    const invalid = targetJobReason(job);
    if (invalid) return { ok: false, reason: invalid, clicked: false };
    const beforeSelection = observeTargetOffer(
      documentValue,
      urlValue,
      job.retailerSku,
      job.fulfillment,
      new Date(now).toISOString(),
      environment
    );
    const initiallyVerified = verifyLiveOffer(job, beforeSelection, now);
    if (!initiallyVerified.ok) {
      return { ok: false, reason: targetOfferReason(initiallyVerified.reason, beforeSelection), clicked: false };
    }
    let binding = targetAddBinding(documentValue, urlValue, job.retailerSku, job.fulfillment, environment);
    if (!binding.control || binding.control !== authorization.control || binding.fulfillmentControl !== authorization.fulfillmentControl || binding.selectionRequired !== authorization.selectionRequired || binding.offerRoot !== authorization.offerRoot) {
      traceElement(environment, "authorized", authorization.control);
      traceElement(environment, "rebound", binding.control);
      return { ok: false, reason: "add_control_changed", clicked: false };
    }
    if (binding.selectionRequired) {
      try {
        binding.fulfillmentControl.click();
      } catch {
        return { ok: false, reason: "fulfillment_selection_failed", clicked: false };
      }
      const selected = await waitForSelectedFulfillmentBinding(documentValue, urlValue, job, environment);
      if (!selected) return { ok: false, reason: "fulfillment_selection_failed", clicked: false };
      if (!selected.offerRoot || selected.offerRoot !== authorization.offerRoot || !selected.control || !targetOfferOwnsControl(authorization.offerRoot, selected.control, job.retailerSku)) {
        traceElement(environment, "authorized", authorization.control);
        traceElement(environment, "rebound", selected.control);
        return { ok: false, reason: "add_control_changed", clicked: false };
      }
      binding = selected;
    }
    const finalNow = now + Math.max(0, Date.now() - startedAt);
    if (finalNow - authorization.createdAt > AUTHORIZATION_MAX_AGE_MS) {
      return { ok: false, reason: "authorization_expired", clicked: false };
    }
    const observation = observeTargetOffer(
      documentValue,
      urlValue,
      job.retailerSku,
      job.fulfillment,
      new Date(finalNow).toISOString(),
      environment
    );
    const verified = verifyLiveOffer(job, observation, finalNow);
    if (!verified.ok) return { ok: false, reason: targetOfferReason(verified.reason, observation), clicked: false };
    const control = binding.control;
    if (!control) return { ok: false, reason: "add_control_unavailable", clicked: false };
    try {
      control.click();
      return { ok: true, reason: "clicked", clicked: true, proof: verified.proof };
    } catch {
      return { ok: false, reason: "click_failed", clicked: false };
    }
  }
  function targetCartUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && (url.hostname === "target.com" || url.hostname.endsWith(".target.com")) && targetPageKind(value) === "cart";
    } catch {
      return false;
    }
  }
  function inspectTargetCartBaseline(documentValue, urlValue, now = Date.now()) {
    if (!targetCartUrl(urlValue)) return { ok: false, reason: "cart_page_unverified" };
    if (targetSecurityChallenge(documentValue) || targetInteractiveBlock(documentValue)) {
      return { ok: false, reason: "manual_action_required" };
    }
    return captureCartBaseline(
      "target",
      observeTargetCart(documentValue, new Date(now).toISOString()),
      now
    );
  }
  function verifyTargetAddedCart(documentValue, urlValue, job, proof, baseline, now = Date.now()) {
    if (!targetCartUrl(urlValue)) return { ok: false, reason: "cart_page_unverified" };
    if (targetSecurityChallenge(documentValue) || targetInteractiveBlock(documentValue)) {
      return { ok: false, reason: "manual_action_required" };
    }
    const inventory = observeTargetCart(documentValue, new Date(now).toISOString());
    const verified = verifyCartAddDelta(job, baseline, inventory, proof, now);
    if (!verified.ok) return verified;
    const nextBaseline = captureCartBaseline("target", inventory, now);
    return {
      ...verified,
      ...nextBaseline.ok ? { cartBaseline: nextBaseline.proof } : {}
    };
  }
  var RAISE_MAX_MS = 7500;
  var RAISE_LINE_WAIT_MS = 1500;
  var RAISE_LISTBOX_WAIT_MS = 1500;
  var RAISE_STEP_WAIT_MS = 2500;
  var RAISE_SETTLE_MS = 800;
  var RAISE_POLL_MS = 50;
  var RAISE_FORBIDDEN_ATTRIBUTE = /check\s*out|place\s*order|buy\s*now|remove|delete|save\s*for\s*later|empty\s*cart/i;
  var RAISE_FORBIDDEN_LABEL = /^\s*(?:check\s*out|place\s+(?:your\s+)?order|buy\s+now|pay|remove|delete|save\s+for\s+later|move\s+to|empty)\b/i;
  function boundedMs(value, maximum) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(value, maximum) : maximum;
  }
  function lowerLimit(...limits) {
    const known = limits.filter((limit) => typeof limit === "number");
    return known.length ? Math.min(...known) : null;
  }
  function pause(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(1, ms)));
  }
  function exactCartLine(documentValue, sku) {
    const lines = targetCartLines(documentValue).filter((line) => line.tcins.includes(sku));
    return lines.length === 1 && lines[0]?.sku === sku ? lines[0].element : null;
  }
  function lineState(documentValue, sku) {
    const line = exactCartLine(documentValue, sku);
    if (!line) return null;
    const control = targetCartQuantityControl(line);
    return { line, control, quantity: control?.quantity ?? null };
  }
  async function waitForLine(context, until, done) {
    let state = lineState(context.documentValue, context.sku);
    while (!done(state) && Date.now() < until) {
      await pause(Math.min(context.pollMs, until - Date.now()));
      state = lineState(context.documentValue, context.sku);
    }
    return state;
  }
  function controlBusy(state) {
    const element = state?.control?.control;
    return Boolean(element && (element.hasAttribute("disabled") || element.getAttribute("aria-busy") === "true" || state?.line.getAttribute("aria-busy") === "true"));
  }
  async function settledQuantity(context, expected) {
    let last;
    let since = Date.now();
    for (; ; ) {
      const state = lineState(context.documentValue, context.sku);
      const quantity = state?.quantity ?? null;
      const busy = controlBusy(state);
      if (quantity !== last || busy) {
        last = quantity;
        since = Date.now();
      }
      if (quantity === expected && !busy && Date.now() - since >= context.settleMs) return quantity;
      if (Date.now() >= context.deadline) return quantity;
      await pause(Math.min(context.pollMs, context.deadline - Date.now()));
    }
  }
  function raiseClickAllowed(element, scope) {
    if (!element || !scope.contains(element) || element.closest("a[href]") || element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") return false;
    if (["id", "name", "data-test", "data-testid"].some((name) => RAISE_FORBIDDEN_ATTRIBUTE.test(element.getAttribute(name) || ""))) return false;
    return ![element.getAttribute("aria-label"), element.getAttribute("title"), String(element.textContent || "").slice(0, 200)].some((label) => RAISE_FORBIDDEN_LABEL.test(String(label || "")));
  }
  function raiseOutcome(context, reached, limitHit, storeLimit) {
    if (reached === null) return { ok: false, reason: "cart_unverified", storeLimit };
    const shown = lineState(context.documentValue, context.sku)?.control?.storeLimit ?? null;
    if (shown !== null && shown <= reached) {
      limitHit = true;
      storeLimit = lowerLimit(storeLimit, shown);
    }
    if (reached > context.target || reached < context.start) return { ok: false, reason: "cart_delta_unverified", quantity: reached, storeLimit };
    if (reached === context.desired || reached === context.target || limitHit && reached > context.start) {
      return { ok: true, reason: "quantity_set", quantity: reached, storeLimit };
    }
    return { ok: false, reason: limitHit ? "quantity_limit_reached" : "quantity_unchanged", quantity: reached, storeLimit };
  }
  function unavailable(context, storeLimit = context.control.storeLimit) {
    return { ok: false, reason: "quantity_control_unavailable", quantity: context.start, storeLimit };
  }
  function notifyQuantityControl(control, type) {
    const view = control.ownerDocument.defaultView;
    if (view) control.dispatchEvent(new view.Event(type, { bubbles: true }));
  }
  function setNativeValue(control, value) {
    const view = control.ownerDocument.defaultView;
    const prototype = control.tagName === "SELECT" ? view?.HTMLSelectElement.prototype : control.tagName === "INPUT" ? view?.HTMLInputElement.prototype : void 0;
    const setter = prototype ? Object.getOwnPropertyDescriptor(prototype, "value")?.set : void 0;
    if (!setter) return false;
    setter.call(control, value);
    return control.value === value;
  }
  async function raiseNativeControl(context) {
    const element = context.control.control;
    if (!["SELECT", "INPUT"].includes(element.tagName) || !context.line.contains(element) || element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true" || element.hasAttribute("readonly")) return unavailable(context);
    const field = element;
    let value = String(context.desired);
    if (field.tagName === "SELECT") {
      const options = [...field.options].filter((option) => !option.disabled && targetCartOptionQuantity(option) === context.desired);
      if (options.length !== 1 || !options[0]) return unavailable(context);
      value = options[0].value;
    } else {
      field.focus();
    }
    if (!setNativeValue(field, value)) return unavailable(context);
    notifyQuantityControl(field, "input");
    notifyQuantityControl(field, "change");
    if (field.tagName === "INPUT") field.blur();
    return raiseOutcome(context, await settledQuantity(context, context.desired), false, context.control.storeLimit);
  }
  function linkedListbox(trigger, line) {
    const documentValue = trigger.ownerDocument;
    const named = `${trigger.getAttribute("aria-controls") || ""} ${trigger.getAttribute("aria-owns") || ""}`.split(/\s+/).filter(Boolean).map((id2) => documentValue.getElementById(id2)).map((element) => element?.getAttribute("role") === "listbox" ? element : element?.querySelectorAll("[role='listbox']").length === 1 ? element.querySelector("[role='listbox']") : null);
    const id = trigger.getAttribute("id");
    const labelled = id ? [...documentValue.querySelectorAll("[role='listbox'][aria-labelledby]")].filter((listbox) => String(listbox.getAttribute("aria-labelledby")).split(/\s+/).includes(id)) : [];
    const candidates = [.../* @__PURE__ */ new Set([...named, ...labelled, ...line.querySelectorAll("[role='listbox']")])].filter((listbox) => Boolean(listbox) && targetElementVisible(listbox));
    return candidates.length === 1 ? candidates[0] ?? null : null;
  }
  async function raiseDropdown(context) {
    const trigger = context.control.control;
    if (!raiseClickAllowed(trigger, context.line)) return unavailable(context);
    if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
    const close = () => {
      if (trigger.isConnected && trigger.getAttribute("aria-expanded") === "true" && raiseClickAllowed(trigger, context.line)) trigger.click();
    };
    const until = Math.min(context.deadline, Date.now() + RAISE_LISTBOX_WAIT_MS);
    let listbox = linkedListbox(trigger, context.line);
    while (!listbox && Date.now() < until) {
      await pause(Math.min(context.pollMs, until - Date.now()));
      listbox = linkedListbox(trigger, context.line);
    }
    if (!listbox) {
      close();
      return unavailable(context);
    }
    const options = [...listbox.querySelectorAll("[role='option']")].filter((option) => targetElementVisible(option)).map((option) => ({ option, quantity: targetCartOptionQuantity(option) })).filter((entry) => entry.quantity !== null);
    if (!options.length) {
      close();
      return unavailable(context);
    }
    const storeLimit = lowerLimit(context.control.storeLimit, Math.max(...options.map((entry) => entry.quantity)));
    const desired = Math.min(context.target, storeLimit ?? context.target);
    if (desired <= context.start) {
      close();
      return { ok: false, reason: "quantity_limit_reached", quantity: context.start, storeLimit };
    }
    const choices = options.filter((entry) => entry.quantity === desired);
    const choice = choices.length === 1 ? choices[0]?.option ?? null : null;
    if (!raiseClickAllowed(choice, listbox)) {
      close();
      return unavailable(context, storeLimit);
    }
    choice.click();
    const raised = { ...context, desired };
    return raiseOutcome(raised, await settledQuantity(raised, desired), false, storeLimit);
  }
  async function raiseStepper(context) {
    let reached = context.start;
    let storeLimit = context.control.storeLimit;
    let limitHit = false;
    while (reached < context.desired && Date.now() < context.deadline) {
      const state = lineState(context.documentValue, context.sku);
      const control = state?.control;
      if (!state || control?.kind !== "stepper" || control.quantity !== reached) {
        return raiseOutcome(context, control?.quantity ?? null, false, storeLimit);
      }
      storeLimit = lowerLimit(storeLimit, control.storeLimit);
      const increase = control.increase;
      if (storeLimit !== null && reached >= storeLimit || increase && cartControlDisabled(increase)) {
        storeLimit = lowerLimit(storeLimit, reached);
        limitHit = true;
        break;
      }
      if (!raiseClickAllowed(increase, state.line)) return reached > context.start ? raiseOutcome(context, reached, false, storeLimit) : unavailable(context, storeLimit);
      increase.click();
      const before = reached;
      const next = await waitForLine(
        context,
        Math.min(context.deadline, Date.now() + context.stepWaitMs),
        (candidate) => candidate?.quantity !== null && candidate?.quantity !== void 0 && candidate.quantity !== before
      );
      const quantity = next?.quantity ?? null;
      if (quantity === null || quantity === before) {
        const after = next?.control;
        if (after?.storeLimit !== null && after?.storeLimit !== void 0 && after.storeLimit <= before || after?.increase && cartControlDisabled(after.increase)) {
          storeLimit = lowerLimit(storeLimit, after?.storeLimit, before);
          limitHit = true;
        }
        break;
      }
      reached = quantity;
      if (reached !== before + 1) break;
    }
    const settled = reached > context.start ? await settledQuantity(context, reached) : reached;
    return raiseOutcome(context, settled, limitHit, storeLimit);
  }
  function cartControlDisabled(element) {
    return element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";
  }
  function raiseInputValid(job, input) {
    const baseline = input?.baselineQuantity;
    const current = input?.currentQuantity;
    const target = input?.targetQuantity;
    return Number.isInteger(baseline) && Number.isInteger(current) && Number.isInteger(target) && baseline >= 0 && current > baseline && current <= target && target <= 99 && target - baseline <= job.quantity;
  }
  async function raiseTargetCartQuantity(documentValue, urlValue, job, input, timing = {}) {
    const deadline = Date.now() + boundedMs(timing.maxMs, RAISE_MAX_MS);
    if (!targetCartUrl(urlValue)) return { ok: false, reason: "cart_page_unverified" };
    const invalid = targetJobReason(job);
    if (invalid) return { ok: false, reason: invalid };
    if (!raiseInputValid(job, input)) return { ok: false, reason: "quantity_invalid" };
    if (targetSecurityChallenge(documentValue) || targetInteractiveBlock(documentValue)) {
      return { ok: false, reason: "manual_action_required" };
    }
    const probe = {
      documentValue,
      sku: job.retailerSku,
      pollMs: Math.max(1, boundedMs(timing.pollMs, RAISE_POLL_MS))
    };
    const initial = await waitForLine(
      probe,
      Math.min(deadline, Date.now() + RAISE_LINE_WAIT_MS),
      (state) => state !== null && state.quantity !== null
    );
    if (!initial) return { ok: false, reason: "quantity_line_ambiguous" };
    const control = initial.control;
    if (!control || control.quantity === null) return { ok: false, reason: "quantity_control_unavailable" };
    const start = control.quantity;
    const storeLimit = control.storeLimit;
    if (start !== input.currentQuantity) return { ok: false, reason: "cart_delta_unverified", quantity: start, storeLimit };
    const desired = Math.min(input.targetQuantity, storeLimit ?? input.targetQuantity);
    if (desired <= start) {
      return start >= input.targetQuantity ? { ok: true, reason: "quantity_set", quantity: start, storeLimit } : { ok: false, reason: "quantity_limit_reached", quantity: start, storeLimit };
    }
    const context = {
      ...probe,
      line: initial.line,
      control,
      start,
      desired,
      target: input.targetQuantity,
      deadline,
      stepWaitMs: boundedMs(timing.stepWaitMs, RAISE_STEP_WAIT_MS),
      settleMs: boundedMs(timing.settleMs, RAISE_SETTLE_MS)
    };
    if (control.kind === "select" || control.kind === "input") return raiseNativeControl(context);
    if (control.kind === "dropdown") return raiseDropdown(context);
    if (control.kind === "stepper") return raiseStepper(context);
    return unavailable(context);
  }
  Object.defineProperty(globalThis, "YoinkTargetAction", {
    value: Object.freeze({
      abandonTargetAdd,
      commitTargetAdd,
      inspectTargetCartBaseline,
      prepareTargetAdd,
      raiseTargetCartQuantity,
      rehearseTargetAdd,
      verifyTargetAddedCart
    }),
    configurable: true
  });
  return __toCommonJS(target_action_exports);
})();
