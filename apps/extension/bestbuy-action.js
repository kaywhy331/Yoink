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
    prepareBestBuyAdd: () => prepareBestBuyAdd,
    rehearseBestBuyAdd: () => rehearseBestBuyAdd,
    verifyBestBuyAddedCart: () => verifyBestBuyAddedCart
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
    pokemoncenter: ["pokemoncenter.com"]
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
      contractVersion: "target-add-v9",
      packVersion: "target-pack-v1",
      observerVersion: "target-observer-v7",
      activationConfirmation: "ENABLE_TARGET_ADD_V9",
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
      contractVersion: "walmart-add-v9",
      packVersion: "walmart-pack-v1",
      observerVersion: "walmart-observer-v8",
      activationConfirmation: "ENABLE_WALMART_ADD_V9",
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
      contractVersion: "amazon-add-v10",
      packVersion: "amazon-pack-v2",
      observerVersion: "amazon-observer-v9",
      activationConfirmation: "ENABLE_AMAZON_ADD_V10",
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
      contractVersion: "bestbuy-add-v15",
      packVersion: "bestbuy-pack-v1",
      observerVersion: "bestbuy-observer-v13",
      activationConfirmation: "ENABLE_BESTBUY_ADD_V15",
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
        default: "Open an available offer explicitly sold by Best Buy, select Shipping, and verify a usable Add to cart or Pre-order control before rehearsing.",
        highDemand: "Best Buy high-demand or queue evidence was recorded, but automated demand-gate handling remains closed.",
        securityChallenge: "Complete the visible Best Buy security check in this tab, then retry qualification.",
        auth: "Sign in to Best Buy in this tab, confirm your location, then retry qualification.",
        mfa: "Complete Best Buy account verification in this tab, then retry qualification.",
        location: "Confirm your Best Buy location and select Shipping, then retry qualification.",
        pickup: "Best Buy pickup evidence was recorded. Select Shipping on an available Best Buy-sold offer before rehearsing."
      }
    })
  });

  // packages/contracts/src/index.ts
  var BESTBUY_ADD_ADAPTER_VERSION = "bestbuy-add-v15";
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
    packVersion: "bestbuy-pack-v1",
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
      merchandisingScope: { selectors: ["[data-testid*='recommend' i]", "[aria-label*='similar' i]", "[aria-label*='sponsored' i]", "[class*='carousel' i]", "[class*='related-products' i]", "[class*='recommend' i]"] },
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
        addControl: ["button[data-testid*='add-to-cart' i]", "button[data-testid*='add-to-bag' i]", "button[name*='add-to-cart' i]", "button[aria-label*='add to bag' i]", "button[aria-label*='add to cart' i]", "button"],
        price: ["meta[itemprop='price']", "meta[property='product:price:amount']", "[itemprop='price']", "[data-testid*='product-price' i]", "[class*='product-price' i]"],
        seller: []
      },
      ravensburger: {
        addControl: ["button[data-testid*='add-to-cart' i]", "button[name*='add-to-cart' i]", "button[aria-label*='add to cart' i]", "button[class*='add-to-cart' i]", "button"],
        price: ["meta[itemprop='price']", "meta[property='product:price:amount']", "[itemprop='price']", "[data-testid*='price' i]", "[class*='product-price' i]"],
        seller: []
      },
      riot: {
        addControl: ["button[data-testid*='add-to-cart' i]", "button[name*='add-to-cart' i]", "button[aria-label*='add to cart' i]", "button[class*='add-to-cart' i]", "button"],
        price: ["meta[itemprop='price']", "meta[property='product:price:amount']", "[itemprop='price']", "[data-testid*='price' i]", "[class*='product-price' i]"],
        seller: []
      },
      booksamillion: {
        addControl: ["button[data-testid*='add-to-cart' i]", "button[name*='add-to-cart' i]", "button[aria-label*='add to cart' i]", "input[type='submit'][value*='add to cart' i]", "button"],
        price: ["meta[itemprop='price']", "meta[property='product:price:amount']", "[itemprop='price']", "[data-testid*='price' i]", "[class*='our-price' i]", "[class*='sale-price' i]"],
        seller: []
      },
      fanatics: {
        addControl: ["button[data-testid*='add-to-cart' i]", "button[name*='add-to-cart' i]", "button[aria-label*='add to cart' i]", "button[class*='add-to-cart' i]", "button"],
        price: ["[data-talos='pdpProductPrice'] .money-value", "[data-trk-id='pdp-price'] .money-value", "meta[itemprop='price']", "meta[property='product:price:amount']", "[itemprop='price']", "[data-testid*='price' i]", "[class*='current-price' i]", "[class*='sale-price' i]"],
        seller: ["[data-testid*='seller' i]", "[class*='seller' i]", "[class*='shipping' i]"]
      },
      kohls: {
        addControl: ["button[data-testid*='add-to-cart' i]", "button[name*='add-to-cart' i]", "button[aria-label*='add to cart' i]", "button[class*='add-to-cart' i]", "button"],
        price: ["meta[itemprop='price']", "meta[property='product:price:amount']", "[itemprop='price']", "[data-testid*='sale-price' i]", "[data-testid*='price' i]", "[class*='sale-price' i]"],
        seller: ["[data-testid*='seller' i]", "[class*='seller' i]"]
      },
      macys: {
        addControl: ["button[data-testid*='add-to-bag' i]", "button[name*='add-to-bag' i]", "button[aria-label*='add to bag' i]", "button[class*='add-to-bag' i]", "button"],
        price: ["meta[itemprop='price']", "meta[property='product:price:amount']", "[itemprop='price']", "[data-testid*='sale-price' i]", "[data-testid*='price' i]", "[class*='sale-price' i]"],
        seller: ["[data-testid*='seller' i]", "[class*='seller' i]", "[class*='marketplace' i]"]
      },
      pbandai: {
        addControl: ["button[data-testid*='add-to-cart' i]", "button[data-automation-id*='add-to-cart' i]", "button[aria-label*='add to cart' i]", "button[class*='add-cart' i]", "button[class*='pre-order' i]", "a[class*='add-cart' i]", "a[class*='pre-order' i]", "button", "a[role='button']"],
        price: ["meta[itemprop='price']", "meta[property='product:price:amount']", "[itemprop='price']", "[data-testid*='price' i]", "[class*='item-price' i]", "[class*='product-price' i]"],
        seller: []
      },
      pokemoncenter: {
        addControl: ["button[data-testid*='add-to-cart' i]", "button[data-automation-id*='add-to-cart' i]", "button[name*='add-to-cart' i]", "button[aria-label*='add to cart' i]", "button[class*='add-to-cart' i]", "button"],
        price: ["meta[itemprop='price']", "meta[property='product:price:amount']", "[itemprop='price']", "[data-testid*='price' i]", "[class*='product-price' i]", "[class*='sales-price' i]"],
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
    pokemoncenter: OBSERVE_ONLY_SELECTOR_PACK.packVersion
  });
  function selectorsFor(retailerId, field) {
    if (retailerId in ADD_SELECTOR_PACKS) {
      return ADD_SELECTOR_PACKS[retailerId].fields[field];
    }
    if (field === "fulfillmentTile") return OBSERVE_ONLY_FULFILLMENT_TILES;
    if (field !== "addControl" && field !== "price" && field !== "seller") return Object.freeze([]);
    return OBSERVE_ONLY_SELECTOR_PACK.retailers[retailerId][field];
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
      firstPartyPattern: /ships\s+from\s+amazon(?:\.com)?[\s\S]{0,160}sold\s+by\s+amazon(?:\.com)?|sold\s+by\s+amazon(?:\.com)?[\s\S]{0,160}ships\s+from\s+amazon(?:\.com)?/i,
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
  function text(value, maximum = 2e3) {
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
        if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(element.tagName) || element.classList.contains("aok-hidden") || !(renderedOnly ? renderedVisible(element) : visible(element))) return;
      }
      for (const child of [...node.childNodes]) visit(child);
    };
    visit(value);
    return fragments.join(" ").replace(/\s+/g, " ").trim().slice(0, maximum);
  }
  function sellerElementText(value, maximum = 2e3) {
    if (!value || maximum < 1) return "";
    const fragments = [observableText(value, maximum)];
    const elements = [value, ...value.querySelectorAll("[aria-label], [alt], [title], [data-seller-name]")];
    for (const element of elements) {
      if (!visible(element)) continue;
      for (const attribute of ["aria-label", "alt", "title", "data-seller-name"]) {
        const candidate = String(element.getAttribute(attribute) || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
        if (candidate) fragments.push(candidate);
      }
    }
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
  function renderedVisible(element) {
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
    return visible(element) && !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true" && !/sold out|out of stock|unavailable|currently unavailable|pre[ -]?order closed|order(?:ing)? period (?:has )?ended|sales? ended/i.test(text(element, 300));
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
      const found = [...root.querySelectorAll(selector)].find(renderedVisible);
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
    const cents = Number(match[2]);
    return Number.isSafeInteger(dollars) && dollars >= 0 && Number.isSafeInteger(cents) ? dollars * 100 + cents : null;
  }
  function parseRetailerPriceElement(element) {
    const nodes = [element, ...element.querySelectorAll("*")];
    const semanticCandidates = nodes.flatMap((node) => [
      node.getAttribute("content"),
      node.getAttribute("value"),
      node.getAttribute("aria-label"),
      node.getAttribute("data-price"),
      node.getAttribute("data-value")
    ]).filter((candidate) => Boolean(candidate?.trim()));
    const leafCandidates = nodes.filter((node) => node.childElementCount === 0).map((node) => text(node, 300)).filter(Boolean);
    for (const candidate of [...semanticCandidates, ...leafCandidates]) {
      if (!explicitFraction(candidate)) continue;
      const parsed = parseUsPrice(candidate);
      if (parsed !== null) return parsed;
    }
    const split = splitDollarPrice(element);
    if (split !== null) return split;
    for (const candidate of semanticCandidates) {
      const parsed = parseUsPrice(candidate);
      if (parsed !== null) return parsed;
    }
    if (element.childElementCount === 0) return parseUsPrice(text(element, 300));
    return null;
  }
  function readPrice(root, selectors) {
    for (const selector of selectors) {
      for (const element of root.querySelectorAll(selector)) {
        if (element.tagName !== "META" && !visible(element)) continue;
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
  function extractRetailerSku(retailerId, urlValue) {
    try {
      const retailer = config(retailerId);
      const url = new URL(urlValue);
      if (!retailer || !hostAllowed(url, retailer.domains)) return "";
      const sku = retailer.skuFromUrl(url).toUpperCase();
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
    return /\bpage you have attempted to access can not be displayed\b|\bpage (?:is|was) temporarily unavailable\b/i.test(text(document.body, 2e4));
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
      "[class*='high-demand-gate' i]"
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
    const dialogText = text(dialog, 12e3);
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
    const sellerText = retailer.retailerId === "bestbuy" ? sellerElementText(element, 1e3) : text(element, 1e3);
    const scopedText = retailer.retailerId === "bestbuy" ? observableText(root, 8e4) : text(root, 8e4);
    const pageText = retailer.retailerId === "bestbuy" ? `${sellerText} ${scopedText}`.trim() : sellerText || scopedText;
    if (retailer.firstPartyPattern.test(pageText)) return { sellerName: retailer.firstPartyName, sellerType: "first_party" };
    if (retailer.retailerId === "fanatics" && /ships?\s+directly\s+from\s+a\s+trusted\s+partner/i.test(pageText)) {
      return { sellerName: "", sellerType: "unknown" };
    }
    if (sellerText && retailer.marketplacePattern.test(sellerText)) {
      const sellerName = sellerText.replace(/^.*?sold\s+(?:and|&)\s+shipped\s+by\s*/i, "").replace(/^.*?sold\s+by\s*/i, "").replace(/\s+(?:and|&)\s+(?:shipped|fulfilled)\s+by.*$/i, "").trim().slice(0, 160);
      return sellerName ? { sellerName, sellerType: "third_party" } : { sellerName: "", sellerType: "unknown" };
    }
    if (retailer.marketplacePattern.test(scopedText)) return { sellerName: "", sellerType: "unknown" };
    if (retailer.implicitFirstParty && control) return { sellerName: retailer.firstPartyName, sellerType: "first_party" };
    return { sellerName: "", sellerType: "unknown" };
  }
  function fulfillmentEvidence(root, control, retailer) {
    const tileSelectors = selectorsFor(retailer.retailerId, "fulfillmentTile");
    selectorListTrace("fulfillment", root, tileSelectors);
    const selected = [...root.querySelectorAll(tileSelectors.join(", "))].filter(visible).map((element) => text(element.closest("label, [role='tab'], [data-testid*='fulfillment' i], [data-automation-id*='fulfillment' i]") || element, 800));
    const evidence = [text(control, 500), ...selected].join(" ");
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
      text(element, 300)
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
    return [...new Set(packaged)].filter((element) => visible(element) && intentPattern.test(controlIntent(element)) && !merchandisingControl(element));
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
    const elements = field === "addControl" ? genericAddIntentControls(root) : [...root.querySelectorAll(REPAIR_STRUCTURAL_SELECTOR)].slice(0, 500).filter((element) => visible(element) && !merchandisingControl(element));
    return [...new Set(elements)].filter((element) => repairLandmarkElement(element, field) !== null).filter((element) => repairSemanticMatches(field, element, retailer));
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
    const packaged = readPrice(root, retailer.priceSelectors);
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
    )].filter(visible);
    for (const feature of features) {
      const label = text(queryVisible(feature, [
        `.offer-display-feature-label[offer-display-feature-name='${desktopName}']`,
        `[data-csa-c-slot-id='odf-feature-label-${desktopName}']`
      ]), 300);
      const value = text(queryVisible(feature, [
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
    const sellerText = text(queryVisible(root, retailer.sellerSelectors), 2e3) || text(root, 3e4);
    return retailer.firstPartyPattern.test(sellerText) || retailer.marketplacePattern.test(sellerText);
  }
  function amazonFulfillment(root) {
    const selectedEvidence = [...root.querySelectorAll(selectorsFor("amazon", "fulfillmentTile").join(", "))].filter(visible).map((element) => observableText(
      element.closest("label, [role='tab'], [role='radio'], [data-testid*='fulfillment' i], [data-feature-name*='delivery' i]") || element,
      2e3
    )).join(" ");
    const selectedShipping = /\bshipping\b|\bdeliver(?:y|ies|ed|ing)?\b/i.test(selectedEvidence);
    const selectedPickup = /\bpick[ -]?up\b|\blocker\b/i.test(selectedEvidence);
    if (selectedShipping !== selectedPickup) return selectedShipping ? "shipping" : "pickup";
    const evidence = observableText(root, 3e4);
    const shipping = /\bships?\s+from\b|\bshipper\b|\bshipping\b|\bdeliver(?:y|ies|ed|ing)?\b/i.test(evidence);
    const pickup = /\bpick[ -]?up\b/i.test(evidence);
    return shipping !== pickup ? shipping ? "shipping" : "pickup" : "unknown";
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
      const controls = candidateControls(root, retailer);
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
    const scoped = candidateControls(document, retailer).map((control) => amazonOfferScope(control, retailer, expectedSku)).filter((candidate) => Boolean(candidate));
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
    const scopedText = text(root, 3e4);
    return retailer.firstPartyPattern.test(scopedText) || retailer.marketplacePattern.test(scopedText);
  }
  function objectValue(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  }
  function walmartQuantityOne(root) {
    const selectors = selectorsFor("walmart", "quantity");
    selectorListTrace("quantity", root, selectors);
    const controls = [...root.querySelectorAll(selectors.join(", "))].filter((element) => element.tagName === "INPUT" || visible(element));
    if (!controls.length) return true;
    return controls.every((control) => String(control.value || "").trim() === "1");
  }
  function walmartPrimaryActionControls(document, retailer) {
    selectorTrace("offer_scope", document, WALMART_MERCHANDISING_SCOPE);
    selectorTrace("offer_scope", document, WALMART_SECONDARY_ACTION_SCOPE);
    selectorTrace("offer_scope", document, WALMART_PRIMARY_SCOPE);
    const rendered = candidateControls(document, retailer).filter((control) => !control.closest(WALMART_MERCHANDISING_SCOPE)).filter(renderedVisible);
    const nonSecondary = rendered.filter((control) => !control.closest(WALMART_SECONDARY_ACTION_SCOPE));
    const primary = nonSecondary.filter((control) => Boolean(control.closest(WALMART_PRIMARY_SCOPE)));
    if (primary.length > 0) return primary;
    if (nonSecondary.length > 0) return nonSecondary;
    return rendered.length === 1 ? rendered : [];
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
    if (!condition("product.conditionOffers[].condition.groupCode", 1, offerCondition?.groupCode, Number(offerCondition?.groupCode) === 1)) return null;
    if (!condition("product.conditionOffers[].price.price", unitPriceCents, Math.round(Number(conditionPrice?.price) * 100), Math.round(Number(conditionPrice?.price) * 100) === unitPriceCents)) return null;
    const expectedType = requiredFulfillment === "pickup" ? "PICKUP" : "SHIPPING";
    const fulfillmentOptions = Array.isArray(product.fulfillmentOptions) ? product.fulfillmentOptions.map(objectValue).filter(Boolean) : [];
    const selectedOptions = fulfillmentOptions.filter((option) => option?.type === expectedType && option?.selected === true);
    if (!condition("product.fulfillmentOptions.selected.count", 1, selectedOptions.length, selectedOptions.length === 1) || !selectedOptions[0]) return null;
    const fulfillmentOption = selectedOptions[0];
    if (!condition("product.fulfillmentOptions[].availabilityStatus", "IN_STOCK", fulfillmentOption.availabilityStatus, fulfillmentOption.availabilityStatus === "IN_STOCK")) return null;
    if (!condition("product.fulfillmentOptions[].viewOnly", false, fulfillmentOption.viewOnly, fulfillmentOption.viewOnly !== true)) return null;
    if (!condition("product.fulfillmentOptions[].restricted", false, fulfillmentOption.restricted, fulfillmentOption.restricted !== true)) return null;
    if (!condition("product.fulfillmentOptions[].intent", "not false", fulfillmentOption.intent, fulfillmentOption.intent !== false)) return null;
    for (const limit of [fulfillmentOption.maxOrderQuantity, fulfillmentOption.orderLimit, product.orderLimit]) {
      if (limit !== null && limit !== void 0 && (!Number.isFinite(Number(limit)) || Number(limit) < 1)) return null;
    }
    const pool = walmartPrimaryActionControls(document, retailer);
    if (pool.length !== 1 || !pool[0] || !walmartQuantityOne(document)) return null;
    const control = pool[0];
    const offerRoot = control.closest(WALMART_PRIMARY_SCOPE) || control.closest("main") || control.parentElement;
    if (!offerRoot) return null;
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
    const scoped = walmartPrimaryActionControls(document, retailer).map((control) => walmartOfferScope(control, retailer, expectedSku)).filter((candidate) => Boolean(candidate));
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
    )].filter((element) => visible(element) && !element.closest(BESTBUY_MERCHANDISING_SCOPE) && element.childElementCount <= 8);
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
  function bestBuyFulfillment(root, control) {
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
    const selected = [...root.querySelectorAll(selectorsFor("bestbuy", "fulfillmentTile").join(", "))].filter(visible).map(evidenceFor);
    const selectedShipping = selected.some((value) => CONFIGS.bestbuy.shippingPattern.test(value));
    const selectedPickup = selected.some((value) => CONFIGS.bestbuy.pickupPattern.test(value));
    if (selectedShipping !== selectedPickup) return selectedShipping ? "shipping" : "pickup";
    return "unknown";
  }
  var BESTBUY_SECONDARY_ACTION_SCOPE = selectorsFor("bestbuy", "secondaryActionScope").join(", ");
  function bestBuyBoundPrice(root, retailer) {
    for (const selector of retailer.priceSelectors) {
      const prices = new Set(
        [...root.querySelectorAll(selector)].filter((element) => (element.tagName === "META" || visible(element)) && !element.closest(BESTBUY_MERCHANDISING_SCOPE)).map(parseRetailerPriceElement).filter((price) => price !== null)
      );
      if (prices.size > 0) return prices.size === 1 ? [...prices][0] ?? null : null;
    }
    return null;
  }
  function bestBuySellerUnambiguous(root, retailer) {
    const evidence = [...root.querySelectorAll(retailer.sellerSelectors.join(", "))].filter((element) => visible(element) && !element.closest(BESTBUY_MERCHANDISING_SCOPE)).map((element) => sellerElementText(element, 2e3)).join(" ");
    const scoped = evidence || observableText(root, 3e4);
    const firstParty = retailer.firstPartyPattern.test(scoped);
    const marketplace = retailer.marketplacePattern.test(scoped);
    return firstParty !== marketplace;
  }
  function recoveredBestBuyOfferScope(document, retailer, expectedSku) {
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
        const fulfillment = bestBuyFulfillment(root, control);
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
    const controls = [...root.querySelectorAll(quantitySelectors.join(", "))].filter((element) => element.tagName === "INPUT" || visible(element));
    if (!controls.length) return true;
    return controls.every((control) => String(control.value || "").trim() === "1");
  }
  function bestBuyOfferScope(control, retailer, expectedSku) {
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
      const fulfillment = bestBuyFulfillment(root, control);
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
    const scoped = candidateControls(document, retailer).map((control) => bestBuyOfferScope(control, retailer, expectedSku)).filter((candidate) => Boolean(candidate));
    const recovered = scoped.length === 0 ? recoveredBestBuyOfferScope(document, retailer, expectedSku) : null;
    const bound = [...scoped, ...recovered ? [recovered] : []];
    const matching = bound.filter((candidate) => candidate.fulfillment === expectedFulfillment);
    return matching.length === 1 && matching[0] ? matching[0] : { control: null, fulfillment: unmatchedFulfillment(bound, expectedFulfillment), offerRoot: null };
  }
  function selectedControl(document, retailer, requiredFulfillment, expectedSku = "") {
    recordTrace({
      step: "add_control",
      condition: "selectedControl.retailer",
      expected: retailer.retailerId,
      actual: retailer.retailerId,
      passed: true
    });
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
    if (extractRetailerSku(retailerId, urlValue) !== expectedSku) return null;
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
    const flagged = selectors.length > 0 && [...document.querySelectorAll(selectors.join(", "))].filter((element) => visible(element) && !merchandisingControl(element)).some((element) => UNAVAILABLE_EVIDENCE.test(
      `${element.getAttribute("content") || ""} ${element.getAttribute("aria-label") || ""} ${observableText(element, 500)}`
    ));
    if (flagged) return true;
    const intentPattern = retailer.addIntentPattern ?? ADD_CONTROL_INTENT;
    const controls = [...new Set(retailer.addSelectors.flatMap((selector) => [...document.querySelectorAll(selector)]))].filter((element) => visible(element) && intentPattern.test(controlIntent(element)) && !merchandisingControl(element));
    return controls.length > 0 && controls.every((control) => !actionable(control));
  }
  function observeRetailerOffer(document, urlValue, retailerId, expectedSku, requiredFulfillment = "shipping", observedAt = (/* @__PURE__ */ new Date()).toISOString(), environment) {
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
    const pageSku = extractRetailerSku(retailerId, urlValue);
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
    const controlText = text(selected.control, 300);
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
  function cleanAmazonOfferId(value) {
    const candidate = String(value ?? "").replace(/^`+|`+$/g, "").trim();
    return candidate && candidate.length <= 2048 && !/[`\u0000-\u001f\u007f]/.test(candidate) ? candidate : "";
  }

  // packages/browser-adapters/src/bestbuy.ts
  function text2(value, maximum = 2e3) {
    return String(value?.textContent || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
  }
  function visible2(element) {
    if (!element) return false;
    let current = element;
    while (current) {
      if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden") === "true") return false;
      const style = String(current.getAttribute("style") || "").replace(/\s+/g, "").toLocaleLowerCase("en-US");
      if (/(?:^|;)display:none(?:;|$)|(?:^|;)visibility:hidden(?:;|$)/.test(style)) return false;
      current = current.parentElement;
    }
    return true;
  }
  function queryVisible2(root, selectors) {
    for (const selector of selectors) {
      const found = [...root.querySelectorAll(selector)].find(visible2);
      if (found) return found;
    }
    return null;
  }
  function readPrice2(root) {
    for (const selector of [
      "[data-testid='customer-price']",
      "[data-testid*='line-price' i]",
      "[data-testid*='price' i]",
      ".priceView-customer-price",
      ".priceView-hero-price",
      "[itemprop='price']"
    ]) {
      for (const element of root.querySelectorAll(selector)) {
        if (!visible2(element)) continue;
        const price = parseRetailerPriceElement(element);
        if (price !== null) return price;
      }
    }
    return null;
  }
  function bestBuyHost(url) {
    return url.protocol === "https:" && !url.username && !url.password && (url.hostname === "bestbuy.com" || url.hostname.endsWith(".bestbuy.com"));
  }
  function bestBuyPageKind(urlValue) {
    try {
      const url = new URL(urlValue);
      if (!bestBuyHost(url)) return "other";
      const path = url.pathname.toLocaleLowerCase("en-US");
      if (/\/identity\/(?:global\/)?signin|\/login|\/signin|\/challenge/.test(path)) return "auth";
      if (/waiting-room|virtual-queue|\/queue(?:\/|$)|^\/qp(?:\/|$)/.test(path)) return "queue";
      if (/^\/cart(?:\/|$)/.test(path)) return "cart";
      if (/^\/(?:checkout|payment|purchase)(?:\/|$)/.test(path)) return "checkout";
      return extractRetailerSku("bestbuy", urlValue) ? "product" : "other";
    } catch {
      return "other";
    }
  }
  function bestBuyAddControl(documentValue, urlValue, expectedSku, requiredFulfillment, environment) {
    if (requiredFulfillment !== "shipping" && requiredFulfillment !== "pickup") return null;
    if (bestBuyInteractiveBlock(documentValue, urlValue)) return null;
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
    return { ...observation, pageKind: bestBuyPageKind(urlValue) };
  }
  function lineSku(line) {
    for (const name of ["data-sku-id", "data-sku", "data-product-id"]) {
      const candidate = String(line.getAttribute(name) || "");
      if (/^\d{5,20}$/.test(candidate)) return candidate;
    }
    for (const anchor of line.querySelectorAll("a[href]")) {
      let href = "";
      try {
        href = new URL(anchor.getAttribute("href") || "", "https://www.bestbuy.com").href;
      } catch {
        href = "";
      }
      const sku = extractRetailerSku("bestbuy", href);
      if (sku) return sku;
    }
    return text2(line, 2e4).match(/\bSKU\s*:?\s*(\d{5,20})\b/i)?.[1] || "";
  }
  function lineQuantity(line) {
    const control = queryVisible2(line, [
      "select[aria-label*='quantity' i]",
      "select[name*='quantity' i]",
      "input[aria-label*='quantity' i]",
      "input[name*='quantity' i]",
      "[data-testid*='quantity' i]",
      "[class*='quantity' i]"
    ]);
    const formValue = control && ["INPUT", "SELECT"].includes(control.tagName) ? String(control.value || "") : "";
    const candidate = `${formValue} ${control?.getAttribute("aria-label") || ""} ${text2(control, 300)} ${text2(line, 4e3)}`;
    const match = candidate.match(/(?:qty|quantity)\s*:?\s*(\d{1,2})/i) ?? formValue.match(/^\s*(\d{1,2})\s*$/);
    const quantity = Number(match?.[1]);
    return Number.isInteger(quantity) && quantity >= 1 && quantity <= 99 ? quantity : null;
  }
  function sellerEvidence2(line) {
    const sellerElement = queryVisible2(line, [
      "[data-testid='sold-by']",
      "[data-testid*='sold-by' i]",
      "[data-testid*='seller' i]",
      "[class*='seller' i]"
    ]);
    const evidence = text2(sellerElement || line, 12e3);
    if (/sold\s+(?:and|&)\s+shipped\s+by\s+best\s*buy|sold\s+by\s+best\s*buy/i.test(evidence)) {
      return { sellerName: "Best Buy", sellerType: "first_party" };
    }
    const marketplace = evidence.match(/sold\s+(?:and|&)\s+shipped\s+by\s+(.{1,160}?)(?:\s+(?:return|shipping|pickup|quantity|qty|\$)|$)/i)?.[1] ?? evidence.match(/sold\s+by\s+(.{1,160}?)(?:\s+(?:return|shipping|pickup|quantity|qty|\$)|$)/i)?.[1] ?? "";
    const sellerName = marketplace.trim().slice(0, 160);
    return sellerName ? { sellerName, sellerType: "third_party" } : { sellerName: "", sellerType: "unknown" };
  }
  function cartLineElements(documentValue) {
    const candidates = [...documentValue.querySelectorAll(
      "[data-testid='cart-item'], [data-testid^='cart-item-'], [data-sku-id][class*='cart' i], li.item-list-item, [class~='cart-item']"
    )].filter((element) => visible2(element) && Boolean(lineSku(element)));
    return [...new Set(candidates)].filter((candidate) => !candidates.some((other) => other !== candidate && other.contains(candidate)));
  }
  function visiblyEmpty(documentValue) {
    const root = queryVisible2(documentValue, ["[data-testid*='empty-cart' i]", "main", "body"]);
    return Boolean(root && /(?:your )?cart is empty|no items in (?:your )?cart|cart has no items/i.test(text2(root, 4e4)));
  }
  function observeBestBuyCart(documentValue, observedAt = (/* @__PURE__ */ new Date()).toISOString()) {
    const elements = cartLineElements(documentValue);
    const lines = elements.map((line) => {
      const seller = sellerEvidence2(line);
      return {
        retailerSku: lineSku(line),
        quantity: lineQuantity(line),
        unitPriceCents: readPrice2(line),
        sellerName: seller.sellerName,
        sellerType: seller.sellerType
      };
    });
    const independentlyCounted = elements.length > 0 ? new Set(elements).size === elements.length : visiblyEmpty(documentValue);
    return {
      contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
      observedAt,
      complete: independentlyCounted && lines.every((line) => Boolean(line.retailerSku)),
      independentlyCounted,
      independentLineCount: elements.length,
      lines
    };
  }
  function bestBuySecurityChallenge(documentValue) {
    return retailerSecurityChallenge(documentValue, "bestbuy");
  }
  function bestBuyInteractiveBlock(documentValue, urlValue) {
    return retailerInteractiveBlock(documentValue, urlValue);
  }

  // apps/extension/src/bestbuy-action.ts
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
    if (job?.quantity !== 1) return "quantity_not_supported";
    if (job?.sellerPolicy !== "first_party_only") return "seller_policy_not_supported";
    if (job?.fulfillment !== "shipping" && job?.fulfillment !== "pickup") return "fulfillment_not_supported";
    return "";
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
    if (!verified.ok) return verified;
    const control = bestBuyAddControl(documentValue, urlValue, job.retailerSku, job.fulfillment, environment);
    if (!control) return { ok: false, reason: "add_control_unavailable" };
    const id = authorizationId(now);
    pending = { id, jobId: job.jobId, createdAt: now, control, proof: verified.proof };
    return { ok: true, reason: "verified", authorizationId: id, proof: verified.proof };
  }
  function rehearseBestBuyAdd(documentValue, urlValue, job, now = Date.now(), environment) {
    const prepared = prepareBestBuyAdd(documentValue, urlValue, job, now, environment);
    if (!prepared.ok) return prepared;
    abandonBestBuyAdd(prepared.authorizationId);
    return { ok: true, reason: "verified", proof: prepared.proof, wouldClick: true };
  }
  function commitBestBuyAdd(documentValue, urlValue, job, value, now = Date.now(), environment) {
    const authorization = pending;
    pending = null;
    if (!authorization || authorization.id !== value || authorization.jobId !== job.jobId) {
      return { ok: false, reason: "authorization_missing", clicked: false };
    }
    if (now < authorization.createdAt || now - authorization.createdAt > AUTHORIZATION_MAX_AGE_MS) {
      return { ok: false, reason: "authorization_expired", clicked: false };
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
    if (!verified.ok) return { ...verified, clicked: false };
    const control = bestBuyAddControl(documentValue, urlValue, job.retailerSku, job.fulfillment, environment);
    if (!control || control !== authorization.control) {
      traceElement(environment, "authorized", authorization.control);
      traceElement(environment, "rebound", control);
      return { ok: false, reason: "add_control_changed", clicked: false };
    }
    try {
      control.click();
      return { ok: true, reason: "clicked", clicked: true, proof: verified.proof };
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
  function verifyBestBuyAddedCart(documentValue, urlValue, job, proof, baseline, now = Date.now()) {
    if (!bestBuyCartUrl(urlValue)) return { ok: false, reason: "cart_page_unverified" };
    if (bestBuySecurityChallenge(documentValue) || bestBuyInteractiveBlock(documentValue, urlValue)) {
      return { ok: false, reason: "manual_action_required" };
    }
    const inventory = observeBestBuyCart(documentValue, new Date(now).toISOString());
    const verified = verifyCartAddDelta(job, baseline, inventory, proof, now);
    if (!verified.ok) return verified;
    const nextBaseline = captureCartBaseline("bestbuy", inventory, now);
    return {
      ...verified,
      ...nextBaseline.ok ? { cartBaseline: nextBaseline.proof } : {}
    };
  }
  Object.defineProperty(globalThis, "YoinkBestBuyAction", {
    value: Object.freeze({
      abandonBestBuyAdd,
      commitBestBuyAdd,
      inspectBestBuyCartBaseline,
      prepareBestBuyAdd,
      rehearseBestBuyAdd,
      verifyBestBuyAddedCart
    }),
    configurable: true
  });
  return __toCommonJS(bestbuy_action_exports);
})();
