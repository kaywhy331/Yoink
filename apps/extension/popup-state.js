"use strict";
var YoinkPopupStateModule = (() => {
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

  // packages/extension-ui/src/popup-state.ts
  var popup_state_exports = {};
  __export(popup_state_exports, {
    CART_READY_STORAGE_KEY: () => CART_READY_STORAGE_KEY,
    POPUP_RESULT_STORAGE_KEY: () => POPUP_RESULT_STORAGE_KEY,
    POPUP_UPDATE_HANDOFF_STORAGE_KEY: () => POPUP_UPDATE_HANDOFF_STORAGE_KEY,
    PRODUCT_DOCUMENT_PATTERNS: () => PRODUCT_DOCUMENT_PATTERNS,
    RETAILER_ORIGINS: () => RETAILER_ORIGINS,
    appDestinationUrl: () => appDestinationUrl,
    cartReadyState: () => cartReadyState,
    classifyPageContext: () => classifyPageContext,
    compareVersions: () => compareVersions,
    deriveContextMenuCommands: () => deriveContextMenuCommands,
    derivePopupView: () => derivePopupView,
    drawingsPopupResult: () => drawingsPopupResult,
    errorPopupResult: () => errorPopupResult,
    popupPurchaseOpportunity: () => popupPurchaseOpportunity,
    popupUpdateHandoff: () => popupUpdateHandoff,
    preferredActionHandoff: () => preferredActionHandoff,
    qualificationPopupResult: () => qualificationPopupResult
  });

  // packages/browser-safety/src/index.ts
  var CART_PROOF_MAX_AGE_MS = 5 * 6e4;
  var CHECKOUT_EVIDENCE_MAX_AGE_MS = 2 * 6e4;
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
      contractVersion: "target-add-v8",
      packVersion: "target-pack-v1",
      observerVersion: "target-observer-v6",
      activationConfirmation: "ENABLE_TARGET_ADD_V8",
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
      contractVersion: "walmart-add-v8",
      packVersion: "walmart-pack-v1",
      observerVersion: "walmart-observer-v7",
      activationConfirmation: "ENABLE_WALMART_ADD_V8",
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
      contractVersion: "amazon-add-v9",
      packVersion: "amazon-pack-v2",
      observerVersion: "amazon-observer-v8",
      activationConfirmation: "ENABLE_AMAZON_ADD_V9",
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
      contractVersion: "bestbuy-add-v11",
      packVersion: "bestbuy-pack-v1",
      observerVersion: "bestbuy-observer-v10",
      activationConfirmation: "ENABLE_BESTBUY_ADD_V11",
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

  // packages/browser-adapters/src/target.ts
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
  var TARGET_FULFILLMENT_ROOT_SELECTOR = selectorsFor("target", "fulfillmentRoot").join(", ");
  var TARGET_FULFILLMENT_TILE_SELECTOR = selectorsFor("target", "fulfillmentTile").join(", ");

  // packages/browser-adapters/src/retailers.ts
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
  function config(retailerId) {
    return retailerId === "target" ? null : CONFIGS[retailerId];
  }
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
  function canonicalRetailerProductUrl(retailerId, urlValue) {
    try {
      const retailer = config(retailerId);
      const url = new URL(urlValue);
      if (!retailer || !hostAllowed(url, retailer.domains) || url.pathname.length > 1e3) return "";
      const sku = extractRetailerSku(retailerId, url.href);
      if (!sku) return "";
      if (retailerId === "walmart") return `https://www.walmart.com/ip/${sku}`;
      if (retailerId === "amazon") return `https://www.amazon.com/dp/${sku}`;
      if (retailerId === "bestbuy") return `https://www.bestbuy.com/site/-/${sku}.p`;
      if (retailerId === "riot") return `https://merch.riotgames.com/en-us/product/${sku.toLocaleLowerCase("en-US")}/`;
      if (retailerId === "booksamillion") return `https://www.booksamillion.com/p/-/${sku}`;
      if (retailerId === "pbandai") return `https://p-bandai.com/us/item/${sku}`;
      if (retailerId === "pokemoncenter") {
        url.hostname = "www.pokemoncenter.com";
        url.port = "";
        url.search = "";
        url.hash = "";
        return url.href;
      }
      const canonical = new URL(`https://${retailerId === "disney" ? "www.disneystore.com" : retailerId === "ravensburger" ? "www.ravensburger.us" : retailerId === "fanatics" ? "www.fanatics.com" : retailerId === "kohls" ? "www.kohls.com" : "www.macys.com"}${url.pathname}`);
      if (retailerId === "macys") canonical.searchParams.set("ID", sku);
      return canonical.href;
    } catch {
      return "";
    }
  }
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
  var BESTBUY_SECONDARY_ACTION_SCOPE = selectorsFor("bestbuy", "secondaryActionScope").join(", ");

  // packages/extension-ui/src/popup-state.ts
  var POPUP_RESULT_STORAGE_KEY = "yoinkPopupResultV1";
  var POPUP_UPDATE_HANDOFF_STORAGE_KEY = "yoinkUpdateHandoffV1";
  var CART_READY_STORAGE_KEY = "yoinkCartReadyV1";
  var APP_DESTINATION_ROUTES = {
    dashboard: { pathname: "/", hash: "home" },
    actions: { pathname: "/", hash: "activity" },
    insights: { pathname: "/", hash: "activity/insights" },
    connections: { pathname: "/", hash: "settings/chrome" },
    settings: { pathname: "/", hash: "settings" }
  };
  function appDestinationUrl(appOrigin, destination = "dashboard") {
    const route = APP_DESTINATION_ROUTES[destination];
    if (!route) throw new Error("Unknown Yoink app destination.");
    const url = new URL(route.pathname, appOrigin);
    if (route.hash) url.hash = route.hash;
    return url.href;
  }
  var RETAILERS = {
    target: { name: "Target", domains: ["target.com"], identityLabel: "TCIN" },
    walmart: { name: "Walmart", domains: ["walmart.com"], identityLabel: "Item" },
    amazon: { name: "Amazon", domains: ["amazon.com"], identityLabel: "ASIN" },
    bestbuy: { name: "Best Buy", domains: ["bestbuy.com"], identityLabel: "SKU" },
    disney: { name: "Disney Store", domains: ["disneystore.com"], identityLabel: "SKU" },
    ravensburger: { name: "Ravensburger", domains: ["ravensburger.us"], identityLabel: "SKU" },
    riot: { name: "Riot Games Merch", domains: ["merch.riotgames.com"], identityLabel: "SKU" },
    booksamillion: { name: "Books-A-Million", domains: ["booksamillion.com"], identityLabel: "SKU" },
    fanatics: { name: "Fanatics", domains: ["fanatics.com"], identityLabel: "SKU" },
    kohls: { name: "Kohl's", domains: ["kohls.com"], identityLabel: "SKU" },
    macys: { name: "Macy's", domains: ["macys.com"], identityLabel: "SKU" },
    pbandai: { name: "Premium Bandai", domains: ["p-bandai.com"], identityLabel: "SKU" },
    pokemoncenter: { name: "Pok\xE9mon Center", domains: ["pokemoncenter.com"], identityLabel: "SKU" }
  };
  var RETAILER_ORDER = Object.keys(RETAILERS);
  var RETAILER_ORIGINS = {
    target: ["https://www.target.com/*"],
    walmart: ["https://*.walmart.com/*"],
    amazon: ["https://*.amazon.com/*"],
    bestbuy: ["https://*.bestbuy.com/*"],
    disney: ["https://www.disneystore.com/*"],
    ravensburger: ["https://*.ravensburger.us/*"],
    riot: ["https://merch.riotgames.com/*"],
    booksamillion: ["https://*.booksamillion.com/*"],
    fanatics: ["https://*.fanatics.com/*"],
    kohls: ["https://*.kohls.com/*"],
    macys: ["https://*.macys.com/*"],
    pbandai: ["https://*.p-bandai.com/*"],
    pokemoncenter: ["https://*.pokemoncenter.com/*"]
  };
  var PRODUCT_DOCUMENT_PATTERNS = [
    "https://www.target.com/p/*",
    "https://*.walmart.com/ip/*",
    "https://*.amazon.com/dp/*",
    "https://*.amazon.com/*/dp/*",
    "https://*.amazon.com/gp/product/*",
    "https://*.amazon.com/gp/aw/d/*",
    "https://*.bestbuy.com/product/*",
    "https://*.bestbuy.com/site/*.p*",
    "https://www.disneystore.com/*.html*",
    "https://*.ravensburger.us/en-US/products/*",
    "https://merch.riotgames.com/en-us/product/*",
    "https://*.booksamillion.com/p/*",
    "https://*.fanatics.com/*+p-*",
    "https://*.fanatics.com/*%2Bp-*",
    "https://*.kohls.com/product/prd-*",
    "https://*.macys.com/shop/product/*",
    "https://*.p-bandai.com/us/item/*",
    "https://*.pokemoncenter.com/product/*"
  ];
  function trustedHttpsUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "https:" && !url.username && !url.password ? url : null;
    } catch {
      return null;
    }
  }
  function hostMatches(host, domain) {
    return host === domain || host.endsWith(`.${domain}`);
  }
  function retailerFromUrl(url) {
    const host = url.hostname.toLocaleLowerCase("en-US");
    return RETAILER_ORDER.find((retailerId) => RETAILERS[retailerId].domains.some((domain) => hostMatches(host, domain))) ?? null;
  }
  function exactProductRoute(retailerId, url) {
    const path = url.pathname;
    if (retailerId === "target") return url.hostname.toLocaleLowerCase("en-US") === "www.target.com" && /(?:^|\/)A-\d{6,}(?:\/|$)/i.test(path);
    if (retailerId === "walmart") return /\/ip\/(?:[^/?#]+\/)?\d{5,20}(?:\/|$)/i.test(path);
    if (retailerId === "amazon") return /\/(?:dp|gp\/product|gp\/aw\/d)\/[A-Z0-9]{10}(?:\/|$)/i.test(path);
    if (retailerId === "bestbuy") {
      return /^\/product\/[^/]+\/(?:[^/]+\/sku\/)?\d{5,20}(?:\/|$)/i.test(path) || /^\/site\/[^/]+\/\d{5,20}\.p(?:\/|$)/i.test(path);
    }
    if (retailerId === "disney") return /-\d{10,20}\.html(?:\/|$)/i.test(path);
    if (retailerId === "ravensburger") return /^\/en-US\/products\/.*-\d{5,20}(?:\/|$)/i.test(path);
    if (retailerId === "riot") return /^\/en-us\/product\/[a-z0-9](?:[a-z0-9-]{1,118}[a-z0-9])?\/?$/i.test(path);
    if (retailerId === "booksamillion") return /^\/p\/(?:-\/)?[a-z0-9]{10,20}(?:\/|$)/i.test(path);
    if (retailerId === "fanatics") return /(?:^|\+)p-\d{6,20}(?:\+|$)/i.test(path.replace(/%2B/gi, "+"));
    if (retailerId === "kohls") return /^\/product\/prd-\d{5,12}\//i.test(path);
    if (retailerId === "macys") return /^\/shop\/product\//i.test(path) && /^\d{5,20}$/.test(url.searchParams.get("ID") || url.searchParams.get("id") || "");
    if (retailerId === "pbandai") return /^\/us\/item\/[a-z]\d{10}(?:\/|$)/i.test(path);
    return /^\/product\/\d{2,3}-\d{5}(?:-\d{3})?(?:\/|$)/i.test(path);
  }
  function classifyPageContext(value) {
    const url = trustedHttpsUrl(value);
    if (!url) return { kind: "unsupported", key: "unsupported" };
    const retailerId = retailerFromUrl(url);
    if (!retailerId) return { kind: "unsupported", key: "unsupported" };
    const retailer = RETAILERS[retailerId];
    if (retailerId === "walmart" && url.pathname.replace(/\/+$/, "") === "/shop/collectibles/draw") {
      return { kind: "walmart_draw", key: "walmart_draw", retailerId: "walmart", retailerName: "Walmart" };
    }
    if (!exactProductRoute(retailerId, url)) {
      return {
        kind: "supported_non_product",
        key: `supported:${retailerId}`,
        retailerId,
        retailerName: retailer.name
      };
    }
    const sku = retailerId === "target" ? extractTargetSku(url.href) : extractRetailerSku(retailerId, url.href);
    if (!sku) {
      return {
        kind: "supported_non_product",
        key: `supported:${retailerId}`,
        retailerId,
        retailerName: retailer.name
      };
    }
    const canonicalUrl = retailerId === "target" ? `https://www.target.com/p/-/A-${sku}` : canonicalRetailerProductUrl(retailerId, url.href);
    return {
      kind: "product",
      key: `product:${retailerId}:${sku}`,
      retailerId,
      retailerName: retailer.name,
      identityLabel: retailer.identityLabel,
      sku,
      canonicalUrl
    };
  }
  function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }
  function cleanResultText(value, maximum = 360) {
    return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
  }
  var CART_READY_RETAILERS = {
    target: { name: "Target", identityLabel: "TCIN" },
    walmart: { name: "Walmart", identityLabel: "Item" },
    amazon: { name: "Amazon", identityLabel: "ASIN" },
    bestbuy: { name: "Best Buy", identityLabel: "SKU" }
  };
  function cartReadyLatency(value) {
    const candidate = record(value);
    const duration = (input) => {
      const milliseconds = Number(input);
      return Number.isSafeInteger(milliseconds) && milliseconds >= 0 && milliseconds <= 60 * 6e4 ? milliseconds : void 0;
    };
    const leaseToCartReadyMs = duration(candidate.leaseToCartReadyMs);
    const leaseToBaselineMs = duration(candidate.leaseToBaselineMs);
    const baselineToOfferMs = duration(candidate.baselineToOfferMs);
    const offerToClickMs = duration(candidate.offerToClickMs);
    const clickToSettleMs = duration(candidate.clickToSettleMs);
    const clickToCartReadyMs = duration(candidate.clickToCartReadyMs);
    const settleToCartReadyMs = duration(candidate.settleToCartReadyMs);
    return {
      ...leaseToCartReadyMs !== void 0 ? { leaseToCartReadyMs } : {},
      ...leaseToBaselineMs !== void 0 ? { leaseToBaselineMs } : {},
      ...baselineToOfferMs !== void 0 ? { baselineToOfferMs } : {},
      ...offerToClickMs !== void 0 ? { offerToClickMs } : {},
      ...clickToSettleMs !== void 0 ? { clickToSettleMs } : {},
      ...clickToCartReadyMs !== void 0 ? { clickToCartReadyMs } : {},
      ...settleToCartReadyMs !== void 0 ? { settleToCartReadyMs } : {}
    };
  }
  function cartReadyState(value, now = Date.now()) {
    const source = record(value);
    const input = Array.isArray(source.items) ? source.items : [];
    const unique = /* @__PURE__ */ new Map();
    for (const raw of input.slice(-20)) {
      const candidate = record(raw);
      const retailerId = String(candidate.retailerId || "");
      const retailer = CART_READY_RETAILERS[retailerId];
      const kind = candidate.kind === "needs_you" ? "needs_you" : "cart_ready";
      const jobId = cleanResultText(candidate.jobId, 120);
      const retailerSku = cleanResultText(candidate.retailerSku, 120).toLocaleUpperCase("en-US");
      const tabId = Number(candidate.tabId);
      const recordedAt = new Date(String(candidate.recordedAt || "")).getTime();
      const openedAt = new Date(String(candidate.openedAt || "")).getTime();
      const reviewedMaximumCents = Number(candidate.reviewedMaximumCents);
      if (candidate.schemaVersion !== 1 || !retailer || !/^[A-Za-z0-9_-]{3,120}$/.test(jobId) || !/^[A-Z0-9-]{3,120}$/.test(retailerSku) || !Number.isSafeInteger(tabId) || tabId < 0 || !Number.isFinite(recordedAt) || recordedAt > now + 6e4 || now - recordedAt >= 24 * 60 * 6e4) continue;
      unique.set(jobId, {
        schemaVersion: 1,
        kind,
        jobId,
        retailerId,
        retailerName: retailer.name,
        identityLabel: retailer.identityLabel,
        retailerSku,
        tabId,
        recordedAt: new Date(recordedAt).toISOString(),
        ...Number.isFinite(openedAt) && openedAt >= recordedAt && openedAt <= now + 6e4 && now - openedAt < 24 * 60 * 6e4 ? { openedAt: new Date(openedAt).toISOString() } : {},
        ...Number.isSafeInteger(reviewedMaximumCents) && reviewedMaximumCents > 0 && reviewedMaximumCents <= 1e8 ? { reviewedMaximumCents } : {},
        ...kind === "needs_you" && /^[a-z][a-z0-9_]{1,79}$/.test(String(candidate.reasonCode || "")) ? { reasonCode: String(candidate.reasonCode) } : {},
        latency: cartReadyLatency(candidate.latency)
      });
    }
    return { schemaVersion: 1, items: [...unique.values()].slice(-10) };
  }
  function preferredActionHandoff(value, now = Date.now(), ranking = "pending_outcome_first") {
    const items = cartReadyState(value, now).items;
    const newest = (kind, opened) => items.filter((item) => item.kind === kind && Boolean(item.openedAt) === opened).at(-1) ?? null;
    const tiers = ranking === "unopened_first" ? [false, true] : [true, false];
    for (const opened of tiers) {
      const item = newest("needs_you", opened) ?? newest("cart_ready", opened);
      if (item) return item;
    }
    return null;
  }
  function popupPurchaseOpportunity(value, now = Date.now()) {
    const candidate = record(value);
    const deliveryId = cleanResultText(candidate.deliveryId, 160);
    const retailerSku = cleanResultText(candidate.retailerSku, 32);
    const expiry = new Date(String(candidate.expiresAt || "")).getTime();
    if (candidate.schemaVersion !== 1 || candidate.kind !== "walmart_review_order" || candidate.retailerId !== "walmart" || !/^[A-Za-z0-9_-]{3,160}$/.test(deliveryId) || !/^\d{5,20}$/.test(retailerSku) || !Number.isFinite(expiry) || expiry <= now || expiry > now + 5 * 6e4) return null;
    return {
      schemaVersion: 1,
      deliveryId,
      kind: "walmart_review_order",
      retailerId: "walmart",
      retailerName: "Walmart",
      identityLabel: "Item",
      retailerSku,
      title: cleanResultText(candidate.title, 160) || `Walmart item ${retailerSku}`,
      expiresAt: new Date(expiry).toISOString()
    };
  }
  function safeErrorText(value) {
    return cleanResultText(value, 600).replace(/https?:\/\/\S+/gi, "[redacted URL]").replace(/\b(authorization|bearer|cookie|csrf|secret|session|token)\s*[:=]?\s*[^\s·,;]+/gi, "$1 [redacted]").replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]").slice(0, 300);
  }
  function resultTitleCase(value) {
    return cleanResultText(value, 80).replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
  }
  function resultMoney(value) {
    const cents = value === null || value === void 0 || value === "" ? Number.NaN : Number(value);
    return Number.isSafeInteger(cents) && cents >= 0 ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100) : "Price unavailable";
  }
  function persistedResult(contextKey, outcome, summary, details, now, productTitle = "") {
    const sanitizedTitle = cleanResultText(productTitle, 300);
    return {
      schemaVersion: 1,
      contextKey: cleanResultText(contextKey, 180),
      outcome,
      summary: cleanResultText(summary, 180),
      details: cleanResultText(details, 1200),
      recordedAt: new Date(now).toISOString(),
      ...sanitizedTitle ? { productTitle: sanitizedTitle } : {}
    };
  }
  function popupUpdateHandoff(value, now = Date.now()) {
    const candidate = record(value);
    const channel = candidate.channel === "local" || candidate.channel === "managed" ? candidate.channel : null;
    const releaseVersion = cleanResultText(candidate.releaseVersion, 40);
    if (!channel || !comparableVersion(releaseVersion)) return null;
    return {
      schemaVersion: 1,
      channel,
      releaseVersion,
      recordedAt: new Date(now).toISOString()
    };
  }
  function exactCatalogProductTitle(response, page) {
    const identity = record(response.productIdentity);
    const retailerId = cleanResultText(identity.retailerId, 40).toLocaleLowerCase("en-US");
    const retailerSku = cleanResultText(identity.retailerSku, 120).toLocaleUpperCase("en-US");
    if (identity.source !== "catalog_exact_retailer_sku" || retailerId !== page.retailerId || retailerSku !== page.sku.toLocaleUpperCase("en-US")) return "";
    return cleanResultText(identity.title, 300);
  }
  function qualificationPopupResult(value, page, now = Date.now()) {
    if (page.kind !== "product") return null;
    const response = record(value);
    const observation = record(response.observation);
    const rehearsal = record(response.rehearsal);
    const productTitle = exactCatalogProductTitle(response, page);
    const price = resultMoney(observation.unitPriceCents);
    const fulfillment = resultTitleCase(observation.fulfillment || "Fulfillment unavailable");
    const seller = cleanResultText(observation.sellerName || "Seller unavailable", 160);
    const lines = [`${page.identityLabel} ${page.sku}`, price, seller, fulfillment];
    if (observation.availability) lines.push(`Availability: ${resultTitleCase(observation.availability)}`);
    if (observation.securityChallenge === true) lines.push("Security check on the page");
    else if (observation.interactiveBlock) lines.push(`Manual step: ${resultTitleCase(observation.interactiveBlock)}`);
    if (observation.purchaseRouteReady === true) lines.push("Exact offer binding verified");
    const qualification = response.workflow === "qualification";
    if (!qualification) {
      return persistedResult(page.key, "inspected", `Inspected \xB7 ${price}`, lines.join(" \xB7 "), now, productTitle);
    }
    if (rehearsal.ok === true) {
      return persistedResult(page.key, "qualified", `Check passed \xB7 ${price} \xB7 ${fulfillment}`, lines.join(" \xB7 "), now, productTitle);
    }
    const reason = safeErrorText(response.message || resultTitleCase(rehearsal.reason || "Offer not verified"));
    return persistedResult(page.key, "blocked", `Blocked \xB7 ${reason}`, `${lines.join(" \xB7 ")} \xB7 ${reason}`, now, productTitle);
  }
  function drawingsPopupResult(value, page, now = Date.now()) {
    if (page.kind !== "walmart_draw") return null;
    const response = record(value);
    const scan = record(response.scan);
    const items = Array.isArray(scan.items) ? scan.items : [];
    const active = items.filter((item) => record(item).drawState === "active").length;
    const summary = `Inspected \xB7 ${active} active drawing${active === 1 ? "" : "s"}`;
    const details = `${items.length} exact drawing item${items.length === 1 ? "" : "s"} observed.`;
    return persistedResult(page.key, "drawings", summary, details, now);
  }
  function errorPopupResult(contextKey, error, blocked = false, now = Date.now()) {
    const message = safeErrorText(record(error).message || error || "The request could not be completed.") || "The request could not be completed.";
    return persistedResult(contextKey, blocked ? "blocked" : "error", `${blocked ? "Blocked" : "Error"} \xB7 ${message}`, message, now);
  }
  function comparableVersion(value) {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(String(value || ""));
    return match ? match.slice(1, 4).map((part) => Number(part)) : null;
  }
  function compareVersions(left, right) {
    const a = comparableVersion(left);
    const b = comparableVersion(right);
    if (!a || !b) return 0;
    for (let index = 0; index < 3; index += 1) {
      const leftPart = a[index] ?? 0;
      const rightPart = b[index] ?? 0;
      if (leftPart !== rightPart) return leftPart > rightPart ? 1 : -1;
    }
    return 0;
  }
  function operationLabel(action, stage) {
    if (stage === "requesting_access") return "Requesting access\u2026";
    if (stage === "inspecting") return action === "inspect_drawings" ? "Inspecting drawings\u2026" : "Inspecting\u2026";
    if (stage === "qualifying") return "Checking offer\u2026";
    if (stage === "pairing") return "Pairing\u2026";
    if (stage === "reconnecting") return "Reconnecting\u2026";
    if (stage === "opening_cart") return action === "open_purchase" ? "Opening Walmart\u2026" : "Opening cart\u2026";
    if (stage === "updating") return "Checking update\u2026";
    if (stage === "checking_stores") return "Checking stores\u2026";
    if (stage === "sharing") return "Sharing\u2026";
    if (stage === "saving") return "Saving\u2026";
    return null;
  }
  function runningSync(health, now) {
    const sync = health.trackalackerSync;
    const updatedAt = new Date(String(sync?.updatedAt || "")).getTime();
    return ["starting", "discovering", "importing"].includes(String(sync?.phase || "")) && Number.isFinite(updatedAt) && now - updatedAt < 10 * 6e4;
  }
  function signalsLabel(health, now) {
    const count = Number(health.popupSummary?.followedCount);
    const updatedAt = new Date(String(health.popupSummary?.followedCountUpdatedAt || "")).getTime();
    return Number.isSafeInteger(count) && count >= 0 && Number.isFinite(updatedAt) && now - updatedAt < 10 * 6e4 ? `Calls live \xB7 ${count.toLocaleString("en-US")} followed` : "Calls live";
  }
  function resultStateLabel(result) {
    if (result.outcome === "qualified") return "Check passed";
    if (result.outcome === "blocked") return "Blocked";
    if (result.outcome === "error") return "Error";
    return "Inspected";
  }
  function resultStateTone(result) {
    if (result.outcome === "qualified") return "success";
    if (result.outcome === "blocked") return "warning";
    if (result.outcome === "error") return "danger";
    return "neutral";
  }
  function resultSupporting(result) {
    const separator = result.summary.indexOf(" \xB7 ");
    return separator >= 0 ? result.summary.slice(separator + 3) : "";
  }
  function statusFor(health, versionDifference) {
    if (health.connected !== true || health.paired !== true || versionDifference !== 0) return "attention";
    if (health.trackalackerPush?.ready !== true) return "attention";
    if (health.actionsPaused === true) return "paused";
    if (health.executionMode !== "live" || health.chromeMutationEnabled !== true) return "monitoring";
    return "ready";
  }
  function statusLabel(status) {
    if (status === "ready") return "Ready";
    if (status === "monitoring") return "Monitoring";
    if (status === "paused") return "Paused";
    return "Needs attention";
  }
  function derivePopupView(input) {
    const health = input.health ?? {};
    const now = input.now ?? Date.now();
    const versionDifference = health.connected === true && comparableVersion(health.version) ? compareVersions(health.version, input.installedVersion) : 0;
    let status = statusFor(health, versionDifference);
    const trackalackerReady = health.trackalackerPush?.ready === true;
    const monitoringOnly = health.executionMode !== "live" || health.chromeMutationEnabled !== true;
    const pageActionable = input.page.kind === "product" || input.page.kind === "walmart_draw";
    const matchedResult = input.lastResult?.schemaVersion === 1 && input.lastResult.contextKey === input.page.key ? input.lastResult : null;
    const handoffRecordedAt = new Date(String(input.updateHandoff?.recordedAt || "")).getTime();
    const readyUpdateHandoff = input.updateHandoff?.schemaVersion === 1 && compareVersions(input.updateHandoff.releaseVersion, health.version) === 0 && Number.isFinite(handoffRecordedAt) && handoffRecordedAt <= now + 6e4 && now - handoffRecordedAt < 24 * 60 * 6e4 ? input.updateHandoff : null;
    const actionHandoffs = cartReadyState(input.cartReady, now).items;
    const needsYouHandoffs = actionHandoffs.filter((item) => item.kind === "needs_you");
    const cartReadyHandoffs = actionHandoffs.filter((item) => item.kind === "cart_ready");
    const requestedOutcomeJobId = cleanResultText(input.cartOutcome?.jobId, 120);
    const requestedOutcomeHandoff = /^[A-Za-z0-9_-]{3,120}$/.test(requestedOutcomeJobId) ? actionHandoffs.find((item) => item.jobId === requestedOutcomeJobId) ?? null : null;
    const preferredHandoff = requestedOutcomeHandoff ?? preferredActionHandoff({ schemaVersion: 1, items: actionHandoffs }, now);
    const purchaseOpportunity = popupPurchaseOpportunity(input.purchaseOpportunity, now);
    let hardBlocker = null;
    let context = {
      visible: false,
      eyebrow: "",
      title: "",
      supporting: "",
      pairing: false
    };
    let primaryAction = null;
    if (preferredHandoff) {
      status = "attention";
      if (preferredHandoff.kind === "needs_you") {
        context = {
          visible: true,
          eyebrow: "NEEDS YOU",
          title: needsYouHandoffs.length === 1 ? `${preferredHandoff.retailerName} needs review` : `${needsYouHandoffs.length} actions need review`,
          supporting: needsYouHandoffs.length === 1 ? `${preferredHandoff.identityLabel} ${preferredHandoff.retailerSku} \xB7 Check the store cart or session` : "Check the open store tabs",
          pairing: false
        };
        primaryAction = {
          id: "open_cart",
          label: preferredHandoff.openedAt ? "Return to store" : "Review store",
          disabled: false
        };
      } else {
        context = {
          visible: true,
          eyebrow: "CART READY",
          title: cartReadyHandoffs.length === 1 ? `${preferredHandoff.retailerName} cart ready` : `${cartReadyHandoffs.length} carts ready`,
          supporting: cartReadyHandoffs.length === 1 ? `${preferredHandoff.identityLabel} ${preferredHandoff.retailerSku}` : "Open the store cart",
          pairing: false
        };
        primaryAction = {
          id: "open_cart",
          label: preferredHandoff.openedAt ? "Return to cart" : "Open cart",
          disabled: false
        };
      }
    } else if (health.connected !== true) {
      hardBlocker = "unavailable";
      context = {
        visible: true,
        eyebrow: "YOINK",
        title: "Yoink unavailable",
        supporting: input.production ? "Check your connection, then retry." : "Start Yoink, then retry.",
        pairing: false
      };
      primaryAction = { id: "retry", label: "Retry", disabled: false };
    } else if (health.paired !== true) {
      hardBlocker = "unpaired";
      context = {
        visible: true,
        eyebrow: "BROWSER",
        title: "Pair this browser",
        supporting: "Enter the code from Yoink \u203A Settings \u203A Chrome.",
        pairing: true
      };
      primaryAction = { id: "pair", label: "Pair browser", disabled: false };
    } else if (versionDifference > 0) {
      if (health.companionCompatible === false) hardBlocker = "companion_update";
      if (readyUpdateHandoff) {
        context = {
          visible: true,
          eyebrow: readyUpdateHandoff.channel === "managed" ? "UPDATE READY" : "UPDATE DOWNLOADED",
          title: readyUpdateHandoff.channel === "managed" ? "Reload Chrome companion" : "Replace extension files",
          supporting: readyUpdateHandoff.channel === "managed" ? `1. Let Chrome finish the Yoink ${readyUpdateHandoff.releaseVersion} update. 2. Choose Reload Chrome companion.` : `1. Open Downloads and extract Yoink-Companion-${readyUpdateHandoff.releaseVersion}.zip. 2. Copy those files over the current Yoink extension folder. 3. Return here and choose Reload Chrome companion.`,
          pairing: false
        };
        primaryAction = { id: "reload_companion", label: "Reload Chrome companion", disabled: false };
      } else {
        context = {
          visible: true,
          eyebrow: "UPDATE REQUIRED",
          title: "Update Chrome companion",
          supporting: `Yoink ${health.version || ""} requires the matching Chrome companion.`,
          pairing: false
        };
        primaryAction = { id: "update_companion", label: "Update Chrome companion", disabled: false };
      }
    } else if (versionDifference < 0) {
      if (health.companionCompatible === false) hardBlocker = "app_update";
      context = {
        visible: true,
        eyebrow: "VERSION MISMATCH",
        title: "Update Yoink",
        supporting: "The Chrome companion is newer than the running Yoink app.",
        pairing: false
      };
      primaryAction = { id: "open_yoink", label: "Open Yoink", disabled: false };
    } else if (input.confirmation === "share_evidence" && input.page.kind === "product") {
      context = {
        visible: true,
        eyebrow: "COMMUNITY EVIDENCE",
        title: `Share ${input.page.retailerName} evidence?`,
        supporting: "Shares one stock update. No account or page text is included.",
        pairing: false
      };
      primaryAction = { id: "confirm_share_evidence", label: "Share evidence", disabled: false };
    } else if (input.page.kind === "product") {
      const productTitle = cleanResultText(matchedResult?.productTitle, 300);
      const resultSummary = matchedResult ? resultSupporting(matchedResult) : "";
      context = {
        visible: true,
        eyebrow: input.page.retailerName.toLocaleUpperCase("en-US"),
        title: productTitle || `${input.page.retailerName} product \xB7 ${input.page.identityLabel} ${input.page.sku}`,
        supporting: productTitle ? [`${input.page.identityLabel} ${input.page.sku}`, input.notice || resultSummary].filter(Boolean).join(" \xB7 ") : input.notice || resultSummary,
        pairing: false
      };
      primaryAction = {
        id: "inspect_product",
        label: matchedResult ? "Inspect again" : "Inspect product",
        disabled: false
      };
    } else if (input.page.kind === "walmart_draw") {
      context = {
        visible: true,
        eyebrow: "WALMART",
        title: "Collectibles Draw",
        supporting: input.notice || (matchedResult ? resultSupporting(matchedResult) : "Entry stays manual"),
        pairing: false
      };
      primaryAction = {
        id: "inspect_drawings",
        label: matchedResult ? "Inspect again" : "Inspect drawings",
        disabled: false
      };
    } else if (purchaseOpportunity) {
      status = "attention";
      context = {
        visible: true,
        eyebrow: "WALMART",
        title: purchaseOpportunity.title,
        supporting: `${purchaseOpportunity.identityLabel} ${purchaseOpportunity.retailerSku} \xB7 Ready to add`,
        pairing: false
      };
      primaryAction = { id: "open_purchase", label: "Buy at Walmart", disabled: false };
    } else if (!trackalackerReady) {
      context = {
        visible: true,
        eyebrow: "TRACKALACKER",
        title: "TrackaLacker disconnected",
        supporting: "Reconnect to receive calls.",
        pairing: false
      };
      primaryAction = { id: "reconnect_trackalacker", label: "Reconnect", disabled: false };
    } else if (health.actionsPaused === true) {
      context = {
        visible: true,
        eyebrow: "STORE ACTIONS",
        title: "Store actions paused",
        supporting: "Monitoring continues. Resume from Home.",
        pairing: false
      };
      primaryAction = { id: "review_pause", label: "Open Home", disabled: false };
    } else if (monitoringOnly) {
      context = {
        visible: true,
        eyebrow: "STORE ACTIONS",
        title: health.executionMode !== "live" ? "Test mode" : "Monitoring only",
        supporting: "Store clicks are off. Details are under Insights.",
        pairing: false
      };
      primaryAction = { id: "review_mode", label: "Open Insights", disabled: false };
    }
    const operation = input.operation?.contextKey === input.page.key || hardBlocker !== null ? input.operation : null;
    if (primaryAction && operation && operation.stage !== "idle") {
      const label = operationLabel(primaryAction.id, operation.stage);
      if (label) primaryAction = { ...primaryAction, label, disabled: true };
    }
    let activity = null;
    if (purchaseOpportunity && hardBlocker === null) status = "attention";
    if (hardBlocker !== null) {
      activity = null;
    } else if (pageActionable && purchaseOpportunity) {
      activity = {
        id: "purchase",
        label: `Walmart ${purchaseOpportunity.identityLabel} ${purchaseOpportunity.retailerSku} ready \xB7 Open`,
        action: "open_purchase"
      };
    } else if (runningSync(health, now)) {
      const processed = Math.max(0, Number(health.trackalackerSync?.processed) || 0);
      const discovered = Math.max(0, Number(health.trackalackerSync?.discovered) || 0);
      activity = { id: "sync", label: `Syncing products \xB7 ${processed} of ${discovered}`, action: "none" };
    } else if (pageActionable && !trackalackerReady) {
      activity = { id: "reconnect", label: "TrackaLacker disconnected \xB7 Reconnect", action: "reconnect_trackalacker" };
    } else if (pageActionable && health.actionsPaused === true) {
      activity = { id: "pause", label: "Store actions paused \xB7 Open Home", action: "review_pause" };
    } else if (pageActionable && monitoringOnly) {
      activity = {
        id: "mode",
        label: `${health.executionMode !== "live" ? "Test mode" : "Monitoring only"} \xB7 Open Insights`,
        action: "review_mode"
      };
    } else if (trackalackerReady) {
      activity = { id: "signals", label: signalsLabel(health, now), action: "none" };
    }
    const retailerActions = health.actionsPaused === true ? "Paused" : health.executionMode !== "live" ? "Test mode" : health.chromeMutationEnabled === true ? "Enabled" : "Monitoring";
    const storeAccess = pageActionable ? input.pageAccessGranted === true ? "Available" : "Requires approval" : "On demand";
    const sharingRetailers = new Set(Array.isArray(health.communitySharingRetailers) ? health.communitySharingRetailers : []);
    const requestedOutcomeStage = ["choice", "amount", "submitting"].includes(String(input.cartOutcome?.stage || "")) ? input.cartOutcome?.stage : null;
    const outcomeHandoff = requestedOutcomeHandoff ?? (preferredHandoff?.openedAt ? preferredHandoff : null);
    const cartOutcome = hardBlocker === null && outcomeHandoff?.openedAt ? {
      jobId: outcomeHandoff.jobId,
      stage: requestedOutcomeStage ?? "choice",
      reviewedMaximumCents: outcomeHandoff.reviewedMaximumCents ?? null,
      error: cleanResultText(input.cartOutcome?.error, 180)
    } : null;
    return {
      status,
      statusLabel: statusLabel(status),
      hardBlocker,
      context,
      primaryAction,
      activity,
      resultStatus: preferredHandoff || !matchedResult ? null : {
        label: resultStateLabel(matchedResult),
        tone: resultStateTone(matchedResult)
      },
      result: preferredHandoff ? null : matchedResult,
      cartReady: preferredHandoff,
      cartOutcome,
      purchaseOpportunity,
      details: [
        { label: "Browser", value: health.paired === true ? "Paired" : "Not paired" },
        { label: "TrackaLacker", value: trackalackerReady ? "Connected" : "Disconnected" },
        { label: "Store actions", value: retailerActions },
        { label: "Store access", value: storeAccess },
        { label: "Checked", value: health.checkedAt || "Not checked" }
      ],
      menu: {
        syncProducts: health.connected === true && health.paired === true,
        shareEvidence: hardBlocker === null && input.page.kind === "product" && sharingRetailers.has(input.page.retailerId),
        saveRepairPage: !input.production && hardBlocker === null && input.page.kind === "product" && health.localEvidenceCapsules === true && health.evidenceCapsuleTransport === "loopback",
        checkUpdates: !input.production && health.connected === true,
        checkStoresNow: health.connected === true && health.paired === true
      }
    };
  }
  function deriveContextMenuCommands(input) {
    const view = derivePopupView(input);
    const commands = ["open_yoink"];
    if (view.hardBlocker === null) {
      if (input.page.kind === "product") commands.push("inspect_product");
      if (!input.production && input.page.kind === "product" && input.health?.localEvidenceCapsules === true && input.health?.evidenceCapsuleTransport === "loopback") commands.push("save_repair_page");
      if (input.page.kind === "walmart_draw") commands.push("inspect_drawings");
      commands.push(input.health?.trackalackerPush?.ready === true ? "sync_products" : "reconnect_trackalacker");
    }
    commands.push("settings");
    return commands;
  }
  return __toCommonJS(popup_state_exports);
})();
