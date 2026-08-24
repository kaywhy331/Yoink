import {
  BROWSER_SAFETY_CONTRACT_VERSION,
  type CartInventoryEvidence,
  type CheckoutEvidence,
  type LiveOfferObservation
} from "../../browser-safety/src/index.js";
import { TARGET_OBSERVER_VERSION, type Fulfillment, type SellerType } from "../../contracts/src/index.js";
import { selectedOfferScope } from "./selected-offer.js";

export { TARGET_OBSERVER_VERSION };

export interface TargetMissionIdentity {
  retailerSku: string;
  quantity: number;
  fulfillment: Fulfillment;
}

export type FingerprintSigner = (values: string[]) => Promise<string>;

const MARKETPLACE_PATTERN = /sold\s+(?:and|&)\s+shipped\s+by\s+(?!target\b)|sold\s+by\s+(?!target\b)|target\s*plus|marketplace\s+seller/i;
const FIRST_PARTY_PATTERN = /sold\s+(?:and|&)\s+shipped\s+by\s+target\b|sold\s+by\s+target\b/i;

function text(value: Element | Document | null | undefined, maximum = 2_000): string {
  return String(value?.textContent || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function visible(element: Element | null): element is Element {
  if (!element) return false;
  let current: Element | null = element;
  while (current) {
    if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden") === "true") return false;
    const style = String(current.getAttribute("style") || "").replace(/\s+/g, "").toLocaleLowerCase("en-US");
    if (/(?:^|;)display:none(?:;|$)|(?:^|;)visibility:hidden(?:;|$)/.test(style)) return false;
    current = current.parentElement;
  }
  return true;
}

function actionable(element: Element | null): element is Element {
  return visible(element)
    && !element.hasAttribute("disabled")
    && element.getAttribute("aria-disabled") !== "true"
    && !/sold out|out of stock|unavailable/i.test(text(element, 300));
}

function formControlValue(element: Element | null): string {
  if (!element || !["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName)) return "";
  return String((element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value || "");
}

function formControlChecked(element: Element): boolean {
  return element.tagName === "INPUT" && Boolean((element as HTMLInputElement).checked);
}

function queryVisible(root: ParentNode, selectors: string[]): Element | null {
  for (const selector of selectors) {
    const match = [...root.querySelectorAll(selector)].find(visible);
    if (match) return match;
  }
  return null;
}

export function extractTargetSku(urlValue: string): string {
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

export function parseUsPrice(value: unknown): number | null {
  const source = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!source || /(?:C|CA|MX|SG|HK|AU|A|R)\s*\$/i.test(source)) return null;
  const match = source.match(/(?:US\s*)?\$\s*([0-9]{1,7}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/i)
    ?? (/^[0-9]{1,7}(?:\.[0-9]{1,2})?$/.test(source) ? [source, source] : null);
  if (!match?.[1]) return null;
  const dollars = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : null;
}

function readPrice(root: ParentNode, selectors: string[]): number | null {
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

export function targetSecurityChallenge(document: Document): boolean {
  return Boolean(queryVisible(document, [
    "iframe[src*='captcha' i]",
    "[data-test*='captcha' i]",
    "[data-testid*='captcha' i]",
    "[id*='captcha' i]"
  ])) || /verify you are human|unusual traffic|security challenge/i.test(text(document.body, 50_000));
}

export function targetInteractiveBlock(document: Document): LiveOfferObservation["interactiveBlock"] {
  const visibleText = text(document.body, 80_000);
  if (queryVisible(document, ["input[autocomplete='one-time-code']", "input[name*='otp' i]"])) return "mfa";
  const dialog = queryVisible(document, ["[role='dialog']", "dialog[open]"]);
  const dialogText = text(dialog, 10_000);
  if (dialog && /choose|select|set/.test(dialogText.toLocaleLowerCase("en-US")) && /pickup store|my store|location/.test(dialogText.toLocaleLowerCase("en-US"))) return "location";
  if (dialog && /target circle 360|membership|free trial/i.test(dialogText)) return "membership";
  if (queryVisible(document, ["form[action*='login' i] input[type='password']", "input[autocomplete='current-password']"])) return "auth";
  if (/you(?:’|')?re in line|virtual queue|waiting room/i.test(visibleText)) return "queue";
  if (targetSecurityChallenge(document)) return "unknown";
  return "";
}

export function targetPageKind(urlValue: string): LiveOfferObservation["pageKind"] {
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

function controlFulfillment(control: Element, document: Document): "shipping" | "pickup" | "unknown" {
  const own = `${control.getAttribute("data-test") || ""} ${control.getAttribute("data-fulfillment") || ""} ${text(control, 300)}`;
  if (/ship it|shipping|delivery/i.test(own)) return "shipping";
  if (/pick it up|pickup|pick-up/i.test(own)) return "pickup";
  const selected = [...document.querySelectorAll("[aria-selected='true'], [data-selected='true'], input:checked")]
    .filter((element) => visible(element))
    .map((element) => text(element.closest("label, [role='tab'], [data-test*='fulfillment' i]") || element, 500));
  const shipping = selected.some((value) => /ship it|shipping|delivery/i.test(value));
  const pickup = selected.some((value) => /pick it up|pickup|pick-up/i.test(value));
  return shipping === pickup ? "unknown" : shipping ? "shipping" : "pickup";
}

function addControls(document: Document, sku: string): Element[] {
  const exact = /^\d{6,}$/.test(sku) ? document.getElementById(`addToCartButtonOrTextIdFor${sku}`) : null;
  const candidates = [
    exact,
    ...document.querySelectorAll("button[data-test='shipItButton'], button[data-test='orderPickupButton'], button[data-test*='addToCart' i]")
  ].filter((value): value is Element => Boolean(value));
  return [...new Set(candidates)].filter((candidate) => {
    if (!visible(candidate)) return false;
    if (candidate.closest("[data-test*='recommend' i], [data-testid*='carousel' i], [aria-label*='similar items' i]")) return false;
    const scopedSku = candidate.closest("[data-tcin]")?.getAttribute("data-tcin");
    return !scopedSku || scopedSku === sku;
  });
}

function selectedAddControl(document: Document, sku: string, required: Fulfillment): { control: Element | null; fulfillment: "shipping" | "pickup" | "unknown" } {
  const candidates = addControls(document, sku).map((control) => ({ control, fulfillment: controlFulfillment(control, document) }));
  const matching = candidates.find((entry) => required === "either"
    ? entry.fulfillment === "shipping" || entry.fulfillment === "pickup"
    : entry.fulfillment === required);
  return matching ?? candidates[0] ?? { control: null, fulfillment: "unknown" };
}

export function targetAddControl(
  document: Document,
  urlValue: string,
  expectedSku: string,
  requiredFulfillment: Fulfillment
): Element | null {
  if (extractTargetSku(urlValue) !== expectedSku) return null;
  const selected = selectedAddControl(document, expectedSku, requiredFulfillment);
  return actionable(selected.control) ? selected.control : null;
}

function closestOfferContainer(anchor: Element | null): Element | null {
  let current = anchor?.parentElement ?? null;
  for (let depth = 0; depth < 12 && current; depth += 1) {
    const scopedText = text(current, 60_000);
    const price = readPrice(current, [
      "[data-test='product-price']",
      "[data-test*='current-price' i]",
      "meta[itemprop='price']",
      "[itemprop='price']"
    ]);
    if (price !== null && scopedText.length < 40_000) return current;
    current = current.parentElement;
  }
  return null;
}

function sellerEvidence(document: Document, anchor: Element | null): { sellerName: string; sellerType: SellerType } {
  const cartRoot = anchor?.closest("[data-test='cart-item'], [data-test='cartItem'], [data-testid='cart-item']") ?? null;
  const offerRoot = cartRoot ? null : closestOfferContainer(anchor);
  const root = cartRoot || offerRoot || anchor?.closest("[data-test*='buy-box' i], [data-test='product-detail'], [data-test*='fulfillment' i]") || document;
  const region = queryVisible(root, ["[data-test*='sold-by' i]", "[data-test*='seller' i]", "[data-testid*='seller' i]"]);
  const seller = text(region, 500);
  const scope = text(root, 60_000);
  if (FIRST_PARTY_PATTERN.test(seller)) return { sellerName: "Target", sellerType: "first_party" };
  if (seller && MARKETPLACE_PATTERN.test(seller)) {
    const name = seller.replace(/^.*?sold\s+(?:and|&)\s+shipped\s+by\s*/i, "").replace(/^.*?sold\s+by\s*/i, "").trim();
    return { sellerName: name.slice(0, 160), sellerType: "third_party" };
  }
  if (MARKETPLACE_PATTERN.test(scope)) return { sellerName: seller.slice(0, 160), sellerType: "unknown" };
  if (cartRoot || offerRoot) return { sellerName: "Target", sellerType: "first_party" };
  if (!MARKETPLACE_PATTERN.test(text(document.body, 120_000))) return { sellerName: "Target", sellerType: "first_party" };
  return { sellerName: seller.slice(0, 160), sellerType: "unknown" };
}

export function observeTargetOffer(
  document: Document,
  urlValue: string,
  expectedSku: string,
  requiredFulfillment: Fulfillment,
  observedAt = new Date().toISOString()
): LiveOfferObservation {
  const pageSku = extractTargetSku(urlValue);
  const selected = pageSku === expectedSku
    ? selectedAddControl(document, expectedSku, requiredFulfillment)
    : { control: null, fulfillment: "unknown" as const };
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

export function observeTargetSelectedOfferScope(
  document: Document,
  urlValue: string,
  expectedSku: string,
  requiredFulfillment: Fulfillment = "either"
) {
  const pageSku = extractTargetSku(urlValue);
  if (!pageSku || pageSku !== expectedSku) throw new Error("The exact Target listing identity is unavailable.");
  const selected = selectedAddControl(document, expectedSku, requiredFulfillment);
  return selectedOfferScope(
    document,
    "target",
    pageSku,
    selected.control?.closest("[data-test='product-detail'], main") || document
  );
}

function lineSku(line: Element): string {
  const own = line.getAttribute("data-tcin");
  if (own && /^\d{6,}$/.test(own)) return own;
  for (const anchor of line.querySelectorAll("a[href]")) {
    const sku = extractTargetSku(anchor.getAttribute("href") || "");
    if (sku) return sku;
  }
  return "";
}

function lineQuantity(line: Element): number | null {
  const control = queryVisible(line, ["select[name*='quantity' i]", "input[name*='quantity' i]", "[data-test*='quantity' i]"]);
  const candidate = control?.getAttribute("value") || formControlValue(control) || text(control, 100);
  const match = String(candidate).match(/(?:qty|quantity)?\s*:?\s*(\d{1,2})/i);
  const quantity = Number(match?.[1]);
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= 99 ? quantity : null;
}

function cartLineElements(document: Document): Element[] {
  const candidates = [...document.querySelectorAll("[data-test='cart-item'], [data-test='cartItem'], [data-testid='cart-item'], [data-tcin][data-cart-line]")].filter(visible);
  return candidates.filter((candidate) => !candidates.some((other) => other !== candidate && other.contains(candidate)));
}

function targetCartVisiblyEmpty(document: Document): boolean {
  const root = queryVisible(document, [
    "[data-test*='empty-cart' i]",
    "[data-testid*='empty-cart' i]",
    "[data-test='cart-empty']",
    "main"
  ]);
  return Boolean(root && /(?:your )?cart is empty|no items in (?:your )?cart|cart has no items/i.test(text(root, 20_000)));
}

export function observeTargetCart(document: Document, observedAt = new Date().toISOString()): CartInventoryEvidence {
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
  const independentlyCounted = elements.length > 0
    ? new Set(elements).size === elements.length
    : targetCartVisiblyEmpty(document);
  return {
    contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
    observedAt,
    complete: independentlyCounted && lines.every((line) => Boolean(line.retailerSku)),
    independentlyCounted,
    independentLineCount: elements.length,
    lines
  };
}

function selectedEvidence(document: Document, selectors: string[]): string[] {
  return [...document.querySelectorAll(selectors.join(", "))]
    .filter(visible)
    .map((element) => text(element, 1_000))
    .filter(Boolean)
    .slice(0, 20);
}

function targetCheckoutFulfillment(document: Document): "shipping" | "pickup" | "unknown" {
  const selected = selectedEvidence(document, ["[data-test*='fulfillment' i][data-selected='true']", "input[name*='fulfillment' i]:checked"]);
  const page = text(queryVisible(document, ["[data-test='STEP_SHIPPING_CONTAINER']", "[data-test*='pickup' i]"]), 5_000);
  const evidence = [...selected, page].join(" ");
  const shipping = /shipping|delivery|ship it/i.test(evidence);
  const pickup = /pickup|pick-up|pick it up/i.test(evidence);
  return shipping === pickup ? "unknown" : shipping ? "shipping" : "pickup";
}

export async function observeTargetCheckout(
  document: Document,
  mission: TargetMissionIdentity,
  signFingerprint: FingerprintSigner,
  observedAt = new Date().toISOString()
): Promise<CheckoutEvidence> {
  if (typeof signFingerprint !== "function") throw new Error("Target checkout observation requires an in-memory fingerprint signer.");
  const fulfillment = targetCheckoutFulfillment(document);
  const destinationValues = fulfillment === "shipping"
    ? selectedEvidence(document, ["[data-test='cart-shipping-address']", "[data-test*='address-option' i][data-selected='true']", "input[name*='address' i]:checked"])
    : [];
  const pickupValues = fulfillment === "pickup"
    ? selectedEvidence(document, ["[data-test*='pickup-store' i]", "[data-test*='store' i][data-selected='true']"])
    : [];
  const paymentValues = selectedEvidence(document, [
    "[data-test^='IconPayment']",
    "[data-test*='payment' i][data-selected='true']",
    "input[name*='payment' i]:checked"
  ]);
  const cart = observeTargetCart(document, observedAt);
  const line = cart.lines.find((entry) => entry.retailerSku === mission.retailerSku);
  const substitutionControls = [...document.querySelectorAll("[data-test*='substitution' i], input[name*='substitution' i]")].filter(visible);
  const substitutionEnabled = substitutionControls.some((control) => (
    formControlChecked(control)
    || control.getAttribute("aria-checked") === "true"
    || control.getAttribute("data-selected") === "true"
    || control.getAttribute("data-enabled") === "true"
  ));
  const checkoutRoot = queryVisible(document, ["[data-test='checkout-container']", "[data-test='checkout-summary-container']", "main"]);
  const substitutions: CheckoutEvidence["substitutions"] = substitutionControls.length
    ? substitutionEnabled ? "enabled" : "disabled"
    : checkoutRoot ? "not-applicable" : "unknown";
  const unsafeChoices = [
    queryVisible(document, ["input[name*='membership' i]:checked", "[data-test*='trial' i][data-selected='true']"]) ? "membership_or_trial" : "",
    queryVisible(document, ["input[name*='gift' i]:checked", "[data-test*='gift' i][data-selected='true']"]) ? "gift_option" : "",
    queryVisible(document, ["input[name*='protection' i]:checked", "[data-test*='protection' i][data-selected='true']"]) ? "protection_plan" : ""
  ].filter(Boolean);
  const submit = queryVisible(document, ["button[data-test*='placeOrder' i]", "button[id*='placeOrder' i]"]);
  return {
    contractVersion: BROWSER_SAFETY_CONTRACT_VERSION,
    source: "visible-checkout-dom",
    observedAt,
    retailerId: "target",
    retailerSku: mission.retailerSku,
    fulfillment,
    destinationFingerprint: destinationValues.length ? await signFingerprint(destinationValues) : "",
    pickupStoreFingerprint: pickupValues.length ? await signFingerprint(pickupValues) : "",
    paymentInstrumentSetFingerprint: paymentValues.length ? await signFingerprint(paymentValues) : "",
    paymentInstrumentCount: paymentValues.length,
    substitutions,
    substitutionSku: mission.retailerSku,
    cartComplete: cart.complete,
    cartIndependentlyCounted: cart.independentlyCounted,
    cartLineCount: cart.lines.length,
    cartSku: line?.retailerSku ?? "",
    cartQuantity: line?.quantity ?? 0,
    orderTotalCents: readPrice(document, [
      "[data-test='order-summary-total']",
      "[data-test='orderTotal']",
      "[data-test='grand-total']",
      "[data-testid='order-total']",
      "[data-test='cart-summary-total']"
    ]),
    unsafeChoices,
    submitControlActionable: actionable(submit)
  };
}
