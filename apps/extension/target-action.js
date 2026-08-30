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

  // packages/contracts/src/index.ts
  var TARGET_ADD_ADAPTER_VERSION = "target-add-v5";

  // packages/browser-adapters/src/target.ts
  var MARKETPLACE_PATTERN = /sold\s+(?:and|&)\s+shipped\s+by\s+(?!target\b)|sold\s+by\s+(?!target\b)|target\s*plus|marketplace\s+seller/i;
  var FIRST_PARTY_PATTERN = /sold\s+(?:and|&)\s+shipped\s+by\s+target\b|sold\s+by\s+target\b/i;
  function text(value, maximum = 2e3) {
    return String(value?.textContent || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
  }
  function visible(element) {
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
  function adaptiveTargetPrice(root, selectors) {
    const packaged = readPrice(root, selectors);
    if (packaged !== null) return packaged;
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
    ])) || /verify you are human|unusual traffic|security challenge/i.test(text(document.body, 5e4));
  }
  function targetInteractiveBlock(document) {
    const visibleText = text(document.body, 8e4);
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
    if (!visible(element) || element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") return false;
    const evidence = `${element.getAttribute("aria-label") || ""} ${text(element, 500)}`;
    if (TARGET_FULFILLMENT_UNAVAILABLE_PATTERN.test(evidence)) return false;
    return fulfillmentTileSelected(element) || TARGET_FULFILLMENT_AVAILABLE_PATTERN.test(evidence);
  }
  function controlFulfillment(control, root) {
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
    return [...root.querySelectorAll(`button[id='addToCartButtonOrTextIdFor${sku}']`)].filter((candidate) => visible(candidate) && !recommendationControl(candidate));
  }
  function addControls(document, sku) {
    const candidates = [
      ...exactAddControls(document, sku),
      ...document.querySelectorAll("button[data-test='shipItButton'], button[data-test='shippingButton'], button[data-test='orderPickupButton'], button[data-test*='addToCart' i]")
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
    const roots = [...new Set(document.querySelectorAll(TARGET_FULFILLMENT_ROOT_SELECTOR))].filter((root2) => visible(root2) && !recommendationControl(root2));
    if (roots.length === 0) return null;
    const scoped = roots.map((root2) => ({ root: root2, controls: exactAddControls(root2, sku) })).filter((entry) => entry.controls.length === 1 && entry.controls[0]);
    if (scoped.length !== 1 || !scoped[0]?.controls[0]) return emptyTargetAddBinding();
    const { root } = scoped[0];
    const control = scoped[0].controls[0];
    const tiles = [...root.querySelectorAll(TARGET_FULFILLMENT_TILE_SELECTOR)].filter(visible).map((fulfillmentControl) => ({
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
  var FULFILLMENT_SELECTION_MAX_WAIT_MS = 5e3;
  var sequence = 0;
  var pending = null;
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
    const binding = targetAddBinding(documentValue, urlValue, job.retailerSku, job.fulfillment);
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
  function rehearseTargetAdd(documentValue, urlValue, job, now = Date.now()) {
    const prepared = prepareTargetAdd(documentValue, urlValue, job, now);
    if (!prepared.ok) return prepared;
    abandonTargetAdd(prepared.authorizationId);
    return { ok: true, reason: "verified", proof: prepared.proof, wouldClick: true };
  }
  async function waitForSelectedFulfillmentBinding(documentValue, urlValue, job) {
    const deadline = Date.now() + FULFILLMENT_SELECTION_MAX_WAIT_MS;
    while (Date.now() <= deadline) {
      if (targetSecurityChallenge(documentValue) || targetInteractiveBlock(documentValue)) return null;
      const binding = targetAddBinding(documentValue, urlValue, job.retailerSku, job.fulfillment);
      if (binding.control && binding.fulfillment === job.fulfillment && !binding.selectionRequired) return binding;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  }
  async function commitTargetAdd(documentValue, urlValue, job, value, now = Date.now()) {
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
      new Date(now).toISOString()
    );
    const initiallyVerified = verifyLiveOffer(job, beforeSelection, now);
    if (!initiallyVerified.ok) return { ...initiallyVerified, clicked: false };
    let binding = targetAddBinding(documentValue, urlValue, job.retailerSku, job.fulfillment);
    if (!binding.control || binding.control !== authorization.control || binding.fulfillmentControl !== authorization.fulfillmentControl || binding.selectionRequired !== authorization.selectionRequired || binding.offerRoot !== authorization.offerRoot) {
      return { ok: false, reason: "add_control_changed", clicked: false };
    }
    if (binding.selectionRequired) {
      try {
        binding.fulfillmentControl.click();
      } catch {
        return { ok: false, reason: "fulfillment_selection_failed", clicked: false };
      }
      const selected = await waitForSelectedFulfillmentBinding(documentValue, urlValue, job);
      if (!selected) return { ok: false, reason: "fulfillment_selection_failed", clicked: false };
      binding = selected;
    }
    const observation = observeTargetOffer(
      documentValue,
      urlValue,
      job.retailerSku,
      job.fulfillment,
      new Date(now).toISOString()
    );
    const verified = verifyLiveOffer(job, observation, now);
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
    return verifyCartAddDelta(job, baseline, observeTargetCart(documentValue, new Date(now).toISOString()), proof, now);
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
