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
    rehearseTargetAdd: () => rehearseTargetAdd,
    verifyTargetAddedCart: () => verifyTargetAddedCart
  });

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
    if (job.contractVersion !== BROWSER_SAFETY_CONTRACT_VERSION) return "contract_version_mismatch";
    if (!job.jobId || !job.retailerId || !job.retailerSku) return "job_identity_invalid";
    if (!retailerUrlAllowed(job.retailerId, job.canonicalUrl)) return "canonical_url_invalid";
    if (!Number.isInteger(job.quantity) || job.quantity < 1 || job.quantity > 99) return "quantity_invalid";
    if (!Number.isSafeInteger(job.maxUnitPriceCents) || job.maxUnitPriceCents <= 0) return "unit_cap_invalid";
    if (!Number.isSafeInteger(job.maxOrderTotalCents) || job.maxOrderTotalCents <= 0) return "total_cap_invalid";
    if (job.fulfillment !== "shipping" && job.fulfillment !== "pickup") return "fulfillment_not_supported";
    const expiresAt = new Date(job.expiresAt).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= now) return "job_expired";
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
    if (Number(observation.unitPriceCents) > job.maxUnitPriceCents) return rejected("over_unit_cap");
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
      contractVersion: "target-add-v10",
      packVersion: "target-pack-v1",
      observerVersion: "target-observer-v7",
      activationConfirmation: "ENABLE_TARGET_ADD_V10",
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
        verifyCart: "verifyTargetAddedCart"
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
      runnerFile: "walmart-action.js",
      runnerGlobal: "YoinkWalmartAction",
      operations: {
        rehearse: "rehearseWalmartAdd",
        baseline: "inspectWalmartCartBaseline",
        prepare: "prepareWalmartAdd",
        commit: "commitWalmartAdd",
        verifyCart: "verifyWalmartAddedCart"
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
      runnerFile: "bestbuy-action.js",
      runnerGlobal: "YoinkBestBuyAction",
      operations: {
        rehearse: "rehearseBestBuyAdd",
        baseline: "inspectBestBuyCartBaseline",
        prepare: "prepareBestBuyAdd",
        commit: "commitBestBuyAdd",
        verifyCart: "verifyBestBuyAddedCart"
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
  var TARGET_ADD_ADAPTER_VERSION = "target-add-v10";
  var EVIDENCE_CAPSULE_MAX_SNAPSHOT_BYTES = 3 * 1024 * 1024;

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
    const visibleMatches = matches.filter(visible);
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
  function observableText(value, maximum = 2e3) {
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
        if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(element.tagName) || !visible(element)) return;
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
    return visible(element) && !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true" && !/sold out|out of stock|unavailable/i.test(text(element, 300));
  }
  function formControlValue(element) {
    if (!element || !["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName)) return "";
    return String(element.value || "");
  }
  function queryVisible(root, selectors) {
    for (const selector of selectors) {
      const match = [...root.querySelectorAll(selector)].find(visible);
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
        if (!visible(element) || recommendationControl(element)) continue;
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
    const modulePrices = [...root.querySelectorAll(TARGET_PRICE_MODULE_SELECTOR)].filter((element) => visible(element) && !recommendationControl(element)).map((element) => readPrice(element, selectors) ?? parseUsPrice(observableText(element, 1200))).filter((price) => price !== null);
    const uniqueModulePrices = [...new Set(modulePrices)];
    if (uniqueModulePrices.length === 1) return uniqueModulePrices[0] ?? null;
    const candidates = [...root.querySelectorAll("[data-test], [data-testid], [itemprop], [aria-label]")].slice(0, 500).filter((element) => visible(element) && !recommendationControl(element)).filter((element) => /(?:price|amount)/i.test([
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
    if (!visible(element) || element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") return false;
    const evidence = `${element.getAttribute("aria-label") || ""} ${text(element, 500)}`;
    if (TARGET_FULFILLMENT_UNAVAILABLE_PATTERN.test(evidence)) return false;
    return fulfillmentTileSelected(element) || TARGET_FULFILLMENT_AVAILABLE_PATTERN.test(evidence);
  }
  function controlFulfillment(control, root) {
    selectorTrace("fulfillment", root, TARGET_FULFILLMENT_TILE_SELECTOR);
    selectorListTrace("fulfillment", root, ["[aria-selected='true']", "[data-selected='true']", "input:checked"]);
    const own = fulfillmentKind(control);
    const selectedTiles = [...root.querySelectorAll(TARGET_FULFILLMENT_TILE_SELECTOR)].filter((element) => visible(element) && fulfillmentKind(element) !== "unknown" && fulfillmentTileSelected(element));
    if (selectedTiles.length === 1 && selectedTiles[0]) {
      const selected2 = fulfillmentKind(selectedTiles[0]);
      return own !== "unknown" && own !== selected2 ? "unknown" : selected2;
    }
    if (selectedTiles.length > 1) return "unknown";
    if (own !== "unknown") return own;
    const selected = [...root.querySelectorAll("[aria-selected='true'], [data-selected='true'], input:checked")].filter((element) => visible(element)).map((element) => text(element.closest("label, [role='tab'], [data-test*='fulfillment' i]") || element, 500));
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
    return [...root.querySelectorAll(`button[id='addToCartButtonOrTextIdFor${sku}']`)].filter((candidate) => visible(candidate) && !recommendationControl(candidate));
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
    const candidates = [...root.querySelectorAll("button, input[type='submit'], input[type='button'], [role='button']")].filter((candidate) => visible(candidate) && !recommendationControl(candidate)).filter((candidate) => /\badd(?:\s+(?:item\s+)?to)?\s+cart\b/i.test([
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
      if (!visible(candidate)) return false;
      if (recommendationControl(candidate)) return false;
      const idSku = candidate.getAttribute("id")?.match(/^addToCartButtonOrTextIdFor(\d{6,})$/)?.[1];
      if (idSku && idSku !== sku) return false;
      const scopedSku = candidate.closest("[data-tcin]")?.getAttribute("data-tcin");
      return idSku === sku || scopedSku === sku;
    });
  }
  function emptyTargetAddBinding() {
    return { control: null, fulfillmentControl: null, fulfillment: "unknown", selectionRequired: false, offerRoot: null };
  }
  function modernTargetAddBinding(document, sku, required) {
    selectorTrace("offer_scope", document, TARGET_FULFILLMENT_ROOT_SELECTOR);
    const visibleRoots = [...new Set(document.querySelectorAll(TARGET_FULFILLMENT_ROOT_SELECTOR))].filter((root2) => visible(root2) && !recommendationControl(root2));
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
    const scoped = roots.map((root2) => {
      const exact = exactAddControls(root2, sku);
      return { root: root2, controls: exact.length > 0 ? exact : semanticTargetAddControls(root2, sku) };
    }).filter((entry) => entry.controls.length === 1 && entry.controls[0]);
    if (scoped.length !== 1 || !scoped[0]?.controls[0]) return emptyTargetAddBinding();
    const { root } = scoped[0];
    const control = scoped[0].controls[0];
    const tiles = [...root.querySelectorAll(TARGET_FULFILLMENT_TILE_SELECTOR)].filter((fulfillmentControl) => fulfillmentControl !== control && visible(fulfillmentControl)).map((fulfillmentControl) => ({
      fulfillmentControl,
      fulfillment: fulfillmentKind(fulfillmentControl),
      selected: fulfillmentTileSelected(fulfillmentControl),
      available: fulfillmentTileAvailable(fulfillmentControl)
    })).filter((entry) => entry.fulfillment !== "unknown");
    required = required === "pickup" ? "pickup" : "shipping";
    if (tiles.length === 0) {
      const directFulfillment = directControlFulfillment(control, root);
      return directFulfillment === required ? { control, fulfillmentControl: null, fulfillment: required, selectionRequired: false, offerRoot: root } : emptyTargetAddBinding();
    }
    const selected = tiles.filter((entry) => entry.selected);
    if (selected.length !== 1 || !selected[0]) return emptyTargetAddBinding();
    const selectedEntry = selected[0];
    const alreadySelected = selectedEntry.fulfillment === required && selectedEntry.available;
    if (alreadySelected) {
      return { control, fulfillmentControl: selectedEntry.fulfillmentControl, fulfillment: required, selectionRequired: false, offerRoot: root };
    }
    const available = tiles.filter((entry) => entry.fulfillment === required && entry.available);
    if (available.length === 0) return emptyTargetAddBinding();
    const preferred = required === "shipping" ? available.find((entry) => /shipping/i.test(String(entry.fulfillmentControl.getAttribute("data-test") || entry.fulfillmentControl.getAttribute("id") || ""))) ?? available[0] : available[0];
    return preferred ? { control, fulfillmentControl: preferred.fulfillmentControl, fulfillment: required, selectionRequired: true, offerRoot: root } : emptyTargetAddBinding();
  }
  function targetExplicitlyUnavailable(document) {
    return [...document.querySelectorAll(TARGET_AVAILABILITY_SELECTORS.join(", "))].filter((element) => visible(element) && !recommendationControl(element)).some((element) => /\b(?:out of stock|sold out|currently unavailable)\b/i.test(
      `${element.getAttribute("content") || ""} ${element.getAttribute("aria-label") || ""} ${observableText(element, 500)}`
    ));
  }
  function legacyTargetAddBinding(document, sku, required) {
    required = required === "pickup" ? "pickup" : "shipping";
    const candidates = addControls(document, sku).map((control) => ({ control, fulfillment: controlFulfillment(control, document) }));
    const matching = candidates.find((entry) => entry.fulfillment === required);
    return matching ? { ...matching, fulfillmentControl: null, selectionRequired: false, offerRoot: null } : emptyTargetAddBinding();
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
    const unitPriceCents = adaptiveTargetPrice(priceRoot, TARGET_CURRENT_PRICE_SELECTORS);
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
  function lineSku(line) {
    const own = line.getAttribute("data-tcin");
    if (own && /^\d{6,}$/.test(own)) return own;
    for (const anchor of line.querySelectorAll("a[href]")) {
      const sku = extractTargetSku(anchor.getAttribute("href") || "");
      if (sku) return sku;
    }
    return "";
  }
  function lineQuantity(line) {
    const control = queryVisible(line, TARGET_QUANTITY_SELECTORS);
    const candidate = control?.getAttribute("value") || formControlValue(control) || text(control, 100);
    const match = String(candidate).match(/(?:qty|quantity)?\s*:?\s*(\d{1,2})/i);
    const quantity = Number(match?.[1]);
    return Number.isInteger(quantity) && quantity >= 1 && quantity <= 99 ? quantity : null;
  }
  function cartLineElements(document) {
    const candidates = [...document.querySelectorAll("[data-test='cart-item'], [data-test='cartItem'], [data-testid='cart-item'], [data-tcin][data-cart-line]")].filter(visible);
    return candidates.filter((candidate) => !candidates.some((other) => other !== candidate && other.contains(candidate)));
  }
  function targetCartVisiblyEmpty(document) {
    const root = queryVisible(document, [
      "[data-test*='empty-cart' i]",
      "[data-testid*='empty-cart' i]",
      "[data-test='cart-empty']",
      "main"
    ]);
    return Boolean(root && /(?:your )?cart is empty|no items in (?:your )?cart|cart has no items/i.test(text(root, 2e4)));
  }
  function observeTargetCart(document, observedAt = (/* @__PURE__ */ new Date()).toISOString()) {
    const elements = cartLineElements(document);
    const lines = elements.map((line) => {
      const seller = sellerEvidence(document, line);
      return {
        retailerSku: lineSku(line),
        quantity: lineQuantity(line),
        unitPriceCents: readPrice(line, ["[data-test*='price' i]", "[itemprop='price']"]),
        sellerName: seller.sellerName,
        sellerType: seller.sellerType
      };
    });
    const independentlyCounted = elements.length > 0 ? new Set(elements).size === elements.length : targetCartVisiblyEmpty(document);
    return {
      contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
      observedAt,
      complete: independentlyCounted && lines.every((line) => Boolean(line.retailerSku)),
      independentlyCounted,
      independentLineCount: elements.length,
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
    if (job?.quantity !== 1) return "quantity_not_supported";
    if (job?.sellerPolicy !== "first_party_only") return "seller_policy_not_supported";
    if (job?.fulfillment !== "shipping" && job?.fulfillment !== "pickup") return "fulfillment_not_supported";
    return "";
  }
  function authorizationId(now) {
    sequence += 1;
    return `target_add_${now.toString(36)}_${sequence.toString(36)}`;
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
    if (!verified.ok) return verified;
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
      proof: verified.proof
    };
    return { ok: true, reason: "verified", authorizationId: id, proof: verified.proof };
  }
  function rehearseTargetAdd(documentValue, urlValue, job, now = Date.now(), environment) {
    const prepared = prepareTargetAdd(documentValue, urlValue, job, now, environment);
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
    if (!authorization || authorization.id !== value || authorization.jobId !== job.jobId) {
      return { ok: false, reason: "authorization_missing", clicked: false };
    }
    if (now < authorization.createdAt || now - authorization.createdAt > AUTHORIZATION_MAX_AGE_MS) {
      return { ok: false, reason: "authorization_expired", clicked: false };
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
    if (!initiallyVerified.ok) return { ...initiallyVerified, clicked: false };
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
    if (!verified.ok) return { ...verified, clicked: false };
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
  Object.defineProperty(globalThis, "YoinkTargetAction", {
    value: Object.freeze({
      abandonTargetAdd,
      commitTargetAdd,
      inspectTargetCartBaseline,
      prepareTargetAdd,
      rehearseTargetAdd,
      verifyTargetAddedCart
    }),
    configurable: true
  });
  return __toCommonJS(target_action_exports);
})();
