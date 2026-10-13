import type { ExactRetailerProductLink } from "../../domain/src/attribution.js";
import { isShortStoreLink, storeItemFromLink } from "../../domain/src/store-item-link.js";
import type { FollowedLink, FollowedLinks } from "../../sources/src/discord-notification.js";

/**
 * Follows the short links in a Discord message (amzn.to, bit.ly, howl.me,
 * Mavely and Impact links …) to the store item they lead to, so the call
 * traces like a plain store link. Only known short-link and redirect services
 * are ever asked; each hop must be one of them, and Yoink stops as soon as a
 * hop names a store item, so the store's own page is never opened from here.
 * Nothing is sent but the link itself: no cookies, no sign-in.
 */

export type ShortLinkFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface ShortLinkFollowerOptions {
  fetch?: ShortLinkFetch;
  /** For every link of one message together (default 4 s). */
  timeoutMs?: number;
  maxHops?: number;
}

const DEFAULT_TIMEOUT_MS = 4_000;
const DEFAULT_MAX_HOPS = 5;
// Enough for the redirect pages Branch and similar services send instead of a redirect.
const MAX_PAGE_BYTES = 64 * 1024;
const BROWSER_HEADERS = Object.freeze({
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml"
});
const PAGE_LINK = /https?:(?:\/\/|\\\/\\\/)[^\s"'<>`)\]]+/gi;

async function pageText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < MAX_PAGE_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_PAGE_BYTES));
}

/** The one store item a redirect page points at (a script or refresh to the store), if exactly one. */
function storeItemInPage(text: string): ExactRetailerProductLink | null {
  const items = new Map<string, ExactRetailerProductLink>();
  for (const match of text.matchAll(PAGE_LINK)) {
    const link = match[0].replace(/\\\//g, "/").replace(/&amp;/g, "&").replace(/[.,;]+$/, "");
    const item = storeItemFromLink(link);
    if (item) items.set(`${item.retailerId}:${item.retailerSku}`, item);
    if (items.size > 1) return null;
  }
  return [...items.values()][0] ?? null;
}

/** Where a short link leads: the store item, or the address it stopped at (never fetched past a short-link service). */
async function followOne(start: string, fetcher: ShortLinkFetch, signal: AbortSignal, maxHops: number): Promise<FollowedLink> {
  let current = start;
  for (let hop = 0; hop <= maxHops; hop += 1) {
    const item = storeItemFromLink(current);
    if (item) return { item, landing: item.canonicalUrl };
    if (hop === maxHops || !isShortStoreLink(current)) return { item: null, landing: hop ? current : "" };
    const response = await fetcher(current, { method: "GET", redirect: "manual", signal, headers: BROWSER_HEADERS });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => undefined);
      try {
        current = new URL(location, current).href;
      } catch {
        return { item: null, landing: "" };
      }
      continue;
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      return { item: null, landing: "" };
    }
    const found = storeItemInPage(await pageText(response));
    return { item: found, landing: found?.canonicalUrl ?? current };
  }
  return { item: null, landing: "" };
}

/** Follows each short link (together, within the time limit); a link that fails or leads to no item has no item. */
export function shortLinkFollower(options: ShortLinkFollowerOptions = {}): (links: readonly string[]) => Promise<FollowedLinks> {
  const fetcher = options.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));
  const timeoutMs = Math.max(250, Math.floor(options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const maxHops = Math.max(1, Math.min(10, Math.floor(options.maxHops ?? DEFAULT_MAX_HOPS)));
  return async (links) => {
    const signal = AbortSignal.timeout(timeoutMs);
    const followed: Record<string, FollowedLink> = {};
    await Promise.all([...new Set(links)].map(async (link) => {
      try {
        followed[link] = await followOne(link, fetcher, signal, maxHops);
      } catch {
        followed[link] = { item: null, landing: "" };
      }
    }));
    return followed;
  };
}
