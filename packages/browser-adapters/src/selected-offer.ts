import {
  SELECTED_OFFER_SCOPE_VERSION,
  type SelectedOfferAttributeKey,
  type SelectedOfferScopeInput,
  type SupportedRetailerId
} from "../../contracts/src/index.js";

const EXACT_RETAILER_SKUS = new Set<SupportedRetailerId>([
  "target", "walmart", "amazon", "bestbuy", "ravensburger",
  "booksamillion", "pbandai", "pokemoncenter"
]);

const DIMENSIONS: ReadonlyArray<readonly [SelectedOfferAttributeKey, RegExp]> = [
  ["size", /(?:^|[^a-z])size(?:$|[^a-z])/i],
  ["color", /(?:^|[^a-z])colou?r(?:$|[^a-z])/i],
  ["edition", /(?:^|[^a-z])edition(?:$|[^a-z])/i],
  ["language", /(?:^|[^a-z])language(?:$|[^a-z])/i],
  ["pack", /(?:^|[^a-z])(?:pack(?:\s*count)?|multipack)(?:$|[^a-z])/i],
  ["condition", /(?:^|[^a-z])condition(?:$|[^a-z])/i],
  ["finish", /(?:^|[^a-z])finish(?:$|[^a-z])/i],
  ["style", /(?:^|[^a-z])style(?:$|[^a-z])/i]
];

const CONTROL_SELECTOR = "select, input[type='radio'], [role='radio'], [role='option'], button[aria-pressed], [aria-selected], [aria-checked], [data-selected]";

function visible(element: Element): boolean {
  if (element.closest("[hidden], [aria-hidden='true']")) return false;
  const style = (element as HTMLElement).style;
  return style?.display !== "none" && style?.visibility !== "hidden";
}

function clean(value: unknown, maximum = 120): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function associatedLabel(element: Element): string {
  const id = clean(element.getAttribute("id"), 100);
  const explicit = id
    ? [...element.ownerDocument.querySelectorAll("label[for]")].find((label) => label.getAttribute("for") === id)
    : null;
  return clean(explicit?.textContent || element.closest("label")?.textContent, 240);
}

function dimension(element: Element): SelectedOfferAttributeKey | null {
  const fieldset = element.closest("fieldset");
  const context = [
    element.getAttribute("name"), element.getAttribute("id"), element.getAttribute("aria-label"),
    element.getAttribute("data-testid"), element.getAttribute("data-attribute"),
    fieldset?.querySelector("legend")?.textContent, associatedLabel(element)
  ].map((value) => clean(value, 240)).filter(Boolean).join(" ");
  return DIMENSIONS.find(([, pattern]) => pattern.test(context))?.[0] ?? null;
}

function isSelected(element: Element): boolean {
  if (element.tagName === "SELECT") return true;
  if (element.tagName === "INPUT") return (element as HTMLInputElement).checked;
  return element.getAttribute("aria-selected") === "true"
    || element.getAttribute("aria-checked") === "true"
    || element.getAttribute("aria-pressed") === "true"
    || element.getAttribute("data-selected") === "true";
}

function selectedValue(element: Element): string {
  if (element.tagName === "SELECT") {
    const select = element as HTMLSelectElement;
    return clean(select.selectedOptions.length === 1
      ? select.selectedOptions[0]?.textContent || select.value : "");
  }
  const inputValue = element.tagName === "INPUT" ? (element as HTMLInputElement).value : "";
  return clean(
    element.getAttribute("data-value")
      || element.getAttribute("aria-label")
      || inputValue
      || associatedLabel(element)
      || element.textContent
  );
}

export function selectedOfferScope(
  document: Document,
  retailerId: SupportedRetailerId,
  retailerSku: string,
  root: ParentNode = document
): SelectedOfferScopeInput {
  const observed = new Map<SelectedOfferAttributeKey, { controls: number; values: Set<string> }>();
  for (const control of [...root.querySelectorAll(CONTROL_SELECTOR)].filter(visible).slice(0, 200)) {
    const key = dimension(control);
    if (!key) continue;
    const state = observed.get(key) ?? { controls: 0, values: new Set<string>() };
    state.controls += 1;
    if (isSelected(control)) {
      const value = selectedValue(control);
      if (value) state.values.add(value);
    }
    observed.set(key, state);
  }
  const attributes: Partial<Record<SelectedOfferAttributeKey, string>> = {};
  let unresolved = false;
  for (const [key, state] of [...observed].sort(([left], [right]) => left.localeCompare(right))) {
    if (state.values.size !== 1) {
      unresolved = true;
      continue;
    }
    attributes[key] = [...state.values][0] as string;
  }
  const hasAttributes = Object.keys(attributes).length > 0;
  return {
    schemaVersion: SELECTED_OFFER_SCOPE_VERSION,
    selectionState: unresolved ? "unresolved"
      : hasAttributes || EXACT_RETAILER_SKUS.has(retailerId) ? "exact" : "listing_only",
    childOfferKey: clean(retailerSku, 120),
    attributes
  };
}
