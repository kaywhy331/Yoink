import { suggestionToleranceCents } from "./price-history-summary.js";

/**
 * TrackaLacker's "All New …" entries (All New Pokemon, All New NeeDoh, …)
 * collect each new item of a brand as it appears at stores. Yoink keeps every
 * such item as its own product, linked to its entry, and wanting the entry
 * wants each item (Kevin, 2026-10-09).
 */
export function isAllNewCollectionTitle(title: unknown): boolean {
  return /^all new\s+\S/i.test(String(title ?? "").trim());
}

/** "All New Needoh" → "Needoh". */
export function collectionBrand(title: unknown): string {
  return String(title ?? "").trim().replace(/^all new\s+/i, "").trim();
}

const STORE_PATH_WORDS = new Set(["ip", "p", "site", "dp", "gp", "product", "products", "item", "items", "s", "search", "shop", "c", "b"]);

/** An item's name from its store link when the link carries one, e.g. walmart.com/ip/NeeDoh-Halloween-Countdown/189… */
export function itemTitleFromUrl(value: unknown): string {
  let url: URL;
  try { url = new URL(String(value ?? "")); } catch { return ""; }
  const decode = (part: string) => { try { return decodeURIComponent(part); } catch { return part; } };
  const slug = url.pathname.split("/").map((part) => decode(part).trim())
    .filter((part) => part.length > 3 && /[a-z]/i.test(part) && /[-_ ]/.test(part)
      && !STORE_PATH_WORDS.has(part.toLowerCase()) && !/^A-\d+$/i.test(part) && !/\.p$/i.test(part)
      // An ID block ("o-2323621544+t-7812744940+p-421113924" at Fanatics) names nothing.
      && (part.match(/[a-z]/gi)?.length ?? 0) > (part.match(/\d/g)?.length ?? 0))
    .sort((first, second) => second.length - first.length)[0] ?? "";
  if (!slug) return "";
  const words = slug.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  // ALL-CAPS and all-lowercase store slugs read better in title case.
  const titled = words === words.toUpperCase() || words === words.toLowerCase()
    ? words.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    : words;
  return titled.slice(0, 200);
}

/** A name for an item whose store link carries none: "New NeeDoh item at Walmart (20349455720)". */
export function fallbackItemTitle(collectionTitle: unknown, retailerName: string, retailerSku: string): string {
  const brand = collectionBrand(collectionTitle) || "store";
  return `New ${brand} item at ${retailerName} (${retailerSku})`;
}

export function isFallbackItemTitle(title: unknown): boolean {
  return /^New .+ item at .+ \([^)]+\)$/.test(String(title ?? ""));
}

// Words a name can drop without naming another item.
const TITLE_STOPWORDS = new Set(["a", "an", "and", "the", "of", "for", "with", "by", "vs", "versus", "from", "to", "in", "on", "at", "new", "all"]);
// Words that change what you get: a size, a count, a box or pack, a store exclusive.
const ITEM_FORM_WORDS = new Set([
  "box", "boxes", "display", "displays", "case", "cases", "pack", "packs", "bundle", "bundles", "booster", "boosters",
  "tin", "tins", "blister", "blisters", "sleeve", "sleeves", "collection", "collections", "set", "sets", "kit", "kits",
  "bag", "bags", "deck", "decks", "etb", "elite", "trainer", "premium", "deluxe", "ultra", "mini", "mega", "jumbo", "giant",
  "xl", "large", "small", "single", "singles", "double", "triple", "twin", "pair", "lot", "combo", "assorted", "assortment",
  "variety", "multi", "multipack", "mult", "pk", "ct", "count", "pc", "pcs", "piece", "pieces", "plush", "keychain",
  "figure", "figures", "starter", "exclusive", "promo", "special", "limited", "edition", "version", "holiday", "gift",
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "twelve", "dozen"
]);

export function itemTitleTokens(title: unknown): string[] {
  return String(title ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .split(/[^a-z0-9]+/).filter((token) => token && !TITLE_STOPWORDS.has(token));
}

/**
 * Two stores' items of one "All New …" entry are the same product (Kevin,
 * 2026-10-09: "the same item should share the same listing if browsing by
 * all") when one name holds every word of the other, besides the brand at
 * least two, the other adds nothing that changes what you get, and their
 * prices are within Yoink's usual tolerance ($5 or 10%). Without both prices
 * the names must match word for word. A placeholder name never matches.
 */
export function sameCollectionItem(
  collectionTitle: unknown,
  first: { title: string; priceCents: number | null },
  second: { title: string; priceCents: number | null }
): boolean {
  if (isFallbackItemTitle(first.title) || isFallbackItemTitle(second.title)) return false;
  const brand = new Set(itemTitleTokens(collectionBrand(collectionTitle)));
  const one = new Set(itemTitleTokens(first.title));
  const other = new Set(itemTitleTokens(second.title));
  const [small, large] = one.size <= other.size ? [one, other] : [other, one];
  if ([...small].filter((token) => !brand.has(token)).length < 2) return false;
  if (![...small].every((token) => large.has(token))) return false;
  const extra = [...large].filter((token) => !small.has(token));
  if (extra.some((token) => ITEM_FORM_WORDS.has(token) || /\d/.test(token))) return false;
  const prices = [first.priceCents, second.priceCents];
  if (prices.every((cents) => Number.isSafeInteger(cents) && Number(cents) > 0)) {
    const [low, high] = (prices as number[]).sort((left, right) => left - right) as [number, number];
    return high - low <= suggestionToleranceCents(low);
  }
  return extra.length === 0;
}
