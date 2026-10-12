"use strict";
var YoinkBestBuyActionModule = (() => {
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

  // apps/extension/src/bestbuy-action.ts
  var bestbuy_action_exports = {};
  __export(bestbuy_action_exports, {
    abandonBestBuyAdd: () => abandonBestBuyAdd,
    commitBestBuyAdd: () => commitBestBuyAdd,
    inspectBestBuyCartBaseline: () => inspectBestBuyCartBaseline,
    inspectBestBuyPostAdd: () => inspectBestBuyPostAdd,
    prepareBestBuyAdd: () => prepareBestBuyAdd,
    raiseBestBuyCartQuantity: () => raiseBestBuyCartQuantity,
    rehearseBestBuyAdd: () => rehearseBestBuyAdd,
    selectBestBuyShipping: () => selectBestBuyShipping,
    verifyBestBuyAddedCart: () => verifyBestBuyAddedCart
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
    "signal_seller_mismatch",
    "no_featured_offer"
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
      // What Amazon's own "Proceed to checkout" opens: its cart page (2026-10) sends
      // checkout to /checkout/entry/cart and no longer links the old /gp/buy/spc page.
      checkoutUrl: "https://www.amazon.com/checkout/entry/cart?proceedToRetailCheckout=Proceed+to+checkout&ref_=ox_sc_proceed",
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
  var BESTBUY_ADD_ADAPTER_VERSION = "bestbuy-add-v18";
  var EVIDENCE_CAPSULE_MAX_SNAPSHOT_BYTES = 3 * 1024 * 1024;
  var SELECTED_OFFER_SCOPE_VERSION = 1;

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
  function observeAudioAdviceOffer(document, url, variantId, observedAt = (/* @__PURE__ */ new Date()).toISOString(), environment) {
    const binding = audioAdviceOfferBinding(document, url, variantId, environment);
    return {
      contractVersion: 1,
      observedAt,
      url,
      pageKind: audioAdvicePageKind(url),
      retailerId: "audioadvice",
      retailerSku: binding?.variantId || "",
      availability: binding ? "in_stock" : "unknown",
      unitPriceCents: binding?.unitPriceCents ?? null,
      currency: "USD",
      sellerName: binding ? "Audio Advice" : "",
      sellerType: binding ? "first_party" : "unknown",
      fulfillment: binding ? "shipping" : "unknown",
      addControlActionable: Boolean(binding),
      securityChallenge: audioAdviceSecurityChallenge(document, environment),
      interactiveBlock: audioAdviceInteractiveBlock(document, url, environment)
    };
  }

  // packages/browser-adapters/src/bananarepublic.ts
  var CHILD_SKU = /^\d{9}0000$/;
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
    const price = Number(match[1].replace(/,/g, "")) * 100 + Number(match[2]);
    return Number.isSafeInteger(price) && price > 0 ? price : null;
  }
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
  function bananarepublicPageKind(value) {
    const url = bananarepublicUrl(value);
    if (!url) return "other";
    if (/^\/my-account\/(?:sign-in|register)(?:\/|$)/.test(url.pathname)) return "auth";
    if (url.hostname === "secure-bananarepublic.gap.com" && url.pathname === "/shopping-bag") return "cart";
    if (/^\/checkout(?:\/|$)/.test(url.pathname)) return "checkout";
    return bananarepublicUrlSku(value) ? "product" : "other";
  }
  function bananarepublicSecurityChallenge(document, environment) {
    return /(?:verify|confirm) (?:that )?you are (?:a )?human|access denied|you have been blocked|security check|captcha challenge/i.test(text2(document.body, environment)) || elements(document, "iframe[src*='captcha'], iframe[src*='challenge']", environment).length > 0;
  }
  function bananarepublicInteractiveBlock(document, url, environment) {
    if (bananarepublicPageKind(url) === "auth") return "auth";
    if (bananarepublicSecurityChallenge(document, environment)) return "unknown";
    if (/you(?:'|’)re in line|waiting room|please wait in (?:the )?queue/i.test(text2(document.body, environment))) return "queue";
    if (elements(document, "dialog[open], [aria-modal='true'], input[type='password']", environment).length) return "unknown";
    return "";
  }
  function bananarepublicOfferBinding(document, urlValue, expectedSku, environment) {
    const retailerSku = bananarepublicUrlSku(urlValue);
    if (!retailerSku || document.URL !== urlValue || expectedSku !== void 0 && expectedSku !== retailerSku || bananarepublicInteractiveBlock(document, urlValue, environment)) return null;
    const roots = elements(document, "#buy-box-wrapper-id", environment);
    if (roots.length !== 1) return null;
    const root = roots[0];
    const controls = elements(root, "button#pdp-atb-btn[type=button]", environment);
    if (controls.length !== 1) return null;
    const control = controls[0];
    if (text2(control, environment) !== "Add to Bag" || control.matches(":disabled") || control.closest("[aria-disabled=true], [aria-busy=true], [data-isdisabled=true], [data-isloading=true]")) return null;
    const quantities = [...root.querySelectorAll("#AddToBag select")];
    const quantityLabels = elements(root, "#pdp-quantity-selector", environment);
    if (quantities.length !== 1 || quantities[0].value !== "1" || quantityLabels.length !== 1 || text2(quantityLabels[0], environment) !== "1") return null;
    const sizes = [...root.querySelectorAll("input[name=buybox-sizeDimension1]")];
    if (sizes.length !== 1 || !sizes[0].checked || sizes[0].disabled || sizes[0].getAttribute("aria-disabled") === "true" || root.querySelector("input[name=buybox-sizeDimension2]")) return null;
    const sizeLabels = elements(root, "label[for]", environment).filter((label) => label.getAttribute("for") === sizes[0].id);
    if (sizeLabels.length !== 1 || text2(sizeLabels[0], environment) !== "One Size") return null;
    const colors = [...root.querySelectorAll("input[name=buybox-color-swatch]:checked")];
    const colorLabels = elements(root, "[data-testid=pdp-color-value]", environment);
    if (colors.length !== 1 || colors[0].disabled || colors[0].getAttribute("data-testid") !== "pdp-color-swatch-instock" || colorLabels.length !== 1 || colors[0].getAttribute("aria-label") !== text2(colorLabels[0], environment)) return null;
    const shipping = [...root.querySelectorAll("input#shipping[data-testid=pdp-fulfillment-shipping]")];
    const pickup = [...root.querySelectorAll("input#pickup[data-testid=pdp-fulfillment-pickup]")];
    const shippingStatus = elements(root, "[data-testid=shipping-inventory-status]", environment);
    if (shipping.length !== 1 || !shipping[0].checked || shipping[0].getAttribute("data-selected") !== "true" || pickup.length !== 1 || pickup[0].checked || pickup[0].getAttribute("data-selected") !== "false" || shippingStatus.length !== 1 || text2(shippingStatus[0], environment) !== "In Stock") return null;
    const names = elements(root, "h1[data-testid=product-title]", environment);
    const prices = elements(root, "[data-testid=pdp-title-price-wrapper] .fds__core-web-purchase-price", environment);
    if (names.length !== 1 || prices.length !== 1) return null;
    const unitPriceCents = cents(text2(prices[0], environment));
    if (!unitPriceCents) return null;
    const products = [];
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.textContent || "null");
        for (const entry of Array.isArray(data) ? data : [data]) if (entry?.["@type"] === "Product") products.push(entry);
      } catch {
      }
    }
    if (products.length !== 1) return null;
    const product = products[0];
    const offers = product.offers;
    if (!Array.isArray(offers) || offers.length !== 1) return null;
    const offer = offers[0];
    const content = text2(root, environment);
    if (product.productID !== retailerSku.slice(0, 9) || String(product.name).toLocaleLowerCase("en-US") !== text2(names[0], environment).toLocaleLowerCase("en-US") || product.brand?.name !== "Banana Republic" || product.color !== text2(colorLabels[0], environment) || !offer || offer.sku !== retailerSku || bananarepublicUrlSku(String(offer.url)) !== retailerSku || offer.priceCurrency !== "USD" || cents(`$${offer.price}`) !== unitPriceCents || offer.seller?.name !== "Banana Republic" || offer.availability !== "https://schema.org/InStock" || offer.itemCondition !== "https://schema.org/NewCondition" || /pre[ -]?order|subscription|sold (?:and shipped )?by|\b(?:CAD|GBP|EUR|AUD)\b|CA\$|C\$|[£€]/i.test(content)) return null;
    const fingerprint = JSON.stringify([
      retailerSku,
      unitPriceCents,
      product.name,
      product.color,
      "One Size",
      "shipping",
      sizes[0].id,
      colors[0].id,
      quantities[0].value
    ]);
    return { root, control, retailerSku, unitPriceCents, fingerprint };
  }
  function observeBananaRepublicOffer(document, url, retailerSku, observedAt = (/* @__PURE__ */ new Date()).toISOString(), environment) {
    const binding = bananarepublicOfferBinding(document, url, retailerSku, environment);
    return {
      contractVersion: 1,
      observedAt,
      url,
      pageKind: bananarepublicPageKind(url),
      retailerId: "bananarepublic",
      retailerSku: bananarepublicUrlSku(url),
      availability: binding ? "in_stock" : "unknown",
      unitPriceCents: binding?.unitPriceCents ?? null,
      currency: "USD",
      sellerName: binding ? "Banana Republic" : "",
      sellerType: binding ? "first_party" : "unknown",
      fulfillment: binding ? "shipping" : "unknown",
      addControlActionable: Boolean(binding),
      securityChallenge: bananarepublicSecurityChallenge(document, environment),
      interactiveBlock: bananarepublicInteractiveBlock(document, url, environment)
    };
  }

  // packages/browser-adapters/src/bananarepublicfactory.ts
  var CHILD_SKU2 = /^\d{10}0000$/;
  function elements2(root, selector, environment) {
    return [...root.querySelectorAll(selector)].filter((e) => renderedVisible(e, environment));
  }
  function text3(element, environment) {
    if (!environment && typeof element.innerText === "string") return element.innerText.replace(/\s+/g, " ").trim();
    const parts = [];
    const visit = (node) => {
      if (node.nodeType === 3) parts.push(node.textContent || "");
      else if (node.nodeType === 1 && !["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"].includes(node.tagName) && renderedVisible(node, environment)) for (const child of node.childNodes) visit(child);
    };
    visit(element);
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }
  function cents2(value) {
    const match = value.match(/^\$(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$/);
    if (!match) return null;
    const price = Number(match[1].replace(/,/g, "")) * 100 + Number(match[2]);
    return Number.isSafeInteger(price) && price > 0 ? price : null;
  }
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
  function bananarepublicfactoryPageKind(value) {
    const url = bananarepublicfactoryUrl(value);
    if (!url) return "other";
    if (/^\/my-account\/(?:sign-in|register)(?:\/|$)/.test(url.pathname)) return "auth";
    if (url.hostname === "secure-bananarepublicfactory.gapfactory.com" && url.pathname === "/shopping-bag") return "cart";
    if (/^\/checkout(?:\/|$)/.test(url.pathname)) return "checkout";
    return bananarepublicfactoryUrlSku(value) ? "product" : "other";
  }
  function bananarepublicfactorySecurityChallenge(document, environment) {
    return /(?:verify|confirm) (?:that )?you are (?:a )?human|access denied|you have been blocked|security check|captcha challenge/i.test(text3(document.body, environment)) || elements2(document, "iframe[src*='captcha'], iframe[src*='challenge']", environment).length > 0;
  }
  function bananarepublicfactoryInteractiveBlock(document, url, environment) {
    if (bananarepublicfactoryPageKind(url) === "auth") return "auth";
    if (bananarepublicfactorySecurityChallenge(document, environment)) return "unknown";
    if (/you(?:'|’)re in line|waiting room|please wait in (?:the )?queue/i.test(text3(document.body, environment))) return "queue";
    if (elements2(document, "dialog[open], [aria-modal='true'], input[type='password']", environment).length) return "unknown";
    return "";
  }
  function bananarepublicfactoryOfferBinding(document, urlValue, expectedSku, environment) {
    const retailerSku = bananarepublicfactoryUrlSku(urlValue);
    if (!retailerSku || document.URL !== urlValue || expectedSku !== void 0 && expectedSku !== retailerSku || bananarepublicfactoryInteractiveBlock(document, urlValue, environment)) return null;
    const roots = elements2(document, "#buy-box-wrapper-id", environment);
    if (roots.length !== 1) return null;
    const root = roots[0];
    const controls = elements2(root, "button#pdp-atb-btn[type=button]", environment);
    if (controls.length !== 1) return null;
    const control = controls[0];
    if (text3(control, environment) !== "Add to Bag" || control.matches(":disabled") || control.closest("[aria-disabled=true], [aria-busy=true], [data-isdisabled=true], [data-isloading=true]")) return null;
    const quantities = [...root.querySelectorAll("#AddToBag select")];
    const quantityLabels = elements2(root, "#pdp-quantity-selector", environment);
    if (quantities.length !== 1 || quantities[0].value !== "1" || quantityLabels.length !== 1 || text3(quantityLabels[0], environment) !== "1") return null;
    const sizes = [...root.querySelectorAll("input[name=buybox-sizeDimension1]")];
    if (sizes.length !== 1 || !sizes[0].checked || sizes[0].disabled || sizes[0].getAttribute("aria-disabled") === "true" || root.querySelector("input[name=buybox-sizeDimension2]")) return null;
    const sizeLabels = elements2(root, "label[for]", environment).filter((label) => label.getAttribute("for") === sizes[0].id);
    if (sizeLabels.length !== 1 || text3(sizeLabels[0], environment) !== "One Size") return null;
    const colors = [...root.querySelectorAll("input[name=buybox-color-swatch]:checked")];
    const colorLabels = elements2(root, "[data-testid=pdp-color-value]", environment);
    if (colors.length !== 1 || colors[0].disabled || colors[0].getAttribute("data-testid") !== "pdp-color-swatch-instock" || colorLabels.length !== 1 || colors[0].getAttribute("aria-label") !== text3(colorLabels[0], environment)) return null;
    const shipping = [...root.querySelectorAll("input#shipping[data-testid=pdp-fulfillment-shipping]")];
    const pickup = [...root.querySelectorAll("input#pickup[data-testid=pdp-fulfillment-pickup]")];
    const shippingStatus = elements2(root, "[data-testid=shipping-inventory-status]", environment);
    if (shipping.length !== 1 || !shipping[0].checked || shipping[0].getAttribute("data-selected") !== "true" || pickup.length !== 1 || pickup[0].checked || pickup[0].getAttribute("data-selected") !== "false" || shippingStatus.length !== 1 || text3(shippingStatus[0], environment) !== "In Stock") return null;
    const names = elements2(root, "h1[data-testid=product-title]", environment);
    const prices = elements2(root, "[data-testid=pdp-title-price-wrapper] .fds__core-web-purchase-price", environment);
    if (names.length !== 1 || prices.length !== 1) return null;
    const unitPriceCents = cents2(text3(prices[0], environment));
    if (!unitPriceCents) return null;
    const products = [];
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.textContent || "null");
        for (const entry of Array.isArray(data) ? data : [data]) if (entry?.["@type"] === "Product") products.push(entry);
      } catch {
      }
    }
    if (products.length !== 1) return null;
    const product = products[0];
    const offers = product.offers;
    if (!Array.isArray(offers) || offers.length !== 1) return null;
    const offer = offers[0];
    const content = text3(root, environment);
    if (product.productID !== retailerSku.slice(0, -4) || String(product.name).toLocaleLowerCase("en-US") !== text3(names[0], environment).toLocaleLowerCase("en-US") || product.brand?.name !== "Banana Republic Factory" || product.color !== text3(colorLabels[0], environment) || !offer || offer.sku !== retailerSku || bananarepublicfactoryUrlSku(String(offer.url)) !== retailerSku || offer.priceCurrency !== "USD" || cents2(`$${offer.price}`) !== unitPriceCents || offer.seller?.name !== "Banana Republic Factory" || offer.availability !== "https://schema.org/InStock" || offer.itemCondition !== "https://schema.org/NewCondition" || /pre[ -]?order|subscription|sold (?:and shipped )?by|\b(?:CAD|GBP|EUR|AUD)\b|CA\$|C\$|[£€]/i.test(content)) return null;
    const fingerprint = JSON.stringify([
      retailerSku,
      unitPriceCents,
      product.name,
      product.color,
      "One Size",
      "shipping",
      sizes[0].id,
      colors[0].id,
      quantities[0].value
    ]);
    return { root, control, retailerSku, unitPriceCents, fingerprint };
  }
  function observeBananaRepublicFactoryOffer(document, url, retailerSku, observedAt = (/* @__PURE__ */ new Date()).toISOString(), environment) {
    const binding = bananarepublicfactoryOfferBinding(document, url, retailerSku, environment);
    return {
      contractVersion: 1,
      observedAt,
      url,
      pageKind: bananarepublicfactoryPageKind(url),
      retailerId: "bananarepublicfactory",
      retailerSku: bananarepublicfactoryUrlSku(url),
      availability: binding ? "in_stock" : "unknown",
      unitPriceCents: binding?.unitPriceCents ?? null,
      currency: "USD",
      sellerName: binding ? "Banana Republic Factory" : "",
      sellerType: binding ? "first_party" : "unknown",
      fulfillment: binding ? "shipping" : "unknown",
      addControlActionable: Boolean(binding),
      securityChallenge: bananarepublicfactorySecurityChallenge(document, environment),
      interactiveBlock: bananarepublicfactoryInteractiveBlock(document, url, environment)
    };
  }

  // packages/browser-adapters/src/athleta.ts
  var CHILD_SKU3 = /^\d{9}0000$/;
  function elements3(root, selector, environment) {
    return [...root.querySelectorAll(selector)].filter((e) => renderedVisible(e, environment));
  }
  function text4(element, environment) {
    if (!environment && typeof element.innerText === "string") return element.innerText.replace(/\s+/g, " ").trim();
    const parts = [];
    const visit = (node) => {
      if (node.nodeType === 3) parts.push(node.textContent || "");
      else if (node.nodeType === 1 && !["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"].includes(node.tagName) && renderedVisible(node, environment)) for (const child of node.childNodes) visit(child);
    };
    visit(element);
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }
  function cents3(value) {
    const match = value.match(/^\$(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$/);
    if (!match) return null;
    const price = Number(match[1].replace(/,/g, "")) * 100 + Number(match[2]);
    return Number.isSafeInteger(price) && price > 0 ? price : null;
  }
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
  function athletaPageKind(value) {
    const url = athletaUrl(value);
    if (!url) return "other";
    if (/^\/my-account\/(?:sign-in|register)(?:\/|$)/.test(url.pathname)) return "auth";
    if (url.hostname === "secure-athleta.gap.com" && url.pathname === "/shopping-bag") return "cart";
    if (/^\/checkout(?:\/|$)/.test(url.pathname)) return "checkout";
    return athletaUrlSku(value) ? "product" : "other";
  }
  function athletaSecurityChallenge(document, environment) {
    return /(?:verify|confirm) (?:that )?you are (?:a )?human|access denied|you have been blocked|security check|captcha challenge/i.test(text4(document.body, environment)) || elements3(document, "iframe[src*='captcha'], iframe[src*='challenge']", environment).length > 0;
  }
  function athletaInteractiveBlock(document, url, environment) {
    if (athletaPageKind(url) === "auth") return "auth";
    if (athletaSecurityChallenge(document, environment)) return "unknown";
    if (/you(?:'|’)re in line|waiting room|please wait in (?:the )?queue/i.test(text4(document.body, environment))) return "queue";
    if (elements3(document, "dialog[open], [aria-modal='true'], input[type='password']", environment).length) return "unknown";
    return "";
  }
  function athletaOfferBinding(document, urlValue, expectedSku, environment) {
    const retailerSku = athletaUrlSku(urlValue);
    if (!retailerSku || document.URL !== urlValue || expectedSku !== void 0 && expectedSku !== retailerSku || athletaInteractiveBlock(document, urlValue, environment)) return null;
    const roots = elements3(document, "#buy-box-wrapper-id", environment);
    if (roots.length !== 1) return null;
    const root = roots[0];
    const controls = elements3(root, "button#pdp-atb-btn[type=button]", environment);
    if (controls.length !== 1) return null;
    const control = controls[0];
    if (text4(control, environment) !== "Add to Bag" || control.matches(":disabled") || control.closest("[aria-disabled=true], [aria-busy=true], [data-isdisabled=true], [data-isloading=true]")) return null;
    const quantities = [...root.querySelectorAll("#AddToBag select")];
    const quantityLabels = elements3(root, "#pdp-quantity-selector", environment);
    if (quantities.length !== 1 || quantities[0].value !== "1" || quantityLabels.length !== 1 || text4(quantityLabels[0], environment) !== "1") return null;
    const sizes = [...root.querySelectorAll("input[name=buybox-sizeDimension1]")];
    if (sizes.length !== 1 || !sizes[0].checked || sizes[0].disabled || sizes[0].getAttribute("aria-disabled") === "true" || root.querySelector("input[name=buybox-sizeDimension2]")) return null;
    const sizeLabels = elements3(root, "label[for]", environment).filter((label) => label.getAttribute("for") === sizes[0].id);
    if (sizeLabels.length !== 1 || text4(sizeLabels[0], environment) !== "One Size") return null;
    const colors = [...root.querySelectorAll("input[name=buybox-color-swatch]:checked")];
    const colorLabels = elements3(root, "[data-testid=pdp-color-value]", environment);
    if (colors.length !== 1 || colors[0].disabled || colors[0].getAttribute("data-testid") !== "pdp-color-swatch-instock" || colorLabels.length !== 1 || colors[0].getAttribute("aria-label") !== text4(colorLabels[0], environment)) return null;
    const shipping = [...root.querySelectorAll("input#shipping[data-testid=pdp-fulfillment-shipping]")];
    const pickup = [...root.querySelectorAll("input#pickup[data-testid=pdp-fulfillment-pickup]")];
    const shippingStatus = elements3(root, "[data-testid=shipping-inventory-status]", environment);
    if (shipping.length !== 1 || !shipping[0].checked || shipping[0].getAttribute("data-selected") !== "true" || pickup.length !== 1 || pickup[0].checked || pickup[0].getAttribute("data-selected") !== "false" || shippingStatus.length !== 1 || text4(shippingStatus[0], environment) !== "In Stock") return null;
    const names = elements3(root, "h1[data-testid=product-title]", environment);
    const prices = elements3(root, "[data-testid=pdp-title-price-wrapper] .fds__core-web-purchase-price", environment);
    if (names.length !== 1 || prices.length !== 1) return null;
    const unitPriceCents = cents3(text4(prices[0], environment));
    if (!unitPriceCents) return null;
    const products = [];
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.textContent || "null");
        for (const entry of Array.isArray(data) ? data : [data]) if (entry?.["@type"] === "Product") products.push(entry);
      } catch {
      }
    }
    if (products.length !== 1) return null;
    const product = products[0];
    const offers = product.offers;
    if (!Array.isArray(offers) || offers.length !== 1) return null;
    const offer = offers[0];
    const content = text4(root, environment);
    if (product.productID !== retailerSku.slice(0, 9) || String(product.name).toLocaleLowerCase("en-US") !== text4(names[0], environment).toLocaleLowerCase("en-US") || product.brand?.name !== "Athleta" || product.color !== text4(colorLabels[0], environment) || !offer || offer.sku !== retailerSku || athletaUrlSku(String(offer.url)) !== retailerSku || offer.priceCurrency !== "USD" || cents3(`$${offer.price}`) !== unitPriceCents || offer.seller?.name !== "Athleta" || offer.availability !== "https://schema.org/InStock" || offer.itemCondition !== "https://schema.org/NewCondition" || /pre[ -]?order|subscription|sold (?:and shipped )?by|\b(?:CAD|GBP|EUR|AUD)\b|CA\$|C\$|[£€]/i.test(content)) return null;
    const fingerprint = JSON.stringify([
      retailerSku,
      unitPriceCents,
      product.name,
      product.color,
      "One Size",
      "shipping",
      sizes[0].id,
      colors[0].id,
      quantities[0].value
    ]);
    return { root, control, retailerSku, unitPriceCents, fingerprint };
  }
  function observeAthletaOffer(document, url, retailerSku, observedAt = (/* @__PURE__ */ new Date()).toISOString(), environment) {
    const binding = athletaOfferBinding(document, url, retailerSku, environment);
    return {
      contractVersion: 1,
      observedAt,
      url,
      pageKind: athletaPageKind(url),
      retailerId: "athleta",
      retailerSku: athletaUrlSku(url),
      availability: binding ? "in_stock" : "unknown",
      unitPriceCents: binding?.unitPriceCents ?? null,
      currency: "USD",
      sellerName: binding ? "Athleta" : "",
      sellerType: binding ? "first_party" : "unknown",
      fulfillment: binding ? "shipping" : "unknown",
      addControlActionable: Boolean(binding),
      securityChallenge: athletaSecurityChallenge(document, environment),
      interactiveBlock: athletaInteractiveBlock(document, url, environment)
    };
  }

  // packages/browser-adapters/src/asus.ts
  function elements4(root, selector, environment) {
    return [...root.querySelectorAll(selector)].filter((element) => renderedVisible(element, environment));
  }
  function text5(element, environment) {
    if (!environment && typeof element.innerText === "string") return element.innerText.replace(/\s+/g, " ").trim();
    const parts = [];
    const visit = (node) => {
      if (node.nodeType === 3) parts.push(node.textContent || "");
      else if (node.nodeType === 1 && !["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"].includes(node.tagName) && renderedVisible(node, environment)) for (const child of node.childNodes) visit(child);
    };
    visit(element);
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }
  function cents4(value) {
    if (!["number", "string"].includes(typeof value) || !/^\d+(?:\.\d{1,6})?$/.test(String(value))) return null;
    const amount = Number(value) * 100;
    const rounded = Math.round(amount);
    return Number.isSafeInteger(rounded) && rounded >= 0 && Math.abs(amount - rounded) < 1e-6 ? rounded : null;
  }
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
  function asusPageKind(value) {
    const url = asusUrl(value);
    if (!url) return "other";
    if (/^\/us\/checkout\/cart\/?$/.test(url.pathname)) return "cart";
    if (/^\/us\/checkout(?:\/|$)/.test(url.pathname)) return "checkout";
    if (/^\/us\/customer\/account(?:\/|$)/.test(url.pathname)) return "auth";
    return asusUrlSku(value) ? "product" : "other";
  }
  function asusSecurityChallenge(document, environment) {
    return /(?:verify|confirm) (?:that )?you are (?:a )?human|access denied|you have been blocked|security check|captcha challenge/i.test(text5(document.body, environment)) || elements4(document, "iframe[src*='captcha'], iframe[src*='challenge']", environment).length > 0;
  }
  function asusInteractiveBlock(document, url, environment) {
    if (asusPageKind(url) === "auth") return "auth";
    if (asusSecurityChallenge(document, environment)) return "unknown";
    if (/you(?:'|’)re in line|waiting room|please wait in (?:the )?queue/i.test(text5(document.body, environment))) return "queue";
    if (elements4(document, "dialog[open], [aria-modal='true'], .modal-popup._show, input[type='password']", environment).length) return "unknown";
    return "";
  }
  function asusOfferBinding(document, urlValue, expectedSku, environment) {
    const retailerSku = asusUrlSku(urlValue);
    if (!retailerSku || document.URL !== urlValue || expectedSku !== void 0 && expectedSku !== retailerSku || asusInteractiveBlock(document, urlValue, environment)) return null;
    const roots = elements4(document, ".product-info-main", environment);
    const forms = elements4(document, "form#product_addtocart_form", environment);
    if (roots.length !== 1 || forms.length !== 1 || !roots[0].contains(forms[0])) return null;
    const root = roots[0], form = forms[0];
    if (form.getAttribute("data-product-sku") !== retailerSku || form.getAttribute("method")?.toLowerCase() !== "post") return null;
    const values = (name) => [...form.querySelectorAll(`input[name='${name}']`)].map((x) => x.value);
    const products = values("product"), quantities = values("qty"), configurations = values("selected_configurable_option");
    const productId = products[0] || "";
    if (products.length !== 1 || !/^\d{1,10}$/.test(productId) || quantities.length !== 1 || quantities[0] !== "1" || configurations.length !== 1 || configurations[0] !== "" || values("related_product").some((value) => value !== "") || form.querySelector("select, input[name^='super_attribute'], input[name^='bundle_option'], [data-is-cto='1']")) return null;
    const action = asusUrl(form.getAttribute("action") || "");
    if (!action || !new RegExp(`^/us/checkout/cart/add/uenc/[A-Za-z0-9_,=-]+/product/${productId}/$`).test(action.pathname) || action.search || action.hash) return null;
    const controls = elements4(form, "button#product-addtocart-button[type='submit']", environment);
    if (controls.length !== 1 || text5(controls[0], environment) !== "Add to Cart" || controls[0].matches(":disabled") || controls[0].closest("[aria-disabled='true']")) return null;
    const prices = elements4(root, "[data-price-type='finalPrice'][data-price-amount]", environment);
    const currencies = [...document.querySelectorAll('meta[property="product:price:currency"]')];
    const metaPrices = [...document.querySelectorAll('meta[property="product:price:amount"]')];
    if (prices.length !== 1 || currencies.length !== 1 || currencies[0].content !== "USD" || metaPrices.length !== 1) return null;
    const unitPriceCents = cents4(prices[0].getAttribute("data-price-amount"));
    const shown = text5(prices[0], environment);
    if (!unitPriceCents || !/^\$\d+(?:,\d{3})*\.\d{2}$/.test(shown) || cents4(shown.slice(1).replace(/,/g, "")) !== unitPriceCents || cents4(metaPrices[0].content) !== unitPriceCents || cents4(form.getAttribute("data-product-originalprice")) !== unitPriceCents) return null;
    const content = text5(root, environment);
    const partNumbers = [...content.matchAll(/Part Number:\s*([A-Z0-9-]+)/g)].map((match) => match[1]);
    if (partNumbers.length !== 1 || partNumbers[0] !== retailerSku || !content.includes("Most orders ship out within 24 hours") || /pre[ -]?order|subscription|out of stock|sold out|pick ?up|sold (?:and shipped )?by|\b(?:CAD|GBP|EUR|AUD)\b|CA\$|C\$|[£€]/i.test(content)) return null;
    return {
      root,
      control: controls[0],
      retailerSku,
      productId,
      unitPriceCents,
      fingerprint: JSON.stringify([retailerSku, productId, unitPriceCents, action.href, content])
    };
  }
  function observeAsusOffer(document, url, retailerSku, observedAt = (/* @__PURE__ */ new Date()).toISOString(), environment) {
    const binding = asusOfferBinding(document, url, retailerSku, environment);
    return {
      contractVersion: 1,
      observedAt,
      url,
      pageKind: asusPageKind(url),
      retailerId: "asus",
      retailerSku: binding?.retailerSku || asusUrlSku(url),
      availability: binding ? "in_stock" : "unknown",
      unitPriceCents: binding?.unitPriceCents ?? null,
      currency: "USD",
      sellerName: binding ? "ASUS" : "",
      sellerType: binding ? "first_party" : "unknown",
      fulfillment: binding ? "shipping" : "unknown",
      addControlActionable: Boolean(binding),
      securityChallenge: asusSecurityChallenge(document, environment),
      interactiveBlock: asusInteractiveBlock(document, url, environment)
    };
  }

  // packages/browser-adapters/src/americaneagle.ts
  var CHILD_SKU4 = /^\d{10}$/;
  function elements5(root, selector, environment) {
    return [...root.querySelectorAll(selector)].filter((e) => renderedVisible(e, environment));
  }
  function text6(element, environment) {
    if (!environment && typeof element.innerText === "string") return element.innerText.replace(/\s+/g, " ").trim();
    const parts = [];
    const visit = (node) => {
      if (node.nodeType === 3) parts.push(node.textContent || "");
      else if (node.nodeType === 1 && !["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"].includes(node.tagName) && renderedVisible(node, environment)) for (const child of node.childNodes) visit(child);
    };
    visit(element);
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }
  function cents5(value) {
    const match = value.match(/^\$(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$/);
    if (!match) return null;
    const price = Number(match[1].replace(/,/g, "")) * 100 + Number(match[2]);
    return Number.isSafeInteger(price) && price > 0 ? price : null;
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
    return /(?:verify|confirm) (?:that )?you are (?:a )?human|access denied|you have been blocked|security check|captcha challenge/i.test(text6(document.body, environment)) || elements5(document, "iframe[src*='captcha'], iframe[src*='challenge']", environment).length > 0;
  }
  function americanEagleInteractiveBlock(document, url, environment) {
    if (americanEaglePageKind(url) === "auth") return "auth";
    if (americanEagleSecurityChallenge(document, environment)) return "unknown";
    if (/you(?:'|’)re in line|waiting room|please wait in (?:the )?queue/i.test(text6(document.body, environment))) return "queue";
    if (elements5(document, "dialog[open], [aria-modal='true'], input[type='password']", environment).length) return "unknown";
    return "";
  }
  function americanEagleOfferBinding(document, urlValue, expectedSku, environment) {
    const url = americanEagleUrl(urlValue);
    const styleColor = americanEagleStyleColor(urlValue);
    if (!url || !styleColor || document.URL !== urlValue || americanEagleInteractiveBlock(document, urlValue, environment)) return null;
    const panels = elements5(document, "[data-test-psp]", environment);
    if (panels.length !== 1) return null;
    const panel = panels[0];
    const root = panel.closest("[data-test-sticky-content]");
    if (!root || !renderedVisible(root, environment)) return null;
    const buttons = elements5(panel, "button[data-test-btn='addToBag'][type='button']", environment);
    if (buttons.length !== 1) return null;
    const control = buttons[0];
    if (!/^Add to Bag(?: \(Before It's Gone\))?$/i.test(text6(control, environment)) || control.matches(":disabled") || control.closest("[aria-disabled='true']")) return null;
    const sizes = elements5(panel, "[data-test-select-size]", environment);
    if (sizes.length !== 1 || sizes[0].getAttribute("data-test-sizes-count") !== "1") return null;
    const size = sizes[0];
    const selectedText = elements5(size, "[data-test-dropdown-toggle][aria-label='Size'] [data-test-text]", environment);
    if (selectedText.length !== 1 || text6(selectedText[0], environment) !== "One Size") return null;
    const options = [...size.querySelectorAll("li[data-value]")];
    if (options.length !== 1 || !options[0].classList.contains("active") || options[0].textContent?.replace(/\s+/g, " ").trim() !== "One Size") return null;
    const retailerSku = options[0].getAttribute("data-value") || "";
    if (!CHILD_SKU4.test(retailerSku) || expectedSku !== void 0 && retailerSku !== expectedSku || url.searchParams.has("sku") && americanEagleUrlSku(urlValue) !== retailerSku) return null;
    const quantities = elements5(panel, "[data-test-select-quantity] [data-testid='quantity-value']", environment);
    if (quantities.length !== 1 || text6(quantities[0], environment) !== "1") return null;
    if (elements5(panel, "input:checked, [aria-checked='true'], [aria-pressed='true']", environment).length || /pre[ -]?order|subscription|pick ?up (?:at|in store)|ship to store/i.test(text6(panel, environment)) || elements5(root, "[data-testid='modal-link-shipping-returns']", environment).length !== 1) return null;
    const prices = elements5(root, "[data-test-product-sku-price]", environment);
    const names = elements5(root, "h1[data-testid='product-name']", environment);
    if (prices.length !== 1 || names.length !== 1) return null;
    const unitPriceCents = cents5(text6(prices[0], environment));
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
    if (product.sku !== styleColor || product.name !== text6(names[0], environment) || !offer || Array.isArray(offer) || offer.priceCurrency !== "USD" || !/\/InStock$/.test(String(offer.availability)) || americanEagleStyleColor(String(offer.url)) !== styleColor || cents5(`$${offer.price}`) !== unitPriceCents || /\b(?:CAD|GBP|EUR|AUD)\b|CA\$|C\$|[£€]|sold (?:and shipped )?by/i.test(text6(root, environment))) return null;
    const fingerprint = JSON.stringify([
      styleColor,
      retailerSku,
      unitPriceCents,
      product.name,
      "One Size",
      text6(root.querySelector("[data-test-extras='colors']") || names[0], environment),
      control.getAttribute("name")
    ]);
    return { root, control, retailerSku, styleColor, unitPriceCents, fingerprint };
  }
  function observeAmericanEagleOffer(document, url, retailerSku, observedAt = (/* @__PURE__ */ new Date()).toISOString(), environment) {
    const binding = americanEagleOfferBinding(document, url, retailerSku, environment);
    return {
      contractVersion: 1,
      observedAt,
      url,
      pageKind: americanEaglePageKind(url),
      retailerId: "americaneagle",
      retailerSku: binding?.retailerSku || "",
      availability: binding ? "in_stock" : "unknown",
      unitPriceCents: binding?.unitPriceCents ?? null,
      currency: "USD",
      sellerName: binding ? "American Eagle" : "",
      sellerType: binding ? "first_party" : "unknown",
      fulfillment: binding ? "shipping" : "unknown",
      addControlActionable: Boolean(binding),
      securityChallenge: americanEagleSecurityChallenge(document, environment),
      interactiveBlock: americanEagleInteractiveBlock(document, url, environment)
    };
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
      const text10 = String(element.textContent || "").trim();
      add(text10.match(/^(?:SKU\s*:?\s*)?(\d{5,20})\s*$/i)?.[1]);
    }
    return skus.size === 1 ? [...skus][0] : "";
  }

  // packages/browser-adapters/src/aninebing.ts
  var VARIANT2 = /^\d{10,20}$/;
  function text7(element, environment) {
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
    return /(?:verify|confirm) (?:that )?you are (?:a )?human|access denied|you have been blocked|security check|captcha challenge/i.test(text7(document.body, environment)) || [...document.querySelectorAll("iframe[src*='captcha'], iframe[src*='challenge']")].some((e) => renderedVisible(e, environment));
  }
  function anineBingInteractiveBlock(document, url, environment) {
    if (anineBingPageKind(url) === "auth") return "auth";
    if (anineBingSecurityChallenge(document, environment)) return "unknown";
    if (/you(?:'|’)re in line|waiting room|please wait in (?:the )?queue/i.test(text7(document.body, environment))) return "queue";
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
    const controls = [...root.querySelectorAll("button[name='add'][type='submit']")].filter((button) => renderedVisible(button, environment) && /^add to cart$/i.test(text7(button, environment)));
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
    const match = text7(priceNodes[0], environment).match(/^\$(\d[\d,]*)(?:\.(\d{2}))?$/);
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
    const pageText = text7(document.body, environment);
    if (!/free standard shipping (?:to the united states )?on all orders/i.test(pageText) || /\b(?:CAD|GBP|EUR|AUD)\b|CA\$|C\$|[£€]/.test(text7(root, environment))) return null;
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
  function observeAnineBingOffer(document, url, variantId, observedAt = (/* @__PURE__ */ new Date()).toISOString(), environment) {
    const binding = anineBingOfferBinding(document, url, variantId, environment);
    return {
      contractVersion: 1,
      observedAt,
      url,
      pageKind: anineBingPageKind(url),
      retailerId: "aninebing",
      retailerSku: binding?.variantId || "",
      availability: binding ? "in_stock" : "unknown",
      unitPriceCents: binding?.unitPriceCents ?? null,
      currency: "USD",
      sellerName: binding ? "ANINE BING" : "",
      sellerType: binding ? "first_party" : "unknown",
      fulfillment: binding ? "shipping" : "unknown",
      addControlActionable: Boolean(binding),
      securityChallenge: anineBingSecurityChallenge(document, environment),
      interactiveBlock: anineBingInteractiveBlock(document, url, environment)
    };
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
    const visibleMatches = matches.filter(visible2);
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
  function text8(value, maximum = 2e3) {
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
      const bounded2 = fragment.slice(0, maximum - length);
      fragments.push(bounded2);
      length += bounded2.length + 1;
    };
    const visit = (node) => {
      if (length >= maximum) return;
      if (node.nodeType === 3) {
        append(node.textContent);
        return;
      }
      if (node.nodeType === 1) {
        const element = node;
        if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(element.tagName) || element.classList.contains("aok-hidden") || !(renderedOnly ? renderedVisible2(element) : visible2(element))) return;
      }
      for (const child of [...node.childNodes]) visit(child);
    };
    visit(value);
    return fragments.join(" ").replace(/\s+/g, " ").trim().slice(0, maximum);
  }
  function sellerElementText(value, maximum = 2e3) {
    if (!value || maximum < 1) return "";
    const fragments = [observableText(value, maximum)];
    const elements6 = [value, ...value.querySelectorAll("[aria-label], [alt], [title], [data-seller-name]")];
    for (const element of elements6) {
      if (!visible2(element)) continue;
      for (const attribute of ["aria-label", "alt", "title", "data-seller-name"]) {
        const candidate = String(element.getAttribute(attribute) || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
        if (candidate) fragments.push(candidate);
      }
    }
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
    if (!visible2(element)) return false;
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
    return visible2(element) && !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true" && !/sold out|out of stock|unavailable|currently unavailable|pre[ -]?order closed|order(?:ing)? period (?:has )?ended|sales? ended/i.test(text8(element, 300));
  }
  function queryVisible(root, selectors) {
    for (const selector of selectors) {
      const found = [...root.querySelectorAll(selector)].find(visible2);
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
    const cents6 = Number(match[2]);
    return Number.isSafeInteger(dollars) && dollars >= 0 && Number.isSafeInteger(cents6) ? dollars * 100 + cents6 : null;
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
      const parentText = parent && parent !== element && element.contains(parent) ? text8(parent, 200) : "";
      const context = parentText.length <= 40 ? parentText : "";
      return !NON_CURRENT_PRICE_TEXT.test(text8(node, 300)) && !NON_CURRENT_PRICE_TEXT.test(context);
    }).map((node) => text8(node, 300)).filter(Boolean);
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
    if (element.childElementCount === 0) return parseUsPrice(text8(element, 300));
    return null;
  }
  function readPrice(root, selectors) {
    for (const selector of selectors) {
      for (const element of root.querySelectorAll(selector)) {
        if (element.tagName !== "META" && !visible2(element)) continue;
        const price = parseRetailerPriceElement(element);
        if (price !== null) return price;
      }
    }
    return null;
  }
  function config(retailerId) {
    return retailerId === "target" ? null : CONFIGS[retailerId];
  }
  var SEMANTIC_ACTION_RECOVERY_RETAILERS = /* @__PURE__ */ new Set(["walmart", "amazon", "bestbuy"]);
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
    return /\bpage you have attempted to access can not be displayed\b|\bpage (?:is|was) temporarily unavailable\b/i.test(text8(document.body, 2e4));
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
    const dialogText = text8(dialog, 12e3);
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
  function sellerEvidence(document, control, retailer, boundRoot = null) {
    const root = boundRoot || control?.closest("form, [data-testid*='buy-box' i], [data-automation-id*='buy-box' i], #buybox, main") || document;
    selectorListTrace("seller", root, retailer.sellerSelectors);
    if (retailer.retailerId === "amazon") {
      const offerDisplaySeller = amazonOfferDisplaySeller(root);
      if (offerDisplaySeller) return offerDisplaySeller;
    }
    const element = queryVisible(root, retailer.sellerSelectors) || (boundRoot ? null : queryVisible(document, retailer.sellerSelectors));
    const sellerText = retailer.retailerId === "bestbuy" ? sellerElementText(element, 1e3) : text8(element, 1e3);
    const scopedText2 = retailer.retailerId === "bestbuy" ? observableText(root, 8e4) : text8(root, 8e4);
    const pageText = retailer.retailerId === "bestbuy" ? `${sellerText} ${scopedText2}`.trim() : sellerText || scopedText2;
    if (retailer.firstPartyPattern.test(pageText)) return { sellerName: retailer.firstPartyName, sellerType: "first_party" };
    if (retailer.retailerId === "fanatics" && /ships?\s+directly\s+from\s+a\s+trusted\s+partner/i.test(pageText)) {
      return { sellerName: "", sellerType: "unknown" };
    }
    if (sellerText && retailer.marketplacePattern.test(sellerText)) {
      const sellerName = sellerText.replace(/^.*?sold\s+(?:and|&)\s+shipped\s+by\s*/i, "").replace(/^.*?sold\s+by\s*/i, "").replace(/\s+(?:and|&)\s+(?:shipped|fulfilled)\s+by.*$/i, "").trim().slice(0, 160);
      return sellerName ? { sellerName, sellerType: "third_party" } : { sellerName: "", sellerType: "unknown" };
    }
    if (retailer.marketplacePattern.test(scopedText2)) return { sellerName: "", sellerType: "unknown" };
    if (retailer.implicitFirstParty && control) return { sellerName: retailer.firstPartyName, sellerType: "first_party" };
    return { sellerName: "", sellerType: "unknown" };
  }
  function fulfillmentEvidence(root, control, retailer) {
    const tileSelectors = selectorsFor(retailer.retailerId, "fulfillmentTile");
    selectorListTrace("fulfillment", root, tileSelectors);
    const selected = [...root.querySelectorAll(tileSelectors.join(", "))].filter(visible2).map((element) => text8(element.closest("label, [role='tab'], [data-testid*='fulfillment' i], [data-automation-id*='fulfillment' i]") || element, 800));
    const evidence = [text8(control, 500), ...selected].join(" ");
    const shipping = retailer.shippingPattern.test(evidence);
    const pickup = retailer.pickupPattern.test(evidence);
    if (shipping !== pickup) return shipping ? "shipping" : "pickup";
    return control && retailer.defaultShipping ? "shipping" : "unknown";
  }
  var ADD_CONTROL_INTENT = /\b(?:add|pre[ -]?order)(?:\s+(?:item\s+)?to)?\s+(?:cart|bag)\b|\batc\b/i;
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
      text8(element, 300)
    ].filter(Boolean).join(" ");
    return `${raw} ${raw.replace(/[-_.:]+/g, " ")}`;
  }
  function merchandisingControl(element) {
    return Boolean(element.closest(MERCHANDISING_CONTROL_SCOPE));
  }
  function packagedCandidateControls(root, retailer) {
    selectorListTrace("add_control", root, retailer.addSelectors);
    const packaged = retailer.addSelectors.flatMap((selector) => [...root.querySelectorAll(selector)]);
    const intentPattern = retailer.addIntentPattern ?? ADD_CONTROL_INTENT;
    return [...new Set(packaged)].filter((element) => visible2(element) && intentPattern.test(controlIntent(element)) && (retailer.retailerId !== "bestbuy" || !element.closest(BESTBUY_MERCHANDISING_SCOPE)) && (retailer.retailerId !== "pokemoncenter" || !element.closest("aside, [class*='recommend' i], [data-testid*='saved' i]")) && !merchandisingControl(element));
  }
  function candidateControls(root, retailer) {
    const packagedMatches = packagedCandidateControls(root, retailer);
    if (packagedMatches.length > 0) return packagedMatches;
    if (!SEMANTIC_ACTION_RECOVERY_RETAILERS.has(retailer.retailerId)) return [];
    const semanticMatches = genericAddIntentControls(root);
    if (semanticMatches.length !== 1 || !semanticMatches[0]) return [];
    const document = root.nodeType === 9 ? root : root.ownerDocument;
    return stableRepairLandmark(document, semanticMatches[0], "addControl") ? semanticMatches : [];
  }
  function genericAddIntentControls(root) {
    return [...root.querySelectorAll("button, input[type='submit'], input[type='button'], [role='button']")].filter((element) => visible2(element) && GENERIC_ADD_CONTROL_INTENT.test(controlIntent(element)) && !merchandisingControl(element));
  }
  var REPAIR_LANDMARK_ATTRIBUTES = [
    "data-testid",
    "data-test-id",
    "data-automation-id",
    "data-button-state",
    "name",
    "itemprop"
  ];
  var REPAIR_LANDMARK_VALUE = /^[A-Za-z][A-Za-z0-9_.:-]{1,63}$/;
  var REPAIR_LANDMARK_FORBIDDEN = /(?:checkout|buy[_.:-]?now|place[_.:-]?order|submit[_.:-]?order|payment|credit|debit|address|email|phone|account|password|cookie|csrf|token)/i;
  var REPAIR_LANDMARK_TOKENS = /* @__PURE__ */ new Set([
    "pdp",
    "product",
    "detail",
    "buy",
    "box",
    "fulfillment",
    "shipping",
    "delivery",
    "primary",
    "main",
    "add",
    "to",
    "cart",
    "bag",
    "pre",
    "preorder",
    "order",
    "button",
    "btn",
    "control",
    "atc",
    "submit",
    "action",
    "purchase",
    "state",
    "available",
    "availability",
    "unavailable",
    "inventory",
    "stock",
    "in",
    "out",
    "sold",
    "price",
    "amount",
    "cost",
    "current",
    "customer",
    "sale",
    "offer",
    "value",
    "seller",
    "merchant",
    "vendor",
    "display",
    "name",
    "by",
    "fulfilled",
    "ship",
    "pickup",
    "pick",
    "up",
    "store",
    "method",
    "option",
    "selected",
    "status",
    "label",
    "message",
    "info",
    "commerce"
  ]);
  var REPAIR_LANDMARK_INTENT = {
    availability: /(?:availability|available|unavailable|inventory|stock|sold[_.:-]?out|pre[_.:-]?order)/i,
    unitPrice: /(?:price|amount|cost|sale[_.:-]?price|customer[_.:-]?price|offer[_.:-]?price)/i,
    seller: /(?:seller|merchant|vendor|sold[_.:-]?by)/i,
    fulfillment: /(?:fulfillment|shipping|delivery|pickup|pick[_.:-]?up|ship[_.:-]?to)/i,
    addControl: /(?:add|cart|bag|pre[_.:-]?order|atc)/i
  };
  var REPAIR_STRUCTURAL_SELECTOR = REPAIR_LANDMARK_ATTRIBUTES.map((attribute) => `[${attribute}]`).join(", ");
  function repairLandmarkTokensAllowed(field, value) {
    return REPAIR_LANDMARK_INTENT[field].test(value) && value.split(/[_.:-]+/).filter(Boolean).every((token) => REPAIR_LANDMARK_TOKENS.has(token.toLocaleLowerCase("en-US")));
  }
  function repairLandmarkElement(element, field) {
    if (element.tagName === "BUTTON") return "button";
    if (element.tagName === "INPUT") return field === "addControl" ? "input" : null;
    if (element.getAttribute("role") === "button") return "role_button";
    if (field === "addControl") return null;
    const elementKind = element.tagName.toLocaleLowerCase("en-US");
    return ["div", "span", "p", "label", "section", "li"].includes(elementKind) ? elementKind : null;
  }
  function repairLandmarkSelector(landmark) {
    const element = landmark.elementKind === "role_button" ? "[role='button']" : landmark.elementKind;
    return `${element}[${landmark.attribute}='${landmark.value}']`;
  }
  function repairSemanticMatches(field, element, retailer) {
    const evidence = field === "seller" ? sellerElementText(element, 1e3) : `${observableText(element, 1e3)} ${element.getAttribute("aria-label") ?? ""}`.trim();
    if (field === "availability") {
      return /\bout of stock\b|\bsold out\b|\bcurrently unavailable\b|\bunavailable\b|\bin stock\b|\bpre[ -]?order\b/i.test(evidence);
    }
    if (field === "unitPrice") return parseRetailerPriceElement(element) !== null;
    if (field === "seller") {
      return retailer.firstPartyPattern.test(evidence) || retailer.marketplacePattern.test(evidence);
    }
    if (field === "fulfillment") {
      const shipping = retailer.shippingPattern.test(evidence);
      const pickup = retailer.pickupPattern.test(evidence);
      return shipping !== pickup;
    }
    return GENERIC_ADD_CONTROL_INTENT.test(controlIntent(element));
  }
  function repairFieldCandidates(root, retailer, field) {
    const elements6 = field === "addControl" ? genericAddIntentControls(root) : [...root.querySelectorAll(REPAIR_STRUCTURAL_SELECTOR)].slice(0, 500).filter((element) => visible2(element) && !merchandisingControl(element));
    return [...new Set(elements6)].filter((element) => repairLandmarkElement(element, field) !== null).filter((element) => repairSemanticMatches(field, element, retailer));
  }
  function stableRepairLandmark(document, element, field) {
    const elementKind = repairLandmarkElement(element, field);
    if (!elementKind) return null;
    for (const attribute of REPAIR_LANDMARK_ATTRIBUTES) {
      const value = String(element.getAttribute(attribute) ?? "").trim();
      if (!REPAIR_LANDMARK_VALUE.test(value) || REPAIR_LANDMARK_FORBIDDEN.test(value) || !repairLandmarkTokensAllowed(field, value) || /\d{4,}|[a-f0-9]{12,}/i.test(value)) continue;
      const landmark = { field, elementKind, attribute, value };
      try {
        const matches = [...document.querySelectorAll(repairLandmarkSelector(landmark))];
        if (matches.length === 1 && matches[0] === element) return landmark;
      } catch {
      }
    }
    return null;
  }
  function adaptiveReadPrice(root, retailer) {
    selectorListTrace("price", root, retailer.priceSelectors);
    const packaged = retailer.retailerId === "amazon" ? amazonReadPrice(root, retailer.priceSelectors) : readPrice(root, retailer.priceSelectors);
    if (packaged !== null) return packaged;
    if (!SEMANTIC_ACTION_RECOVERY_RETAILERS.has(retailer.retailerId)) return null;
    const candidates = repairFieldCandidates(root, retailer, "unitPrice");
    if (candidates.length !== 1 || !candidates[0]) return null;
    const document = root.nodeType === 9 ? root : root.ownerDocument;
    if (!stableRepairLandmark(document, candidates[0], "unitPrice")) return null;
    return parseRetailerPriceElement(candidates[0]);
  }
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
  function amazonOfferDisplayField(root, kind) {
    const featureName = kind === "merchant" ? "merchantInfoFeature" : "fulfillerInfoFeature";
    const desktopName = kind === "merchant" ? "desktop-merchant-info" : "desktop-fulfiller-info";
    const features = [...root.querySelectorAll(
      `#${featureName}_feature_div, [data-feature-name='${featureName}']`
    )].filter(visible2);
    for (const feature of features) {
      const label = text8(queryVisible(feature, [
        `.offer-display-feature-label[offer-display-feature-name='${desktopName}']`,
        `[data-csa-c-slot-id='odf-feature-label-${desktopName}']`
      ]), 300);
      const value = text8(queryVisible(feature, [
        `.offer-display-feature-text[offer-display-feature-name='${desktopName}'] .offer-display-feature-text-message`,
        `[data-csa-c-slot-id='odf-feature-text-${desktopName}'] .offer-display-feature-text-message`,
        `.offer-display-feature-text[offer-display-feature-name='${desktopName}']`
      ]), 160);
      if (label && value) return { label, value };
    }
    return null;
  }
  function amazonOfferDisplaySeller(root) {
    const merchant = amazonOfferDisplayField(root, "merchant");
    if (!merchant) return null;
    if (/^shipper\s*\/\s*seller$/i.test(merchant.label)) {
      return /^amazon(?:\.com)?$/i.test(merchant.value) ? { sellerName: CONFIGS.amazon.firstPartyName, sellerType: "first_party" } : { sellerName: merchant.value, sellerType: "third_party" };
    }
    if (!/^sold\s+by$/i.test(merchant.label)) return null;
    if (!/^amazon(?:\.com)?$/i.test(merchant.value)) {
      return { sellerName: merchant.value, sellerType: "third_party" };
    }
    const fulfiller = amazonOfferDisplayField(root, "fulfiller");
    const amazonShips = fulfiller && /^ships?\s+from$/i.test(fulfiller.label) && /^amazon(?:\.com)?$/i.test(fulfiller.value);
    return amazonShips ? { sellerName: CONFIGS.amazon.firstPartyName, sellerType: "first_party" } : { sellerName: CONFIGS.amazon.firstPartyName, sellerType: "unknown" };
  }
  function amazonAsinEvidence(root) {
    const explicit = /* @__PURE__ */ new Set();
    const explicitElements = [
      ...root.matches(AMAZON_EXPLICIT_ASIN_SELECTOR) ? [root] : [],
      ...root.querySelectorAll(AMAZON_EXPLICIT_ASIN_SELECTOR)
    ];
    for (const element of explicitElements) {
      const candidate = String(
        element.value ?? ""
      ).toUpperCase();
      if (CONFIGS.amazon.skuPattern.test(candidate)) explicit.add(candidate);
    }
    if (explicit.size > 0) return explicit;
    const asins = /* @__PURE__ */ new Set();
    for (const element of [root, ...root.querySelectorAll("[data-asin]")]) {
      const candidate = String(element.getAttribute("data-asin") || "").toUpperCase();
      if (CONFIGS.amazon.skuPattern.test(candidate)) asins.add(candidate);
    }
    return asins;
  }
  function amazonOfferIds(root) {
    const collect = (selector) => {
      const offers2 = /* @__PURE__ */ new Set();
      for (const input of root.querySelectorAll(selector)) {
        const offer = cleanAmazonOfferId(input.value);
        if (offer) offers2.add(offer);
      }
      return offers2;
    };
    const canonical = collect(AMAZON_CANONICAL_OFFER_INPUT_SELECTOR);
    if (canonical.size > 0) return canonical;
    const offers = /* @__PURE__ */ new Set();
    for (const input of root.querySelectorAll(AMAZON_ALTERNATE_OFFER_INPUT_SELECTOR)) {
      const offer = cleanAmazonOfferId(input.value);
      if (offer) offers.add(offer);
    }
    return offers;
  }
  function amazonSellerBound(root, retailer) {
    if (amazonOfferDisplaySeller(root)) return true;
    const sellerText = text8(queryVisible(root, retailer.sellerSelectors), 2e3) || text8(root, 3e4);
    return retailer.firstPartyPattern.test(sellerText) || retailer.marketplacePattern.test(sellerText);
  }
  var AMAZON_INACTIVE_ROW = "[data-a-accordion-row-name]:not(.a-accordion-active)";
  var AMAZON_INACTIVE_ACCORDION = `${AMAZON_INACTIVE_ROW} .a-accordion-inner`;
  var AMAZON_UNSHOWN = `.a-popover-preload, .a-popover-content, .aok-hidden, .a-hidden, [hidden], template, ${AMAZON_INACTIVE_ACCORDION}`;
  function amazonChosenControls(root, retailer) {
    return candidateControls(root, retailer).filter((control) => !control.closest(AMAZON_INACTIVE_ACCORDION));
  }
  var AMAZON_NOT_UNIT_PRICE = "#twisterPlusPriceSubtotalWWDesktop_feature_div, [id^='twisterPlusPriceSubtotal'], #tp_price_update_feature_ww, .twister-plus-price-template, .twister-plus-subtotal-price-template";
  function amazonReadPrice(root, selectors) {
    const rootRow = root.nodeType === 1 ? root.closest(AMAZON_INACTIVE_ROW) : null;
    for (const selector of selectors) {
      for (const element of root.querySelectorAll(selector)) {
        if (element.tagName !== "META" && !visible2(element)) continue;
        if (element.closest(`${AMAZON_NOT_UNIT_PRICE}, .a-popover-preload, .a-popover-content, .aok-hidden, .a-hidden, template`)) continue;
        const row = element.closest(AMAZON_INACTIVE_ROW);
        if (row && row !== rootRow) continue;
        const price = parseRetailerPriceElement(element);
        if (price !== null) return price;
      }
    }
    return null;
  }
  function amazonShown(element) {
    return visible2(element) && !element.closest(AMAZON_UNSHOWN);
  }
  function amazonEvidenceText(value, maximum = 4e3, skip = "") {
    if (!value || !amazonShown(value)) return "";
    const fragments = [];
    let length = 0;
    const visit = (node) => {
      if (length >= maximum) return;
      if (node.nodeType === 3) {
        const fragment = String(node.textContent || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
        if (fragment) {
          fragments.push(fragment);
          length += fragment.length + 1;
        }
        return;
      }
      if (node.nodeType !== 1) return;
      const element = node;
      if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(element.tagName) || element.matches(AMAZON_UNSHOWN) || skip && element.matches(skip) || !visible2(element)) return;
      for (const child of [...node.childNodes]) visit(child);
    };
    visit(value);
    return fragments.join(" ").slice(0, maximum);
  }
  var AMAZON_DELIVERY_BLOCK = "#mir-layout-DELIVERY_BLOCK, #deliveryBlockMessage, #deliveryBlock_feature_div, [data-feature-name='deliveryBlock']";
  function amazonFulfillment(root) {
    const selectedEvidence = [...root.querySelectorAll(selectorsFor("amazon", "fulfillmentTile").join(", "))].filter(visible2).map((element) => observableText(
      element.closest("label, [role='tab'], [role='radio'], [data-testid*='fulfillment' i], [data-feature-name*='delivery' i]") || element,
      2e3
    )).join(" ");
    const selectedShipping = /\bshipping\b|\bdeliver(?:y|ies|ed|ing)?\b/i.test(selectedEvidence);
    const selectedPickup = /\bpick[ -]?up\b|\blocker\b/i.test(selectedEvidence);
    if (selectedShipping !== selectedPickup) return selectedShipping ? "shipping" : "pickup";
    const blocks = [...root.querySelectorAll(AMAZON_DELIVERY_BLOCK)].filter(amazonShown);
    const outer = blocks.filter((block) => !blocks.some((other) => other !== block && other.contains(block)));
    const promised = outer.flatMap((block) => [...block.querySelectorAll("[data-csa-c-delivery-type]")]).filter(amazonShown).map((element) => String(element.getAttribute("data-csa-c-delivery-type") || "").toLocaleLowerCase("en-US")).find((kind) => /deliver|ship|pick\s*-?up|locker/.test(kind));
    if (promised) return /pick\s*-?up|locker/.test(promised) ? "pickup" : "shipping";
    const message = outer.map((block) => amazonEvidenceText(block)).join(" ");
    if (/\b(?:cannot|can't|can not|won't|will not)\s+(?:be\s+)?(?:shipped|delivered|ship|deliver)\b|\bdoes(?:n't| not) ship\b|\bnot (?:available|eligible) for (?:shipping|delivery)\b/i.test(message)) return "unknown";
    const shipping = /\bdeliver(?:y|ies|ed|ing)?\b|\bshipping\b|\bships?\b/i.test(message);
    const pickup = /\bpick[ -]?up\b|\blocker\b/i.test(message);
    if (shipping || pickup) return shipping !== pickup ? shipping ? "shipping" : "pickup" : "unknown";
    const fulfiller = amazonOfferDisplayField(root, "fulfiller");
    const merchant = amazonOfferDisplayField(root, "merchant");
    if (fulfiller && /^ships?\s+from$/i.test(fulfiller.label) || merchant && /^shipper\s*\/\s*seller$/i.test(merchant.label)) return "shipping";
    const legacy = amazonEvidenceText(queryVisible(root, CONFIGS.amazon.sellerSelectors), 2e3);
    return /\bships?\s+from\b|\bshipper\b|\bfulfilled\s+by\b/i.test(legacy) ? "shipping" : "unknown";
  }
  function amazonOfferScope(control, retailer, expectedSku) {
    const merchandising = Boolean(control.closest(AMAZON_MERCHANDISING_SCOPE));
    recordTrace({
      step: "offer_scope",
      condition: "amazon.merchandisingScope",
      actual: merchandising ? "inside" : "outside",
      passed: !merchandising,
      ...merchandising ? { reject: "merchandising_scope" } : {}
    });
    if (control.closest(AMAZON_MERCHANDISING_SCOPE)) return null;
    const roots = [];
    const exactForm = control.closest("form");
    if (exactForm) roots.push(exactForm);
    let current = control.parentElement;
    for (let depth = 0; depth < 14 && current; depth += 1) {
      if (["MAIN", "BODY", "HTML"].includes(current.tagName)) break;
      if (!roots.includes(current)) roots.push(current);
      current = current.parentElement;
    }
    for (const root of roots) {
      const controls = amazonChosenControls(root, retailer);
      const asins = amazonAsinEvidence(root);
      const offers = amazonOfferIds(root);
      const price = adaptiveReadPrice(root, retailer);
      const fulfillment = amazonFulfillment(root);
      recordTrace({
        step: "sku_binding",
        condition: "amazon.asin",
        expected: expectedSku,
        actual: [...asins].join(","),
        passed: asins.size === 1 && asins.has(expectedSku),
        ...asins.size === 1 && asins.has(expectedSku) ? {} : { reject: "sku_mismatch" }
      });
      if (controls.length === 1 && controls[0] === control && asins.size === 1 && asins.has(expectedSku) && offers.size === 1 && price !== null && fulfillment !== "unknown" && amazonSellerBound(root, retailer)) {
        return {
          control,
          fulfillment,
          offerRoot: root,
          offerListingId: [...offers][0] ?? ""
        };
      }
    }
    return null;
  }
  function selectedAmazonControl(document, retailer, expectedSku, requiredFulfillment) {
    const expectedFulfillment = requiredFulfillment === "pickup" ? "pickup" : "shipping";
    const scoped = amazonChosenControls(document, retailer).map((control) => amazonOfferScope(control, retailer, expectedSku)).filter((candidate) => Boolean(candidate));
    const matching = scoped.filter((candidate) => candidate.fulfillment === expectedFulfillment);
    return matching.length === 1 && matching[0] ? matching[0] : { control: null, fulfillment: unmatchedFulfillment(scoped, expectedFulfillment), offerRoot: null };
  }
  function walmartSkuEvidence(root) {
    const skus = /* @__PURE__ */ new Set();
    for (const element of [root, ...root.querySelectorAll(selectorsFor("walmart", "offerInput").join(", "))]) {
      for (const name of ["data-us-item-id", "data-item-id", "data-product-id"]) {
        const candidate = String(element.getAttribute(name) || "");
        if (CONFIGS.walmart.skuPattern.test(candidate)) skus.add(candidate);
      }
    }
    for (const anchor of root.querySelectorAll("a[href]")) {
      let href = "";
      try {
        href = new URL(anchor.getAttribute("href") || "", root.ownerDocument.baseURI || "https://www.walmart.com").href;
      } catch {
        href = "";
      }
      const sku = extractRetailerSku("walmart", href);
      if (sku) skus.add(sku);
    }
    return skus;
  }
  function walmartSellerBound(root, retailer) {
    if (queryVisible(root, retailer.sellerSelectors)) return true;
    const scopedText2 = text8(root, 3e4);
    return retailer.firstPartyPattern.test(scopedText2) || retailer.marketplacePattern.test(scopedText2);
  }
  function objectValue(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  }
  function walmartQuantityOne(root, generic = true) {
    const selectors = selectorsFor("walmart", "quantity");
    selectorListTrace("quantity", root, selectors);
    return quantityIsOne(
      root,
      selectors,
      (element) => visible2(element),
      (element) => Boolean(element.closest(WALMART_MERCHANDISING_SCOPE)),
      generic
    );
  }
  var WALMART_ADVERTISEMENT_SCOPE = "[aria-label='Advertisement' i], [data-testid$='-ad' i]";
  var WALMART_ITEM_IDENTITY = "[data-us-item-id], [data-item-id], [data-product-id]";
  function walmartForeignItemControl(control, expectedSku) {
    if (control.closest(WALMART_ADVERTISEMENT_SCOPE)) return true;
    if (!expectedSku) return false;
    for (let tile = control.closest(WALMART_ITEM_IDENTITY); tile; tile = tile.parentElement?.closest(WALMART_ITEM_IDENTITY) ?? null) {
      for (const name of ["data-us-item-id", "data-item-id", "data-product-id"]) {
        const candidate = String(tile.getAttribute(name) || "");
        if (CONFIGS.walmart.skuPattern.test(candidate) && candidate !== expectedSku) return true;
      }
    }
    return false;
  }
  function walmartPrimaryActionControls(document, retailer, expectedSku = "") {
    selectorTrace("offer_scope", document, WALMART_MERCHANDISING_SCOPE);
    selectorTrace("offer_scope", document, WALMART_SECONDARY_ACTION_SCOPE);
    selectorTrace("offer_scope", document, WALMART_PRIMARY_SCOPE);
    const candidates = candidateControls(document, retailer);
    const foreign = candidates.filter((control) => walmartForeignItemControl(control, expectedSku));
    if (foreign.length) {
      recordTrace({
        step: "offer_scope",
        condition: "walmart.foreignItemControl",
        matched: foreign.length,
        actual: `${foreign.length} excluded`,
        passed: true
      });
    }
    const rendered = candidates.filter((control) => !foreign.includes(control)).filter((control) => !control.closest(WALMART_MERCHANDISING_SCOPE)).filter(renderedVisible2);
    const nonSecondary = rendered.filter((control) => !control.closest(WALMART_SECONDARY_ACTION_SCOPE));
    const primary = nonSecondary.filter((control) => Boolean(control.closest(WALMART_PRIMARY_SCOPE)));
    if (primary.length > 0) return primary;
    if (nonSecondary.length > 0) return nonSecondary;
    return rendered.length === 1 ? rendered : [];
  }
  var WALMART_TILE_UNAVAILABLE = /\b(?:out of stock|sold out|unavailable|not available|not eligible|check nearby|check availability)\b/i;
  function walmartFulfillmentTiles(document) {
    const byType = /* @__PURE__ */ new Map();
    for (const input of document.querySelectorAll("input[type='radio'][name='fulfillment' i]")) {
      if (input.closest(WALMART_MERCHANDISING_SCOPE) || input.closest(WALMART_ADVERTISEMENT_SCOPE)) continue;
      const label = input.labels?.[0] ?? input.closest("label");
      if (!label || !renderedVisible2(label)) continue;
      const type = String(input.getAttribute("value") || "").trim().toUpperCase();
      if (type !== "SHIPPING" && type !== "PICKUP" && type !== "DELIVERY") continue;
      const intent = text8(label.querySelector("[data-seo-id$='-intent' i]"), 300);
      const unavailable = input.disabled || input.getAttribute("aria-disabled") === "true" || WALMART_TILE_UNAVAILABLE.test(intent);
      const tile = {
        type,
        input,
        label,
        selected: input.checked && input.getAttribute("data-selected") !== "false",
        intent,
        unavailable,
        available: !unavailable && Boolean(intent)
      };
      byType.set(type, [...byType.get(type) ?? [], tile]);
    }
    const tiles = [];
    for (const group of byType.values()) {
      if (group.some((tile) => tile.selected !== group[0]?.selected || tile.available !== group[0]?.available)) return null;
      if (group[0]) tiles.push(group[0]);
    }
    return tiles;
  }
  function walmartNewCondition(product, conditionOffer, offerCondition) {
    const groupCode = Number(offerCondition?.groupCode);
    if (groupCode === 1) return true;
    return groupCode === 4 && Number(offerCondition?.code) === 401001 && String(offerCondition?.text ?? "").trim().toLocaleLowerCase("en-US") === "new" && conditionOffer.isConditionNew === true && product.isConditionNew === true && product.isPreowned !== true;
  }
  function walmartOrderLimitValue(value) {
    if (value === null || value === void 0) return null;
    const limit = typeof value === "number" ? value : typeof value === "string" && /^\s*\d{1,6}\s*$/.test(value) ? Number(value) : Number.NaN;
    if (!Number.isSafeInteger(limit) || limit < 0) return void 0;
    return limit === 0 ? null : limit;
  }
  function walmartStructuredOffer(document, retailer, expectedSku, requiredFulfillment) {
    const condition = (name, expected, actual, passed) => {
      recordTrace({
        step: "structured_offer",
        condition: name,
        expected: String(expected),
        actual: String(actual),
        passed,
        ...passed ? {} : { reject: "condition_failed" }
      });
      return passed;
    };
    const structuredSelector = selectorsFor("walmart", "structuredData").join(", ");
    const scripts = [...document.querySelectorAll(structuredSelector)];
    if (!condition("script#__NEXT_DATA__.count", 1, scripts.length, scripts.length === 1) || !condition("script#__NEXT_DATA__.type", "application/json", scripts[0]?.getAttribute("type") || "", scripts[0]?.getAttribute("type") === "application/json")) return null;
    const script = scripts[0];
    const serialized = String(script?.textContent || "").trim();
    if (!serialized || serialized.length > 2e6) return null;
    let root = null;
    try {
      root = objectValue(JSON.parse(serialized));
    } catch {
      return null;
    }
    const props = objectValue(root?.props);
    const pageProps = objectValue(props?.pageProps);
    const initialData = objectValue(pageProps?.initialData);
    const data = objectValue(initialData?.data);
    const product = objectValue(data?.product);
    if (!condition("product", "object", product ? "object" : "missing", Boolean(product)) || !product) return null;
    if (!condition("product.usItemId", expectedSku, product.usItemId || "", String(product.usItemId || "") === expectedSku)) return null;
    if (!condition("product.availabilityStatus", "IN_STOCK", product.availabilityStatus, product.availabilityStatus === "IN_STOCK")) {
      selectorListTrace("price", document, retailer.priceSelectors);
      return null;
    }
    if (!condition("product.itemPageAvailabilityStatus", "IN_STOCK", product.itemPageAvailabilityStatus, product.itemPageAvailabilityStatus === "IN_STOCK")) return null;
    if (!condition("product.showAtc", true, product.showAtc, product.showAtc === true)) return null;
    if (!condition("product.isConditionNew", true, product.isConditionNew, product.isConditionNew === true)) return null;
    const selectedOfferId = String(product.selectedOfferId || "").trim();
    const offerId = String(product.offerId || "").trim();
    if (!condition("product.selectedOfferId", "valid offer id", selectedOfferId, /^[A-Za-z0-9_-]{8,200}$/.test(selectedOfferId))) return null;
    if (!condition("product.offerId", selectedOfferId, offerId, offerId === selectedOfferId)) return null;
    const priceInfo = objectValue(product.priceInfo);
    const currentPrice = objectValue(priceInfo?.currentPrice);
    const dollars = Number(currentPrice?.price);
    if (!condition("product.priceInfo.currentPrice.price", "positive number", currentPrice?.price, Number.isFinite(dollars) && dollars > 0)) return null;
    if (!condition("product.priceInfo.currentPrice.currencyUnit", "USD", currentPrice?.currencyUnit, currentPrice?.currencyUnit === "USD")) return null;
    const unitPriceCents = Math.round(dollars * 100);
    if (!condition("product.priceInfo.currentPrice.precision", "whole cents", dollars, Math.abs(dollars * 100 - unitPriceCents) <= 1e-3)) return null;
    if (!condition("product.sellerType", "INTERNAL", product.sellerType, product.sellerType === "INTERNAL")) return null;
    if (!condition("product.sellerName", "Walmart", product.sellerName, /^walmart(?:\.com)?$/i.test(String(product.sellerName || "").trim()))) return null;
    const visibleSeller = queryVisible(document, retailer.sellerSelectors);
    const visibleSellerText = sellerElementText(visibleSeller, 2e3);
    if (visibleSellerText && retailer.marketplacePattern.test(visibleSellerText) && !retailer.firstPartyPattern.test(visibleSellerText)) return null;
    const conditionOffers = Array.isArray(product.conditionOffers) ? product.conditionOffers.map(objectValue).filter(Boolean) : [];
    const exactConditionOffers = conditionOffers.filter((conditionOffer2) => conditionOffer2?.offerId === selectedOfferId);
    if (!condition("product.conditionOffers.selected.count", 1, exactConditionOffers.length, exactConditionOffers.length === 1) || !exactConditionOffers[0]) return null;
    const conditionOffer = exactConditionOffers[0];
    const conditionAvailability = objectValue(conditionOffer.availabilityStatus);
    const offerCondition = objectValue(conditionOffer.condition);
    const conditionPrice = objectValue(conditionOffer.price);
    if (!condition("product.conditionOffers[].availabilityStatus.value", "IN_STOCK", conditionAvailability?.value, conditionAvailability?.value === "IN_STOCK")) return null;
    if (!condition(
      "product.conditionOffers[].condition",
      "New (group 1) or Collectible New (group 4, code 401001)",
      `group ${String(offerCondition?.groupCode)} code ${String(offerCondition?.code)} ${String(offerCondition?.text ?? "")}`.trim(),
      walmartNewCondition(product, conditionOffer, offerCondition)
    )) return null;
    if (!condition("product.conditionOffers[].price.price", unitPriceCents, Math.round(Number(conditionPrice?.price) * 100), Math.round(Number(conditionPrice?.price) * 100) === unitPriceCents)) return null;
    const expectedType = requiredFulfillment === "pickup" ? "PICKUP" : "SHIPPING";
    const fulfillmentOptions = Array.isArray(product.fulfillmentOptions) ? product.fulfillmentOptions.map(objectValue).filter(Boolean) : [];
    const tiles = walmartFulfillmentTiles(document);
    if (!condition("walmart.fulfillmentTiles", "one tile per option", tiles ? tiles.length : "conflicting", tiles !== null) || !tiles) return null;
    const tile = tiles.find((candidate) => candidate.type === expectedType) ?? null;
    const tileSelected = Boolean(tile?.selected) && tiles.every((candidate) => candidate === tile || !candidate.selected);
    if (tiles.length > 0 && !condition(
      "walmart.fulfillmentTiles.selected",
      expectedType,
      tiles.filter((candidate) => candidate.selected).map((candidate) => candidate.type).join(",") || "none",
      tileSelected
    )) return null;
    if (tile && !condition("walmart.fulfillmentTiles.intent", "not unavailable", tile.intent, !tile.unavailable)) return null;
    const servedSelected = fulfillmentOptions.filter((option) => option?.type === expectedType && option?.selected === true);
    const pickedAfterLoad = servedSelected.length === 0 && tileSelected && tile?.available === true;
    const selectedOptions = pickedAfterLoad ? fulfillmentOptions.filter((option) => option?.type === expectedType) : servedSelected;
    if (!condition("product.fulfillmentOptions.selected.count", 1, selectedOptions.length, selectedOptions.length === 1) || !selectedOptions[0]) return null;
    const fulfillmentOption = selectedOptions[0];
    if (!condition("product.fulfillmentOptions[].availabilityStatus", "IN_STOCK", fulfillmentOption.availabilityStatus, fulfillmentOption.availabilityStatus === "IN_STOCK")) return null;
    if (!condition("product.fulfillmentOptions[].viewOnly", false, fulfillmentOption.viewOnly, fulfillmentOption.viewOnly !== true)) return null;
    if (!condition("product.fulfillmentOptions[].restricted", false, fulfillmentOption.restricted, fulfillmentOption.restricted !== true)) return null;
    if (!condition(
      "product.fulfillmentOptions[].intent",
      pickedAfterLoad ? "picked in the buy box" : "not false",
      fulfillmentOption.intent,
      pickedAfterLoad || fulfillmentOption.intent !== false
    )) return null;
    for (const [name, limit] of [
      ["product.fulfillmentOptions[].maxOrderQuantity", fulfillmentOption.maxOrderQuantity],
      ["product.fulfillmentOptions[].orderLimit", fulfillmentOption.orderLimit],
      ["product.orderLimit", product.orderLimit]
    ]) {
      if (walmartOrderLimitValue(limit) === void 0) {
        condition(name, "0, null or a whole number limit", limit, false);
        return null;
      }
    }
    const pool = walmartPrimaryActionControls(document, retailer, expectedSku);
    if (pool.length !== 1 || !pool[0] || !walmartQuantityOne(document, false)) return null;
    const control = pool[0];
    const offerRoot = control.closest(WALMART_PRIMARY_SCOPE) || control.closest("main") || control.parentElement;
    if (!offerRoot || !walmartQuantityOne(offerRoot)) return null;
    return {
      control,
      fulfillment: expectedType === "PICKUP" ? "pickup" : "shipping",
      offerRoot,
      structuredOffer: {
        unitPriceCents,
        sellerName: "Walmart",
        sellerType: "first_party",
        exactSelectionBound: true
      }
    };
  }
  function walmartOfferScope(control, retailer, expectedSku) {
    recordTrace({
      step: "offer_scope",
      condition: "walmart.merchandisingScope",
      actual: control.closest(WALMART_MERCHANDISING_SCOPE) ? "inside" : "outside",
      passed: !control.closest(WALMART_MERCHANDISING_SCOPE),
      ...control.closest(WALMART_MERCHANDISING_SCOPE) ? { reject: "merchandising_scope" } : {}
    });
    if (control.closest(WALMART_MERCHANDISING_SCOPE)) return null;
    const primaryScope = Boolean(control.closest(WALMART_PRIMARY_SCOPE));
    let current = control.parentElement;
    for (let depth = 0; depth < 14 && current; depth += 1) {
      if (["MAIN", "BODY", "HTML"].includes(current.tagName)) break;
      const controls = candidateControls(current, retailer);
      const price = adaptiveReadPrice(current, retailer);
      const fulfillment = fulfillmentEvidence(current, control, retailer);
      if (controls.length === 1 && controls[0] === control && price !== null && fulfillment !== "unknown" && walmartSellerBound(current, retailer)) {
        const skus = walmartSkuEvidence(current);
        if ([...skus].some((sku) => sku !== expectedSku)) return null;
        const primaryRoot = control.closest(WALMART_PRIMARY_SCOPE);
        if (!walmartQuantityOne(current) || primaryRoot && !walmartQuantityOne(primaryRoot)) return null;
        return {
          control,
          fulfillment,
          offerRoot: current,
          identityBound: skus.has(expectedSku),
          primaryScope
        };
      }
      current = current.parentElement;
    }
    return null;
  }
  function selectedWalmartControl(document, retailer, expectedSku, requiredFulfillment) {
    const expectedFulfillment = requiredFulfillment === "pickup" ? "pickup" : "shipping";
    const scoped = walmartPrimaryActionControls(document, retailer, expectedSku).map((control) => walmartOfferScope(control, retailer, expectedSku)).filter((candidate) => Boolean(candidate));
    const exact = scoped.filter((candidate) => candidate.identityBound);
    const primary = scoped.filter((candidate) => candidate.primaryScope);
    const pool = exact.length > 0 ? exact : primary.length > 0 ? primary : scoped;
    const matching = pool.filter((candidate) => candidate.fulfillment === expectedFulfillment);
    const selected = matching.length === 1 ? matching[0] : null;
    return selected || walmartStructuredOffer(document, retailer, expectedSku, requiredFulfillment) || { control: null, fulfillment: "unknown", offerRoot: null };
  }
  function bestBuySkuEvidence(root) {
    const skus = /* @__PURE__ */ new Set();
    const add = (value) => {
      const candidate = String(value || "").trim();
      if (CONFIGS.bestbuy.skuPattern.test(candidate)) skus.add(candidate);
    };
    const productElements = [root, ...root.querySelectorAll(selectorsFor("bestbuy", "offerInput").join(", "))].filter((element) => !element.closest(BESTBUY_MERCHANDISING_SCOPE));
    for (const element of productElements) {
      add(element.getAttribute("data-sku-id"));
      add(element.getAttribute("data-sku"));
      add(element.getAttribute("data-product-id"));
      if (element.tagName === "INPUT") add(element.value);
    }
    for (const anchor of [...root.querySelectorAll("a[href]")].filter((element) => !element.closest(BESTBUY_MERCHANDISING_SCOPE))) {
      let href = "";
      try {
        href = new URL(anchor.getAttribute("href") || "", root.ownerDocument.baseURI || "https://www.bestbuy.com").href;
      } catch {
        href = "";
      }
      add(extractRetailerSku("bestbuy", href));
    }
    const textCandidates = [root, ...root.querySelectorAll(
      "[data-testid*='sku' i], [class*='sku' i], p, span, dt, dd"
    )].filter((element) => visible2(element) && !element.closest(BESTBUY_MERCHANDISING_SCOPE) && element.childElementCount <= 8);
    for (const element of textCandidates.slice(0, 500)) {
      for (const match of observableText(element, 1e3).matchAll(/\bSKU\s*:?\s*(\d{5,20})\b/gi)) add(match[1]);
    }
    return skus;
  }
  function bestBuySellerBound(root, retailer) {
    const seller = queryVisible(root, retailer.sellerSelectors);
    const evidence = `${sellerElementText(seller, 2e3)} ${observableText(root, 3e4)}`.trim();
    return retailer.firstPartyPattern.test(evidence) || retailer.marketplacePattern.test(evidence);
  }
  function bestBuyReservation(document, expectedSku) {
    const present = Boolean(bestBuyReservationPanel(document, expectedSku));
    return { present, shipping: present ? bestBuyReservationShipping(document, expectedSku) : null };
  }
  function bestBuyFulfillment(root, control, reservation) {
    const chosen = bestBuySelectedFulfillment(root, control);
    if (reservation?.present) {
      const shipping = reservation.shipping;
      return shipping && shipping.control === control && root.contains(shipping.panel) && chosen !== "pickup" ? "shipping" : "unknown";
    }
    return chosen;
  }
  function bestBuySelectedFulfillment(root, control) {
    const evidenceFor = (element) => {
      const scope = element.closest(
        "label, [role='tab'], [role='radio'], [data-testid*='fulfillment' i], [data-automation-id*='fulfillment' i], [class*='fulfillment' i]"
      ) || element;
      return [
        scope.getAttribute("aria-label"),
        scope.getAttribute("data-testid"),
        scope.getAttribute("data-automation-id"),
        scope.getAttribute("data-fulfillment"),
        scope.getAttribute("data-fulfillment-type"),
        observableText(scope, 2e3)
      ].filter(Boolean).join(" ");
    };
    const directScope = control.closest(
      "[data-fulfillment], [data-fulfillment-type], [data-testid*='shipping' i], [data-testid*='pickup' i], [class*='shipping-option' i], [class*='pickup-option' i]"
    );
    if (directScope && root.contains(directScope)) {
      const evidence = evidenceFor(directScope);
      const shipping = CONFIGS.bestbuy.shippingPattern.test(evidence);
      const pickup = CONFIGS.bestbuy.pickupPattern.test(evidence);
      if (shipping !== pickup) return shipping ? "shipping" : "pickup";
    }
    const selected = [...root.querySelectorAll(selectorsFor("bestbuy", "fulfillmentTile").join(", "))].filter(visible2).map(evidenceFor);
    const selectedShipping = selected.some((value) => CONFIGS.bestbuy.shippingPattern.test(value));
    const selectedPickup = selected.some((value) => CONFIGS.bestbuy.pickupPattern.test(value));
    if (selectedShipping !== selectedPickup) return selectedShipping ? "shipping" : "pickup";
    return "unknown";
  }
  var BESTBUY_SECONDARY_ACTION_SCOPE = selectorsFor("bestbuy", "secondaryActionScope").join(", ");
  function bestBuyBoundPrice(root, retailer) {
    for (const selector of retailer.priceSelectors) {
      const prices = new Set(
        [...root.querySelectorAll(selector)].filter((element) => (element.tagName === "META" || visible2(element)) && !element.closest(BESTBUY_MERCHANDISING_SCOPE)).map(parseRetailerPriceElement).filter((price) => price !== null)
      );
      if (prices.size > 0) return prices.size === 1 ? [...prices][0] ?? null : null;
    }
    return null;
  }
  function bestBuySellerUnambiguous(root, retailer) {
    const evidence = [...root.querySelectorAll(retailer.sellerSelectors.join(", "))].filter((element) => visible2(element) && !element.closest(BESTBUY_MERCHANDISING_SCOPE)).map((element) => sellerElementText(element, 2e3)).join(" ");
    const scoped = evidence || observableText(root, 3e4);
    const firstParty = retailer.firstPartyPattern.test(scoped);
    const marketplace = retailer.marketplacePattern.test(scoped);
    return firstParty !== marketplace;
  }
  function recoveredBestBuyOfferScope(document, retailer, expectedSku, reservation) {
    selectorTrace("offer_scope", document, BESTBUY_MERCHANDISING_SCOPE);
    selectorTrace("offer_scope", document, BESTBUY_SECONDARY_ACTION_SCOPE);
    selectorTrace("offer_scope", document, BESTBUY_PRIMARY_SCOPE);
    const controls = candidateControls(document, retailer).filter((control2) => !control2.closest(BESTBUY_MERCHANDISING_SCOPE));
    if (controls.length < 1 || controls.length > 4) return null;
    const nonSecondary = controls.filter((control2) => !control2.closest(BESTBUY_SECONDARY_ACTION_SCOPE));
    const primary = nonSecondary.filter((control2) => Boolean(control2.closest(BESTBUY_PRIMARY_SCOPE)));
    const pool = primary.length > 0 ? primary : nonSecondary;
    if (pool.length !== 1 || !pool[0]) return null;
    const control = pool[0];
    let root = control.parentElement;
    for (let depth = 0; depth < 18 && root; depth += 1) {
      if (["BODY", "HTML"].includes(root.tagName)) break;
      if (bestBuyBoundPrice(root, retailer) !== null && bestBuySellerUnambiguous(root, retailer) && bestBuyQuantityOne(root)) {
        const fulfillment = bestBuyFulfillment(root, control, reservation);
        const skus = bestBuySkuEvidence(root);
        const identityBound = skus.size === 1 && skus.has(expectedSku);
        const exactPageOnlyControl = controls.length === 1 && skus.size === 0;
        if (fulfillment !== "unknown" && (identityBound || exactPageOnlyControl)) {
          return { control, fulfillment, offerRoot: root };
        }
      }
      root = root.parentElement;
    }
    return null;
  }
  function bestBuyQuantityOne(root) {
    const quantitySelectors = selectorsFor("bestbuy", "quantity");
    selectorListTrace("quantity", root, quantitySelectors);
    const controls = [...root.querySelectorAll(quantitySelectors.join(", "))].filter((element) => element.tagName === "INPUT" || visible2(element));
    if (!controls.length) return true;
    return controls.every((control) => String(control.value || "").trim() === "1");
  }
  function bestBuyOfferScope(control, retailer, expectedSku, reservation) {
    recordTrace({
      step: "offer_scope",
      condition: "bestbuy.merchandisingScope",
      actual: control.closest(BESTBUY_MERCHANDISING_SCOPE) ? "inside" : "outside",
      passed: !control.closest(BESTBUY_MERCHANDISING_SCOPE),
      ...control.closest(BESTBUY_MERCHANDISING_SCOPE) ? { reject: "merchandising_scope" } : {}
    });
    if (control.closest(BESTBUY_MERCHANDISING_SCOPE)) return null;
    const roots = [];
    const primary = control.closest(BESTBUY_PRIMARY_SCOPE);
    const form = control.closest("form");
    if (primary) roots.push(primary);
    if (form && !roots.includes(form)) roots.push(form);
    let current = control.parentElement;
    for (let depth = 0; depth < 14 && current; depth += 1) {
      if (["MAIN", "BODY", "HTML"].includes(current.tagName)) break;
      if (!roots.includes(current)) roots.push(current);
      current = current.parentElement;
    }
    for (const root of roots) {
      const controls = candidateControls(root, retailer);
      if (controls.length !== 1 || controls[0] !== control) continue;
      if (adaptiveReadPrice(root, retailer) === null || !bestBuySellerBound(root, retailer)) continue;
      const fulfillment = bestBuyFulfillment(root, control, reservation);
      if (fulfillment === "unknown" || !bestBuyQuantityOne(root)) continue;
      const skus = bestBuySkuEvidence(root);
      if (skus.size > 0 && (skus.size !== 1 || !skus.has(expectedSku))) continue;
      return { control, fulfillment, offerRoot: root };
    }
    return null;
  }
  function unmatchedFulfillment(candidates, expected) {
    const kinds = new Set(candidates.map((candidate) => candidate.fulfillment).filter((kind) => kind !== "unknown"));
    const only = [...kinds][0];
    return kinds.size === 1 && only && only !== expected ? only : "unknown";
  }
  function selectedBestBuyControl(document, retailer, expectedSku, requiredFulfillment) {
    const expectedFulfillment = requiredFulfillment === "pickup" ? "pickup" : "shipping";
    const reservation = bestBuyReservation(document, expectedSku);
    const scoped = candidateControls(document, retailer).map((control) => bestBuyOfferScope(control, retailer, expectedSku, reservation)).filter((candidate) => Boolean(candidate));
    const recovered = scoped.length === 0 ? recoveredBestBuyOfferScope(document, retailer, expectedSku, reservation) : null;
    const bound = [...scoped, ...recovered ? [recovered] : []];
    const matching = bound.filter((candidate) => candidate.fulfillment === expectedFulfillment);
    return matching.length === 1 && matching[0] ? matching[0] : { control: null, fulfillment: unmatchedFulfillment(bound, expectedFulfillment), offerRoot: null };
  }
  function bestBuyShippingBinding(document, urlValue, expectedSku, environment) {
    if (environment) return withAdapterEnvironment(environment, () => bestBuyShippingBinding(document, urlValue, expectedSku));
    if (!/^\d{5,20}$/.test(expectedSku) || extractRetailerSku("bestbuy", urlValue, document) !== expectedSku || retailerInteractiveBlock(document, urlValue)) return null;
    const retailer = CONFIGS.bestbuy;
    const shipping = selectedBestBuyControl(document, retailer, expectedSku, "shipping");
    const bound = shipping.offerRoot ? shipping : selectedBestBuyControl(document, retailer, expectedSku, "pickup");
    const root = bound.offerRoot;
    if (!root || !bound.control || !bestBuyQuantityOne(root) || sellerEvidence(document, bound.control, retailer, root).sellerType !== "first_party") return null;
    const reservation = bestBuyReservationShipping(document, expectedSku);
    if (reservation && bound.fulfillment === "shipping" && bound.control === reservation.control) {
      return { control: reservation.tile, offerRoot: root, selected: true };
    }
    const controls = [...root.querySelectorAll("[role='radio'], [role='tab'], input[type='radio']")].filter((element) => {
      if (!renderedVisible2(element) || element.closest(BESTBUY_MERCHANDISING_SCOPE) || element.closest("a[href]") || element.matches(":disabled") || element.closest("[aria-disabled='true'], [aria-busy='true']") || element.tagName === "BUTTON" && element.getAttribute("type") !== "button") return false;
      const label = element.tagName === "INPUT" ? element.labels?.[0] || element : element;
      const evidence = `${element.getAttribute("aria-label") || ""} ${observableText(label, 800)}`;
      if (!retailer.shippingPattern.test(evidence) || retailer.pickupPattern.test(evidence) || /unavailable|not available|not eligible|sold out|out of stock|in.store.only|add to cart|buy now|checkout/i.test(evidence)) return false;
      const skuTiles = [element, ...element.querySelectorAll("[data-testid^='pdp-shipping-tile-']")];
      if (skuTiles.some((tile) => {
        const match = tile.getAttribute("data-testid")?.match(/^pdp-shipping-tile-(\d+)(?:-selected)?$/);
        return match && match[1] !== expectedSku;
      })) return false;
      return true;
    });
    if (controls.length !== 1 || !controls[0]) return null;
    const control = controls[0];
    const selected = control.tagName === "INPUT" ? control.checked : control.getAttribute("aria-checked") === "true" || control.getAttribute("aria-selected") === "true";
    return { control, offerRoot: root, selected: selected && bound.fulfillment === "shipping" };
  }
  function selectedControl(document, retailer, requiredFulfillment, expectedSku = "") {
    recordTrace({
      step: "add_control",
      condition: "selectedControl.retailer",
      expected: retailer.retailerId,
      actual: retailer.retailerId,
      passed: true
    });
    if (retailer.retailerId === "audioadvice") {
      const binding = audioAdviceOfferBinding(document, document.URL, expectedSku, activeAdapterEnvironment);
      return {
        control: binding?.control || null,
        offerRoot: binding?.root || null,
        fulfillment: binding ? "shipping" : "unknown"
      };
    }
    if (retailer.retailerId === "bananarepublic") {
      const binding = bananarepublicOfferBinding(document, document.URL, expectedSku, activeAdapterEnvironment);
      return {
        control: binding?.control || null,
        offerRoot: binding?.root || null,
        fulfillment: binding ? "shipping" : "unknown"
      };
    }
    if (retailer.retailerId === "bananarepublicfactory") {
      const binding = bananarepublicfactoryOfferBinding(document, document.URL, expectedSku, activeAdapterEnvironment);
      return {
        control: binding?.control || null,
        offerRoot: binding?.root || null,
        fulfillment: binding ? "shipping" : "unknown"
      };
    }
    if (retailer.retailerId === "athleta") {
      const binding = athletaOfferBinding(document, document.URL, expectedSku, activeAdapterEnvironment);
      return {
        control: binding?.control || null,
        offerRoot: binding?.root || null,
        fulfillment: binding ? "shipping" : "unknown"
      };
    }
    if (retailer.retailerId === "asus") {
      const binding = asusOfferBinding(document, document.URL, expectedSku, activeAdapterEnvironment);
      return {
        control: binding?.control || null,
        offerRoot: binding?.root || null,
        fulfillment: binding ? "shipping" : "unknown"
      };
    }
    const expectedFulfillment = requiredFulfillment === "pickup" ? "pickup" : "shipping";
    if (retailer.retailerId === "walmart" && CONFIGS.walmart.skuPattern.test(expectedSku)) {
      return selectedWalmartControl(document, retailer, expectedSku, requiredFulfillment);
    }
    if (retailer.retailerId === "amazon" && CONFIGS.amazon.skuPattern.test(expectedSku)) {
      return selectedAmazonControl(document, retailer, expectedSku, requiredFulfillment);
    }
    if (retailer.retailerId === "bestbuy" && CONFIGS.bestbuy.skuPattern.test(expectedSku)) {
      return selectedBestBuyControl(document, retailer, expectedSku, requiredFulfillment);
    }
    const candidates = candidateControls(document, retailer).map((control) => ({ control, fulfillment: fulfillmentEvidence(document, control, retailer) }));
    const matching = candidates.filter((candidate) => candidate.fulfillment === expectedFulfillment);
    const selected = matching.length === 1 && matching[0] ? matching[0] : { control: null, fulfillment: unmatchedFulfillment(candidates, expectedFulfillment) };
    return { ...selected, offerRoot: null };
  }
  function retailerAddControl(document, urlValue, retailerId, expectedSku, requiredFulfillment, environment) {
    if (environment) {
      return withAdapterEnvironment(environment, () => retailerAddControl(document, urlValue, retailerId, expectedSku, requiredFulfillment));
    }
    const retailer = CONFIGS[retailerId];
    if (extractRetailerSku(retailerId, urlValue, document) !== expectedSku) return null;
    const selected = selectedControl(document, retailer, requiredFulfillment, expectedSku);
    const expectedFulfillment = requiredFulfillment === "pickup" ? "pickup" : "shipping";
    const fulfillmentAllowed2 = selected.fulfillment === expectedFulfillment;
    const chosen = fulfillmentAllowed2 && actionable(selected.control) ? selected.control : null;
    recordTrace({
      step: "add_control",
      chosen: chosen ? 1 : 0,
      condition: "actionable",
      expected: "true",
      actual: String(Boolean(chosen)),
      passed: Boolean(chosen),
      ...chosen ? {} : { reject: "not_actionable" }
    });
    return chosen;
  }
  var UNAVAILABLE_EVIDENCE = /\b(?:out of stock|sold out|currently unavailable|coming soon)\b/i;
  function explicitlyUnavailableOffer(document, retailer) {
    const selectors = selectorsFor(retailer.retailerId, "availability");
    const flagged = selectors.length > 0 && [...document.querySelectorAll(selectors.join(", "))].filter((element) => visible2(element) && !merchandisingControl(element)).some((element) => UNAVAILABLE_EVIDENCE.test(
      `${element.getAttribute("content") || ""} ${element.getAttribute("aria-label") || ""} ${observableText(element, 500)}`
    ));
    if (flagged) return true;
    const intentPattern = retailer.addIntentPattern ?? ADD_CONTROL_INTENT;
    const controls = [...new Set(retailer.addSelectors.flatMap((selector) => [...document.querySelectorAll(selector)]))].filter((element) => visible2(element) && intentPattern.test(controlIntent(element)) && !merchandisingControl(element));
    return controls.length > 0 && controls.every((control) => !actionable(control));
  }
  function observeRetailerOffer(document, urlValue, retailerId, expectedSku, requiredFulfillment = "shipping", observedAt = (/* @__PURE__ */ new Date()).toISOString(), environment) {
    if (retailerId === "asus") {
      const observation = observeAsusOffer(document, urlValue, expectedSku, observedAt, environment || activeAdapterEnvironment);
      return requiredFulfillment === "shipping" ? observation : { ...observation, availability: "unknown", fulfillment: "unknown", addControlActionable: false };
    }
    if (retailerId === "audioadvice") {
      const observation = observeAudioAdviceOffer(document, urlValue, expectedSku, observedAt, environment || activeAdapterEnvironment);
      return requiredFulfillment === "shipping" ? observation : { ...observation, availability: "unknown", fulfillment: "unknown", addControlActionable: false };
    }
    if (retailerId === "bananarepublic") {
      const observation = observeBananaRepublicOffer(document, urlValue, expectedSku, observedAt, environment || activeAdapterEnvironment);
      return requiredFulfillment === "shipping" ? observation : { ...observation, availability: "unknown", fulfillment: "unknown", addControlActionable: false };
    }
    if (retailerId === "bananarepublicfactory") {
      const observation = observeBananaRepublicFactoryOffer(document, urlValue, expectedSku, observedAt, environment || activeAdapterEnvironment);
      return requiredFulfillment === "shipping" ? observation : { ...observation, availability: "unknown", fulfillment: "unknown", addControlActionable: false };
    }
    if (retailerId === "athleta") {
      const observation = observeAthletaOffer(document, urlValue, expectedSku, observedAt, environment || activeAdapterEnvironment);
      return requiredFulfillment === "shipping" ? observation : { ...observation, availability: "unknown", fulfillment: "unknown", addControlActionable: false };
    }
    if (retailerId === "americaneagle") {
      const observation = observeAmericanEagleOffer(document, urlValue, expectedSku, observedAt, environment || activeAdapterEnvironment);
      return requiredFulfillment === "shipping" ? observation : { ...observation, availability: "unknown", fulfillment: "unknown", addControlActionable: false };
    }
    if (retailerId === "aninebing") {
      const observation = observeAnineBingOffer(document, urlValue, expectedSku, observedAt, environment || activeAdapterEnvironment);
      return requiredFulfillment === "shipping" ? observation : { ...observation, availability: "unknown", fulfillment: "unknown", addControlActionable: false };
    }
    if (environment) {
      return withAdapterEnvironment(environment, () => observeRetailerOffer(
        document,
        urlValue,
        retailerId,
        expectedSku,
        requiredFulfillment,
        observedAt
      ));
    }
    const retailer = CONFIGS[retailerId];
    const pageSku = extractRetailerSku(retailerId, urlValue, document);
    recordTrace({
      step: "page_identity",
      condition: "retailerSku",
      expected: expectedSku,
      actual: pageSku,
      passed: pageSku === expectedSku,
      ...pageSku === expectedSku ? {} : { reject: "sku_mismatch" }
    });
    const blocked = retailerInteractiveBlock(document, urlValue);
    const selected = pageSku === expectedSku ? selectedControl(document, retailer, requiredFulfillment, expectedSku) : { control: null, fulfillment: "unknown", offerRoot: null };
    const retainBoundManualEvidence = blocked === "high_demand" && pageSku === expectedSku && Boolean(selected.offerRoot);
    const seller = blocked && !retainBoundManualEvidence ? { sellerName: "", sellerType: "unknown" } : selected.structuredOffer ? { sellerName: selected.structuredOffer.sellerName, sellerType: selected.structuredOffer.sellerType } : sellerEvidence(document, selected.control, retailer, selected.offerRoot);
    const priceRoot = selected.offerRoot || selected.control?.closest("form, [data-testid*='buy-box' i], [data-automation-id*='buy-box' i], #buybox, main") || null;
    const unitPriceCents = (!blocked || retainBoundManualEvidence) && priceRoot ? selected.structuredOffer?.unitPriceCents ?? adaptiveReadPrice(priceRoot, retailer) ?? adaptiveReadPrice(document, retailer) : null;
    const selectedControlActionable = pageSku === expectedSku && actionable(selected.control);
    const canAdd = selectedControlActionable && !blocked;
    const controlText = text8(selected.control, 300);
    const availability = blocked && !(retainBoundManualEvidence && selectedControlActionable) ? "unknown" : selectedControlActionable ? /pre[ -]?order/i.test(controlText) ? "preorder" : "in_stock" : explicitlyUnavailableOffer(document, retailer) ? "out_of_stock" : "unknown";
    recordTrace({
      step: "availability",
      condition: "offer.availability",
      expected: "in_stock or preorder",
      actual: availability,
      passed: availability === "in_stock" || availability === "preorder",
      ...availability === "in_stock" || availability === "preorder" ? {} : { reject: "not_actionable" }
    });
    return {
      contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
      observedAt,
      url: urlValue,
      pageKind: pageSku ? "product" : "other",
      retailerId,
      retailerSku: pageSku,
      ...pageSku === expectedSku && ["amazon", "walmart", "bestbuy"].includes(retailerId) ? {
        selectedOffer: observeRetailerSelectedOfferScope(document, urlValue, retailerId, expectedSku, requiredFulfillment)
      } : {},
      availability,
      unitPriceCents,
      currency: "USD",
      sellerName: seller.sellerName,
      sellerType: seller.sellerType,
      fulfillment: blocked && !retainBoundManualEvidence ? "unknown" : selected.fulfillment,
      addControlActionable: canAdd,
      securityChallenge: retailerSecurityChallenge(document, retailerId),
      interactiveBlock: blocked
    };
  }
  function observeRetailerSelectedOfferScope(document, urlValue, retailerId, expectedSku, requiredFulfillment = "shipping", environment) {
    if (retailerId === "asus") {
      const binding = asusOfferBinding(document, urlValue, expectedSku, environment);
      return {
        schemaVersion: 1,
        selectionState: binding ? "exact" : "unresolved",
        childOfferKey: expectedSku,
        attributes: {}
      };
    }
    if (retailerId === "audioadvice") {
      const binding = audioAdviceOfferBinding(document, urlValue, expectedSku, environment);
      return {
        schemaVersion: 1,
        selectionState: binding ? "exact" : "unresolved",
        childOfferKey: expectedSku,
        attributes: {}
      };
    }
    if (retailerId === "bananarepublic") {
      const binding = bananarepublicOfferBinding(document, urlValue, expectedSku, environment);
      return {
        schemaVersion: 1,
        selectionState: binding ? "exact" : "unresolved",
        childOfferKey: expectedSku,
        attributes: binding ? { size: "One Size" } : {}
      };
    }
    if (retailerId === "bananarepublicfactory") {
      const binding = bananarepublicfactoryOfferBinding(document, urlValue, expectedSku, environment);
      return {
        schemaVersion: 1,
        selectionState: binding ? "exact" : "unresolved",
        childOfferKey: expectedSku,
        attributes: binding ? { size: "One Size" } : {}
      };
    }
    if (retailerId === "athleta") {
      const binding = athletaOfferBinding(document, urlValue, expectedSku, environment);
      return {
        schemaVersion: 1,
        selectionState: binding ? "exact" : "unresolved",
        childOfferKey: expectedSku,
        attributes: binding ? { size: "One Size" } : {}
      };
    }
    if (retailerId === "americaneagle") {
      const binding = americanEagleOfferBinding(document, urlValue, expectedSku, environment);
      return {
        schemaVersion: 1,
        selectionState: binding ? "exact" : "unresolved",
        childOfferKey: expectedSku,
        attributes: binding ? { size: "One Size", style: binding.styleColor } : {}
      };
    }
    if (retailerId === "aninebing") {
      const binding = anineBingOfferBinding(document, urlValue, expectedSku, environment);
      return {
        schemaVersion: 1,
        selectionState: binding ? "exact" : "unresolved",
        childOfferKey: expectedSku,
        attributes: {}
      };
    }
    if (environment) {
      return withAdapterEnvironment(environment, () => observeRetailerSelectedOfferScope(
        document,
        urlValue,
        retailerId,
        expectedSku,
        requiredFulfillment
      ));
    }
    const pageSku = extractRetailerSku(retailerId, urlValue, document);
    if (!pageSku || pageSku !== expectedSku) throw new Error("The exact retailer listing identity is unavailable.");
    const selected = selectedControl(document, CONFIGS[retailerId], requiredFulfillment, expectedSku);
    if (retailerId === "walmart" && selected.structuredOffer?.exactSelectionBound === true) {
      return {
        schemaVersion: 1,
        selectionState: "exact",
        childOfferKey: pageSku,
        attributes: {}
      };
    }
    return selectedOfferScope(
      document,
      retailerId,
      pageSku,
      selected.offerRoot || selected.control?.closest("form, main") || document
    );
  }
  function cleanAmazonOfferId(value) {
    const candidate = String(value ?? "").replace(/^`+|`+$/g, "").trim();
    return candidate && candidate.length <= 2048 && !/[`\u0000-\u001f\u007f]/.test(candidate) ? candidate : "";
  }

  // packages/browser-adapters/src/bestbuy.ts
  var BESTBUY_MERCHANDISING_SCOPE2 = selectorsFor("bestbuy", "merchandisingScope").join(", ");
  function text9(value, maximum = 2e3) {
    return String(value?.textContent || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
  }
  function visibleSelf(element) {
    if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") return false;
    const style = String(element.getAttribute("style") || "").replace(/\s+/g, "").toLocaleLowerCase("en-US");
    return !/(?:^|;)display:none(?:;|$)|(?:^|;)visibility:hidden(?:;|$)/.test(style);
  }
  function visible3(element) {
    if (!element) return false;
    for (let current = element; current; current = current.parentElement) {
      if (!visibleSelf(current)) return false;
    }
    return true;
  }
  function scopedText(root, skip, maximum = 3e4, shown = visibleSelf) {
    const parts = [];
    let size = 0;
    const visit = (node) => {
      if (size >= maximum) return;
      if (node.nodeType === 3) {
        const value = node.textContent || "";
        parts.push(value);
        size += value.length;
        return;
      }
      if (node.nodeType !== 1) return;
      const element = node;
      if (["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "SELECT"].includes(element.tagName)) return;
      if (element !== root && (!shown(element) || skip(element))) return;
      for (const child of element.childNodes) visit(child);
    };
    visit(root);
    return parts.join(" ").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
  }
  function queryVisible2(root, selectors) {
    for (const selector of selectors) {
      const found = [...root.querySelectorAll(selector)].find(visible3);
      if (found) return found;
    }
    return null;
  }
  function bestBuyHost(url) {
    return url.protocol === "https:" && !url.username && !url.password && (url.hostname === "bestbuy.com" || url.hostname.endsWith(".bestbuy.com"));
  }
  function bestBuyPageKind(urlValue, document) {
    try {
      const url = new URL(urlValue);
      if (!bestBuyHost(url)) return "other";
      const path = url.pathname.toLocaleLowerCase("en-US");
      if (/\/identity\/(?:global\/)?signin|\/login|\/signin|\/challenge/.test(path)) return "auth";
      if (/waiting-room|virtual-queue|\/queue(?:\/|$)|^\/qp(?:\/|$)/.test(path)) return "queue";
      if (/^\/cart(?:\/|$)/.test(path)) return "cart";
      if (/^\/(?:checkout|payment|purchase)(?:\/|$)/.test(path)) return "checkout";
      return extractRetailerSku("bestbuy", urlValue, document) ? "product" : "other";
    } catch {
      return "other";
    }
  }
  function bestBuyAddControl(documentValue, urlValue, expectedSku, requiredFulfillment, environment) {
    if (requiredFulfillment !== "shipping" && requiredFulfillment !== "pickup") return null;
    if (retailerInteractiveBlock(documentValue, urlValue, environment)) return null;
    return retailerAddControl(documentValue, urlValue, "bestbuy", expectedSku, requiredFulfillment, environment);
  }
  function observeBestBuyOffer(documentValue, urlValue, expectedSku, requiredFulfillment, observedAt = (/* @__PURE__ */ new Date()).toISOString(), environment) {
    const observation = observeRetailerOffer(
      documentValue,
      urlValue,
      "bestbuy",
      expectedSku,
      requiredFulfillment,
      observedAt,
      environment
    );
    return { ...observation, pageKind: bestBuyPageKind(urlValue, documentValue) };
  }
  var FULFILLMENT_UNAVAILABLE = /\b(?:unavailable|not available|not eligible|sold out|out of stock)\b/i;
  function bestBuyFulfillmentUnavailable(documentValue, expectedSku, fulfillment, environment) {
    if (!/^\d{5,20}$/.test(expectedSku) || fulfillment !== "shipping" && fulfillment !== "pickup") return false;
    const tiles = [...documentValue.querySelectorAll(
      `[data-testid='pdp-${fulfillment}-tile-${expectedSku}'], [data-testid='pdp-${fulfillment}-tile-${expectedSku}-selected']`
    )].filter((tile) => renderedVisible(tile, environment) && !tile.closest(BESTBUY_MERCHANDISING_SCOPE2));
    return tiles.length > 0 && tiles.every((tile) => FULFILLMENT_UNAVAILABLE.test(`${tile.getAttribute("aria-label") || ""} ${text9(tile, 500)}`));
  }
  function bestBuyFulfillmentLoading(documentValue, environment) {
    return [...documentValue.querySelectorAll("[data-testid='fulfillment-selector-loading']")].some((element) => renderedVisible(element, environment) && !element.closest(BESTBUY_MERCHANDISING_SCOPE2));
  }
  var ADD_INTENT = /\badd(?:\s+(?:item\s+)?to)?\s+(?:cart|bag)\b|\bpre[ -]?order\b/i;
  var PURCHASE_LIMIT = /\blimit(?:ed)?(?:\s+(?:of|to))?\s+(\d{1,2})\s+(?:per|each)\s+(?:customer|order|household|guest|account|person|member|transaction)s?\b/gi;
  function wholeQuantity(value) {
    const candidate = String(value ?? "").trim();
    return /^\d{1,2}$/.test(candidate) && Number(candidate) >= 1 ? Number(candidate) : null;
  }
  function purchaseLimits(value) {
    return [...value.matchAll(PURCHASE_LIMIT)].map((match) => wholeQuantity(match[1])).filter((limit) => limit !== null);
  }
  function replayVisibility(environment) {
    const isVisible = environment?.isVisible;
    if (!isVisible) return visible3;
    return (element) => {
      try {
        return isVisible(element);
      } catch {
        return false;
      }
    };
  }
  function addIntentControls(root, shown) {
    return [...root.querySelectorAll("button, [role='button'], input[type='submit']")].filter((element) => shown(element) && !element.closest(BESTBUY_MERCHANDISING_SCOPE2) && ADD_INTENT.test(`${element.getAttribute("aria-label") || ""} ${element.getAttribute("value") || ""} ${text9(element, 200)}`));
  }
  function bestBuyBuyBox(control, shown) {
    let root = null;
    for (let node = control.parentElement; node && !["MAIN", "BODY", "HTML"].includes(node.tagName); node = node.parentElement) {
      if (addIntentControls(node, shown).some((other) => other !== control && !other.contains(control) && !control.contains(other))) break;
      root = node;
    }
    return root;
  }
  function bestBuyPurchaseLimit(control, environment) {
    const shown = replayVisibility(environment);
    const root = control ? bestBuyBuyBox(control, shown) : null;
    if (!root) return null;
    const limits = purchaseLimits(scopedText(
      root,
      (element) => element.matches(BESTBUY_MERCHANDISING_SCOPE2),
      3e4,
      environment?.isVisible ? shown : visibleSelf
    ));
    return limits.length ? Math.min(...limits) : null;
  }
  function bestBuyBoundProductCode(documentValue, urlValue, expectedSku) {
    if (!/^\d{5,20}$/.test(expectedSku) || extractRetailerSku("bestbuy", urlValue, documentValue) !== expectedSku) return "";
    const own = bestBuyProductCode(urlValue);
    if (own) return own;
    const codes = /* @__PURE__ */ new Set();
    for (const element of documentValue.querySelectorAll("link[rel='canonical'], meta[property='og:url']")) {
      let href = "";
      try {
        href = new URL(element.getAttribute("href") || element.getAttribute("content") || "", urlValue).href;
      } catch {
        continue;
      }
      const code = bestBuyProductCode(href);
      if (code && bestBuyPageSku(documentValue, href) === expectedSku) codes.add(code);
    }
    return codes.size === 1 ? [...codes][0] ?? "" : "";
  }
  var CART_SIDE_SCOPE = [
    BESTBUY_MERCHANDISING_SCOPE2,
    "[class*='protection-plan' i]",
    "[class*='geek-squad' i]",
    "[class*='geeksquad' i]",
    "[data-testid*='protection' i]",
    "[data-testid*='warranty' i]",
    "[data-testid*='geek-squad' i]"
  ].join(", ");
  function sideScoped(element, line) {
    for (let node = element; node && node !== line; node = node.parentElement) {
      if (node.matches(CART_SIDE_SCOPE)) return true;
    }
    return false;
  }
  function lineParts(line, selector) {
    return [...line.querySelectorAll(selector)].slice(0, 5e3).filter((element) => !sideScoped(element, line));
  }
  function lineText(line, maximum = 2e4) {
    return scopedText(line, (element) => element.matches(CART_SIDE_SCOPE), maximum);
  }
  var SKU_VALUE = /^\d{5,20}$/;
  var SKU_QUERY = /[?&]skuId=(\d{5,20})(?!\d)/gi;
  var URL_ATTRIBUTES = ["href", "data-href", "data-url", "data-link", "action"];
  function lineIdentity(line) {
    for (const name of ["data-test-sku", "data-sku-id", "data-sku", "data-product-id"]) {
      const own = String(line.getAttribute(name) || "").trim();
      if (SKU_VALUE.test(own)) return { sku: own, code: "" };
    }
    const skus = /* @__PURE__ */ new Set();
    const codes = /* @__PURE__ */ new Set();
    const add = (value) => {
      const candidate = String(value ?? "").trim();
      if (SKU_VALUE.test(candidate)) skus.add(candidate);
    };
    for (const element of lineParts(line, "*")) {
      add(element.getAttribute("data-sku-id"));
      add(element.getAttribute("data-sku"));
      if (element.tagName === "INPUT" && /sku/i.test(element.getAttribute("name") || "")) add(element.value);
      for (const name of URL_ATTRIBUTES) {
        const raw = element.getAttribute(name);
        if (!raw) continue;
        for (const match of raw.matchAll(SKU_QUERY)) add(match[1]);
        let href = "";
        try {
          href = new URL(raw, "https://www.bestbuy.com").href;
        } catch {
          continue;
        }
        add(extractRetailerSku("bestbuy", href));
        const code = bestBuyProductCode(href);
        if (code) codes.add(code);
      }
    }
    for (const match of lineText(line).matchAll(/\bSKU\s*:?\s*(\d{5,20})\b/gi)) add(match[1]);
    if (skus.size > 0) return { sku: skus.size === 1 ? [...skus][0] ?? "" : "", code: "" };
    return { sku: "", code: codes.size === 1 ? [...codes][0] ?? "" : "" };
  }
  function lineKey(identity, binding) {
    if (identity.sku) return identity.sku;
    if (!identity.code) return "";
    return binding && identity.code === binding.productCode ? binding.retailerSku : identity.code;
  }
  var QUANTITY_HINT2 = /qty|quantity/i;
  var STEPPER_FORBIDDEN = /\b(?:cart|checkout|buy|save|remove|delete|trash|protection|plan|warranty|pickup|shipping|member|membership)\b/i;
  var TEXT_INPUT = "input:not([type]), input[type='text'], input[type='number'], input[type='tel']";
  function controlLabel(element) {
    const labelledBy = String(element.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean).map((id) => text9(element.ownerDocument.getElementById(id), 200)).join(" ");
    const labels = [...element.labels || []].map((label) => scopedText(label, () => false, 200)).join(" ");
    return [element.getAttribute("aria-label"), element.getAttribute("title"), labelledBy, labels].filter(Boolean).join(" ");
  }
  function quantityHinted(element) {
    return ["name", "id", "class", "data-testid", "data-test", "data-automation-id"].some((name) => QUANTITY_HINT2.test(element.getAttribute(name) || "")) || QUANTITY_HINT2.test(controlLabel(element));
  }
  function optionQuantity(option) {
    return wholeQuantity(option.value) ?? parseQuantityText(option.textContent);
  }
  function numericOptions(select) {
    const options = [...select.options];
    return options.length > 0 && options.every((option) => optionQuantity(option) !== null);
  }
  function buttonLabel(element) {
    return `${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""} ${text9(element, 80)}`.replace(/\s+/g, " ").trim();
  }
  function increaseButton(element) {
    const label = buttonLabel(element);
    if (!label || label.length > 80 || STEPPER_FORBIDDEN.test(label)) return false;
    return /^[+＋]$/.test(label) || /^(?:increase|increment|add one|plus one|plus)$/i.test(label) || /\b(?:increase|increment)\b/i.test(label) && QUANTITY_HINT2.test(label);
  }
  function stepperValue(button, line) {
    for (let node = button.parentElement, depth = 0; node && depth < 4; node = node === line ? null : node.parentElement, depth += 1) {
      const parts = [...node.querySelectorAll("select, input, [role='spinbutton'], output, span, div, p, strong, b, label")].filter((element) => element !== button && !button.contains(element) && !element.contains(button) && !element.matches("input[type='hidden'], input[type='checkbox'], input[type='radio'], input[type='submit'], input[type='button']") && visible3(element) && !sideScoped(element, line));
      const formLike = parts.filter((element) => ["SELECT", "INPUT"].includes(element.tagName) || element.getAttribute("role") === "spinbutton");
      if (formLike.length) return formLike.length === 1 ? formLike[0] ?? null : null;
      const displays = parts.filter((element) => element.childElementCount === 0 && /^\s*(?:(?:qty|quantity)\s*:?\s*)?\d{1,2}\s*$/i.test(element.textContent || ""));
      if (displays.length) return displays.length === 1 ? displays[0] ?? null : null;
    }
    return null;
  }
  function quantityControls(line) {
    const controls = [];
    const add = (kind, element, increase = null) => {
      const existing = controls.find((control) => control.element === element);
      if (existing) {
        if (!existing.increase) existing.increase = increase;
        return;
      }
      controls.push({ kind, element, increase });
    };
    for (const select of lineParts(line, "select")) {
      if (visible3(select) && (quantityHinted(select) || numericOptions(select))) add("select", select);
    }
    for (const input of lineParts(line, TEXT_INPUT)) {
      if (visible3(input) && quantityHinted(input)) add("input", input);
    }
    for (const spin of lineParts(line, "[role='spinbutton']")) {
      if (!["SELECT", "INPUT"].includes(spin.tagName) && visible3(spin)) add("spinbutton", spin);
    }
    let unreadableStepper = false;
    for (const button of lineParts(line, "button, [role='button']")) {
      if (!visible3(button) || !increaseButton(button)) continue;
      const value = stepperValue(button, line);
      if (!value) {
        unreadableStepper = true;
        continue;
      }
      add(value.tagName === "SELECT" ? "select" : value.tagName === "INPUT" ? "input" : value.getAttribute("role") === "spinbutton" ? "spinbutton" : "stepper", value, button);
    }
    return { controls, unreadableStepper };
  }
  function controlQuantity(control) {
    const element = control.element;
    if (element.tagName === "SELECT") {
      const select = element;
      const option = select.selectedOptions.length === 1 ? select.selectedOptions[0] : void 0;
      return option ? optionQuantity(option) : null;
    }
    if (element.tagName === "INPUT") return wholeQuantity(element.value);
    const now = element.getAttribute("aria-valuenow");
    if (now !== null && now.trim()) return wholeQuantity(now);
    return parseQuantityText(element.textContent);
  }
  function labelledQuantity(line) {
    const readings = /* @__PURE__ */ new Set();
    for (const label of lineParts(line, "span > span.sr-only")) {
      const holder = label.parentElement;
      if (!holder || holder === line || !/\bquantity$/i.test(text9(label, 300)) || !visible3(holder)) continue;
      const quantity = wholeQuantity([...holder.childNodes].filter((node) => node !== label).map((node) => node.textContent || "").join(" "));
      if (quantity !== null) readings.add(quantity);
    }
    return readings.size === 1 ? [...readings][0] ?? null : null;
  }
  function staticQuantity(line) {
    const readings = /* @__PURE__ */ new Set();
    for (const element of lineParts(line, "span, div, p, strong, b, label, output, dd, td")) {
      if (element.childElementCount > 2 || !visible3(element)) continue;
      const value = scopedText(element, () => false, 120);
      if (!/^(?:qty|quantity)\s*:?\s*\d{1,2}$/i.test(value)) continue;
      const quantity = parseQuantityText(value);
      if (quantity !== null) readings.add(quantity);
    }
    return readings.size === 1 ? [...readings][0] ?? null : null;
  }
  function lineQuantity(line, controls = quantityControls(line)) {
    if (!controls.controls.length) {
      if (controls.unreadableStepper) return null;
      const shown = staticQuantity(line) ?? labelledQuantity(line);
      if (shown !== null) return shown;
      return line.matches(BEST_BUY_CART_LINE) ? 1 : null;
    }
    const readings = controls.controls.map(controlQuantity);
    const first = readings[0] ?? null;
    return first !== null && readings.every((reading) => reading === first) ? first : null;
  }
  var LINE_PRICE_SELECTORS = [
    // Best Buy's cart (2026-10): the line total, read where it is spelled out
    // whole; its other "price" test ids are savings and add-on prices.
    ".price-block__primary-price .sr-only",
    "[data-testid='customer-price']",
    "[data-testid*='line-price' i]",
    "[data-testid*='price' i]",
    ".priceView-customer-price",
    ".priceView-hero-price",
    "[itemprop='price']"
  ];
  var UNIT_PRICE_SELECTORS = ["[data-testid*='unit-price' i]", "[class*='unit-price' i]"];
  var EACH_PRICE = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:each\b|ea\b|\/\s*ea(?:ch)?\b|per\s+(?:item|unit)\b)/i;
  function firstLinePrice(line, selectors) {
    for (const selector of selectors) {
      for (const element of lineParts(line, selector)) {
        if (!visible3(element)) continue;
        const price = parseRetailerPriceElement(element);
        if (price !== null) return price;
      }
    }
    return null;
  }
  function lineUnitPrice(line, quantity) {
    const unit = firstLinePrice(line, UNIT_PRICE_SELECTORS);
    if (unit !== null) return unit;
    const each = lineText(line).match(EACH_PRICE)?.[1];
    if (each) {
      const cents6 = Math.round(Number(each.replace(/,/g, "")) * 100);
      if (Number.isSafeInteger(cents6) && cents6 > 0) return cents6;
    }
    const shown = firstLinePrice(line, LINE_PRICE_SELECTORS);
    if (shown === null) return null;
    return quantity !== null && quantity > 1 ? Math.ceil(shown / quantity) : shown;
  }
  function sellerEvidence2(line) {
    let sellerElement = null;
    for (const selector of ["[data-testid='sold-by']", "[data-testid*='sold-by' i]", "[data-testid*='seller' i]", "[class*='seller' i]"]) {
      sellerElement = lineParts(line, selector).find(visible3) ?? null;
      if (sellerElement) break;
    }
    const evidence = sellerElement ? text9(sellerElement, 12e3) : lineText(line, 12e3);
    if (/sold\s+(?:and|&)\s+shipped\s+by\s+best\s*buy|sold\s+by\s+best\s*buy/i.test(evidence)) {
      return { sellerName: "Best Buy", sellerType: "first_party" };
    }
    const marketplace = evidence.match(/sold\s+(?:and|&)\s+shipped\s+by\s+(.{1,160}?)(?:\s+(?:return|shipping|pickup|quantity|qty|\$)|$)/i)?.[1] ?? evidence.match(/sold\s+by\s+(.{1,160}?)(?:\s+(?:return|shipping|pickup|quantity|qty|\$)|$)/i)?.[1] ?? "";
    const sellerName = marketplace.trim().slice(0, 160);
    return sellerName ? { sellerName, sellerType: "third_party" } : { sellerName: "", sellerType: "unknown" };
  }
  var BEST_BUY_CART_LINE = ".fluid-item[data-test-sku]";
  function cartLineElements(documentValue) {
    const candidates = [...documentValue.querySelectorAll(
      `${BEST_BUY_CART_LINE}, [data-testid='cart-item'], [data-testid^='cart-item-'], [data-sku-id][class*='cart' i], li.item-list-item, [class~='cart-item']`
    )].filter(visible3);
    const lines = [...new Set(candidates)].filter((candidate) => !candidates.some((other) => other !== candidate && other.contains(candidate)));
    const unnamed = [...documentValue.querySelectorAll(".fluid-item")].some((item) => visible3(item) && !lines.some((line) => line.contains(item)));
    return unnamed ? [] : lines;
  }
  function visiblyEmpty(documentValue) {
    const root = queryVisible2(documentValue, ["[data-testid*='empty-cart' i]", "main", "body"]);
    return Boolean(root && /(?:your )?cart is empty|no items in (?:your )?cart|cart has no items/i.test(text9(root, 4e4)));
  }
  function bestBuyCartLines(documentValue, binding) {
    const elements6 = cartLineElements(documentValue);
    const lines = elements6.map((element) => {
      const seller = sellerEvidence2(element);
      const quantity = lineQuantity(element);
      return {
        element,
        retailerSku: lineKey(lineIdentity(element), binding),
        quantity,
        unitPriceCents: lineUnitPrice(element, quantity),
        sellerName: seller.sellerName,
        sellerType: seller.sellerType
      };
    });
    const independentlyCounted = elements6.length > 0 ? new Set(elements6).size === elements6.length : visiblyEmpty(documentValue);
    return { lines, independentlyCounted };
  }
  function observeBestBuyCart(documentValue, observedAt = (/* @__PURE__ */ new Date()).toISOString(), binding) {
    const { lines, independentlyCounted } = bestBuyCartLines(documentValue, binding);
    return {
      contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
      observedAt,
      complete: independentlyCounted && lines.every((line) => Boolean(line.retailerSku)),
      independentlyCounted,
      independentLineCount: lines.length,
      lines: lines.map(({ retailerSku, quantity, unitPriceCents, sellerName, sellerType }) => ({ retailerSku, quantity, unitPriceCents, sellerName, sellerType }))
    };
  }
  var LINE_LIMIT = /\blimit(?:ed)?(?:\s+(?:of|to))?\s+(\d{1,2})\s+(?:per|each)\b|\bmax(?:imum)?\s+(?:qty|quantity|purchase quantity|order quantity)(?:\s+(?:of|is))?\s*:?\s*(\d{1,2})\b|\bmax(?:imum)?\s+(?:of\s+)?(\d{1,2})\s+per\b/gi;
  var LIMIT_MESSAGE = /\blimit(?:ed)?(?:\s+(?:of|to))?\s+\d{1,2}\s+(?:per|each)\b|\b(?:quantity|purchase|order)\s+limit\b|\blimit\s+reached\b|\breached\s+(?:the|your)\s+(?:maximum|limit)\b|\bmax(?:imum)?\s+(?:qty|quantity)\b/i;
  function disabledControl(element) {
    return Boolean(element && (element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true" || element.closest("fieldset[disabled]")));
  }
  function bestBuyLineQuantityState(line) {
    const found = quantityControls(line);
    const quantity = lineQuantity(line, found);
    const controls = found.controls;
    const chosen = controls.find((control) => control.kind === "select") ?? controls.find((control) => control.kind === "input") ?? controls.find((control) => Boolean(control.increase)) ?? controls[0] ?? null;
    const limits = [];
    if (chosen?.kind === "select") {
      const values = [...chosen.element.options].filter((option) => !option.disabled).map(optionQuantity).filter((value) => value !== null);
      if (values.length) limits.push(Math.max(...values));
    }
    if (chosen?.kind === "input") {
      const maximum = wholeQuantity(chosen.element.getAttribute("max"));
      if (maximum !== null) limits.push(maximum);
    }
    for (const control of controls) {
      const maximum = wholeQuantity(control.element.getAttribute("aria-valuemax"));
      if (maximum !== null) limits.push(maximum);
    }
    const words = lineText(line);
    for (const match of words.matchAll(LINE_LIMIT)) {
      const limit = wholeQuantity(match[1] ?? match[2] ?? match[3]);
      if (limit !== null) limits.push(limit);
    }
    const increase = chosen?.increase ?? null;
    return {
      quantity,
      kind: chosen?.kind ?? "none",
      control: chosen?.element ?? null,
      increase,
      increaseEnabled: Boolean(increase) && !disabledControl(increase),
      disabled: disabledControl(chosen?.element ?? null),
      storeLimit: limits.length ? Math.min(...limits) : null,
      limitMessage: LIMIT_MESSAGE.test(words)
    };
  }
  function bestBuySecurityChallenge(documentValue) {
    return retailerSecurityChallenge(documentValue, "bestbuy");
  }
  function bestBuyInteractiveBlock(documentValue, urlValue) {
    return retailerInteractiveBlock(documentValue, urlValue);
  }
  function observeBestBuyPostAdd(document, urlValue, expectedSku, fulfillment, environment) {
    const result = (state, reason, addControlActionable = false) => ({ state, reason, addControlActionable });
    let url;
    try {
      url = new URL(urlValue);
    } catch {
      return result("user_action", "page_changed");
    }
    if (!bestBuyHost(url) || url.port || document.URL !== urlValue || !/^\d{5,20}$/.test(expectedSku)) return result("user_action", "page_changed");
    const kind = bestBuyPageKind(urlValue, document);
    const isVisible = (e) => {
      if (environment?.isVisible) return environment.isVisible(e);
      for (let p = e; p; p = p.parentElement) {
        if (p.hasAttribute("hidden") || p.hasAttribute("inert") || p.getAttribute("aria-hidden") === "true") return false;
        const style = document.defaultView?.getComputedStyle(p);
        if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) return false;
      }
      return true;
    };
    const visibleText = (root) => {
      const parts = [];
      const visit = (node) => {
        if (node.nodeType === 3) parts.push(node.textContent || "");
        else if (node.nodeType === 1 && !["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"].includes(node.tagName) && isVisible(node)) for (const child of node.childNodes) visit(child);
      };
      visit(root);
      return parts.join(" ").replace(/\s+/g, " ").trim();
    };
    if (bestBuySecurityChallenge(document)) return result("user_action", "security_challenge");
    const block = retailerInteractiveBlock(document, urlValue, environment);
    if (kind === "auth" || ["auth", "mfa", "location", "membership"].includes(block)) return result("user_action", "manual_action_required");
    const page = visibleText(document.body);
    if (kind === "queue" || block === "queue" || block === "high_demand" || /\b(?:you(?:['’]re| are) in (?:the )?line|virtual queue|waiting room|(?:your )?place in line|please (?:do not|don['’]t) (?:refresh|leave|close))\b/i.test(page)) {
      return result("queue", "bestbuy_queue_waiting");
    }
    if (block) return result("user_action", "manual_action_required");
    if ([...document.querySelectorAll("dialog[open], [role=dialog], [aria-modal=true]")].some((e) => isVisible(e) && !/\badded to (?:your )?cart\b/i.test(visibleText(e)))) return result("user_action", "manual_action_required");
    if (kind === "cart") return result("cart", "cart_page");
    if (kind !== "product") return result("unknown", "post_add_state_unknown");
    if (extractRetailerSku("bestbuy", urlValue, document) !== expectedSku) return result("user_action", "listing_mismatch");
    const waitingControl = [...document.querySelectorAll(
      `[data-testid='pdp-add-to-cart-${expectedSku}'], [data-sku-id='${expectedSku}'] button, [data-sku='${expectedSku}'] button`
    )].some((e) => isVisible(e) && /^(?:please wait|checking (?:inventory|availability)|getting in line)[.!…\s]*$/i.test(visibleText(e)));
    if (waitingControl) return result("queue", "bestbuy_queue_waiting");
    return result("product", "awaiting_cart", Boolean(bestBuyAddControl(document, urlValue, expectedSku, fulfillment, environment)));
  }

  // apps/extension/src/bestbuy-action.ts
  async function selectBestBuyShipping(documentValue, urlValue, expectedSku, environment, timing = {}) {
    pending = null;
    const timeoutMs = Math.min(4e3, Math.max(1, Number.isFinite(timing.timeoutMs) ? timing.timeoutMs : 3e3));
    const quietMs = Math.min(500, Math.max(0, Number.isFinite(timing.quietMs) ? timing.quietMs : 200));
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;
    const loadingDeadline = startedAt + Math.min(8e3, Math.max(
      timeoutMs,
      Number.isFinite(timing.loadingTimeoutMs) ? timing.loadingTimeoutMs : 8e3
    ));
    const initialDocumentUrl = documentValue.URL;
    let selectionClicked = false;
    let lastMutation = Date.now();
    let watchedRoot = null;
    let mutationObserver;
    const result = (ok, reason) => ({ ok, reason, selectionClicked });
    try {
      while (true) {
        if (!/^\d{5,20}$/.test(expectedSku) || documentValue.URL !== initialDocumentUrl || extractRetailerSku("bestbuy", urlValue, documentValue) !== expectedSku) return result(false, "listing_mismatch");
        if (retailerInteractiveBlock(documentValue, urlValue, environment)) {
          return result(false, "manual_action_required");
        }
        const binding = bestBuyShippingBinding(documentValue, urlValue, expectedSku, environment);
        if (binding) {
          if (binding.offerRoot !== watchedRoot) {
            mutationObserver?.disconnect();
            watchedRoot = binding.offerRoot;
            lastMutation = Date.now();
            const Observer = documentValue.defaultView?.MutationObserver;
            if (Observer) {
              mutationObserver = new Observer(() => {
                lastMutation = Date.now();
              });
              mutationObserver.observe(watchedRoot, { subtree: true, childList: true, attributes: true, characterData: true });
            }
          }
          if (binding.selected && (!selectionClicked || Date.now() - lastMutation >= quietMs)) {
            return result(true, "verified");
          }
          if (!binding.selected && !selectionClicked) {
            selectionClicked = true;
            lastMutation = Date.now();
            try {
              binding.control.click();
            } catch {
              return result(false, "fulfillment_selection_failed");
            }
            await new Promise((resolve) => setTimeout(resolve, Math.min(100, timeoutMs)));
            continue;
          }
        }
        const now = Date.now();
        const limit = !selectionClicked && now < loadingDeadline && bestBuyFulfillmentLoading(documentValue, environment) ? loadingDeadline : deadline;
        if (now >= limit) return result(false, selectionClicked ? "fulfillment_selection_failed" : "fulfillment_unverified");
        await new Promise((resolve) => setTimeout(resolve, Math.min(100, Math.max(1, limit - now))));
      }
    } catch {
      return result(false, "fulfillment_selection_failed");
    } finally {
      mutationObserver?.disconnect();
    }
  }
  var AUTHORIZATION_MAX_AGE_MS = 1e4;
  var sequence = 0;
  var pending = null;
  function traceElement(environment, condition, element) {
    if (!environment?.trace) return;
    const attributes = ["id", "name", "type", "role", "data-test", "data-testid", "data-test-id", "data-automation-id", "aria-label"].map((name) => element?.hasAttribute(name) ? `${name}=${JSON.stringify(String(element.getAttribute(name)).slice(0, 80))}` : "").filter(Boolean).join(" ");
    const content = String(element?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
    environment.trace.record({ step: "add_control", condition, actual: element ? `${element.tagName.toLowerCase()} ${attributes} ${content}`.trim() : "missing" });
  }
  function bestBuyJobReason(job) {
    if (job?.adapterVersion !== BESTBUY_ADD_ADAPTER_VERSION) return "adapter_version_mismatch";
    if (job?.retailerId !== "bestbuy" || job?.action !== "add_to_cart") return "unsupported_action";
    if (!guardedCartQuantity(job?.quantity)) return "quantity_not_supported";
    if (job?.sellerPolicy !== "first_party_only") return "seller_policy_not_supported";
    if (job?.fulfillment !== "shipping" && job?.fulfillment !== "pickup") return "fulfillment_not_supported";
    return "";
  }
  function honestOfferReason(reason, observation, documentValue, job, environment) {
    if (reason !== "out_of_stock" || observation.availability !== "unknown") return reason;
    return bestBuyFulfillmentUnavailable(documentValue, job.retailerSku, job.fulfillment, environment) ? "out_of_stock" : "add_control_unavailable";
  }
  function boundProof(proof, documentValue, urlValue, sku) {
    const productCode = bestBuyBoundProductCode(documentValue, urlValue, sku);
    return productCode ? { ...proof, productCode } : proof;
  }
  function quantityPlan(requested, storeLimit) {
    return { requested, storeLimit, add: 1, raiseTo: Math.min(requested, storeLimit ?? requested) };
  }
  function authorizationId(now) {
    sequence += 1;
    return `bestbuy_add_${now.toString(36)}_${sequence.toString(36)}`;
  }
  function abandonBestBuyAdd(value) {
    if (!pending || pending.id !== value) return false;
    pending = null;
    return true;
  }
  function prepareBestBuyAdd(documentValue, urlValue, job, now = Date.now(), environment) {
    pending = null;
    const invalid = bestBuyJobReason(job);
    if (invalid) return { ok: false, reason: invalid };
    const observation = observeBestBuyOffer(
      documentValue,
      urlValue,
      job.retailerSku,
      job.fulfillment,
      new Date(now).toISOString(),
      environment
    );
    const verified = verifyLiveOffer(job, observation, now);
    if (!verified.ok) return { ok: false, reason: honestOfferReason(verified.reason, observation, documentValue, job, environment) };
    const control = bestBuyAddControl(documentValue, urlValue, job.retailerSku, job.fulfillment, environment);
    if (!control) return { ok: false, reason: "add_control_unavailable" };
    const quantity = job.quantity > 1 ? quantityPlan(job.quantity, bestBuyPurchaseLimit(control, environment)) : null;
    const proof = boundProof(verified.proof, documentValue, urlValue, job.retailerSku);
    const id = authorizationId(now);
    pending = {
      id,
      jobId: job.jobId,
      createdAt: now,
      control,
      proof,
      document: documentValue,
      jobSnapshot: JSON.stringify(job),
      add: 1
    };
    return { ok: true, reason: "verified", authorizationId: id, proof, ...quantity ? { quantity } : {} };
  }
  function rehearseBestBuyAdd(documentValue, urlValue, job, now = Date.now(), environment) {
    const prepared = prepareBestBuyAdd(documentValue, urlValue, { ...job, validationMode: "rehearsal" }, now, environment);
    if (!prepared.ok) return prepared;
    abandonBestBuyAdd(prepared.authorizationId);
    return {
      ok: true,
      reason: "verified",
      proof: prepared.proof,
      wouldClick: true,
      ...prepared.quantity ? { quantity: prepared.quantity } : {}
    };
  }
  function commitBestBuyAdd(documentValue, urlValue, job, value, now = Date.now(), environment) {
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
    const invalid = bestBuyJobReason(job);
    if (invalid) return { ok: false, reason: invalid, clicked: false };
    const observation = observeBestBuyOffer(
      documentValue,
      urlValue,
      job.retailerSku,
      job.fulfillment,
      new Date(now).toISOString(),
      environment
    );
    const verified = verifyLiveOffer(job, observation, now);
    if (!verified.ok) {
      return { ok: false, reason: honestOfferReason(verified.reason, observation, documentValue, job, environment), clicked: false };
    }
    const control = bestBuyAddControl(documentValue, urlValue, job.retailerSku, job.fulfillment, environment);
    if (!control || control !== authorization.control) {
      traceElement(environment, "authorized", authorization.control);
      traceElement(environment, "rebound", control);
      return { ok: false, reason: "add_control_changed", clicked: false };
    }
    if (authorization.add !== 1) return { ok: false, reason: "quantity_not_supported", clicked: false };
    const proof = boundProof(verified.proof, documentValue, urlValue, job.retailerSku);
    try {
      control.click();
      return { ok: true, reason: "clicked", clicked: true, proof };
    } catch {
      return { ok: false, reason: "click_failed", clicked: false };
    }
  }
  function bestBuyCartUrl(value) {
    return bestBuyPageKind(value) === "cart";
  }
  function inspectBestBuyCartBaseline(documentValue, urlValue, now = Date.now()) {
    if (!bestBuyCartUrl(urlValue)) return { ok: false, reason: "cart_page_unverified" };
    if (bestBuySecurityChallenge(documentValue) || bestBuyInteractiveBlock(documentValue, urlValue)) {
      return { ok: false, reason: "manual_action_required" };
    }
    return captureCartBaseline(
      "bestbuy",
      observeBestBuyCart(documentValue, new Date(now).toISOString()),
      now
    );
  }
  function cartBinding(job, proof) {
    const productCode = String(proof?.productCode || "").toUpperCase();
    const retailerSku = String(job?.retailerSku || "");
    if (!/^(?=[A-Z0-9]*[A-Z])[A-Z0-9]{10}$/.test(productCode) || !/^\d{5,20}$/.test(retailerSku) || proof?.retailerSku !== retailerSku) return null;
    return { productCode, retailerSku };
  }
  function boundBaseline(baseline, binding) {
    if (!binding || !Array.isArray(baseline?.lines)) return baseline;
    const key = (value) => String(value || "").toUpperCase();
    if (!baseline.lines.some((line) => key(line?.retailerSku) === binding.productCode) || baseline.lines.some((line) => key(line?.retailerSku) === binding.retailerSku)) return baseline;
    return {
      ...baseline,
      lines: baseline.lines.map((line) => key(line.retailerSku) === binding.productCode ? { ...line, retailerSku: binding.retailerSku } : line)
    };
  }
  function verifyBestBuyAddedCart(documentValue, urlValue, job, proof, baseline, now = Date.now()) {
    if (!bestBuyCartUrl(urlValue)) return { ok: false, reason: "cart_page_unverified" };
    if (bestBuySecurityChallenge(documentValue) || bestBuyInteractiveBlock(documentValue, urlValue)) {
      return { ok: false, reason: "manual_action_required" };
    }
    const observedAt = new Date(now).toISOString();
    const binding = cartBinding(job, proof);
    const inventory = observeBestBuyCart(documentValue, observedAt, binding);
    const before = boundBaseline(baseline, binding);
    const verified = verifyCartAddDelta(job, before, inventory, proof, now);
    if (!verified.ok) {
      const unchanged = verified.reason === "cart_delta_unverified" && inventory.complete && inventory.independentlyCounted && inventory.lines.length === before.lines.length && inventory.lines.every((line) => before.lines.some((prior) => prior.retailerSku === line.retailerSku && prior.quantity === line.quantity));
      return unchanged ? { ...verified, pending: true } : verified;
    }
    const nextBaseline = captureCartBaseline("bestbuy", binding ? observeBestBuyCart(documentValue, observedAt) : inventory, now);
    return {
      ...verified,
      ...nextBaseline.ok ? { cartBaseline: nextBaseline.proof } : {}
    };
  }
  var RAISE_MAX_MS = 8e3;
  function bounded(value, minimum, maximum, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
  }
  function pause(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(1, milliseconds)));
  }
  function setQuantityControl(control, value) {
    const view = control.ownerDocument.defaultView;
    const prototype = control.tagName === "SELECT" ? view?.HTMLSelectElement?.prototype : view?.HTMLInputElement?.prototype;
    const setter = prototype ? Object.getOwnPropertyDescriptor(prototype, "value")?.set : void 0;
    if (setter) setter.call(control, value);
    else control.value = value;
    const EventType = view?.Event ?? Event;
    for (const type of control.tagName === "SELECT" ? ["change"] : ["input", "change"]) {
      control.dispatchEvent(new EventType(type, { bubbles: true }));
    }
  }
  function selectStep(select, current, desired) {
    let chosen = null;
    let chosenValue = 0;
    for (const option of select.options) {
      if (option.disabled) continue;
      const value = /^\d{1,2}$/.test(option.value.trim()) ? Number(option.value.trim()) : Number(String(option.textContent || "").trim());
      if (Number.isInteger(value) && value > current && value <= desired && value > chosenValue) {
        chosen = option;
        chosenValue = value;
      }
    }
    return chosen;
  }
  function busyLine(line) {
    return line.getAttribute("aria-busy") === "true" || Boolean(line.querySelector("[aria-busy='true']"));
  }
  async function raiseBestBuyCartQuantity(documentValue, urlValue, job, input, proof, timing = {}) {
    const deadline = Date.now() + bounded(timing.timeoutMs, 1, RAISE_MAX_MS, 7500);
    const stepTimeoutMs = bounded(timing.stepTimeoutMs, 1, 2500, 2500);
    const quietMs = bounded(timing.quietMs, 0, 1e3, 600);
    const invalid = bestBuyJobReason(job);
    if (invalid) return { ok: false, reason: invalid };
    const baselineQuantity = Number(input?.baselineQuantity);
    const currentQuantity = Number(input?.currentQuantity);
    const targetQuantity = Number(input?.targetQuantity);
    if (!Number.isInteger(baselineQuantity) || !Number.isInteger(currentQuantity) || !Number.isInteger(targetQuantity) || baselineQuantity < 0 || currentQuantity <= baselineQuantity || targetQuantity < currentQuantity || targetQuantity > 99 || targetQuantity - baselineQuantity > job.quantity) {
      return { ok: false, reason: "quantity_target_invalid" };
    }
    const binding = cartBinding(job, proof);
    const locate = (fullPage = false) => {
      if (documentValue.URL !== urlValue) return { reason: "cart_page_unverified" };
      if (fullPage) {
        const page = observeBestBuyPostAdd(documentValue, urlValue, job.retailerSku, job.fulfillment);
        if (page.state !== "cart") {
          return { reason: ["queue", "user_action"].includes(page.state) && page.reason !== "page_changed" ? "manual_action_required" : "cart_page_unverified" };
        }
      }
      const cart = bestBuyCartLines(documentValue, binding);
      if (!cart.independentlyCounted || cart.lines.some((line2) => !line2.retailerSku)) return { reason: "cart_unverified" };
      const mine = cart.lines.filter((line2) => line2.retailerSku === job.retailerSku);
      if (mine.length > 1) return { reason: "quantity_line_ambiguous" };
      const line = mine[0];
      if (!line) return { reason: "quantity_line_missing" };
      return { line, state: bestBuyLineQuantityState(line.element) };
    };
    const first = locate(true);
    if ("reason" in first) return { ok: false, reason: first.reason };
    const before = first.state;
    if (first.line.sellerType === "third_party") return { ok: false, reason: "third_party_seller" };
    if (before.quantity === null) return { ok: false, reason: "quantity_control_unavailable" };
    if (before.quantity !== currentQuantity) return { ok: false, reason: "quantity_line_changed", quantity: before.quantity };
    const storeLimit = before.storeLimit;
    if (currentQuantity >= targetQuantity) return { ok: true, reason: "quantity_set", quantity: currentQuantity, storeLimit };
    const desired = Math.min(targetQuantity, storeLimit ?? targetQuantity);
    if (desired <= currentQuantity) return { ok: false, reason: "quantity_limit_reached", quantity: currentQuantity, storeLimit };
    const unitPriceCents = first.line.unitPriceCents;
    if (unitPriceCents !== null && unitPriceCents > job.maxUnitPriceCents) {
      return { ok: false, reason: "over_unit_cap", quantity: currentQuantity, storeLimit };
    }
    if (unitPriceCents !== null && unitPriceCents * (desired - baselineQuantity) > job.maxOrderTotalCents) {
      return { ok: false, reason: "over_total_cap", quantity: currentQuantity, storeLimit };
    }
    if (!before.control || before.disabled) return { ok: false, reason: "quantity_control_unavailable", quantity: currentQuantity, storeLimit };
    const newLimitMessage = (state) => state.limitMessage && !before.limitMessage;
    let failure = "";
    let limitSeen = false;
    if (before.kind === "select" || before.kind === "input") {
      const option = before.kind === "select" ? selectStep(before.control, currentQuantity, desired) : null;
      if (before.kind === "select" && !option) return { ok: false, reason: "quantity_limit_reached", quantity: currentQuantity, storeLimit };
      const expected = option ? Number(/^\d{1,2}$/.test(option.value.trim()) ? option.value.trim() : String(option.textContent || "").trim()) : desired;
      try {
        const control = before.control;
        if (before.kind === "input") control.focus?.();
        setQuantityControl(control, option ? option.value : String(desired));
        if (before.kind === "input") control.blur?.();
      } catch {
        return { ok: false, reason: "quantity_control_unavailable", quantity: currentQuantity, storeLimit };
      }
      const settleBy = Math.min(deadline, Date.now() + stepTimeoutMs + quietMs);
      let last = expected;
      let since = Date.now();
      for (; ; ) {
        const now = locate();
        const value = "reason" in now ? null : now.state.quantity;
        if (!("reason" in now) && newLimitMessage(now.state)) limitSeen = true;
        if (value !== last || ("reason" in now ? false : busyLine(now.line.element))) {
          last = value;
          since = Date.now();
        }
        if ((value === expected || limitSeen) && Date.now() - since >= quietMs) break;
        if (Date.now() >= settleBy) break;
        await pause(Math.min(100, settleBy - Date.now()));
      }
    } else if (before.increase) {
      let reading = currentQuantity;
      let clicks = 0;
      while (reading < desired && Date.now() < deadline) {
        let now = locate();
        const readyBy = Math.min(deadline, Date.now() + stepTimeoutMs);
        while (clicks > 0 && !("reason" in now) && now.state.quantity === reading && !newLimitMessage(now.state) && (!now.state.increaseEnabled || busyLine(now.line.element)) && Date.now() < readyBy) {
          await pause(100);
          now = locate();
        }
        if (!("reason" in now)) now = locate(true);
        if ("reason" in now) {
          failure = now.reason;
          break;
        }
        if (now.state.quantity !== reading) break;
        if (newLimitMessage(now.state) || !now.state.increase || !now.state.increaseEnabled || now.state.storeLimit !== null && reading >= now.state.storeLimit) {
          limitSeen = true;
          break;
        }
        try {
          now.state.increase.click();
        } catch {
          failure = "quantity_control_unavailable";
          break;
        }
        clicks += 1;
        const changeBy = Math.min(deadline, Date.now() + stepTimeoutMs);
        let next = reading;
        for (; ; ) {
          const after2 = locate();
          next = "reason" in after2 ? null : after2.state.quantity;
          if (next !== null && next !== reading || Date.now() >= changeBy) break;
          await pause(Math.min(100, changeBy - Date.now()));
        }
        if (next === null || next === reading) break;
        const previous = reading;
        reading = next;
        if (next !== previous + 1) break;
        if (reading < desired) await pause(Math.min(200, Math.max(1, quietMs)));
      }
    } else {
      return { ok: false, reason: "quantity_control_unavailable", quantity: currentQuantity, storeLimit };
    }
    const after = locate(true);
    if ("reason" in after) return { ok: false, reason: failure || after.reason };
    const shown = after.state.quantity;
    if (shown === null) return { ok: false, reason: "quantity_unconfirmed" };
    const knownLimits = [after.state.storeLimit, storeLimit].filter((value) => value !== null);
    const reportedLimit = knownLimits.length ? Math.min(...knownLimits) : null;
    if (failure) return { ok: false, reason: failure, quantity: shown, storeLimit: reportedLimit };
    if (shown === desired) return { ok: true, reason: "quantity_set", quantity: shown, storeLimit: reportedLimit };
    if (shown < currentQuantity) return { ok: false, reason: "quantity_line_changed", quantity: shown, storeLimit: reportedLimit };
    if (shown > desired) return { ok: false, reason: "quantity_exceeded", quantity: shown, storeLimit: reportedLimit };
    const plusBlocked = before.kind !== "select" && before.kind !== "input" && Boolean(after.state.increase) && !after.state.increaseEnabled;
    if (limitSeen || plusBlocked || newLimitMessage(after.state) || reportedLimit !== null && shown >= reportedLimit) {
      return { ok: false, reason: "quantity_limit_reached", quantity: shown, storeLimit: Math.min(reportedLimit ?? shown, shown) };
    }
    return { ok: false, reason: shown === currentQuantity ? "quantity_unchanged" : "quantity_unconfirmed", quantity: shown, storeLimit: reportedLimit };
  }
  function inspectBestBuyPostAdd(document, url, job, environment) {
    return observeBestBuyPostAdd(document, url, job.retailerSku, job.fulfillment, environment);
  }
  Object.defineProperty(globalThis, "YoinkBestBuyAction", {
    value: Object.freeze({
      inspectBestBuyPostAdd,
      selectBestBuyShipping,
      abandonBestBuyAdd,
      commitBestBuyAdd,
      inspectBestBuyCartBaseline,
      prepareBestBuyAdd,
      raiseBestBuyCartQuantity,
      rehearseBestBuyAdd,
      verifyBestBuyAddedCart
    }),
    configurable: true
  });
  return __toCommonJS(bestbuy_action_exports);
})();
