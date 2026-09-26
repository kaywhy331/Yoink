import type { AdapterEnvironment } from "../../contracts/src/index.js";

// Shared DOM helpers for the store adapters. Each helper here replaces a
// hand-copied variant that had started to drift between adapters.

/**
 * Rendered visibility: the node and every ancestor must not be hidden, inert,
 * aria-hidden, display:none, visibility:hidden/collapse or fully transparent.
 * A throwing `environment.isVisible` hook counts as not visible.
 */
export function renderedVisible(element: Element, environment?: AdapterEnvironment): boolean {
  if (environment?.isVisible) {
    try { return environment.isVisible(element); } catch { return false; }
  }
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute("hidden") || node.hasAttribute("inert") || node.getAttribute("aria-hidden") === "true") return false;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style && (style.display === "none" || ["hidden", "collapse"].includes(style.visibility) || style.opacity === "0")) return false;
  }
  return true;
}

// The number may carry trailing decoration without digits ("Qty 1 ⌄",
// "Qty 1 Edit", "1 in cart"); any second number makes the text unreadable.
const QUANTITY_TEXT = /^\s*(?:qty|quantity)?\s*:?\s*(\d{1,2})(?!\d)[^\d]{0,24}$/i;

/** Parses "1", "Qty 1", "Quantity: 2", "Qty 1 ⌄". Anything else, including "Quantity 100", is null. */
export function parseQuantityText(value: unknown): number | null {
  const match = String(value ?? "").replace(/\s+/g, " ").match(QUANTITY_TEXT);
  const quantity = Number(match?.[1]);
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= 99 ? quantity : null;
}

const STEPPER_TEXT = /\b(?:increase|decrease|increment|decrement|add one|remove one|plus|minus)\b(?:\s+(?:the\s+)?(?:quantity|qty))?|[+\-\u2212\u2013]/gi;

/** Reads the lone number between stepper labels: "Decrease quantity 1 Increase quantity" is 1. */
export function parseStepperText(value: unknown): number | null {
  return parseQuantityText(String(value ?? "").replace(STEPPER_TEXT, " "));
}

/** Store-agnostic quantity controls, used when a selector pack matches nothing. */
export const GENERIC_QUANTITY_SELECTORS: readonly string[] = Object.freeze([
  "select[name*='quantity' i]",
  "select[name*='qty' i]",
  "select[aria-label*='quantity' i]",
  "input[name*='quantity' i]",
  "input[name*='qty' i]",
  "input[aria-label*='quantity' i]",
  "[role='spinbutton']",
  "button[aria-label*='quantity' i]",
  "[role='combobox'][aria-label*='quantity' i]"
]);

const FORM_CONTROL = "select, input:not([type='checkbox']):not([type='radio']):not([type='submit']):not([type='button'])";
const STEPPER_LABEL = /\b(?:increase|decrease|increment|decrement|add one|remove one|plus|minus)\b/i;

function controlLike(element: Element): boolean {
  const role = String(element.getAttribute("role") || "").toLocaleLowerCase("en-US");
  return element.matches(FORM_CONTROL)
    || element.tagName === "BUTTON"
    || ["spinbutton", "combobox", "button", "listbox"].includes(role)
    || element.hasAttribute("aria-valuenow")
    || Boolean(element.querySelector(FORM_CONTROL));
}

const QUANTITY_HINT = /qty|quantity/i;

function indicatesQuantity(element: Element): boolean {
  return ["name", "id", "aria-label", "data-test", "data-testid", "data-automation-id"]
    .some((attribute) => QUANTITY_HINT.test(element.getAttribute(attribute) || ""));
}

function hiddenInput(element: Element): boolean {
  return element.tagName === "INPUT" && String(element.getAttribute("type") || "").toLocaleLowerCase("en-US") === "hidden";
}

function rawFormValue(element: Element): string {
  return String((element as HTMLInputElement | HTMLSelectElement).value ?? "").trim();
}

