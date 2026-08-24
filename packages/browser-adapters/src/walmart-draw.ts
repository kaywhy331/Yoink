import {
  WALMART_DRAW_OBSERVER_VERSION,
  type SellerType,
  type WalmartDrawItemObservationInput,
  type WalmartDrawScanInput,
  type WalmartDrawState
} from "../../contracts/src/index.js";
import { retailerInteractiveBlock, retailerSecurityChallenge } from "./retailers.js";

export { WALMART_DRAW_OBSERVER_VERSION };

const HUB_PATH = "/shop/collectibles/draw";
const MAX_ITEMS = 24;

function cleanText(value: unknown, maximum: number): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function finiteInteger(value: unknown, minimum: number, maximum: number): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function validHubUrl(urlValue: string): boolean {
  try {
    const url = new URL(urlValue);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && (url.hostname === "walmart.com" || url.hostname.endsWith(".walmart.com"))
      && url.pathname.replace(/\/+$/, "") === HUB_PATH;
  } catch {
    return false;
  }
}

function drawState(value: unknown): WalmartDrawState {
  const normalized = cleanText(value, 160).toLocaleLowerCase("en-US");
  if (/\bactive\b|\bcurrent\b/.test(normalized)) return "active";
  if (/\bupcoming\b|\bcoming soon\b/.test(normalized)) return "upcoming";
  if (/\bclosed\b|\bprevious\b/.test(normalized)) return "closed";
  return "unknown";
}

function seller(value: unknown): { sellerName: string; sellerType: SellerType } {
  const name = cleanText(value, 160);
  if (/^walmart(?:\.com)?$/i.test(name)) return { sellerName: "Walmart", sellerType: "first_party" };
  return name ? { sellerName: name, sellerType: "third_party" } : { sellerName: "", sellerType: "unknown" };
}

function priceCents(product: Record<string, unknown>): number | null {
  const direct = Number(product.price);
  if (Number.isFinite(direct) && direct >= 0 && direct <= 1_000_000) return Math.round(direct * 100);
  const priceInfo = product.priceInfo && typeof product.priceInfo === "object"
    ? product.priceInfo as Record<string, unknown> : {};
  const display = cleanText(priceInfo.linePriceDisplay ?? priceInfo.linePrice, 80);
  const match = display.replace(/,/g, "").match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1_000_000 ? Math.round(parsed * 100) : null;
}

function losAngelesDateParts(observedAt: string): { year: number; month: number; day: number } | null {
  const date = new Date(observedAt);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const result = { year: value("year"), month: value("month"), day: value("day") };
  return Object.values(result).every(Number.isInteger) ? result : null;
}

export function parseWalmartDrawCloseAt(labelValue: unknown, observedAt: string): string | null {
  const label = cleanText(labelValue, 100);
  const match = label.match(/^(today|tomorrow|([A-Za-z]{3})\s+(\d{1,2})),\s*(\d{1,2}):(\d{2})\s*(am|pm)\s*(PDT|PST)$/i);
  const base = losAngelesDateParts(observedAt);
  if (!match || !base) return null;
  const relative = match[1] || "";
  const meridiem = match[6] || "";
  const zone = match[7] || "";
  let { year, month, day } = base;
  if (/^tomorrow$/i.test(relative)) {
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    year = next.getUTCFullYear();
    month = next.getUTCMonth() + 1;
    day = next.getUTCDate();
  } else if (match[2]) {
    const monthIndex = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
      .indexOf(match[2].toLocaleLowerCase("en-US"));
    const namedDay = Number(match[3]);
    if (monthIndex < 0 || namedDay < 1 || namedDay > 31) return null;
    month = monthIndex + 1;
    day = namedDay;
    const candidate = Date.UTC(year, month - 1, day);
    const baseDate = Date.UTC(base.year, base.month - 1, base.day);
    if (candidate < baseDate - 180 * 86_400_000) year += 1;
  }
  let hour = Number(match[4]);
  const minute = Number(match[5]);
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  if (/pm/i.test(meridiem) && hour !== 12) hour += 12;
  if (/am/i.test(meridiem) && hour === 12) hour = 0;
  const offsetHours = zone.toUpperCase() === "PDT" ? -7 : -8;
  const timestamp = Date.UTC(year, month - 1, day, hour - offsetHours, minute);
  const result = new Date(timestamp);
  return Number.isFinite(result.getTime()) ? result.toISOString() : null;
}

