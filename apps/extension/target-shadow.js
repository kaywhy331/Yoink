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
  var TARGET_OBSERVER_VERSION = "target-observer-v4";
  var SELECTED_OFFER_SCOPE_VERSION = 1;

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

  // packages/browser-adapters/src/target.ts
  var MARKETPLACE_PATTERN = /sold\s+(?:and|&)\s+shipped\s+by\s+(?!target\b)|sold\s+by\s+(?!target\b)|target\s*plus|marketplace\s+seller/i;
  var FIRST_PARTY_PATTERN = /sold\s+(?:and|&)\s+shipped\s+by\s+target\b|sold\s+by\s+target\b/i;
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
        if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(element.tagName) || !visible2(element)) return;
      }
      for (const child of [...node.childNodes]) visit(child);
    };
    visit(value);
    return fragments.join(" ").replace(/\s+/g, " ").trim().slice(0, maximum);
  }
  function visible2(element) {
    if (!element) return false;
    const view = element.ownerDocument.defaultView;
    let current = element;
    while (current) {
      if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden") === "true") return false;
      const style = String(current.getAttribute("style") || "").replace(/\s+/g, "").toLocaleLowerCase("en-US");
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
        if (!visible2(element)) continue;
        for (const candidate of [element.getAttribute("content"), element.getAttribute("value"), text(element, 300)]) {
          const price = parseUsPrice(candidate);
          if (price !== null) return price;
        }
      }
    }
    return null;
  }
  function adaptiveTargetPrice(root, selectors) {
    const packaged = readPrice(root, selectors);
    if (packaged !== null) return packaged;
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
  function targetInteractiveBlock(document) {
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
  var TARGET_FULFILLMENT_ROOT_SELECTOR = [
    "[data-test='@web/AddToCart/FulfillmentSection'][aria-label='Fulfillment']",
    "[data-test='module-product-detail-fulfillment-v1'][aria-label='Fulfillment']",
    "[data-module-type='ProductDetailFulfillment'] [aria-label='Fulfillment']",
    "[aria-label='Fulfillment']"
  ].join(", ");
  var TARGET_FULFILLMENT_TILE_SELECTOR = [
    "button[data-test='fulfillment-cell-pickup']",
    "button[data-test='fulfillment-cell-delivery']",
    "button[data-test='fulfillment-cell-shipping']",
    "button#PICKUP",
    "button#DELIVERY",
    "button#SHIPPING",
    "button[aria-label]"
  ].join(", ");
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
  function recommendationControl(candidate) {
    return Boolean(candidate.closest([
      "[data-test*='recommend' i]",
      "[data-testid*='carousel' i]",
      "[aria-label*='similar items' i]",
      "[data-test*='productCard' i]",
      "[data-strategy-id]",
      "[data-module-type*='Recommended' i]"
    ].join(", ")));
  }
  function exactAddControls(root, sku) {
    if (!/^\d{6,}$/.test(sku)) return [];
    return [...root.querySelectorAll(`button[id='addToCartButtonOrTextIdFor${sku}']`)].filter((candidate) => visible2(candidate) && !recommendationControl(candidate));
  }
  function targetSkuEvidence(root) {
    const skus = /* @__PURE__ */ new Set();
    const elements = [
      ...root.nodeType === 1 ? [root] : [],
      ...root.querySelectorAll("[data-tcin], button[id^='addToCartButtonOrTextIdFor']")
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
    return candidates.length === 1 ? candidates : [];
  }
  function addControls(document, sku) {
    const candidates = [
      ...exactAddControls(document, sku),
      ...document.querySelectorAll("button[data-test='shipItButton'], button[data-test='shippingButton'], button[data-test='orderPickupButton'], button[data-test*='addToCart' i]")
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
  function emptyTargetAddBinding() {
    return { control: null, fulfillmentControl: null, fulfillment: "unknown", selectionRequired: false, offerRoot: null };
  }
  function modernTargetAddBinding(document, sku, required) {
    const visibleRoots = [...new Set(document.querySelectorAll(TARGET_FULFILLMENT_ROOT_SELECTOR))].filter((root2) => visible2(root2) && !recommendationControl(root2));
    const roots = visibleRoots.filter((root2) => !visibleRoots.some((candidate) => candidate !== root2 && root2.contains(candidate)));
    if (roots.length === 0) return null;
    const scoped = roots.map((root2) => {
      const exact = exactAddControls(root2, sku);
      return { root: root2, controls: exact.length > 0 ? exact : semanticTargetAddControls(root2, sku) };
    }).filter((entry) => entry.controls.length === 1 && entry.controls[0]);
    if (scoped.length !== 1 || !scoped[0]?.controls[0]) return emptyTargetAddBinding();
    const { root } = scoped[0];
    const control = scoped[0].controls[0];
    const tiles = [...root.querySelectorAll(TARGET_FULFILLMENT_TILE_SELECTOR)].filter(visible2).map((fulfillmentControl) => ({
      fulfillmentControl,
      fulfillment: fulfillmentKind(fulfillmentControl),
      selected: fulfillmentTileSelected(fulfillmentControl),
      available: fulfillmentTileAvailable(fulfillmentControl)
    })).filter((entry) => entry.fulfillment !== "unknown");
    const selected = tiles.filter((entry) => entry.selected);
    if (selected.length !== 1 || !selected[0]) return emptyTargetAddBinding();
    const selectedEntry = selected[0];
    required = required === "pickup" ? "pickup" : "shipping";
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
    const selectors = [
      "[data-test*='availability' i]",
      "[data-testid*='availability' i]",
      "[data-test*='out-of-stock' i]",
      "[data-testid*='out-of-stock' i]",
      "[itemprop='availability']",
      "button[disabled]"
    ];
    return [...document.querySelectorAll(selectors.join(", "))].filter((element) => visible2(element) && !recommendationControl(element)).some((element) => /\b(?:out of stock|sold out|currently unavailable)\b/i.test(
      `${element.getAttribute("content") || ""} ${element.getAttribute("aria-label") || ""} ${observableText(element, 500)}`
    ));
  }
  function legacyTargetAddBinding(document, sku, required) {
    required = required === "pickup" ? "pickup" : "shipping";
    const candidates = addControls(document, sku).map((control) => ({ control, fulfillment: controlFulfillment(control, document) }));
    const matching = candidates.find((entry) => entry.fulfillment === required);
    return matching ? { ...matching, fulfillmentControl: null, selectionRequired: false, offerRoot: null } : emptyTargetAddBinding();
  }
  function targetAddBinding(document, urlValue, expectedSku, requiredFulfillment) {
    if (extractTargetSku(urlValue) !== expectedSku) return emptyTargetAddBinding();
    return modernTargetAddBinding(document, expectedSku, requiredFulfillment) ?? legacyTargetAddBinding(document, expectedSku, requiredFulfillment);
  }
  function closestOfferContainer(anchor) {
    let current = anchor?.parentElement ?? null;
    for (let depth = 0; depth < 12 && current; depth += 1) {
      const scopedText = text(current, 6e4);
      const price = adaptiveTargetPrice(current, [
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
    const selected = pageSku === expectedSku ? targetAddBinding(document, urlValue, expectedSku, requiredFulfillment) : emptyTargetAddBinding();
    const seller = sellerEvidence(document, selected.control);
    const priceRoot = selected.offerRoot?.closest("[data-test*='buy-box' i], [data-test='product-detail'], main") || selected.control?.closest("[data-test*='buy-box' i], [data-test='product-detail'], main") || document;
    const unitPriceCents = adaptiveTargetPrice(priceRoot, [
      "[data-test='product-price']",
      "[data-test*='current-price' i]",
      "meta[itemprop='price']",
      "[itemprop='price']"
    ]);
    const blocked = targetInteractiveBlock(document);
    const selectedControlActionable = pageSku === expectedSku && actionable(selected.control);
    const availability = blocked ? "unknown" : selectedControlActionable ? "in_stock" : pageSku === expectedSku && targetExplicitlyUnavailable(document) ? "out_of_stock" : "unknown";
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
  function observeTargetSelectedOfferScope(document, urlValue, expectedSku, requiredFulfillment = "shipping") {
    const pageSku = extractTargetSku(urlValue);
    if (!pageSku || pageSku !== expectedSku) throw new Error("The exact Target listing identity is unavailable.");
    const selected = targetAddBinding(document, urlValue, expectedSku, requiredFulfillment);
    return selectedOfferScope(
      document,
      "target",
      pageSku,
      selected.control?.closest("[data-test='product-detail'], main") || document
    );
  }

  // apps/extension/src/target-shadow.ts
  function collectTargetShadowObservation(documentValue = globalThis.document, urlValue = globalThis.location?.href ?? "") {
    if (!documentValue) throw new Error("The current Target page is unavailable.");
    const retailerSku = extractTargetSku(urlValue);
    if (!retailerSku) throw new Error("Open an exact Target product page before inspecting it.");
    const observation = observeTargetOffer(documentValue, urlValue, retailerSku, "shipping");
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
      interactiveBlock: observation.interactiveBlock,
      selectedOffer: observeTargetSelectedOfferScope(documentValue, urlValue, retailerSku, "shipping")
    });
  }
  Object.defineProperty(globalThis, "YoinkTargetShadow", {
    value: Object.freeze({ collectTargetShadowObservation }),
    configurable: true
  });
  return __toCommonJS(target_shadow_exports);
})();
