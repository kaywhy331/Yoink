"use strict";
var YoinkTargetShadowModule = (() => {
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

  // apps/extension/src/target-shadow.ts
  var target_shadow_exports = {};
  __export(target_shadow_exports, {
    collectTargetShadowObservation: () => collectTargetShadowObservation
  });

  // packages/contracts/src/index.ts
  var TARGET_OBSERVER_VERSION = "target-observer-v1";

  // packages/browser-safety/src/index.ts
  var BROWSER_SAFETY_CONTRACT_VERSION = 1;
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

  // packages/browser-adapters/src/target.ts
  var MARKETPLACE_PATTERN = /sold\s+(?:and|&)\s+shipped\s+by\s+(?!target\b)|sold\s+by\s+(?!target\b)|target\s*plus|marketplace\s+seller/i;
  var FIRST_PARTY_PATTERN = /sold\s+(?:and|&)\s+shipped\s+by\s+target\b|sold\s+by\s+target\b/i;
  function text(value, maximum = 2e3) {
    return String(value?.textContent || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
  }
  function visible(element) {
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
  function actionable(element) {
    return visible(element) && !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true" && !/sold out|out of stock|unavailable/i.test(text(element, 300));
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
        if (!visible(element)) continue;
        for (const candidate of [element.getAttribute("content"), element.getAttribute("value"), text(element, 300)]) {
          const price = parseUsPrice(candidate);
          if (price !== null) return price;
        }
      }
    }
    return null;
  }
  function targetSecurityChallenge(document) {
    return Boolean(queryVisible(document, [
      "iframe[src*='captcha' i]",
      "[data-test*='captcha' i]",
      "[data-testid*='captcha' i]",
      "[id*='captcha' i]"
    ])) || /verify you are human|unusual traffic|security challenge/i.test(text(document.body, 5e4));
  }
  function targetInteractiveBlock(document) {
    const visibleText = text(document.body, 8e4);
    if (queryVisible(document, ["input[autocomplete='one-time-code']", "input[name*='otp' i]"])) return "mfa";
    const dialog = queryVisible(document, ["[role='dialog']", "dialog[open]"]);
    const dialogText = text(dialog, 1e4);
    if (dialog && /choose|select|set/.test(dialogText.toLocaleLowerCase("en-US")) && /pickup store|my store|location/.test(dialogText.toLocaleLowerCase("en-US"))) return "location";
    if (dialog && /target circle 360|membership|free trial/i.test(dialogText)) return "membership";
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
  function controlFulfillment(control, document) {
    const own = `${control.getAttribute("data-test") || ""} ${control.getAttribute("data-fulfillment") || ""} ${text(control, 300)}`;
    if (/ship it|shipping|delivery/i.test(own)) return "shipping";
    if (/pick it up|pickup|pick-up/i.test(own)) return "pickup";
    const selected = [...document.querySelectorAll("[aria-selected='true'], [data-selected='true'], input:checked")].filter((element) => visible(element)).map((element) => text(element.closest("label, [role='tab'], [data-test*='fulfillment' i]") || element, 500));
    const shipping = selected.some((value) => /ship it|shipping|delivery/i.test(value));
    const pickup = selected.some((value) => /pick it up|pickup|pick-up/i.test(value));
    return shipping === pickup ? "unknown" : shipping ? "shipping" : "pickup";
  }
  function addControls(document, sku) {
    const exact = /^\d{6,}$/.test(sku) ? document.getElementById(`addToCartButtonOrTextIdFor${sku}`) : null;
    const candidates = [
      exact,
      ...document.querySelectorAll("button[data-test='shipItButton'], button[data-test='orderPickupButton'], button[data-test*='addToCart' i]")
    ].filter((value) => Boolean(value));
    return [...new Set(candidates)].filter((candidate) => {
      if (!visible(candidate)) return false;
      if (candidate.closest("[data-test*='recommend' i], [data-testid*='carousel' i], [aria-label*='similar items' i]")) return false;
      const scopedSku = candidate.closest("[data-tcin]")?.getAttribute("data-tcin");
      return !scopedSku || scopedSku === sku;
    });
  }
  function selectedAddControl(document, sku, required) {
    const candidates = addControls(document, sku).map((control) => ({ control, fulfillment: controlFulfillment(control, document) }));
    const matching = candidates.find((entry) => required === "either" ? entry.fulfillment === "shipping" || entry.fulfillment === "pickup" : entry.fulfillment === required);
    return matching ?? candidates[0] ?? { control: null, fulfillment: "unknown" };
  }
  function closestOfferContainer(anchor) {
    let current = anchor?.parentElement ?? null;
    for (let depth = 0; depth < 12 && current; depth += 1) {
      const scopedText = text(current, 6e4);
      const price = readPrice(current, [
        "[data-test='product-price']",
        "[data-test*='current-price' i]",
        "meta[itemprop='price']",
        "[itemprop='price']"
      ]);
      if (price !== null && scopedText.length < 4e4) return current;
      current = current.parentElement;
    }
    return null;
  }
  function sellerEvidence(document, anchor) {
    const cartRoot = anchor?.closest("[data-test='cart-item'], [data-test='cartItem'], [data-testid='cart-item']") ?? null;
    const offerRoot = cartRoot ? null : closestOfferContainer(anchor);
    const root = cartRoot || offerRoot || anchor?.closest("[data-test*='buy-box' i], [data-test='product-detail'], [data-test*='fulfillment' i]") || document;
    const region = queryVisible(root, ["[data-test*='sold-by' i]", "[data-test*='seller' i]", "[data-testid*='seller' i]"]);
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
  function observeTargetOffer(document, urlValue, expectedSku, requiredFulfillment, observedAt = (/* @__PURE__ */ new Date()).toISOString()) {
    const pageSku = extractTargetSku(urlValue);
    const selected = pageSku === expectedSku ? selectedAddControl(document, expectedSku, requiredFulfillment) : { control: null, fulfillment: "unknown" };
    const seller = sellerEvidence(document, selected.control);
    const priceRoot = selected.control?.closest("[data-test*='buy-box' i], [data-test='product-detail'], main") || document;
    const unitPriceCents = readPrice(priceRoot, [
      "[data-test='product-price']",
      "[data-test*='current-price' i]",
      "meta[itemprop='price']",
      "[itemprop='price']"
    ]);
    const blocked = targetInteractiveBlock(document);
    return {
      contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
      observedAt,
      url: urlValue,
      pageKind: targetPageKind(urlValue),
      retailerId: "target",
      retailerSku: pageSku,
      availability: pageSku === expectedSku && actionable(selected.control) && !blocked ? "in_stock" : "out_of_stock",
      unitPriceCents,
      currency: "USD",
      sellerName: seller.sellerName,
      sellerType: seller.sellerType,
      fulfillment: selected.fulfillment,
      addControlActionable: pageSku === expectedSku && actionable(selected.control) && !blocked,
      securityChallenge: targetSecurityChallenge(document),
      interactiveBlock: blocked
    };
  }

  // apps/extension/src/target-shadow.ts
  function collectTargetShadowObservation(documentValue = globalThis.document, urlValue = globalThis.location?.href ?? "") {
    if (!documentValue) throw new Error("The current Target page is unavailable.");
    const retailerSku = extractTargetSku(urlValue);
    if (!retailerSku) throw new Error("Open an exact Target product page before inspecting it.");
    const observation = observeTargetOffer(documentValue, urlValue, retailerSku, "either");
    if (observation.pageKind !== "product" || observation.retailerId !== "target" || observation.retailerSku !== retailerSku) {
      throw new Error("The exact Target product page could not be verified.");
    }
    const fulfillment = observation.fulfillment === "shipping" || observation.fulfillment === "pickup" ? observation.fulfillment : "unknown";
    return Object.freeze({
      adapterVersion: TARGET_OBSERVER_VERSION,
      contractVersion: 1,
      observedAt: observation.observedAt,
      pageKind: "product",
      retailerId: "target",
      retailerSku,
      availability: observation.availability,
      unitPriceCents: observation.unitPriceCents,
      currency: "USD",
      sellerName: observation.sellerName,
      sellerType: observation.sellerType,
      fulfillment,
      addControlActionable: observation.addControlActionable,
      securityChallenge: observation.securityChallenge,
      interactiveBlock: observation.interactiveBlock
    });
  }
  Object.defineProperty(globalThis, "YoinkTargetShadow", {
    value: Object.freeze({ collectTargetShadowObservation }),
    configurable: true
  });
  return __toCommonJS(target_shadow_exports);
})();
