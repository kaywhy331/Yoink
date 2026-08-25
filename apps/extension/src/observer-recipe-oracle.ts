export const OBSERVER_RECIPE_ORACLE_PROFILE = "packaged_structured_oracle_v1" as const;

const FIELD_ORDER = ["availability", "unitPrice", "seller", "fulfillment", "addControl"] as const;
type Field = (typeof FIELD_ORDER)[number];
type NormalizedValue = string | number | boolean;

interface RecipeField {
  mode: "text" | "attribute" | "presence" | "disabled_state";
  selectors: string[];
  attribute?: "aria-label" | "content" | "data-testid" | "data-automation-id";
}

export interface PackagedObserverEvidence {
  retailerSku: string;
  availability: string;
  unitPriceCents: number | null;
  sellerName: string;
  fulfillment: string;
  addControlActionable: boolean;
  known: Record<Field, boolean>;
}

export interface ObserverRecipeFieldOutcome {
  field: Field;
  recipeState: "value" | "missing" | "ambiguous" | "unrecognized";
  packagedState: "agreed" | "conflict" | "missing" | "not_evaluated";
  oracleState: "agreed" | "conflict" | "missing" | "ambiguous" | "not_evaluated";
  disposition: "verified" | "conflict" | "insufficient";
}

export interface ObserverRecipeOracleEvaluation {
  validationProfile: typeof OBSERVER_RECIPE_ORACLE_PROFILE;
  evaluatedFieldCount: number;
  agreedFieldCount: number;
  ambiguousFieldCount: number;
  oracleEvaluatedFieldCount: number;
  oracleAgreedFieldCount: number;
  oracleConflictFieldCount: number;
  packagedMissingFieldCount: number;
  packagedConflictFieldCount: number;
  insufficientFieldCount: number;
  fieldOutcomes: ObserverRecipeFieldOutcome[];
  shape: string;
}

interface ReadResult {
  state: "value" | "missing" | "ambiguous" | "unrecognized";
  value?: NormalizedValue;
}

interface OracleResult {
  state: "value" | "missing" | "ambiguous";
  value?: NormalizedValue;
}

function tidy(value: unknown, maximum = 300): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function visible(document: Document, element: Element): boolean {
  if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") return false;
  const view = document.defaultView;
  if (!view) return true;
  const style = view.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function parseAvailability(value: unknown): string | null {
  const text = tidy(value).toLocaleLowerCase("en-US");
  if (!text) return null;
  if (/out[ _-]?of[ _-]?stock|sold[ _-]?out|unavailable|discontinued/.test(text)) return "out_of_stock";
  if (/pre[ _-]?order|presale/.test(text)) return "preorder";
  if (/in[ _-]?stock|limited[ _-]?availability|available|add to (?:cart|bag|basket)/.test(text)) return "in_stock";
  return null;
}

function parsePrice(value: unknown): number | null {
  const text = tidy(value).replace(/,/g, "");
  const match = text.match(/(?:US\$|\$|USD\s*)(\d{1,7})(?:\.(\d{2}))?/i)
    ?? text.match(/^\s*(\d{1,7})\.(\d{2})\s*$/);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] || "00").padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

function parseFulfillment(value: unknown): string | null {
  const text = tidy(value).toLocaleLowerCase("en-US");
  if (/pick[ _-]?up|curbside|on[ _-]?site/.test(text)) return "pickup";
  if (/ship|delivery|parcel|freight|mail/.test(text)) return "shipping";
  return null;
}

function normalizedSeller(value: unknown): string | null {
  const original = tidy(value, 160).toLocaleLowerCase("en-US");
  const soldBy = original.match(/\bsold by\s*:?\s*(.+)$/)?.[1];
  const seller = (soldBy ?? original)
    .replace(/^(?:seller|merchant|vendor)\s*:?\s*/, "")
    .replace(/[.·|\s]+$/g, "")
    .trim();
  return seller && seller !== "unknown" ? seller : null;
}

function comparable(field: Field, value: unknown): NormalizedValue | null {
  if (field === "availability") return parseAvailability(value);
  if (field === "unitPrice") return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value : parsePrice(value);
  if (field === "seller") return normalizedSeller(value);
  if (field === "fulfillment") return parseFulfillment(value);
  if (field === "addControl") return typeof value === "boolean" ? value : null;
  return null;
}

function equal(field: Field, left: NormalizedValue, right: NormalizedValue): boolean {
  return left === right;
}

function elementText(element: Element, definition: RecipeField): string {
  if (definition.mode === "attribute") return tidy(element.getAttribute(definition.attribute ?? ""));
  if (element instanceof (element.ownerDocument.defaultView?.HTMLInputElement ?? Object)) {
    const input = element as HTMLInputElement;
    return tidy(input.value || input.getAttribute("aria-label") || input.textContent);
  }
  return tidy(element.textContent || element.getAttribute("aria-label"));
}

