"use strict";
var YoinkObserverRecipeOracleModule = (() => {
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

  // apps/extension/src/observer-recipe-oracle.ts
  var observer_recipe_oracle_exports = {};
  __export(observer_recipe_oracle_exports, {
    OBSERVER_RECIPE_ORACLE_PROFILE: () => OBSERVER_RECIPE_ORACLE_PROFILE,
    evaluateObserverRecipeEvidence: () => evaluateObserverRecipeEvidence
  });
  var OBSERVER_RECIPE_ORACLE_PROFILE = "packaged_structured_oracle_v1";
  var FIELD_ORDER = ["availability", "unitPrice", "seller", "fulfillment", "addControl"];
  function tidy(value, maximum = 300) {
    return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
  }
  function visible(document, element) {
    if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") return false;
    const view = document.defaultView;
    if (!view) return true;
    const style = view.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }
  function parseAvailability(value) {
    const text = tidy(value).toLocaleLowerCase("en-US");
    if (!text) return null;
    if (/out[ _-]?of[ _-]?stock|sold[ _-]?out|unavailable|discontinued/.test(text)) return "out_of_stock";
    if (/pre[ _-]?order|presale/.test(text)) return "preorder";
    if (/in[ _-]?stock|limited[ _-]?availability|available|add to (?:cart|bag|basket)/.test(text)) return "in_stock";
    return null;
  }
  function parsePrice(value) {
    const text = tidy(value).replace(/,/g, "");
    const match = text.match(/(?:US\$|\$|USD\s*)(\d{1,7})(?:\.(\d{2}))?/i) ?? text.match(/^\s*(\d{1,7})\.(\d{2})\s*$/);
    if (!match) return null;
    const cents = Number(match[1]) * 100 + Number((match[2] || "00").padEnd(2, "0"));
    return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
  }
  function parseFulfillment(value) {
    const text = tidy(value).toLocaleLowerCase("en-US");
    if (/pick[ _-]?up|curbside|on[ _-]?site/.test(text)) return "pickup";
    if (/ship|delivery|parcel|freight|mail/.test(text)) return "shipping";
    return null;
  }
  function normalizedSeller(value) {
    const original = tidy(value, 160).toLocaleLowerCase("en-US");
    const soldBy = original.match(/\bsold by\s*:?\s*(.+)$/)?.[1];
    const seller = (soldBy ?? original).replace(/^(?:seller|merchant|vendor)\s*:?\s*/, "").replace(/[.·|\s]+$/g, "").trim();
    return seller && seller !== "unknown" ? seller : null;
  }
  function comparable(field, value) {
    if (field === "availability") return parseAvailability(value);
    if (field === "unitPrice") return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : parsePrice(value);
    if (field === "seller") return normalizedSeller(value);
    if (field === "fulfillment") return parseFulfillment(value);
    if (field === "addControl") return typeof value === "boolean" ? value : null;
    return null;
  }
  function equal(field, left, right) {
    return left === right;
  }
  function elementText(element, definition) {
    if (definition.mode === "attribute") return tidy(element.getAttribute(definition.attribute ?? ""));
    if (element instanceof (element.ownerDocument.defaultView?.HTMLInputElement ?? Object)) {
      const input = element;
      return tidy(input.value || input.getAttribute("aria-label") || input.textContent);
    }
    return tidy(element.textContent || element.getAttribute("aria-label"));
  }
  function readRecipeField(document, field, definition) {
    const elements = /* @__PURE__ */ new Set();
    let ambiguous = false;
    for (const selector of definition.selectors) {
      let matches;
      try {
        matches = [...document.querySelectorAll(selector)].filter((element2) => visible(document, element2));
      } catch {
        return { state: "ambiguous" };
      }
      if (matches.length > 1) ambiguous = true;
      for (const match of matches.slice(0, 2)) elements.add(match);
    }
    if (ambiguous || elements.size > 1) return { state: "ambiguous" };
    const element = [...elements][0];
    if (!element) return { state: "missing" };
    let value;
    if (field === "availability") {
      value = definition.mode === "presence" ? "in_stock" : definition.mode === "disabled_state" ? element.disabled || element.getAttribute("aria-disabled") === "true" ? "out_of_stock" : "in_stock" : comparable(field, elementText(element, definition));
    } else if (field === "fulfillment" && definition.mode === "presence") {
      value = "shipping";
    } else if (field === "addControl") {
      value = definition.mode === "presence" ? true : definition.mode === "disabled_state" ? !(element.disabled || element.getAttribute("aria-disabled") === "true") : /add to (?:cart|bag|basket)|pre[ -]?order/i.test(elementText(element, definition));
    } else {
      value = comparable(field, elementText(element, definition));
    }
    return value === null ? { state: "unrecognized" } : { state: "value", value };
  }
  function types(value) {
    return (Array.isArray(value) ? value : [value]).map((item) => tidy(item).toLocaleLowerCase("en-US"));
  }
  function objectIdentifiers(value) {
    return [value.sku, value.productID, value.productId, value.asin, value.mpn].map((item) => tidy(item).toLocaleUpperCase("en-US")).filter(Boolean);
  }
  function childObjects(value, limit = 1e3) {
    const found = [];
    const queue = [value];
    const seen = /* @__PURE__ */ new Set();
    while (queue.length && found.length < limit) {
      const current = queue.shift();
      if (!current || typeof current !== "object" || seen.has(current)) continue;
      seen.add(current);
      if (Array.isArray(current)) {
        queue.push(...current.slice(0, 100));
        continue;
      }
      const object = current;
      found.push(object);
      queue.push(...Object.values(object).slice(0, 100));
    }
    return found;
  }
  function semanticValue(element) {
    return tidy(element.getAttribute("content") || element.getAttribute("href") || element.getAttribute("value") || element.getAttribute("aria-label") || element.textContent);
  }
  function semanticOracle(document, expected) {
    const values = {
      availability: /* @__PURE__ */ new Set(),
      unitPrice: /* @__PURE__ */ new Set(),
      seller: /* @__PURE__ */ new Set(),
      fulfillment: /* @__PURE__ */ new Set(),
      addControl: /* @__PURE__ */ new Set()
    };
    const ambiguous = /* @__PURE__ */ new Set();
    const add = (field, value) => {
      let normalized;
      if (field === "unitPrice" && typeof value === "number") {
        const cents = Math.round(value * 100);
        normalized = Number.isFinite(value) && value > 0 && Number.isSafeInteger(cents) && Math.abs(cents / 100 - value) < 1e-6 ? cents : null;
      } else if (field === "unitPrice" && /^\d{1,7}(?:\.\d{1,2})?$/.test(tidy(value))) {
        const [dollars = "", fraction = ""] = tidy(value).split(".");
        const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, "0"));
        normalized = Number.isSafeInteger(cents) && cents > 0 ? cents : null;
      } else {
        normalized = comparable(field, value);
      }
      if (normalized !== null) values[field].add(normalized);
    };
    const documents = [];
    for (const script of [...document.querySelectorAll("script[type='application/ld+json']")].slice(0, 20)) {
      const body = script.textContent ?? "";
      if (!body || body.length > 2e5) continue;
      try {
        documents.push(JSON.parse(body));
      } catch {
      }
    }
    const objects = documents.flatMap((value) => childObjects(value));
    const products = objects.filter((object) => types(object["@type"]).some((type) => type.endsWith("product")));
    const exactProducts = products.filter((product) => objectIdentifiers(product).includes(expected.retailerSku.toLocaleUpperCase("en-US")));
    const selectedProducts = exactProducts.length === 1 ? exactProducts : exactProducts.length > 1 ? [] : products.length === 1 ? products : [];
    const standaloneOffers = products.length === 0 ? objects.filter((object) => types(object["@type"]).some((type) => type.endsWith("offer"))) : [];
    const structuredRoots = selectedProducts.length ? selectedProducts.flatMap((product) => [product, ...childObjects(product.offers, 250)]) : standaloneOffers.length === 1 ? standaloneOffers : [];
    for (const object of structuredRoots) {
      add("availability", object.availability);
      add("unitPrice", object.price);
      if (object.priceSpecification && typeof object.priceSpecification === "object") {
        add("unitPrice", object.priceSpecification.price);
      }
      const seller = object.seller ?? object.offeredBy;
      add("seller", seller && typeof seller === "object" ? seller.name : seller);
      const deliveryMethod = object.availableDeliveryMethod;
      add("fulfillment", deliveryMethod && typeof deliveryMethod === "object" ? deliveryMethod["@type"] ?? deliveryMethod.name : deliveryMethod);
      if (object.shippingDetails) add("fulfillment", "shipping");
    }
    const productScopes = [...document.querySelectorAll("[itemscope][itemtype*='Product'], [itemtype$='/Product']")];
    const exactScopes = productScopes.filter((scope2) => [...scope2.querySelectorAll("[itemprop='sku'], [itemprop='productID']")].some((element) => semanticValue(element).toLocaleUpperCase("en-US") === expected.retailerSku.toLocaleUpperCase("en-US")));
    const scope = exactScopes.length === 1 ? exactScopes[0] : exactScopes.length > 1 ? document.createDocumentFragment() : productScopes.length === 1 ? productScopes[0] : productScopes.length > 1 ? document.createDocumentFragment() : document;
    const semantic = (selector) => [...scope.querySelectorAll(selector)].filter((element) => visible(document, element));
    for (const element of semantic("[itemprop='availability'], meta[property='product:availability']")) add("availability", semanticValue(element));
    for (const element of semantic("[itemprop='price'], meta[property='product:price:amount'], meta[property='og:price:amount']")) add("unitPrice", semanticValue(element));
    for (const element of semantic("[itemprop='seller'], [itemprop='offeredBy']")) {
      add("seller", element.querySelector("[itemprop='name']") ? semanticValue(element.querySelector("[itemprop='name']")) : semanticValue(element));
    }
    for (const element of semantic("[itemprop='availableDeliveryMethod'], [itemprop='shippingDetails']")) add("fulfillment", semanticValue(element) || "shipping");
    const addControls = semantic("button, [role='button'], input[type='submit'], input[type='button']").filter((element) => /(?:^|\b)(?:add to (?:cart|bag|basket)|pre[ -]?order)(?:\b|$)/i.test(semanticValue(element)));
    if (addControls.length === 1) {
      const control = addControls[0];
      add("addControl", !(control.disabled || control.getAttribute("aria-disabled") === "true"));
    } else if (addControls.length > 1) {
      ambiguous.add("addControl");
    }
    return Object.fromEntries(FIELD_ORDER.map((field) => {
      if (ambiguous.has(field) || values[field].size > 1) return [field, { state: "ambiguous" }];
      const value = [...values[field]][0];
      return [field, value === void 0 ? { state: "missing" } : { state: "value", value }];
    }));
  }
  function expectedValue(field, expected) {
    if (field === "unitPrice") return expected.unitPriceCents;
    if (field === "seller") return normalizedSeller(expected.sellerName);
    if (field === "addControl") return expected.addControlActionable;
    return comparable(field, expected[field]);
  }
  function evaluateObserverRecipeEvidence(document, fields, expected) {
    const oracle = semanticOracle(document, expected);
    const fieldOutcomes = [];
    const recoveryEvidence = [];
    for (const field of FIELD_ORDER) {
      const definition = fields[field];
      if (!definition) continue;
      const recipe = readRecipeField(document, field, definition);
      if (recipe.state !== "value" || recipe.value === void 0) {
        fieldOutcomes.push({
          field,
          recipeState: recipe.state,
          packagedState: "not_evaluated",
          oracleState: "not_evaluated",
          disposition: "insufficient"
        });
        continue;
      }
      const packaged = expectedValue(field, expected);
      const packagedKnown = expected.known[field] === true && packaged !== null;
      if (packagedKnown && !equal(field, recipe.value, packaged)) {
        fieldOutcomes.push({
          field,
          recipeState: "value",
          packagedState: "conflict",
          oracleState: "not_evaluated",
          disposition: "conflict"
        });
        continue;
      }
      const packagedState = packagedKnown ? "agreed" : "missing";
      const oracleRead = oracle[field];
      if (oracleRead.state === "ambiguous") {
        fieldOutcomes.push({ field, recipeState: "value", packagedState, oracleState: "ambiguous", disposition: "insufficient" });
      } else if (oracleRead.state === "missing" || oracleRead.value === void 0) {
        fieldOutcomes.push({
          field,
          recipeState: "value",
          packagedState,
          oracleState: "missing",
          disposition: packagedKnown ? "verified" : "insufficient"
        });
      } else if (equal(field, recipe.value, oracleRead.value)) {
        fieldOutcomes.push({ field, recipeState: "value", packagedState, oracleState: "agreed", disposition: "verified" });
        if (!packagedKnown) recoveryEvidence.push({ field, normalizedValue: recipe.value });
      } else {
        fieldOutcomes.push({ field, recipeState: "value", packagedState, oracleState: "conflict", disposition: "conflict" });
      }
    }
    const count = (predicate) => fieldOutcomes.filter(predicate).length;
    return {
      validationProfile: OBSERVER_RECIPE_ORACLE_PROFILE,
      evaluatedFieldCount: fieldOutcomes.length,
      agreedFieldCount: count((item) => item.disposition === "verified"),
      ambiguousFieldCount: count((item) => item.recipeState === "ambiguous" || item.oracleState === "ambiguous"),
      oracleEvaluatedFieldCount: count((item) => item.oracleState === "agreed" || item.oracleState === "conflict"),
      oracleAgreedFieldCount: count((item) => item.oracleState === "agreed"),
      oracleConflictFieldCount: count((item) => item.oracleState === "conflict"),
      packagedMissingFieldCount: count((item) => item.packagedState === "missing"),
      packagedConflictFieldCount: count((item) => item.packagedState === "conflict"),
      insufficientFieldCount: count((item) => item.disposition === "insufficient"),
      fieldOutcomes,
      recoveryEvidence,
      shape: fieldOutcomes.map((item) => `${item.field}:${item.recipeState}:${item.packagedState}:${item.oracleState}:${item.disposition}`).join("|")
    };
  }
  Object.defineProperty(globalThis, "YoinkObserverRecipeOracle", {
    value: Object.freeze({ evaluateObserverRecipeEvidence }),
    configurable: true
  });
  return __toCommonJS(observer_recipe_oracle_exports);
})();
