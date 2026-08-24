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
    inspectTargetEmptyCart: () => inspectTargetEmptyCart,
    prepareTargetAdd: () => prepareTargetAdd,
    rehearseTargetAdd: () => rehearseTargetAdd,
    verifyTargetAddedCart: () => verifyTargetAddedCart
  });

  // packages/browser-safety/src/index.ts
  var BROWSER_SAFETY_CONTRACT_VERSION = 1;
  var LIVE_OFFER_MAX_AGE_MS = 3e4;
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
    return required === "either" || required === observed;
  }
  function validJob(job, now) {
    if (job.contractVersion !== BROWSER_SAFETY_CONTRACT_VERSION) return "contract_version_mismatch";
    if (!job.jobId || !job.retailerId || !job.retailerSku) return "job_identity_invalid";
    if (!retailerUrlAllowed(job.retailerId, job.canonicalUrl)) return "canonical_url_invalid";
    if (!Number.isInteger(job.quantity) || job.quantity < 1 || job.quantity > 99) return "quantity_invalid";
    if (!Number.isSafeInteger(job.maxUnitPriceCents) || job.maxUnitPriceCents <= 0) return "unit_cap_invalid";
    if (!Number.isSafeInteger(job.maxOrderTotalCents) || job.maxOrderTotalCents <= 0) return "total_cap_invalid";
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
  function verifySingleJobCart(job, inventory, offerProof, now = Date.now()) {
    const invalidJob = validJob(job, now);
    if (invalidJob) return rejected(invalidJob);
    if (inventory.contractVersion !== BROWSER_SAFETY_CONTRACT_VERSION) return rejected("contract_version_mismatch");
    const cartAge = timestampAge(inventory.observedAt, now);
    const offerAge = timestampAge(offerProof.observedAt, now);
    if (cartAge === null || cartAge > LIVE_OFFER_MAX_AGE_MS || offerAge === null || offerAge > CART_PROOF_MAX_AGE_MS) return rejected("cart_evidence_stale");
    if (offerProof.jobId !== job.jobId || offerProof.retailerId !== job.retailerId || offerProof.retailerSku !== job.retailerSku) return rejected("offer_proof_mismatch");
    if (!inventory.complete || !inventory.independentlyCounted || inventory.independentLineCount !== inventory.lines.length) return rejected("cart_unverified");
    if (inventory.lines.length !== 1 || inventory.lines[0]?.retailerSku !== job.retailerSku) return rejected("foreign_cart_line");
    const line = inventory.lines[0];
    if (!line || line.quantity !== job.quantity) return rejected("quantity_unavailable");
    const unitPriceCents = line.unitPriceCents ?? offerProof.unitPriceCents;
    const sellerName = line.sellerName || offerProof.sellerName;
    const sellerType = line.sellerType === "unknown" ? offerProof.sellerType : line.sellerType;
    const sellerReason = sellerAllowed(job, sellerName, sellerType);
    if (sellerReason) return rejected(sellerReason);
    if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents <= 0) return rejected("price_unavailable");
    if (unitPriceCents > job.maxUnitPriceCents) return rejected("over_unit_cap");
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
        unitPriceCents,
        sellerName: cleanSeller(sellerName),
        sellerType
      }
    };
  }

  // packages/contracts/src/index.ts
  var TARGET_ADD_ADAPTER_VERSION = "target-add-v1";

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
  function targetAddControl(document, urlValue, expectedSku, requiredFulfillment) {
    if (extractTargetSku(urlValue) !== expectedSku) return null;
    const selected = selectedAddControl(document, expectedSku, requiredFulfillment);
    return actionable(selected.control) ? selected.control : null;
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
    const control = queryVisible(line, ["select[name*='quantity' i]", "input[name*='quantity' i]", "[data-test*='quantity' i]"]);
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
  var sequence = 0;
  var pending = null;
  function targetJobReason(job) {
    if (job?.adapterVersion !== TARGET_ADD_ADAPTER_VERSION) return "adapter_version_mismatch";
    if (job?.retailerId !== "target" || job?.action !== "add_to_cart") return "unsupported_action";
    if (job?.quantity !== 1) return "quantity_not_supported";
    if (job?.sellerPolicy !== "first_party_only") return "seller_policy_not_supported";
    if (job?.fulfillment !== "shipping") return "fulfillment_not_supported";
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
  function prepareTargetAdd(documentValue, urlValue, job, now = Date.now()) {
    pending = null;
    const invalid = targetJobReason(job);
    if (invalid) return { ok: false, reason: invalid };
    const observation = observeTargetOffer(
      documentValue,
      urlValue,
      job.retailerSku,
      job.fulfillment,
      new Date(now).toISOString()
    );
    const verified = verifyLiveOffer(job, observation, now);
    if (!verified.ok) return verified;
    const control = targetAddControl(documentValue, urlValue, job.retailerSku, job.fulfillment);
    if (!control) return { ok: false, reason: "add_control_unavailable" };
    const id = authorizationId(now);
    pending = { id, jobId: job.jobId, createdAt: now, control, proof: verified.proof };
    return { ok: true, reason: "verified", authorizationId: id, proof: verified.proof };
  }
  function rehearseTargetAdd(documentValue, urlValue, job, now = Date.now()) {
    const prepared = prepareTargetAdd(documentValue, urlValue, job, now);
    if (!prepared.ok) return prepared;
    abandonTargetAdd(prepared.authorizationId);
    return { ok: true, reason: "verified", proof: prepared.proof, wouldClick: true };
  }
  function commitTargetAdd(documentValue, urlValue, job, value, now = Date.now()) {
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
    const observation = observeTargetOffer(
      documentValue,
      urlValue,
      job.retailerSku,
      job.fulfillment,
      new Date(now).toISOString()
    );
    const verified = verifyLiveOffer(job, observation, now);
    if (!verified.ok) return { ...verified, clicked: false };
    const control = targetAddControl(documentValue, urlValue, job.retailerSku, job.fulfillment);
    if (!control || control !== authorization.control) return { ok: false, reason: "add_control_changed", clicked: false };
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
  function inspectTargetEmptyCart(documentValue, urlValue) {
    if (!targetCartUrl(urlValue)) return { ok: false, reason: "cart_page_unverified" };
    if (targetSecurityChallenge(documentValue) || targetInteractiveBlock(documentValue)) {
      return { ok: false, reason: "manual_action_required" };
    }
    const cart = observeTargetCart(documentValue);
    if (!cart.complete || !cart.independentlyCounted) return { ok: false, reason: "cart_unverified" };
    return cart.lines.length === 0 ? { ok: true, reason: "verified_empty" } : { ok: false, reason: "foreign_cart_line" };
  }
  function verifyTargetAddedCart(documentValue, urlValue, job, proof, now = Date.now()) {
    if (!targetCartUrl(urlValue)) return { ok: false, reason: "cart_page_unverified" };
    if (targetSecurityChallenge(documentValue) || targetInteractiveBlock(documentValue)) {
      return { ok: false, reason: "manual_action_required" };
    }
    return verifySingleJobCart(job, observeTargetCart(documentValue, new Date(now).toISOString()), proof, now);
  }
  Object.defineProperty(globalThis, "YoinkTargetAction", {
    value: Object.freeze({
      abandonTargetAdd,
      commitTargetAdd,
      inspectTargetEmptyCart,
      prepareTargetAdd,
      rehearseTargetAdd,
      verifyTargetAddedCart
    }),
    configurable: true
  });
  return __toCommonJS(target_action_exports);
})();
