import { cleanText } from "./normalize.js";

export const WALMART_REVIEW_ORDER_ENDPOINT = "https://www.walmart.com/affil/cart/reviewOrder";

const WALMART_ITEM_ID_PATTERN = /^\d{5,20}$/;
const WALMART_PRODUCT_PATH_PATTERN = /^\/ip\/(?:[^/]+\/)?(\d{5,20})\/?$/i;

function safeWalmartProductUrl(value: unknown): URL | null {
  try {
    const url = new URL(cleanText(value, 4_096));
    const hostname = url.hostname.toLocaleLowerCase("en-US").replace(/\.$/, "");
    if (url.protocol !== "https:"
      || url.username
      || url.password
      || url.port
      || !["walmart.com", "www.walmart.com"].includes(hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export function normalizeWalmartItemId(value: unknown): string {
  const itemId = cleanText(value, 32);
  return WALMART_ITEM_ID_PATTERN.test(itemId) ? itemId : "";
}

export function extractWalmartItemId(value: unknown): string {
  const url = safeWalmartProductUrl(value);
  return url?.pathname.match(WALMART_PRODUCT_PATH_PATTERN)?.[1] ?? "";
}

export function buildWalmartPdpUrl(value: unknown): string {
  const itemId = normalizeWalmartItemId(value);
  return itemId ? `https://www.walmart.com/ip/${itemId}` : "";
}

export function buildWalmartReviewOrderUrl(value: unknown): string {
  const itemId = normalizeWalmartItemId(value);
  if (!itemId) return "";
  const route = new URL(WALMART_REVIEW_ORDER_ENDPOINT);
  route.searchParams.set("items", itemId);
  route.searchParams.set("cn", "nc");
  route.searchParams.set("veh", "aff");
  return route.href;
}

export function buildWalmartClickTrackingId(value: unknown): string {
  const itemId = normalizeWalmartItemId(value);
  return itemId ? `walmart_${itemId}` : "";
}

export interface WalmartPurchaseDestinations {
  walmartItemId: string;
  reviewOrderUrl: string;
  pdpUrl: string;
  trackingId: string;
}

export function buildWalmartPurchaseDestinations(value: unknown): WalmartPurchaseDestinations | null {
  const walmartItemId = normalizeWalmartItemId(value) || extractWalmartItemId(value);
  if (!walmartItemId) return null;
  return {
    walmartItemId,
    reviewOrderUrl: buildWalmartReviewOrderUrl(walmartItemId),
    pdpUrl: buildWalmartPdpUrl(walmartItemId),
    trackingId: buildWalmartClickTrackingId(walmartItemId)
  };
}
