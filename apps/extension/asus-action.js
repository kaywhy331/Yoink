"use strict";
var YoinkAsusActionModule = (() => {
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

  // apps/extension/src/asus-action.ts
  var asus_action_exports = {};
  __export(asus_action_exports, {
    abandonAsusAdd: () => abandonAsusAdd,
    commitAsusAdd: () => commitAsusAdd,
    inspectAsusCartBaseline: () => inspectAsusCartBaseline,
    prepareAsusAdd: () => prepareAsusAdd,
    rehearseAsusAdd: () => rehearseAsusAdd,
    verifyAsusAddedCart: () => verifyAsusAddedCart
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
  var ASUS_ADD_ADAPTER_VERSION = "asus-add-v1";
  var EVIDENCE_CAPSULE_MAX_SNAPSHOT_BYTES = 3 * 1024 * 1024;

  // packages/browser-adapters/src/asus.ts
  var PART_NUMBER = /^[A-Z0-9]{8}-[A-Z0-9]{6}$/;
  function elements(root, selector, environment) {
    return [...root.querySelectorAll(selector)].filter((element) => renderedVisible(element, environment));
  }
  function text(element, environment) {
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
    return /(?:verify|confirm) (?:that )?you are (?:a )?human|access denied|you have been blocked|security check|captcha challenge/i.test(text(document.body, environment)) || elements(document, "iframe[src*='captcha'], iframe[src*='challenge']", environment).length > 0;
  }
  function asusInteractiveBlock(document, url, environment) {
    if (asusPageKind(url) === "auth") return "auth";
    if (asusSecurityChallenge(document, environment)) return "unknown";
    if (/you(?:'|’)re in line|waiting room|please wait in (?:the )?queue/i.test(text(document.body, environment))) return "queue";
    if (elements(document, "dialog[open], [aria-modal='true'], .modal-popup._show, input[type='password']", environment).length) return "unknown";
    return "";
  }
  function asusOfferBinding(document, urlValue, expectedSku, environment) {
    const retailerSku = asusUrlSku(urlValue);
    if (!retailerSku || document.URL !== urlValue || expectedSku !== void 0 && expectedSku !== retailerSku || asusInteractiveBlock(document, urlValue, environment)) return null;
    const roots = elements(document, ".product-info-main", environment);
    const forms = elements(document, "form#product_addtocart_form", environment);
    if (roots.length !== 1 || forms.length !== 1 || !roots[0].contains(forms[0])) return null;
    const root = roots[0], form = forms[0];
    if (form.getAttribute("data-product-sku") !== retailerSku || form.getAttribute("method")?.toLowerCase() !== "post") return null;
    const values = (name) => [...form.querySelectorAll(`input[name='${name}']`)].map((x) => x.value);
    const products = values("product"), quantities = values("qty"), configurations = values("selected_configurable_option");
    const productId = products[0] || "";
    if (products.length !== 1 || !/^\d{1,10}$/.test(productId) || quantities.length !== 1 || quantities[0] !== "1" || configurations.length !== 1 || configurations[0] !== "" || values("related_product").some((value) => value !== "") || form.querySelector("select, input[name^='super_attribute'], input[name^='bundle_option'], [data-is-cto='1']")) return null;
    const action = asusUrl(form.getAttribute("action") || "");
    if (!action || !new RegExp(`^/us/checkout/cart/add/uenc/[A-Za-z0-9_,=-]+/product/${productId}/$`).test(action.pathname) || action.search || action.hash) return null;
    const controls = elements(form, "button#product-addtocart-button[type='submit']", environment);
    if (controls.length !== 1 || text(controls[0], environment) !== "Add to Cart" || controls[0].matches(":disabled") || controls[0].closest("[aria-disabled='true']")) return null;
    const prices = elements(root, "[data-price-type='finalPrice'][data-price-amount]", environment);
    const currencies = [...document.querySelectorAll('meta[property="product:price:currency"]')];
    const metaPrices = [...document.querySelectorAll('meta[property="product:price:amount"]')];
    if (prices.length !== 1 || currencies.length !== 1 || currencies[0].content !== "USD" || metaPrices.length !== 1) return null;
    const unitPriceCents = cents(prices[0].getAttribute("data-price-amount"));
    const shown = text(prices[0], environment);
    if (!unitPriceCents || !/^\$\d+(?:,\d{3})*\.\d{2}$/.test(shown) || cents(shown.slice(1).replace(/,/g, "")) !== unitPriceCents || cents(metaPrices[0].content) !== unitPriceCents || cents(form.getAttribute("data-product-originalprice")) !== unitPriceCents) return null;
    const content = text(root, environment);
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
  function asusCartInventory(value, observedAt = (/* @__PURE__ */ new Date()).toISOString()) {
    const empty = { contractVersion: 1, observedAt, complete: false, independentlyCounted: false, independentLineCount: 0, lines: [] };
    if (!value || typeof value !== "object" || Array.isArray(value)) return empty;
    const cart = value;
    if (!Number.isSafeInteger(cart.summary_count) || cart.summary_count < 0 || !Array.isArray(cart.items) || cart.items.length > 25) return empty;
    const lines = [];
    for (const item of cart.items) {
      if (!item || !PART_NUMBER.test(item.product_sku) || asusUrlSku(String(item.product_url)) !== item.product_sku || item.product_type !== "simple" || !Array.isArray(item.options) || item.options.length || item.is_addon !== false || ["freebie", "add_on", "wep_add_on", "bundle", "preorder"].some((key) => item[key] !== "no") || item.glidex_option !== "" || item.message !== "" || !Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > 99) return empty;
      const unitPriceCents = cents(item.product_price_value);
      if (!unitPriceCents) return empty;
      lines.push({ retailerSku: item.product_sku, quantity: item.qty, unitPriceCents, sellerName: "ASUS", sellerType: "first_party" });
    }
    if (new Set(lines.map((line) => line.retailerSku)).size !== lines.length || lines.reduce((sum, line) => sum + line.quantity, 0) !== cart.summary_count || lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0) !== cents(cart.subtotalAmount)) return empty;
    return { contractVersion: 1, observedAt, complete: true, independentlyCounted: true, independentLineCount: lines.length, lines };
  }

  // apps/extension/src/asus-action.ts
  var AUTHORIZATION_MAX_AGE_MS = 1e4;
  var sequence = 0;
  var pending = null;
  function traceElement(environment, condition, element) {
    if (!environment?.trace) return;
    const attributes = ["id", "name", "type", "role", "data-test", "data-testid", "data-test-id", "data-automation-id", "aria-label"].map((name) => element?.hasAttribute(name) ? `${name}=${JSON.stringify(String(element.getAttribute(name)).slice(0, 80))}` : "").filter(Boolean).join(" ");
    const content = String(element?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
    environment.trace.record({ step: "add_control", condition, actual: element ? `${element.tagName.toLowerCase()} ${attributes} ${content}`.trim() : "missing" });
  }
  function asusJobReason(job) {
    if (job?.adapterVersion !== ASUS_ADD_ADAPTER_VERSION) return "adapter_version_mismatch";
    if (job?.retailerId !== "asus" || job?.action !== "add_to_cart") return "unsupported_action";
    if (job?.quantity !== 1) return "quantity_not_supported";
    if (job?.sellerPolicy !== "first_party_only") return "seller_policy_not_supported";
    if (job?.fulfillment !== "shipping") return "fulfillment_not_supported";
    if (asusPageKind(job.canonicalUrl) !== "product" || asusUrlSku(job.canonicalUrl) !== job.retailerSku) return "listing_mismatch";
    if (job.currency !== "USD") return "currency_mismatch";
    if (job.expectedSeller && job.expectedSeller !== "ASUS") return "seller_unverified";
    return "";
  }
  function authorizationId(now) {
    sequence += 1;
    return `asus_add_${now.toString(36)}_${sequence.toString(36)}`;
  }
  function abandonAsusAdd(value) {
    if (!pending || pending.id !== value) return false;
    pending = null;
    return true;
  }
  function prepareAsusAdd(documentValue, urlValue, job, now = Date.now(), environment) {
    pending = null;
    const invalid = asusJobReason(job);
    if (invalid) return { ok: false, reason: invalid };
    if (asusUrlSku(job.canonicalUrl) !== asusUrlSku(urlValue)) return { ok: false, reason: "listing_mismatch" };
    const observation = observeAsusOffer(
      documentValue,
      urlValue,
      job.retailerSku,
      new Date(now).toISOString(),
      environment
    );
    const verified = verifyLiveOffer(job, observation, now);
    if (!verified.ok) return { ok: false, reason: verified.reason === "out_of_stock" && observation.availability === "unknown" ? "add_control_unavailable" : verified.reason };
    const binding = asusOfferBinding(documentValue, urlValue, job.retailerSku, environment);
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
  function rehearseAsusAdd(documentValue, urlValue, job, now = Date.now(), environment) {
    const prepared = prepareAsusAdd(documentValue, urlValue, job, now, environment);
    if (!prepared.ok) return prepared;
    abandonAsusAdd(prepared.authorizationId);
    return { ok: true, reason: "verified", proof: prepared.proof, wouldClick: true };
  }
  function commitAsusAdd(documentValue, urlValue, job, value, now = Date.now(), environment) {
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
    const invalid = asusJobReason(job);
    if (invalid) return { ok: false, reason: invalid, clicked: false };
    if (asusUrlSku(job.canonicalUrl) !== asusUrlSku(urlValue)) return { ok: false, reason: "listing_mismatch", clicked: false };
    const observation = observeAsusOffer(
      documentValue,
      urlValue,
      job.retailerSku,
      new Date(now).toISOString(),
      environment
    );
    const verified = verifyLiveOffer(job, observation, now);
    if (!verified.ok) return { ok: false, clicked: false, reason: verified.reason === "out_of_stock" && observation.availability === "unknown" ? "add_control_unavailable" : verified.reason };
    const binding = asusOfferBinding(documentValue, urlValue, job.retailerSku, environment);
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
  async function readAsusCart(document, now) {
    try {
      const response = await document.defaultView.fetch(new URL("/us/customer/section/load/?sections=cart&force_new_section_timestamp=true", document.URL).href, {
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(3e3)
      });
      if (!response.ok || !/^application\/json(?:;|$)/i.test(response.headers.get("content-type") || "")) {
        throw new Error("Cart response unavailable");
      }
      return asusCartInventory((await response.json())?.cart, new Date(now).toISOString());
    } catch {
      return asusCartInventory(null, new Date(now).toISOString());
    }
  }
  function asusCartUrl(value) {
    return asusPageKind(value) === "cart";
  }
  async function inspectAsusCartBaseline(documentValue, urlValue, now = Date.now()) {
    if (!asusCartUrl(urlValue) || documentValue.URL !== urlValue) return { ok: false, reason: "cart_page_unverified" };
    if (asusInteractiveBlock(documentValue, urlValue)) {
      return { ok: false, reason: "manual_action_required" };
    }
    return captureCartBaseline(
      "asus",
      await readAsusCart(documentValue, now),
      now
    );
  }
  async function verifyAsusAddedCart(documentValue, urlValue, job, proof, baseline, now = Date.now()) {
    if (!asusCartUrl(urlValue) || documentValue.URL !== urlValue) return { ok: false, reason: "cart_page_unverified" };
    if (asusInteractiveBlock(documentValue, urlValue)) {
      return { ok: false, reason: "manual_action_required" };
    }
    const invalid = asusJobReason(job);
    if (invalid) return { ok: false, reason: invalid };
    const inventory = await readAsusCart(documentValue, now);
    const verified = verifyCartAddDelta(job, baseline, inventory, proof, now);
    if (!verified.ok) return verified;
    const nextBaseline = captureCartBaseline("asus", inventory, now);
    return {
      ...verified,
      ...nextBaseline.ok ? { cartBaseline: nextBaseline.proof } : {}
    };
  }
  Object.defineProperty(globalThis, "YoinkAsusAction", {
    value: Object.freeze({
      abandonAsusAdd,
      commitAsusAdd,
      inspectAsusCartBaseline,
      prepareAsusAdd,
      rehearseAsusAdd,
      verifyAsusAddedCart
    }),
    configurable: true
  });
  return __toCommonJS(asus_action_exports);
})();