function drawBadge(product: Record<string, unknown>): Record<string, unknown> | null {
  const badges = product.badges && typeof product.badges === "object"
    ? product.badges as Record<string, unknown> : {};
  const groups = Array.isArray(badges.groups) ? badges.groups : [];
  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    const members = Array.isArray((group as Record<string, unknown>).members)
      ? (group as Record<string, unknown>).members as unknown[] : [];
    for (const member of members) {
      if (member && typeof member === "object" && cleanText((member as Record<string, unknown>).key, 80) === "DRAW_ELIGIBLE") {
        return member as Record<string, unknown>;
      }
    }
  }
  return null;
}

function structuredItem(
  product: Record<string, unknown>,
  state: WalmartDrawState,
  observedAt: string
): WalmartDrawItemObservationInput | null {
  const retailerSku = cleanText(product.usItemId ?? product.id, 24);
  if (!/^\d{5,20}$/.test(retailerSku)) return null;
  const title = cleanText(product.name, 300);
  if (!title) return null;
  const sellerEvidence = seller(product.sellerName);
  const badge = drawBadge(product);
  const closeLabel = badge ? cleanText(badge.slaText, 100) : "";
  const condition = product.conditionV2 && typeof product.conditionV2 === "object"
    ? product.conditionV2 as Record<string, unknown> : {};
  const drawControlPresent = product.showDrawCTA === true || Boolean(badge);
  return {
    retailerSku,
    title,
    unitPriceCents: priceCents(product),
    currency: "USD",
    sellerName: sellerEvidence.sellerName,
    sellerType: sellerEvidence.sellerType,
    drawState: state,
    closesAt: parseWalmartDrawCloseAt(closeLabel, observedAt),
    conditionCode: finiteInteger(condition.code, 0, 9_999_999),
    conditionGroupCode: finiteInteger(condition.groupCode, 0, 9_999),
    orderMinLimit: finiteInteger(product.orderMinLimit, 1, 99),
    orderMaxLimit: finiteInteger(product.orderLimit, 1, 99),
    drawControlPresent,
    addControlSuppressed: product.showAtc === false && product.canAddToCart === false
  };
}

function parseNextData(documentValue: Document, observedAt: string): {
  moduleFound: boolean;
  expectedCardCount: number;
  rejectedCount: number;
  items: WalmartDrawItemObservationInput[];
} | null {
  const script = documentValue.querySelector("script#__NEXT_DATA__");
  if (!script) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(script.textContent || "");
  } catch {
    return { moduleFound: false, expectedCardCount: 0, rejectedCount: 1, items: [] };
  }
  const root = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const props = root.props && typeof root.props === "object" ? root.props as Record<string, unknown> : {};
  const pageProps = props.pageProps && typeof props.pageProps === "object" ? props.pageProps as Record<string, unknown> : {};
  const initialData = pageProps.initialData && typeof pageProps.initialData === "object"
    ? pageProps.initialData as Record<string, unknown> : {};
  const contentLayout = initialData.contentLayout && typeof initialData.contentLayout === "object"
    ? initialData.contentLayout as Record<string, unknown> : {};
  const modules = Array.isArray(contentLayout.modules) ? contentLayout.modules.slice(0, 60) : [];
  const items: WalmartDrawItemObservationInput[] = [];
  let moduleFound = false;
  let expectedCardCount = 0;
  let rejectedCount = 0;
  for (const moduleValue of modules) {
    if (!moduleValue || typeof moduleValue !== "object") continue;
    const module = moduleValue as Record<string, unknown>;
    const configs = module.configs && typeof module.configs === "object" ? module.configs as Record<string, unknown> : {};
    const productsConfig = configs.productsConfig && typeof configs.productsConfig === "object"
      ? configs.productsConfig as Record<string, unknown> : {};
    const products = Array.isArray(productsConfig.products) ? productsConfig.products.slice(0, MAX_ITEMS) : [];
    const state = drawState(configs.title ?? module.name);
    const drawProducts = products.filter((value) => value && typeof value === "object"
      && ((value as Record<string, unknown>).showDrawCTA === true || Boolean(drawBadge(value as Record<string, unknown>))));
    if (state !== "unknown" || drawProducts.length > 0) moduleFound = moduleFound || /draw/i.test(cleanText(configs.title ?? module.name, 160));
    if (drawProducts.length === 0) continue;
    expectedCardCount += drawProducts.length;
    for (const value of drawProducts) {
      const item = structuredItem(value as Record<string, unknown>, state === "unknown" ? "active" : state, observedAt);
      if (item) items.push(item);
      else rejectedCount += 1;
    }
  }
  return { moduleFound, expectedCardCount, rejectedCount, items };
}