function readRecipeField(document: Document, field: Field, definition: RecipeField): ReadResult {
  const elements = new Set<Element>();
  let ambiguous = false;
  for (const selector of definition.selectors) {
    let matches: Element[];
    try {
      matches = [...document.querySelectorAll(selector)].filter((element) => visible(document, element));
    } catch {
      return { state: "ambiguous" };
    }
    if (matches.length > 1) ambiguous = true;
    for (const match of matches.slice(0, 2)) elements.add(match);
  }
  if (ambiguous || elements.size > 1) return { state: "ambiguous" };
  const element = [...elements][0];
  if (!element) return { state: "missing" };
  let value: NormalizedValue | null;
  if (field === "availability") {
    value = definition.mode === "presence" ? "in_stock"
      : definition.mode === "disabled_state"
        ? ((element as HTMLButtonElement).disabled || element.getAttribute("aria-disabled") === "true" ? "out_of_stock" : "in_stock")
        : comparable(field, elementText(element, definition));
  } else if (field === "fulfillment" && definition.mode === "presence") {
    value = "shipping";
  } else if (field === "addControl") {
    value = definition.mode === "presence" ? true
      : definition.mode === "disabled_state"
        ? !((element as HTMLButtonElement).disabled || element.getAttribute("aria-disabled") === "true")
        : /add to (?:cart|bag|basket)|pre[ -]?order/i.test(elementText(element, definition));
  } else {
    value = comparable(field, elementText(element, definition));
  }
  return value === null ? { state: "unrecognized" } : { state: "value", value };
}

function types(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value]).map((item) => tidy(item).toLocaleLowerCase("en-US"));
}

function objectIdentifiers(value: Record<string, unknown>): string[] {
  return [value.sku, value.productID, value.productId, value.asin, value.mpn]
    .map((item) => tidy(item).toLocaleUpperCase("en-US"))
    .filter(Boolean);
}

function childObjects(value: unknown, limit = 1_000): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const queue: unknown[] = [value];
  const seen = new Set<object>();
  while (queue.length && found.length < limit) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      queue.push(...current.slice(0, 100));
      continue;
    }
    const object = current as Record<string, unknown>;
    found.push(object);
    queue.push(...Object.values(object).slice(0, 100));
  }
  return found;
}

function semanticValue(element: Element): string {
  return tidy(element.getAttribute("content") || element.getAttribute("href")
    || element.getAttribute("value") || element.getAttribute("aria-label") || element.textContent);
}

