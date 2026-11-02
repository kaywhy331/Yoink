"use strict";
var YoinkCheckoutReadinessModule = (() => {
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

  // apps/extension/src/checkout-readiness.ts
  var checkout_readiness_exports = {};
  __export(checkout_readiness_exports, {
    inspectCheckoutReadiness: () => inspectCheckoutReadiness
  });
  var HOSTS = {
    amazon: "amazon.com",
    target: "target.com",
    walmart: "walmart.com",
    bestbuy: "bestbuy.com"
  };
  var STOCK_BLOCK = /out of stock|sold out|(?:item|product|quantity|items).{0,65}(?:no longer available|currently unavailable|not available|unavailable)|(?:no longer available|currently unavailable).{0,45}(?:item|product)|unable to (?:ship|deliver)|cannot (?:be shipped|be delivered)|not enough (?:stock|inventory)/i;
  function visible(element) {
    const view = element.ownerDocument.defaultView;
    for (let node = element; node; node = node.parentElement) {
      const style = view?.getComputedStyle(node);
      if (node.hasAttribute("hidden") || node.getAttribute("aria-hidden") === "true" || style?.display === "none" || style?.visibility === "hidden") return false;
    }
    return element.getClientRects().length > 0;
  }
  function inspectCheckoutReadiness(document, href, job, now = Date.now(), isVisible = visible) {
    const result = (availability, reason) => ({ availability, reason, checkedAt: new Date(now).toISOString() });
    let url;
    try {
      url = new URL(href);
    } catch {
      return result("unknown", "checkout_unverified");
    }
    const host = HOSTS[job.retailerId];
    if (!host || ![host, `www.${host}`].includes(url.hostname)) return result("unknown", "checkout_unverified");
    const shown = (selector) => [...document.querySelectorAll(selector)].filter(isVisible);
    const text = (element) => String(element.textContent || "").replace(/\s+/g, " ").trim();
    const root = document.querySelector('main, #checkoutDisplayPage, #checkout-page-container, #spc, [data-testid="checkout"]') || document.body;
    if (!root) return result("unknown", "checkout_loading");
    if (/captcha|\/blocked|validateCaptcha/i.test(url.pathname) || shown('iframe[src*="captcha" i], [id*="captcha" i], [data-testid*="captcha" i]').length || /verify you are human|robot or human|unusual traffic|security challenge/i.test(text(root))) return result("unknown", "security_challenge");
    if (/\/ap\/signin|\/login|\/signin|\/sign-in/i.test(url.pathname) || shown('input[type="password"]').length) return result("unknown", "checkout_sign_in_required");
    if (!/\/checkout(?:\/|$)|\/gp\/buy\/|\/buy\//i.test(url.pathname)) return result("unknown", "checkout_unverified");
    const sku = job.retailerSku;
    if (!/^[A-Za-z0-9_-]{5,40}$/.test(sku)) return result("unknown", "checkout_identity_mismatch");
    const containsIdentity = (element) => {
      const attrs = ["data-asin", "data-sku", "data-sku-id", "data-item-id", "data-product-id", "data-tcin"];
      if (attrs.some((name) => element.getAttribute(name) === sku)) return true;
      if (element.tagName === "INPUT" && /asin|sku|item|tcin/i.test(element.getAttribute("name") || "") && element.getAttribute("value") === sku) return true;
      if (element.tagName === "A") {
        try {
          const link = new URL(element.getAttribute("href") || "", href);
          return [host, `www.${host}`].includes(link.hostname) && (link.pathname.split(/[\/.-]/).includes(sku) || link.searchParams.get("skuId") === sku);
        } catch {
          return false;
        }
      }
      return false;
    };
    const identities = [...root.querySelectorAll("a[href], [data-asin], [data-sku], [data-sku-id], [data-item-id], [data-product-id], [data-tcin], input[name]")].filter(containsIdentity);
    const lines = identities.map((element) => element.closest('[data-asin], [data-sku], [data-sku-id], [data-item-id], [data-tcin], [data-testid*="item" i], [data-test*="item" i], .shipment, .a-box') || element.parentElement).filter((element) => Boolean(element && isVisible(element)));
    const alerts = shown('[role="alert"], .a-alert-error, .a-alert-warning, #important-message, [data-testid*="error" i], [data-test*="error" i]');
    if (lines.some((line) => STOCK_BLOCK.test(text(line)))) return result("out_of_stock", "out_of_stock");
    if (alerts.some((alert) => STOCK_BLOCK.test(text(alert)))) {
      return job.cartLineCount === 1 ? result("out_of_stock", "out_of_stock") : result("unknown", "checkout_stock_conflict");
    }
    if (job.cartLineCount === 1 && /(?:some|the following|these|this) items? (?:in your (?:order|cart) )?(?:is|are) (?:no longer available|out of stock)/i.test(text(root))) {
      return result("out_of_stock", "out_of_stock");
    }
    if (!lines.length) return result("unknown", "checkout_identity_unverified");
    if (alerts.some((alert) => /select|choose|missing|invalid|cannot|unable|problem|error|change|unavailable/i.test(text(alert)))) {
      return result("unknown", "checkout_review_required");
    }
    const controls = shown('button, input[type="submit"], [role="button"]');
    const placeOrder = controls.find((element) => {
      const label = `${text(element)} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("value") || ""}`;
      return /place (?:your )?order|submit (?:your )?order|complete (?:your )?purchase/i.test(label) && !element.hasAttribute("disabled") && !element.closest('fieldset[disabled], [aria-disabled="true"]');
    });
    return placeOrder ? result("available", "checkout_available") : result("unknown", "checkout_review_required");
  }
  Object.assign(globalThis, { YoinkCheckoutReadiness: { inspectCheckoutReadiness } });
  return __toCommonJS(checkout_readiness_exports);
})();