function domFallback(documentValue: Document, observedAt: string): WalmartDrawItemObservationInput[] {
  const results: WalmartDrawItemObservationInput[] = [];
  for (const element of [...documentValue.querySelectorAll("[data-item-id]")].slice(0, MAX_ITEMS)) {
    const retailerSku = cleanText(element.getAttribute("data-item-id"), 24);
    if (!/^\d{5,20}$/.test(retailerSku)) continue;
    const title = cleanText(element.querySelector("[data-automation-id='product-title']")?.textContent
      ?? element.querySelector("[data-testid='productTileImage']")?.getAttribute("alt"), 300);
    if (!title) continue;
    const priceText = cleanText(element.querySelector("[data-automation-id='product-price']")?.textContent, 300);
    const priceMatch = priceText.replace(/,/g, "").match(/(?:current price\s*)?\$\s*(\d+(?:\.\d{1,2})?)/i);
    const numericPrice = Number(priceMatch?.[1]);
    const closeLabel = cleanText(element.textContent, 2_000).match(/Drawing ends\s+([^|]{1,80})/i)?.[1] || "";
    results.push({
      retailerSku,
      title,
      unitPriceCents: Number.isFinite(numericPrice) ? Math.round(numericPrice * 100) : null,
      currency: "USD",
      sellerName: "",
      sellerType: "unknown",
      drawState: "active",
      closesAt: parseWalmartDrawCloseAt(closeLabel, observedAt),
      conditionCode: null,
      conditionGroupCode: null,
      orderMinLimit: null,
      orderMaxLimit: null,
      drawControlPresent: /Drawing ends/i.test(cleanText(element.textContent, 2_000)),
      addControlSuppressed: element.querySelector("button[aria-label*='add to cart' i], button[data-automation-id='atc']") === null
    });
  }
  return results;
}

export function observeWalmartDrawHub(
  documentValue: Document,
  urlValue: string,
  observedAt = new Date().toISOString()
): WalmartDrawScanInput {
  if (!validHubUrl(urlValue)) throw new Error("Open the exact Walmart Collectibles Draw hub before inspecting drawings.");
  const securityChallenge = retailerSecurityChallenge(documentValue) || Boolean(documentValue.querySelector(
    "iframe[title*='human verification' i], button[aria-label*='human challenge' i]"
  ));
  const interactiveBlock = retailerInteractiveBlock(documentValue, urlValue);
  if (securityChallenge || interactiveBlock) {
    return {
      adapterVersion: WALMART_DRAW_OBSERVER_VERSION,
      contractVersion: 1,
      observedAt,
      pageKind: "walmart_draw_hub",
      outcome: "manual",
      reasonCode: securityChallenge ? "security_challenge" : `interactive_${interactiveBlock}`,
      expectedCardCount: 0,
      observedCardCount: 0,
      securityChallenge,
      interactiveBlock,
      items: []
    };
  }
  const structured = parseNextData(documentValue, observedAt);
  const sourceItems = structured?.items.length ? structured.items : domFallback(documentValue, observedAt);
  const unique = new Map<string, WalmartDrawItemObservationInput>();
  let conflict = false;
  for (const item of sourceItems) {
    const existing = unique.get(item.retailerSku);
    if (!existing) unique.set(item.retailerSku, item);
    else if (JSON.stringify(existing) !== JSON.stringify(item)) conflict = true;
  }
  const items = [...unique.values()].slice(0, MAX_ITEMS);
  const expectedCardCount = structured?.expectedCardCount || sourceItems.length;
  const incomplete = conflict || Boolean(structured?.rejectedCount)
    || items.some((item) => item.unitPriceCents === null || item.sellerType === "unknown"
      || item.closesAt === null || !item.drawControlPresent || !item.addControlSuppressed);
  if (items.length === 0 && !structured?.moduleFound) {
    return {
      adapterVersion: WALMART_DRAW_OBSERVER_VERSION,
      contractVersion: 1,
      observedAt,
      pageKind: "walmart_draw_hub",
      outcome: "failed",
      reasonCode: structured ? "draw_module_missing" : "draw_payload_missing",
      expectedCardCount,
      observedCardCount: 0,
      securityChallenge: false,
      interactiveBlock: "",
      items: []
    };
  }
  return {
    adapterVersion: WALMART_DRAW_OBSERVER_VERSION,
    contractVersion: 1,
    observedAt,
    pageKind: "walmart_draw_hub",
    outcome: incomplete ? "partial" : "passed",
    reasonCode: items.length === 0 ? "no_active_drawings" : incomplete ? "draw_binding_incomplete" : "verified",
    expectedCardCount,
    observedCardCount: items.length,
    securityChallenge: false,
    interactiveBlock: "",
    items
  };
}