function semanticOracle(document: Document, expected: PackagedObserverEvidence): Record<Field, OracleResult> {
  const values: Record<Field, Set<NormalizedValue>> = {
    availability: new Set(), unitPrice: new Set(), seller: new Set(), fulfillment: new Set(), addControl: new Set()
  };
  const ambiguous = new Set<Field>();
  const add = (field: Field, value: unknown): void => {
    let normalized: NormalizedValue | null;
    if (field === "unitPrice" && typeof value === "number") {
      const cents = Math.round(value * 100);
      normalized = Number.isFinite(value) && value > 0 && Number.isSafeInteger(cents)
        && Math.abs(cents / 100 - value) < 0.000_001 ? cents : null;
    } else if (field === "unitPrice" && /^\d{1,7}(?:\.\d{1,2})?$/.test(tidy(value))) {
      const [dollars = "", fraction = ""] = tidy(value).split(".");
      const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, "0"));
      normalized = Number.isSafeInteger(cents) && cents > 0 ? cents : null;
    } else {
      normalized = comparable(field, value);
    }
    if (normalized !== null) values[field].add(normalized);
  };
  const documents: unknown[] = [];
  for (const script of [...document.querySelectorAll("script[type='application/ld+json']")].slice(0, 20)) {
    const body = script.textContent ?? "";
    if (!body || body.length > 200_000) continue;
    try { documents.push(JSON.parse(body) as unknown); } catch { /* malformed structured data is no oracle */ }
  }
  const objects = documents.flatMap((value) => childObjects(value));
  const products = objects.filter((object) => types(object["@type"]).some((type) => type.endsWith("product")));
  const exactProducts = products.filter((product) => objectIdentifiers(product).includes(expected.retailerSku.toLocaleUpperCase("en-US")));
  const selectedProducts = exactProducts.length === 1 ? exactProducts : exactProducts.length > 1 ? [] : products.length === 1 ? products : [];
  const standaloneOffers = products.length === 0
    ? objects.filter((object) => types(object["@type"]).some((type) => type.endsWith("offer"))) : [];
  const structuredRoots = selectedProducts.length
    ? selectedProducts.flatMap((product) => [product, ...childObjects(product.offers, 250)])
    : standaloneOffers.length === 1 ? standaloneOffers : [];
  for (const object of structuredRoots) {
    add("availability", object.availability);
    add("unitPrice", object.price);
    if (object.priceSpecification && typeof object.priceSpecification === "object") {
      add("unitPrice", (object.priceSpecification as Record<string, unknown>).price);
    }
    const seller = object.seller ?? object.offeredBy;
    add("seller", seller && typeof seller === "object" ? (seller as Record<string, unknown>).name : seller);
    const deliveryMethod = object.availableDeliveryMethod;
    add("fulfillment", deliveryMethod && typeof deliveryMethod === "object"
      ? ((deliveryMethod as Record<string, unknown>)["@type"] ?? (deliveryMethod as Record<string, unknown>).name)
      : deliveryMethod);
    if (object.shippingDetails) add("fulfillment", "shipping");
  }

  const productScopes = [...document.querySelectorAll("[itemscope][itemtype*='Product'], [itemtype$='/Product']")];
  const exactScopes = productScopes.filter((scope) => [...scope.querySelectorAll("[itemprop='sku'], [itemprop='productID']")]
    .some((element) => semanticValue(element).toLocaleUpperCase("en-US") === expected.retailerSku.toLocaleUpperCase("en-US")));
  const scope: ParentNode = exactScopes.length === 1 ? exactScopes[0] as Element
    : exactScopes.length > 1 ? document.createDocumentFragment()
      : productScopes.length === 1 ? productScopes[0] as Element
        : productScopes.length > 1 ? document.createDocumentFragment() : document;
  const semantic = (selector: string): Element[] => [...scope.querySelectorAll(selector)].filter((element) => visible(document, element));
  for (const element of semantic("[itemprop='availability'], meta[property='product:availability']")) add("availability", semanticValue(element));
  for (const element of semantic("[itemprop='price'], meta[property='product:price:amount'], meta[property='og:price:amount']")) add("unitPrice", semanticValue(element));
  for (const element of semantic("[itemprop='seller'], [itemprop='offeredBy']")) {
    add("seller", element.querySelector("[itemprop='name']") ? semanticValue(element.querySelector("[itemprop='name']") as Element) : semanticValue(element));
  }
  for (const element of semantic("[itemprop='availableDeliveryMethod'], [itemprop='shippingDetails']")) add("fulfillment", semanticValue(element) || "shipping");

  const addControls = semantic("button, [role='button'], input[type='submit'], input[type='button']")
    .filter((element) => /(?:^|\b)(?:add to (?:cart|bag|basket)|pre[ -]?order)(?:\b|$)/i.test(semanticValue(element)));
  if (addControls.length === 1) {
    const control = addControls[0] as HTMLButtonElement;
    add("addControl", !(control.disabled || control.getAttribute("aria-disabled") === "true"));
  } else if (addControls.length > 1) {
    ambiguous.add("addControl");
  }

  return Object.fromEntries(FIELD_ORDER.map((field) => {
    if (ambiguous.has(field) || values[field].size > 1) return [field, { state: "ambiguous" }];
    const value = [...values[field]][0];
    return [field, value === undefined ? { state: "missing" } : { state: "value", value }];
  })) as Record<Field, OracleResult>;
}

function expectedValue(field: Field, expected: PackagedObserverEvidence): NormalizedValue | null {
  if (field === "unitPrice") return expected.unitPriceCents;
  if (field === "seller") return normalizedSeller(expected.sellerName);
  if (field === "addControl") return expected.addControlActionable;
  return comparable(field, expected[field]);
}

export function evaluateObserverRecipeEvidence(
  document: Document,
  fields: Partial<Record<Field, RecipeField>>,
  expected: PackagedObserverEvidence
): ObserverRecipeOracleEvaluation {
  const oracle = semanticOracle(document, expected);
  const fieldOutcomes: ObserverRecipeFieldOutcome[] = [];
  for (const field of FIELD_ORDER) {
    const definition = fields[field];
    if (!definition) continue;
    const recipe = readRecipeField(document, field, definition);
    if (recipe.state !== "value" || recipe.value === undefined) {
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
    const packagedState = packagedKnown ? "agreed" as const : "missing" as const;
    const oracleRead = oracle[field];
    if (oracleRead.state === "ambiguous") {
      fieldOutcomes.push({ field, recipeState: "value", packagedState, oracleState: "ambiguous", disposition: "insufficient" });
    } else if (oracleRead.state === "missing" || oracleRead.value === undefined) {
      fieldOutcomes.push({
        field,
        recipeState: "value",
        packagedState,
        oracleState: "missing",
        disposition: packagedKnown ? "verified" : "insufficient"
      });
    } else if (equal(field, recipe.value, oracleRead.value)) {
      fieldOutcomes.push({ field, recipeState: "value", packagedState, oracleState: "agreed", disposition: "verified" });
    } else {
      fieldOutcomes.push({ field, recipeState: "value", packagedState, oracleState: "conflict", disposition: "conflict" });
    }
  }
  const count = (predicate: (item: ObserverRecipeFieldOutcome) => boolean): number => fieldOutcomes.filter(predicate).length;
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
    shape: fieldOutcomes.map((item) => `${item.field}:${item.recipeState}:${item.packagedState}:${item.oracleState}:${item.disposition}`).join("|")
  };
}

Object.defineProperty(globalThis, "YoinkObserverRecipeOracle", {
  value: Object.freeze({ evaluateObserverRecipeEvidence }),
  configurable: true
});