/** A hidden quantity input with no value is a placeholder, not a reading. */
function emptyHiddenQuantity(element: Element): boolean {
  return hiddenInput(element) && rawFormValue(element) === "";
}

function formValue(element: Element): number | null {
  const value = rawFormValue(element);
  return /^\d{1,2}$/.test(value) ? parseQuantityText(value) : null;
}

/**
 * Reads the controls inside a quantity wrapper. Controls that name quantity
 * win; otherwise unrelated hidden inputs (a tcin, a form token) are ignored.
 * `undefined` means the wrapper holds no quantity form control at all.
 */
function innerQuantity(element: Element): number | null | undefined {
  const controls = [...element.querySelectorAll(FORM_CONTROL)];
  const named = controls.filter(indicatesQuantity);
  const pool = named.length ? named : controls.filter((control) => !hiddenInput(control));
  if (!pool.length) return undefined;
  const readable = pool.filter((control) => !emptyHiddenQuantity(control));
  if (!readable.length) return null;
  const values = readable.map(formValue);
  return values.every((value) => value !== null && value === values[0]) ? values[0] ?? null : null;
}

/**
 * Quantity shown by one control or control wrapper: its form value, an inner
 * control, aria-valuenow, a value attribute, a quantity aria-label, then the
 * text with stepper labels removed. An authoritative source that is present
 * but unreadable is null; it never falls through to a looser one.
 */
export function readControlQuantity(element: Element | null): number | null {
  if (!element) return null;
  if (element.matches(FORM_CONTROL)) return formValue(element);
  const inner = innerQuantity(element);
  if (inner !== undefined) return inner;
  const valueNow = element.getAttribute("aria-valuenow") ?? element.querySelector("[aria-valuenow]")?.getAttribute("aria-valuenow") ?? null;
  if (valueNow !== null && valueNow.trim()) return parseQuantityText(valueNow);
  const value = element.getAttribute("value");
  if (value && /^\s*\d+\s*$/.test(value)) return parseQuantityText(value);
  const labelled = parseQuantityText(element.getAttribute("aria-label"));
  if (labelled !== null) return labelled;
  return parseStepperText(String(element.textContent || "").slice(0, 100));
}

/**
 * Proves the product page will add exactly one unit. Quantity controls are
 * found through the store's selectors plus a generic fallback, so selector rot
 * does not silently read as "no picker". Fails closed when a quantity control
 * exists and any reading is not 1, or when it cannot be read at all (including
 * a +/- stepper with no readable value). No quantity control at all means the
 * store adds its default single unit.
 */
export function quantityIsOne(
  root: ParentNode,
  selectors: readonly string[],
  isVisible: (element: Element) => boolean,
  exclude: (element: Element) => boolean = () => false,
  generic = true
): boolean {
  const selector = [...new Set([...selectors, ...(generic ? GENERIC_QUANTITY_SELECTORS : [])])].join(", ");
  let candidates: Element[];
  try {
    candidates = [...root.querySelectorAll(selector)];
  } catch {
    return false;
  }
  candidates = [...new Set(candidates)]
    .filter((element) => (element.tagName === "INPUT" || isVisible(element)) && !exclude(element) && controlLike(element));
  let steppers = 0;
  let placeholders = 0;
  const readings: number[] = [];
  for (const candidate of candidates) {
    if (candidate.tagName === "BUTTON" || candidate.getAttribute("role") === "button") {
      if (STEPPER_LABEL.test(`${candidate.getAttribute("aria-label") || ""} ${candidate.textContent || ""}`)) {
        steppers += 1;
        continue;
      }
    }
    if (emptyHiddenQuantity(candidate)) {
      placeholders += 1;
      continue;
    }
    const reading = readControlQuantity(candidate);
    if (reading === null) return false;
    readings.push(reading);
  }
  // A stepper or an empty hidden quantity input only passes beside a visible
  // control that reads 1; alone it is an unreadable quantity.
  if ((steppers > 0 || placeholders > 0) && readings.length === 0) return false;
  return readings.every((reading) => reading === 1);
}
