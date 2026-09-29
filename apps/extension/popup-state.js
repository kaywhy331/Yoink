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
    BESTBUY_WAIT_STORAGE_KEY: () => BESTBUY_WAIT_STORAGE_KEY,
    CART_READY_STORAGE_KEY: () => CART_READY_STORAGE_KEY,
    POPUP_RESULT_STORAGE_KEY: () => POPUP_RESULT_STORAGE_KEY,
    POPUP_UPDATE_HANDOFF_STORAGE_KEY: () => POPUP_UPDATE_HANDOFF_STORAGE_KEY,
    PRODUCT_DOCUMENT_PATTERNS: () => PRODUCT_DOCUMENT_PATTERNS,
    RETAILER_ORIGINS: () => RETAILER_ORIGINS,
    TRACKALACKER_PUSH_QUIET_AFTER_MS: () => TRACKALACKER_PUSH_QUIET_AFTER_MS,
    appDestinationUrl: () => appDestinationUrl,
    bestBuyWaitState: () => bestBuyWaitState,
    cartReadyState: () => cartReadyState,
    classifyPageContext: () => classifyPageContext,
    compareVersions: () => compareVersions,
    deriveContextMenuCommands: () => deriveContextMenuCommands,
    derivePopupView: () => derivePopupView,
    destinationForRoute: () => destinationForRoute,
    drawingsPopupResult: () => drawingsPopupResult,
    errorPopupResult: () => errorPopupResult,
    loopProblem: () => loopProblem,
    packagedRuntimeConfig: () => packagedRuntimeConfig,
    packagedRuntimeOrigin: () => packagedRuntimeOrigin,
    popupPurchaseOpportunity: () => popupPurchaseOpportunity,
    popupUpdateHandoff: () => popupUpdateHandoff,
    preferredActionHandoff: () => preferredActionHandoff,
    qualificationPopupResult: () => qualificationPopupResult,
    retailerDisplayName: () => retailerDisplayName,
    trackalackerPushQuietMs: () => trackalackerPushQuietMs
  });

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
  var EVIDENCE_CAPSULE_MAX_SNAPSHOT_BYTES = 3 * 1024 * 1024;

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
    return /(?:verify|confirm) (?:that )?you are (?:a )?human|access denied|you have been blocked|security check|captcha challenge/i.test(text(document.body, environment)) || elements(document, "iframe[src*='captcha'], iframe[src*='challenge']", environment).length > 0;
  }
  function americanEagleInteractiveBlock(document, url, environment) {
    if (americanEaglePageKind(url) === "auth") return "auth";
    if (americanEagleSecurityChallenge(document, environment)) return "unknown";
    if (/you(?:'|’)re in line|waiting room|please wait in (?:the )?queue/i.test(text(document.body, environment))) return "queue";
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
    if (!/^Add to Bag(?: \(Before It's Gone\))?$/i.test(text(control, environment)) || control.matches(":disabled") || control.closest("[aria-disabled='true']")) return null;
    const sizes = elements(panel, "[data-test-select-size]", environment);
    if (sizes.length !== 1 || sizes[0].getAttribute("data-test-sizes-count") !== "1") return null;
    const size = sizes[0];
    const selectedText = elements(size, "[data-test-dropdown-toggle][aria-label='Size'] [data-test-text]", environment);
    if (selectedText.length !== 1 || text(selectedText[0], environment) !== "One Size") return null;
    const options = [...size.querySelectorAll("li[data-value]")];
    if (options.length !== 1 || !options[0].classList.contains("active") || options[0].textContent?.replace(/\s+/g, " ").trim() !== "One Size") return null;
    const retailerSku = options[0].getAttribute("data-value") || "";
    if (!CHILD_SKU4.test(retailerSku) || expectedSku !== void 0 && retailerSku !== expectedSku || url.searchParams.has("sku") && americanEagleUrlSku(urlValue) !== retailerSku) return null;
    const quantities = elements(panel, "[data-test-select-quantity] [data-testid='quantity-value']", environment);
    if (quantities.length !== 1 || text(quantities[0], environment) !== "1") return null;
    if (elements(panel, "input:checked, [aria-checked='true'], [aria-pressed='true']", environment).length || /pre[ -]?order|subscription|pick ?up (?:at|in store)|ship to store/i.test(text(panel, environment)) || elements(root, "[data-testid='modal-link-shipping-returns']", environment).length !== 1) return null;
    const prices = elements(root, "[data-test-product-sku-price]", environment);
    const names = elements(root, "h1[data-testid='product-name']", environment);
    if (prices.length !== 1 || names.length !== 1) return null;
    const unitPriceCents = cents(text(prices[0], environment));
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
    if (product.sku !== styleColor || product.name !== text(names[0], environment) || !offer || Array.isArray(offer) || offer.priceCurrency !== "USD" || !/\/InStock$/.test(String(offer.availability)) || americanEagleStyleColor(String(offer.url)) !== styleColor || cents(`$${offer.price}`) !== unitPriceCents || /\b(?:CAD|GBP|EUR|AUD)\b|CA\$|C\$|[£€]|sold (?:and shipped )?by/i.test(text(root, environment))) return null;
    const fingerprint = JSON.stringify([
      styleColor,
      retailerSku,
      unitPriceCents,
      product.name,
      "One Size",
      text(root.querySelector("[data-test-extras='colors']") || names[0], environment),
      control.getAttribute("name")
    ]);
    return { root, control, retailerSku, styleColor, unitPriceCents, fingerprint };
  }

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
    pokemoncenter: ["pokemoncenter.com"],
    americaneagle: ["ae.com"],
    asus: ["eshop.asus.com"],
    athleta: ["athleta.gap.com"],
    audioadvice: ["www.audioadvice.com"],
    bananarepublic: ["bananarepublic.gap.com"],
    bananarepublicfactory: ["bananarepublicfactory.gapfactory.com"],
    aninebing: ["aninebing.com"]
  });

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

  // packages/browser-adapters/src/audioadvice.ts
  var VARIANT = /^\d{10,20}$/;
  function text2(element, environment) {
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
    return /(?:verify|confirm) (?:that )?you are (?:a )?human|access denied|you have been blocked|security check|captcha challenge/i.test(text2(document.body, environment)) || [...document.querySelectorAll("iframe[src*='captcha'], iframe[src*='challenge']")].some((e) => renderedVisible(e, environment));
  }
  function audioAdviceInteractiveBlock(document, url, environment) {
    if (audioAdvicePageKind(url) === "auth") return "auth";
    if (audioAdviceSecurityChallenge(document, environment)) return "unknown";
    if (/you(?:'|’)re in line|waiting room|please wait in (?:the )?queue/i.test(text2(document.body, environment))) return "queue";
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
    if (controls.length !== 1 || text2(controls[0], environment).toUpperCase() !== "ADD TO CART") return null;
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
    if (prices.length !== 1 || stock.length !== 1 || title.length !== 1 || subtitle.length > 1 || mpn.length !== 1 || !/^In Stock: Free (?:2-Day )?Shipping$/i.test(text2(stock[0], environment))) return null;
    const match = text2(prices[0], environment).match(/^\$(\d[\d,]*)\.(\d{2})$/);
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
    const expectedName = [text2(title[0], environment), ...subtitle.map((e) => text2(e, environment))].join(" ");
    const primaryTitle = text2(title[0], environment);
    if (typeof product.name !== "string" || !(product.name === primaryTitle || product.name.startsWith(`${primaryTitle} `)) || audioAdviceUrl(String(product.url))?.pathname !== url.pathname || typeof product.sku !== "string" || product.sku.split(":").at(-1) !== text2(mpn[0], environment) || !Array.isArray(product.offers) || product.offers.length !== 1) return null;
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
      text2(stock[0], environment),
      quantities[0].value,
      product.offers
    ]);
    return { root, control, variantId, unitPriceCents, fingerprint };
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
      const text4 = String(element.textContent || "").trim();
      add(text4.match(/^(?:SKU\s*:?\s*)?(\d{5,20})\s*$/i)?.[1]);
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
  function canonicalRetailerProductUrl(retailerId, urlValue, document) {
    try {
      const retailer = config(retailerId);
      const url = new URL(urlValue);
      if (!retailer || !hostAllowed(url, retailer.domains) || url.pathname.length > 1e3) return "";
      const sku = extractRetailerSku(retailerId, url.href, document);
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
      if (retailerId === "asus") {
        url.search = "";
        url.hash = "";
        return url.href;
      }
      if (retailerId === "audioadvice") {
        url.search = "";
        url.searchParams.set("variant", sku);
        url.hash = "";
        return url.href;
      }
      if (retailerId === "bananarepublic") {
        url.search = "";
        url.searchParams.set("pid", sku);
        url.hash = "";
        return url.href;
      }
      if (retailerId === "bananarepublicfactory") {
        url.search = "";
        url.searchParams.set("pid", sku);
        url.hash = "";
        return url.href;
      }
      if (retailerId === "athleta") {
        url.search = "";
        url.searchParams.set("pid", sku);
        url.hash = "";
        return url.href;
      }
      if (retailerId === "americaneagle") {
        url.hostname = "www.ae.com";
        url.search = "";
        url.searchParams.set("sku", sku);
        url.hash = "";
        return url.href;
      }
      if (retailerId === "aninebing") {
        url.hostname = "www.aninebing.com";
        url.port = "";
        url.search = "";
        url.searchParams.set("variant", sku);
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
  var BESTBUY_WAIT_STORAGE_KEY = "yoinkBestBuyWaitV1";
  var APP_DESTINATION_ROUTES = {
    dashboard: { pathname: "/", hash: "home" },
    actions: { pathname: "/", hash: "activity" },
    insights: { pathname: "/", hash: "activity/insights" },
    connections: { pathname: "/", hash: "settings/chrome" },
    settings: { pathname: "/", hash: "settings" },
    stores: { pathname: "/", hash: "stores" }
  };
  function destinationForRoute(route) {
    const value = String(route || "").replace(/^[#/]+/, "").toLowerCase();
    if (value === "activity/insights" || value.startsWith("insights")) return "insights";
    if (value.startsWith("activity") || value.startsWith("actions")) return "actions";
    if (value.startsWith("settings/chrome") || value.startsWith("connections")) return "connections";
    if (value.startsWith("settings")) return "settings";
    if (value === "home" || value === "dashboard") return "dashboard";
    return "stores";
  }
  function packagedRuntimeOrigin(value, profile) {
    const parsed = new URL(String(value || ""));
    const exact = !parsed.username && !parsed.password && parsed.pathname === "/" && !parsed.search && !parsed.hash;
    const loopback = parsed.hostname === "localhost" || parsed.hostname.endsWith(".localhost") || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
    if (!exact || profile === "local" && (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") || profile === "production" && (parsed.protocol !== "https:" || loopback)) {
      throw new Error("Yoink Companion has an invalid packaged runtime origin.");
    }
    return parsed.origin;
  }
  function packagedRuntimeConfig(value) {
    const candidate = value && typeof value === "object" ? value : {};
    const profile = candidate.profile === "production" ? "production" : candidate.profile === "local" ? "local" : "";
    if (!profile || candidate.localPackageUpdates !== (profile === "local")) {
      throw new Error("Yoink Companion has an invalid packaged runtime profile.");
    }
    return Object.freeze({
      profile,
      appOrigin: packagedRuntimeOrigin(candidate.appOrigin, profile),
      localPackageUpdates: candidate.localPackageUpdates === true
    });
  }
  function popupClockTime(value, now) {
    const time = new Date(value).getTime();
    if (!Number.isFinite(time)) return "earlier";
    const seconds = Math.max(0, Math.round((now - time) / 1e3));
    if (seconds < 60) return "just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }
  function deriveActionsToggle(health, input, monitoringOnly) {
    const paused = health.actionsPaused === true;
    const pending = input.actionsTogglePending === true;
    const resume = health.actionsResume || null;
    const approvalPending = paused && Boolean(resume?.pending);
    const blocker = paused ? resume?.blockers?.find((item) => item?.code !== "approval_pending") || null : null;
    const blocked = paused && resume ? resume.allowed !== true : false;
    const rawNext = blocker?.nextAction || resume?.nextAction || null;
    const nextAction = rawNext?.kind ? {
      kind: String(rawNext.kind),
      label: String(rawNext.label || "Open Stores"),
      retailerId: String(rawNext.retailerId || ""),
      route: String(rawNext.route || "stores"),
      destination: destinationForRoute(rawNext.route || "stores")
    } : null;
    const confirming = paused && !blocked && input.actionsResumeConfirming === true;
    const confirmLines = confirming && Array.isArray(resume?.summary) ? resume.summary.map((line) => String(line)) : [];
    const label = pending ? paused ? "Resuming\u2026" : "Pausing\u2026" : approvalPending ? "Waiting" : confirming ? "Confirm resume" : paused ? "Resume" : "Pause";
    const hint = !paused ? monitoringOnly ? `${health.executionMode !== "live" ? "Test mode" : "Monitoring only"} \xB7 no live cart adds` : "Yoink may add to a cart when a call matches a plan." : approvalPending ? "Resume request waiting for approval \xB7 Open Yoink \u203A Activity" : blocked ? `${String(blocker?.message || "Turn on cart adds for at least one store before resuming actions.")}${nextAction ? ` \xB7 ${nextAction.label} \u203A` : ""}` : confirming ? confirmLines.length ? `${confirmLines.join(" \xB7 ")} \xB7 Tap again to confirm` : "Tap again to resume cart adds" : "Monitoring and calls continue. Carts stay untouched.";
    return {
      paused,
      pending,
      label,
      title: paused ? "Store actions paused" : "Store actions on",
      hint,
      blocked: blocked || approvalPending,
      approvalPending,
      confirming,
      confirmLines,
      nextAction
    };
  }
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
    pokemoncenter: { name: "Pok\xE9mon Center", domains: ["pokemoncenter.com"], identityLabel: "SKU" },
    asus: { name: "ASUS", domains: ["eshop.asus.com"], identityLabel: "Part number" },
    audioadvice: { name: "Audio Advice", domains: ["www.audioadvice.com"], identityLabel: "Variant" },
    bananarepublic: { name: "Banana Republic", domains: ["bananarepublic.gap.com"], identityLabel: "Variant" },
    bananarepublicfactory: { name: "Banana Republic Factory", domains: ["bananarepublicfactory.gapfactory.com"], identityLabel: "Variant" },
    athleta: { name: "Athleta", domains: ["athleta.gap.com"], identityLabel: "Variant" },
    americaneagle: { name: "American Eagle", domains: ["ae.com"], identityLabel: "Variant" },
    aninebing: { name: "ANINE BING", domains: ["aninebing.com"], identityLabel: "Variant" }
  };
  var RETAILER_ORDER = Object.keys(RETAILERS);
  function retailerDisplayName(retailerId) {
    const id = String(retailerId || "");
    return Object.hasOwn(RETAILERS, id) ? RETAILERS[id].name : id;
  }
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
    pokemoncenter: ["https://*.pokemoncenter.com/*"],
    asus: ["https://eshop.asus.com/*"],
    audioadvice: ["https://www.audioadvice.com/*"],
    bananarepublic: ["https://bananarepublic.gap.com/*", "https://secure-bananarepublic.gap.com/*"],
    bananarepublicfactory: ["https://bananarepublicfactory.gapfactory.com/*", "https://secure-bananarepublicfactory.gapfactory.com/*"],
    athleta: ["https://athleta.gap.com/*", "https://secure-athleta.gap.com/*"],
    americaneagle: ["https://*.ae.com/*"],
    aninebing: ["https://*.aninebing.com/*"]
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
    "https://*.pokemoncenter.com/product/*",
    "https://eshop.asus.com/us/*.html",
    "https://athleta.gap.com/browse/product.do*",
    "https://www.audioadvice.com/products/*",
    "https://bananarepublic.gap.com/browse/product.do*",
    "https://bananarepublicfactory.gapfactory.com/browse/product.do*",
    "https://*.ae.com/us/en/p/*",
    "https://*.aninebing.com/products/*"
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
    if (retailerId === "asus") return Boolean(asusUrlSku(url.href));
    if (retailerId === "audioadvice") return /^\/products\/[a-z0-9-]+\/?$/.test(path);
    if (retailerId === "bananarepublic") return Boolean(bananarepublicUrlSku(url.href));
    if (retailerId === "bananarepublicfactory") return Boolean(bananarepublicfactoryUrlSku(url.href));
    if (retailerId === "athleta") return Boolean(athletaUrlSku(url.href));
    if (retailerId === "americaneagle") return Boolean(americanEagleStyleColor(url.href));
    if (retailerId === "aninebing") return /^\/products\/[a-z0-9-]+\/?$/.test(path);
    if (retailerId === "pbandai") return /^\/us\/item\/[a-z]\d{10}(?:\/|$)/i.test(path);
    return /^\/product\/\d{2,3}-\d{5}(?:-\d{3})?(?:\/|$)/i.test(path);
  }
  function classifyPageContext(value) {
    const url = trustedHttpsUrl(value);
    if (!url) return { kind: "unsupported", key: "unsupported" };
    const retailerId = retailerFromUrl(url);
    if (!retailerId) return { kind: "unsupported", key: "unsupported" };
    const retailer = RETAILERS[retailerId];
    const productCode = retailerId === "bestbuy" ? bestBuyProductCode(url.href) : "";
    if (productCode && !extractRetailerSku("bestbuy", url.href)) {
      return { kind: "product_link", key: `product_link:bestbuy:${productCode}`, retailerId: "bestbuy", retailerName: "Best Buy", productCode };
    }
    if (retailerId === "americaneagle" && exactProductRoute(retailerId, url) && !extractRetailerSku("americaneagle", url.href)) {
      return { kind: "product_link", key: `product_link:americaneagle:${url.pathname}`, retailerId, retailerName: retailer.name, productCode: url.pathname };
    }
    if (retailerId === "audioadvice" && exactProductRoute(retailerId, url) && !extractRetailerSku("audioadvice", url.href)) {
      return { kind: "product_link", key: `product_link:audioadvice:${url.pathname}`, retailerId, retailerName: retailer.name, productCode: url.pathname };
    }
    if (retailerId === "aninebing" && exactProductRoute(retailerId, url) && !extractRetailerSku("aninebing", url.href)) {
      return { kind: "product_link", key: `product_link:aninebing:${url.pathname}`, retailerId, retailerName: retailer.name, productCode: url.pathname };
    }
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
  var LOOP_LABELS = {
    jobs: "Store actions",
    notifications: "Alerts",
    watch: "Watch checks",
    health: "Background checks"
  };
  function loopProblem(health) {
    const loops = health?.loopHealth && typeof health.loopHealth === "object" ? health.loopHealth : {};
    for (const loop of ["jobs", "notifications", "watch", "health"]) {
      const entry = loops[loop];
      if (!entry || entry.ok === true || Number(entry.consecutiveFailures || 0) < 2) continue;
      const status = Number(entry.status) || 0;
      const detail = status ? `HTTP ${status}` : entry.code === "timeout" ? "timed out" : "no response";
      return { loop, label: `${LOOP_LABELS[loop]} can\u2019t reach Yoink (${detail})` };
    }
    const jobs = loops.jobs;
    if (jobs?.reason === "retailer_access_missing") {
      return { loop: "jobs", label: "No store access granted \xB7 Allow stores in Extension settings" };
    }
    return null;
  }
  function bestBuyWaitState(value, now = Date.now()) {
    const candidate = record(value);
    const jobId = String(candidate.jobId || "");
    const retailerSku = String(candidate.retailerSku || "");
    const reason = String(candidate.reason || "");
    const expiry = new Date(String(candidate.expiresAt || "")).getTime();
    if (candidate.schemaVersion !== 1 || !/^[A-Za-z0-9_-]{3,120}$/.test(jobId) || !/^\d{5,20}$/.test(retailerSku) || !Number.isFinite(expiry) || expiry <= now || expiry > now + 5 * 6e4 || ![
      "bestbuy_add_triggered",
      "bestbuy_queue_waiting",
      "bestbuy_queue_next_step",
      "bestbuy_cart_pending",
      "bestbuy_state_unavailable",
      "manual_action_required",
      "security_challenge"
    ].includes(reason)) return null;
    return {
      schemaVersion: 1,
      jobId,
      retailerSku,
      reason,
      clicked: candidate.clicked === true,
      needsAction: ["bestbuy_queue_next_step", "manual_action_required", "security_challenge"].includes(reason),
      expiresAt: new Date(expiry).toISOString()
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
    bestbuy: { name: "Best Buy", identityLabel: "SKU" },
    pokemoncenter: { name: "Pok\xE9mon Center", identityLabel: "SKU" },
    asus: { name: "ASUS", identityLabel: "Part number" },
    audioadvice: { name: "Audio Advice", identityLabel: "Variant" },
    bananarepublic: { name: "Banana Republic", identityLabel: "Variant" },
    bananarepublicfactory: { name: "Banana Republic Factory", identityLabel: "Variant" },
    athleta: { name: "Athleta", identityLabel: "Variant" },
    americaneagle: { name: "American Eagle", identityLabel: "Variant" },
    aninebing: { name: "ANINE BING", identityLabel: "Variant" }
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
    const cents2 = value === null || value === void 0 || value === "" ? Number.NaN : Number(value);
    return Number.isSafeInteger(cents2) && cents2 >= 0 ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents2 / 100) : "Price unavailable";
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
    if (page.kind !== "product" && page.kind !== "product_link") return null;
    const response = record(value);
    const observation = record(response.observation);
    const resolvedPage = page.kind === "product_link" ? classifyPageContext(observation.canonicalUrl) : page;
    if (resolvedPage.kind !== "product" || resolvedPage.retailerId !== page.retailerId || page.kind === "product_link" && resolvedPage.sku !== observation.retailerSku) return null;
    const rehearsal = record(response.rehearsal);
    const productTitle = exactCatalogProductTitle(response, resolvedPage);
    const price = resultMoney(observation.unitPriceCents);
    const fulfillment = resultTitleCase(observation.fulfillment || "Fulfillment unavailable");
    const seller = cleanResultText(observation.sellerName || "Seller unavailable", 160);
    const lines = [`${resolvedPage.identityLabel} ${resolvedPage.sku}`, price, seller, fulfillment];
    if (observation.availability) lines.push(`Availability: ${resultTitleCase(observation.availability)}`);
    if (observation.securityChallenge === true) lines.push("Security check on the page");
    else if (observation.interactiveBlock) lines.push(`Manual step: ${resultTitleCase(observation.interactiveBlock)}`);
    if (observation.purchaseRouteReady === true) lines.push("Exact offer binding verified");
    const qualification = response.workflow === "qualification";
    if (resolvedPage.retailerId === "bestbuy" && observation.interactiveBlock === "high_demand" && !observation.securityChallenge) {
      const reason2 = "Complete Best Buy\u2019s reservation steps in this tab, then inspect the product again. Nothing was added.";
      return persistedResult(page.key, "blocked", `Reservation required \xB7 ${reason2}`, `${lines.join(" \xB7 ")} \xB7 ${reason2}`, now, productTitle);
    }
    if (!qualification) {
      return persistedResult(page.key, "inspected", `Inspected \xB7 ${price}`, lines.join(" \xB7 "), now, productTitle);
    }
    if (rehearsal.ok === true) {
      return persistedResult(page.key, "qualified", `Check passed \xB7 ${price} \xB7 ${fulfillment}`, lines.join(" \xB7 "), now, productTitle);
    }
    if (resolvedPage.retailerId === "bestbuy" && (observation.fulfillment === "pickup" || record(response.shippingSelection).ok === false) && !observation.securityChallenge && !observation.interactiveBlock) {
      const reason2 = "Yoink could not verify Shipping on this offer. Nothing was added; Pickup will not be used.";
      return persistedResult(page.key, "blocked", `Shipping not verified \xB7 ${reason2}`, `${lines.join(" \xB7 ")} \xB7 ${reason2}`, now, productTitle);
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
    if (stage === "opening_cart") return action === "open_bestbuy_wait" ? "Opening Best Buy\u2026" : action === "open_purchase" ? "Opening Walmart\u2026" : "Opening cart\u2026";
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
  var TRACKALACKER_PUSH_QUIET_AFTER_MS = 48 * 60 * 6e4;
  function trackalackerPushQuietMs(push, now = Date.now()) {
    if (push?.ready !== true) return null;
    let latest = Number.NEGATIVE_INFINITY;
    for (const value of [push.lastNotificationAt, push.lastDeliveryAt, push.lastRegistrationAt]) {
      const time = new Date(String(value || "")).getTime();
      if (Number.isFinite(time) && time > latest) latest = time;
    }
    if (!Number.isFinite(latest)) return null;
    const quietMs = Math.max(0, now - latest);
    return quietMs > TRACKALACKER_PUSH_QUIET_AFTER_MS ? quietMs : null;
  }
  function quietCallsLabel(quietMs) {
    return `No calls for ${Math.max(2, Math.round(quietMs / (24 * 60 * 6e4)))}d`;
  }
  function signalsLabel(health, now) {
    const count = Number(health.popupSummary?.followedCount);
    const updatedAt = new Date(String(health.popupSummary?.followedCountUpdatedAt || "")).getTime();
    return Number.isSafeInteger(count) && count >= 0 && Number.isFinite(updatedAt) && now - updatedAt < 10 * 6e4 ? `Calls live \xB7 ${count.toLocaleString("en-US")} followed` : "Calls live";
  }
  function resultStateLabel(result) {
    if (result.outcome === "blocked" && result.summary.startsWith("Reservation required \xB7 ")) return "Reservation required";
    if (result.outcome === "qualified") return "Check passed";
    if (result.outcome === "blocked" && result.summary.startsWith("Shipping not verified \xB7 ")) return "Shipping not verified";
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
  function statusFor(health, versionDifference, now) {
    if (health.connected !== true || health.paired !== true || versionDifference !== 0) return "attention";
    if (health.trackalackerPush?.ready !== true || trackalackerPushQuietMs(health.trackalackerPush, now) !== null) return "attention";
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
    let status = statusFor(health, versionDifference, now);
    const trackalackerReady = health.trackalackerPush?.ready === true;
    const trackalackerQuiet = trackalackerPushQuietMs(health.trackalackerPush, now);
    const monitoringOnly = health.executionMode !== "live" || health.chromeMutationEnabled !== true;
    const pageActionable = input.page.kind === "product" || input.page.kind === "product_link" || input.page.kind === "walmart_draw";
    const matchedResult = input.lastResult?.schemaVersion === 1 && input.lastResult.contextKey === input.page.key ? input.lastResult : null;
    const handoffRecordedAt = new Date(String(input.updateHandoff?.recordedAt || "")).getTime();
    const readyUpdateHandoff = input.updateHandoff?.schemaVersion === 1 && compareVersions(input.updateHandoff.releaseVersion, health.version) === 0 && Number.isFinite(handoffRecordedAt) && handoffRecordedAt <= now + 6e4 && now - handoffRecordedAt < 24 * 60 * 6e4 ? input.updateHandoff : null;
    const actionHandoffs = cartReadyState(input.cartReady, now).items;
    const bestBuyWait = bestBuyWaitState(input.bestBuyWait, now);
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
    if (bestBuyWait) {
      status = "attention";
      context = {
        visible: true,
        eyebrow: "BEST BUY",
        pairing: false,
        title: bestBuyWait.needsAction ? "Best Buy needs your verification" : bestBuyWait.clicked ? "Add triggered \xB7 Waiting for Best Buy" : "Checking Best Buy add",
        supporting: `SKU ${bestBuyWait.retailerSku} \xB7 ${bestBuyWait.needsAction ? "Complete Best Buy\u2019s steps, including any SMS code, in the open store tab. Yoink is waiting for cart confirmation." : "Keep the store tab open. Yoink is waiting for cart confirmation."}`
      };
      primaryAction = { id: "open_bestbuy_wait", label: bestBuyWait.needsAction ? "Complete verification" : "Open waiting tab", disabled: false };
    } else if (preferredHandoff) {
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
      const failure = health.failure || null;
      const lastOk = health.lastReadyAt ? ` Last OK ${popupClockTime(health.lastReadyAt, now)}.` : "";
      const reasonWords = (failure?.reasons || []).map((reason) => String(reason).replaceAll("_", " ")).join(", ");
      context = {
        visible: true,
        eyebrow: "YOINK",
        title: failure?.kind === "not_ready" ? "Yoink is starting" : failure?.kind === "refused" ? "Yoink refused the companion" : failure?.kind === "unreachable" || failure?.kind === "timeout" ? "Yoink is not running" : failure?.kind === "error" ? "Chrome companion error" : "Yoink unavailable",
        supporting: failure?.kind === "not_ready" ? `${reasonWords ? `Waiting on ${reasonWords}.` : "Waiting for Yoink to finish starting."} Retry in a moment.${lastOk}` : failure?.kind === "refused" ? `${failure.request ? `The ${failure.request} request` : "A request"} was refused (HTTP ${Number(failure.status) || 0}). Open Yoink \u203A Settings \u203A Chrome.${lastOk}` : failure?.kind === "error" ? `${cleanResultText(failure.message, 200) || "The companion could not check Yoink."} Retry, or reload the companion.${lastOk}` : `${input.production ? "Check your connection, then retry." : "Start Yoink, then retry."}${lastOk}`,
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
    } else if (input.page.kind === "product_link") {
      context = {
        visible: true,
        eyebrow: input.page.retailerName.toLocaleUpperCase("en-US"),
        title: cleanResultText(matchedResult?.productTitle, 300) || `${input.page.retailerName} product`,
        supporting: input.notice || (matchedResult ? resultSupporting(matchedResult) : "Inspect this page to identify the item."),
        pairing: false
      };
      primaryAction = { id: "inspect_product", label: matchedResult ? "Inspect again" : "Inspect product", disabled: false };
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
    } else if (trackalackerQuiet !== null) {
      context = {
        visible: true,
        eyebrow: "TRACKALACKER",
        title: quietCallsLabel(trackalackerQuiet),
        supporting: "Reconnect to renew TrackaLacker, then check that Yoink is on in its notification settings.",
        pairing: false
      };
      primaryAction = { id: "reconnect_trackalacker", label: "Reconnect", disabled: false };
    } else if (health.actionsPaused === true) {
      context = {
        visible: true,
        eyebrow: "STORE ACTIONS",
        title: "Store actions paused",
        supporting: "Monitoring continues. Yoink will not add to carts until you resume.",
        pairing: false
      };
      const pausedResume = health.actionsResume || null;
      const pausedBlocker = pausedResume?.blockers?.find((item) => item?.code !== "approval_pending") || null;
      const pausedNext = pausedBlocker?.nextAction || pausedResume?.nextAction || null;
      if (pausedResume?.pending) {
        context.supporting = "A resume request is waiting for independent approval. Cart adds stay paused until it is approved.";
        primaryAction = { id: "open_activity", label: "Open Activity", disabled: false };
      } else if (pausedResume && pausedResume.allowed !== true) {
        context.supporting = String(pausedBlocker?.message || "Turn on cart adds for at least one store before resuming actions.");
        primaryAction = {
          id: "open_destination",
          label: String(pausedNext?.label || "Open Stores"),
          disabled: false,
          destination: destinationForRoute(pausedNext?.route || "stores")
        };
      } else {
        const confirmingResume = input.actionsResumeConfirming === true && input.actionsTogglePending !== true;
        if (confirmingResume) {
          const lines = Array.isArray(pausedResume?.summary) ? pausedResume.summary.map((line) => String(line)) : [];
          context.supporting = lines.length ? `${lines.join(" \xB7 ")} \xB7 Tap Confirm resume to turn cart adds on.` : "Tap Confirm resume to turn cart adds back on.";
        }
        primaryAction = {
          id: "resume_actions",
          label: input.actionsTogglePending === true ? "Resuming\u2026" : confirmingResume ? "Confirm resume" : "Resume actions",
          disabled: input.actionsTogglePending === true
        };
      }
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
    const loopIssue = hardBlocker === null ? loopProblem(health) : null;
    if (purchaseOpportunity && hardBlocker === null) status = "attention";
    if (loopIssue && Number(health.loopHealth?.[loopIssue.loop]?.consecutiveFailures || 0) >= 2 && health.connected === true && health.paired === true) status = "attention";
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
    } else if (pageActionable && trackalackerQuiet !== null) {
      activity = { id: "reconnect", label: `${quietCallsLabel(trackalackerQuiet)} \xB7 Reconnect`, action: "reconnect_trackalacker" };
    } else if (pageActionable && health.actionsPaused === true) {
      activity = {
        id: "pause",
        label: input.actionsResumeConfirming === true ? "Store actions paused \xB7 Confirm resume" : "Store actions paused \xB7 Resume",
        action: "resume_actions"
      };
    } else if (loopIssue && health.connected === true && health.paired === true) {
      activity = { id: "loops", label: loopIssue.label, action: "none" };
    } else if (pageActionable && monitoringOnly) {
      activity = {
        id: "mode",
        label: `${health.executionMode !== "live" ? "Test mode" : "Monitoring only"} \xB7 Open Insights`,
        action: "review_mode"
      };
    } else if (trackalackerReady && trackalackerQuiet === null) {
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
      resultStatus: bestBuyWait || preferredHandoff || !matchedResult ? null : {
        label: resultStateLabel(matchedResult),
        tone: resultStateTone(matchedResult)
      },
      result: bestBuyWait || preferredHandoff ? null : matchedResult,
      cartReady: bestBuyWait ? null : preferredHandoff,
      bestBuyWait,
      cartOutcome: bestBuyWait ? null : cartOutcome,
      purchaseOpportunity,
      actionsToggle: hardBlocker === null && health.connected === true && health.paired === true ? deriveActionsToggle(health, input, monitoringOnly) : null,
      details: [
        { label: "Browser", value: health.paired === true ? "Paired" : "Not paired" },
        {
          label: "TrackaLacker",
          value: !trackalackerReady ? "Disconnected" : trackalackerQuiet !== null ? quietCallsLabel(trackalackerQuiet) : "Connected"
        },
        { label: "Store actions", value: retailerActions },
        { label: "Store access", value: storeAccess },
        ...loopIssue ? [{ label: "Companion", value: loopIssue.label }] : [],
        { label: "Checked", value: health.checkedAt || "Not checked" }
      ],
      menu: {
        syncProducts: health.connected === true && health.paired === true,
        shareEvidence: hardBlocker === null && input.page.kind === "product" && sharingRetailers.has(input.page.retailerId),
        saveRepairPage: !input.production && hardBlocker === null && ["product", "product_link"].includes(input.page.kind) && health.localEvidenceCapsules === true && health.evidenceCapsuleTransport === "loopback",
        checkUpdates: !input.production && health.connected === true,
        checkStoresNow: health.connected === true && health.paired === true
      }
    };
  }
  function deriveContextMenuCommands(input) {
    const view = derivePopupView(input);
    const commands = ["open_yoink"];
    if (view.hardBlocker === null) {
      if (input.page.kind === "product" || input.page.kind === "product_link") commands.push("inspect_product");
      if (!input.production && ["product", "product_link"].includes(input.page.kind) && input.health?.localEvidenceCapsules === true && input.health?.evidenceCapsuleTransport === "loopback") commands.push("save_repair_page");
      if (input.page.kind === "walmart_draw") commands.push("inspect_drawings");
      commands.push(input.health?.trackalackerPush?.ready === true && trackalackerPushQuietMs(input.health.trackalackerPush, input.now ?? Date.now()) === null ? "sync_products" : "reconnect_trackalacker");
    }
    commands.push("settings");
    return commands;
  }
  return __toCommonJS(popup_state_exports);
})();
