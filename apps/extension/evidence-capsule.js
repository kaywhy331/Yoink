"use strict";
var YoinkEvidenceCapsuleModule = (() => {
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

  // apps/extension/src/evidence-capsule.ts
  var evidence_capsule_exports = {};
  __export(evidence_capsule_exports, {
    canonicalEvidenceUrl: () => canonicalEvidenceUrl,
    captureEvidenceCapsule: () => captureEvidenceCapsule,
    sanitizeEvidenceDocument: () => sanitizeEvidenceDocument,
    serializeEvidenceDocument: () => serializeEvidenceDocument,
    shouldCaptureEvidenceCapsule: () => shouldCaptureEvidenceCapsule
  });

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
      checkoutUrl: "https://www.walmart.com/checkout",
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
  var EVIDENCE_CAPSULE_CONTRACT_VERSION = 1;
  var EVIDENCE_CAPSULE_MAX_SNAPSHOT_BYTES = 3 * 1024 * 1024;

  // apps/extension/src/evidence-capsule.ts
  var PRIVATE_KEY = /(account|session|token|auth|credential|password|secret|email|phone|address|zip|postal|cookie|csrf|form.?key|payment|card|customer|user|profile|visitor|device|fingerprint|geo|latitude|longitude)/i;
  var EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  var PHONE = /(?<!\d)(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}(?!\d)/g;
  var CANDIDATE_SELECTOR = "button, input, select, a[href], meta, [role='button'], [data-test], [data-testid], [data-test-id], [data-automation-id], [itemprop], [aria-label]";
  var TEXT_ENCODER = new TextEncoder();
  function blankRedactions() {
    return {
      scriptsRemoved: 0,
      jsonBlocksKept: 0,
      keysRedacted: 0,
      inputsCleared: 0,
      iframesReduced: 0,
      mediaStripped: 0,
      textRedactions: 0
    };
  }
  function redactedJson(value, redactions) {
    if (Array.isArray(value)) return value.map((entry) => redactedJson(entry, redactions));
    if (!value || typeof value !== "object") return value;
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (PRIVATE_KEY.test(key)) {
        result[key] = "[redacted]";
        redactions.keysRedacted += 1;
      } else {
        result[key] = redactedJson(entry, redactions);
      }
    }
    return result;
  }
  function defaultVisible(element) {
    try {
      const view = element.ownerDocument?.defaultView;
      const style = view?.getComputedStyle?.(element);
      return style?.display !== "none" && style?.visibility !== "hidden" && style?.opacity !== "0" && element.getClientRects().length > 0;
    } catch {
      return false;
    }
  }
  function safeRect(element, environment) {
    try {
      return environment.rect?.(element) ?? element.getBoundingClientRect();
    } catch {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
  }
  function reduceFrameSource(value) {
    try {
      const parsed = new URL(value, "https://invalid.local/");
      if (!/^https?:$/.test(parsed.protocol)) return "";
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return "";
    }
  }
  function redactText(value, redactions) {
    let count = 0;
    const replaced = value.replace(EMAIL, () => {
      count += 1;
      return "[redacted]";
    }).replace(PHONE, () => {
      count += 1;
      return "[redacted]";
    });
    redactions.textRedactions += count;
    return replaced;
  }
  function sanitizeEvidenceDocument(source, environment = {}) {
    if (!source?.documentElement) throw new Error("A page document is required for an evidence capsule.");
    const clone = source.cloneNode(true);
    const originals = Array.from(source.querySelectorAll("*"));
    const copies = Array.from(clone.querySelectorAll("*"));
    const elementCount = Math.min(originals.length, copies.length, 2e4);
    const visible = environment.isVisible ?? defaultVisible;
    const clock = environment.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
    const deadlineAt = Number.isFinite(environment.deadlineAt) ? Number(environment.deadlineAt) : Number.POSITIVE_INFINITY;
    const expired = () => clock() >= deadlineAt;
    const truncateSafely = () => {
      clone.documentElement.innerHTML = '<head></head><body><main data-yoink-vis="1">Snapshot capture reached its local time limit.</main></body>';
    };
    let timedOut = false;
    for (let index = 0; index < elementCount; index += 1) {
      if (expired()) {
        timedOut = true;
        truncateSafely();
        break;
      }
      const original = originals[index];
      const copy = copies[index];
      if (!original || !copy) continue;
      if (original.matches("#buy-box-wrapper-id input[type=radio]")) {
        copy.toggleAttribute("checked", original.checked);
      }
      if (original.matches("#buy-box-wrapper-id #AddToBag select option")) {
        copy.toggleAttribute("selected", original.selected);
      }
      let isVisible = false;
      try {
        isVisible = visible(original) === true;
      } catch {
        isVisible = false;
      }
      copy.setAttribute("data-yoink-vis", isVisible ? "1" : "0");
      if (original.matches(CANDIDATE_SELECTOR)) {
        const rect = safeRect(original, environment);
        copy.setAttribute("data-yoink-rect", [rect.x, rect.y, rect.width, rect.height].map((part) => Math.round(Number(part) || 0)).join(","));
      }
    }
    const redactions = blankRedactions();
    if (timedOut) return { document: clone, redactions, elementCount, timedOut };
    for (const script of Array.from(clone.querySelectorAll("script"))) {
      if (expired()) {
        timedOut = true;
        truncateSafely();
        break;
      }
      const type = String(script.getAttribute("type") || "").trim().toLocaleLowerCase("en-US");
      if (type !== "application/json" && type !== "application/ld+json") {
        script.remove();
        redactions.scriptsRemoved += 1;
        continue;
      }
      try {
        script.textContent = JSON.stringify(redactedJson(JSON.parse(script.textContent || ""), redactions));
        redactions.jsonBlocksKept += 1;
      } catch {
        script.remove();
        redactions.scriptsRemoved += 1;
      }
    }
    if (timedOut) return { document: clone, redactions, elementCount, timedOut };
    for (const element of Array.from(clone.querySelectorAll("*"))) {
      if (expired()) {
        timedOut = true;
        truncateSafely();
        break;
      }
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLocaleLowerCase("en-US");
        if (name.startsWith("on")) element.removeAttribute(attribute.name);
        if (["href", "src", "action", "formaction"].includes(name) && /^(?:javascript|data):/i.test(attribute.value.trim())) element.removeAttribute(attribute.name);
      }
      if (element.tagName === "INPUT") {
        const input = element;
        const hidden = input.type.toLocaleLowerCase("en-US") === "hidden";
        const privateHidden = hidden && PRIVATE_KEY.test(`${input.name} ${input.id}`);
        const productQuantity = input.type === "number" && /^[1-9]\d?$/.test(input.value) && (input.name === "quantity" && input.closest("form[data-product-id]") !== null || input.name === "quantity" && input.closest("product-form .product-column-right form[action='/cart/add'][id^='product-form-']") !== null || input.name === "qty" && input.closest("form#product_addtocart_form[data-product-sku]") !== null);
        if (productQuantity) {
          input.setAttribute("value", input.value);
        } else if (!hidden || privateHidden) {
          if (input.value || input.hasAttribute("value")) redactions.inputsCleared += 1;
          input.value = "";
          input.setAttribute("value", "");
        }
      } else if (element.tagName === "TEXTAREA") {
        const textarea = element;
        if (textarea.value || textarea.textContent) redactions.inputsCleared += 1;
        textarea.value = "";
        textarea.textContent = "";
      }
      if (element.tagName === "IFRAME") {
        const reduced = reduceFrameSource(element.getAttribute("src") || "");
        element.replaceChildren();
        element.removeAttribute("srcdoc");
        if (reduced) element.setAttribute("src", reduced);
        else element.removeAttribute("src");
        redactions.iframesReduced += 1;
      }
      if (["IMG", "SOURCE", "VIDEO", "AUDIO"].includes(element.tagName)) {
        let changed = false;
        for (const name of ["src", "srcset", "poster"]) {
          if (element.hasAttribute(name)) changed = true;
          element.removeAttribute(name);
        }
        if (changed) redactions.mediaStripped += 1;
      }
    }
    if (timedOut) return { document: clone, redactions, elementCount, timedOut };
    for (const link of Array.from(clone.querySelectorAll("link[rel~='stylesheet' i]"))) link.remove();
    const walker = clone.createTreeWalker(clone.documentElement, 4);
    let textNode = walker.nextNode();
    while (textNode) {
      if (expired()) {
        timedOut = true;
        truncateSafely();
        break;
      }
      textNode.nodeValue = redactText(textNode.nodeValue || "", redactions);
      textNode = walker.nextNode();
    }
    return { document: clone, redactions, elementCount, timedOut };
  }
  function serializeEvidenceDocument(documentValue) {
    const doctype = documentValue.doctype ? `<!DOCTYPE ${documentValue.doctype.name}>
` : "<!DOCTYPE html>\n";
    return `${doctype}${documentValue.documentElement.outerHTML}`;
  }
  async function gzip(value) {
    const stream = new Blob([TEXT_ENCODER.encode(value)]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  function base64(value) {
    let binary = "";
    const chunk = 32768;
    for (let offset = 0; offset < value.length; offset += chunk) {
      binary += String.fromCharCode(...value.subarray(offset, offset + chunk));
    }
    return btoa(binary);
  }
  async function sha256(value) {
    const digest = await crypto.subtle.digest("SHA-256", value.slice().buffer);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  function newCapsuleId() {
    return `cap_${crypto.randomUUID().replaceAll("-", "")}`;
  }
  function canonicalEvidenceUrl(value) {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new Error("Evidence capsules require a credential-free HTTPS product URL.");
    }
    return `${parsed.origin}${parsed.pathname}`;
  }
  function shouldCaptureEvidenceCapsule(diagnostic, manual = false) {
    if (manual) return true;
    if (diagnostic.operation === "observe") return diagnostic.outcome === "failed";
    if (!["rehearse_add", "live_add"].includes(diagnostic.operation) || !["failed", "rejected"].includes(diagnostic.outcome)) return false;
    return (/* @__PURE__ */ new Set([
      "availability_binding",
      "add_control",
      "sku_binding",
      "offer_binding",
      "price_binding",
      "seller_binding",
      "fulfillment_binding",
      "quantity_binding",
      "route_binding"
    ])).has(diagnostic.failureStage);
  }
  async function snapshotWithinLimit(documentValue, expired) {
    const reductionApplied = [];
    const truncateForDeadline = async () => {
      documentValue.documentElement.innerHTML = '<head></head><body><main data-yoink-vis="1">Snapshot capture reached its local time limit.</main></body>';
      const html2 = serializeEvidenceDocument(documentValue);
      return { html: html2, compressed: await gzip(html2), reductionApplied, truncated: true, timedOut: true };
    };
    let html = serializeEvidenceDocument(documentValue);
    let compressed = await gzip(html);
    if (expired()) return truncateForDeadline();
    if (compressed.length > EVIDENCE_CAPSULE_MAX_SNAPSHOT_BYTES) {
      for (const svg of Array.from(documentValue.querySelectorAll("svg"))) svg.replaceChildren();
      reductionApplied.push("svg_children");
      html = serializeEvidenceDocument(documentValue);
      compressed = await gzip(html);
      if (expired()) return truncateForDeadline();
    }
    if (compressed.length > EVIDENCE_CAPSULE_MAX_SNAPSHOT_BYTES) {
      for (const style of Array.from(documentValue.querySelectorAll("style"))) style.remove();
      reductionApplied.push("styles");
      html = serializeEvidenceDocument(documentValue);
      compressed = await gzip(html);
      if (expired()) return truncateForDeadline();
    }
    if (compressed.length > EVIDENCE_CAPSULE_MAX_SNAPSHOT_BYTES) {
      for (const element of Array.from(documentValue.querySelectorAll('[data-yoink-vis="0"]'))) {
        if (!element.matches(CANDIDATE_SELECTOR) && !element.querySelector(CANDIDATE_SELECTOR)) element.remove();
      }
      reductionApplied.push("hidden_elements");
      html = serializeEvidenceDocument(documentValue);
      compressed = await gzip(html);
      if (expired()) return truncateForDeadline();
    }
    let truncated = false;
    if (compressed.length > EVIDENCE_CAPSULE_MAX_SNAPSHOT_BYTES) {
      const suffix = "</body></html>";
      let low = 0;
      let high = html.length;
      let bestHtml = suffix;
      let bestGzip = await gzip(bestHtml);
      while (low <= high) {
        if (expired()) return truncateForDeadline();
        const middle = Math.floor((low + high) / 2);
        const candidate = `${html.slice(0, middle)}${suffix}`;
        const candidateGzip = await gzip(candidate);
        if (candidateGzip.length <= EVIDENCE_CAPSULE_MAX_SNAPSHOT_BYTES) {
          bestHtml = candidate;
          bestGzip = candidateGzip;
          low = middle + 1;
        } else high = middle - 1;
      }
      html = bestHtml;
      compressed = bestGzip;
      reductionApplied.push("cut_at_cap");
      truncated = true;
    }
    return { html, compressed, reductionApplied, truncated, timedOut: false };
  }
  async function captureEvidenceCapsule(input) {
    const clock = input.environment?.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
    const startedAt = clock();
    const budgetMs = Number.isFinite(input.budgetMs) && Number(input.budgetMs) > 0 ? Math.min(1500, Number(input.budgetMs)) : Number.POSITIVE_INFINITY;
    const deadlineAt = startedAt + budgetMs;
    const sanitized = sanitizeEvidenceDocument(input.document, {
      ...input.environment,
      now: clock,
      deadlineAt
    });
    const reduced = await snapshotWithinLimit(sanitized.document, () => clock() >= deadlineAt);
    const capturedAt = input.capturedAt ?? (/* @__PURE__ */ new Date()).toISOString();
    if (!Number.isFinite(Date.parse(capturedAt))) throw new Error("A valid capsule capture time is required.");
    const viewport = input.viewport ?? {
      width: Math.max(0, Math.round(globalThis.innerWidth || 0)),
      height: Math.max(0, Math.round(globalThis.innerHeight || 0)),
      devicePixelRatio: Math.max(0, Number(globalThis.devicePixelRatio || 1))
    };
    return {
      contractVersion: EVIDENCE_CAPSULE_CONTRACT_VERSION,
      id: input.id ?? newCapsuleId(),
      capturedAt,
      retailerId: input.retailerId,
      retailerSku: input.retailerSku,
      operation: input.diagnostic.operation,
      trigger: input.trigger,
      outcome: input.diagnostic.outcome,
      failureStage: input.diagnostic.failureStage,
      reasonCode: input.diagnostic.reasonCode,
      observerVersion: input.observerVersion,
      addAdapterVersion: input.addAdapterVersion,
      packVersion: input.packVersion ?? "",
      extensionVersion: input.extensionVersion,
      url: canonicalEvidenceUrl(input.url),
      viewport,
      requiredFulfillment: input.requiredFulfillment === "pickup" ? "pickup" : "shipping",
      diagnostic: input.diagnostic,
      trace: (input.trace ?? []).slice(0, 301),
      snapshot: {
        encoding: "gzip+base64",
        bytes: reduced.compressed.length,
        sha256: await sha256(reduced.compressed),
        html: base64(reduced.compressed)
      },
      redactions: sanitized.redactions,
      reductionApplied: reduced.reductionApplied,
      truncated: sanitized.timedOut || reduced.truncated || reduced.timedOut
    };
  }
  return __toCommonJS(evidence_capsule_exports);
})();
