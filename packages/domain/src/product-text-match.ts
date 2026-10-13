import { stableHash } from "./ids.js";

/**
 * Matches free text (a Discord message: "Ascended Heroes ETB restock at
 * Target") to one product title in the catalog. Words count by how rare they
 * are in the catalog, so "Ascended" and "OP-17" decide a match and "Pokémon"
 * or "Box" barely do. A match must cover most of the product's title, use the
 * message's catalog words, and clearly beat the next product; otherwise the
 * caller treats the text as unmatched rather than guess.
 */

export interface ProductTextCandidate {
  id: string;
  title: string;
}

export interface ProductTextMatch {
  id: string;
  title: string;
  /** 0–1: how well title and text agree (both ways). */
  score: number;
  /** 0–1: how much of the product's title the text names. */
  coverage: number;
  matched: string[];
}

export interface ProductTextMatchResult {
  best: ProductTextMatch | null;
  runnerUp: ProductTextMatch | null;
  /** The best product is a safe match on its own. */
  confident: boolean;
  reason: string;
  ranked: ProductTextMatch[];
}

const PHRASES: ReadonlyArray<readonly [RegExp, string]> = Object.freeze([
  [/\bpc etbs?\b/g, " pokemon center elite trainer box "],
  [/\betbs?\b/g, " elite trainer box "],
  [/\bupc\b(?!\s*[:#]?\s*\d)/g, " ultra premium collection "],
  [/\bspc\b/g, " super premium collection "],
  [/\bps5\b/g, " playstation 5 "],
  [/\bps4\b/g, " playstation 4 "],
  [/\bpkmn\b|\bpoke\b/g, " pokemon "],
  [/\bmtg\b/g, " magic the gathering "],
  [/\bbooster box(?:es)?\b/g, " booster box "],
  // Set codes: "OP-17", "OP 17" and "OP17" are one word.
  [/\b(op|eb|st|prb|dp|gd|fb|bt)[\s-]?(\d{1,3})\b/g, " $1$2 "]
] as const);

const STOPWORDS = new Set([
  "a", "an", "and", "or", "the", "of", "for", "with", "w", "in", "on", "at", "by", "to", "from", "is", "are", "was",
  "be", "it", "its", "this", "that", "new", "now", "just", "here", "get", "got", "go", "up", "off",
  "restock", "restocked", "restocking", "stock", "instock", "live", "available", "availability", "drop", "dropped",
  "dropping", "alert", "monitor", "ping", "link", "atc", "cart", "checkout", "buy", "shop", "order", "price",
  "msrp", "retail", "sale", "deal", "sold", "ship", "shipping", "pickup", "delivery", "online", "store", "site",
  "limit", "qty", "quantity", "each", "per", "item", "product", "sku", "tcin", "asin", "pid", "us", "usa", "usd",
  "everyone", "oos", "out", "back", "tcg", "trading", "official", "walmart", "target", "amazon", "bestbuy",
  "best", "gamestop", "costco", "ebay", "tcgplayer"
]);

const CODE_TOKEN = /^(?:op|eb|st|prb|dp|gd|fb|bt)\d{1,3}$/;

function stem(token: string): string {
  if (/\d/.test(token)) return token;
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && /(?:xes|ches|shes|sses|zes)$/.test(token)) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !/(?:ss|us|is)$/.test(token)) return token.slice(0, -1);
  return token;
}

/** The words of a product name or message that can tell products apart. */
export function productTextTokens(value: string): string[] {
  let text = ` ${String(value ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("en-US")} `;
  text = text.replace(/['’‘`]/g, "").replace(/&/g, " and ");
  for (const [pattern, replacement] of PHRASES) text = text.replace(pattern, replacement);
  const tokens: string[] = [];
  for (const raw of text.replace(/[^a-z0-9]+/g, " ").split(" ")) {
    if (!raw || STOPWORDS.has(raw)) continue;
    if (raw.length === 1 && !/\d/.test(raw)) continue;
    const token = stem(raw);
    if (!STOPWORDS.has(token)) tokens.push(token);
  }
  return tokens;
}

/** One key for the same product words in any order: what a remembered link is stored under. */
export function productTextKey(value: string): string {
  const tokens = [...new Set(productTextTokens(value))].sort();
  return tokens.length ? stableHash("yoink_product_text_key_v1", tokens.join(" ")) : "";
}

const MIN_SCORE = 0.7;
const MIN_COVERAGE = 0.75;
const MIN_MARGIN = 0.06;
const MIN_MATCHED_WEIGHT = 2.5;
// A message that leaves words out of a title ("Riftbound Unleashed Champion
// Deck") still matches when no other product comes close.
const SHORT_MIN_SCORE = 0.65;
const SHORT_MIN_COVERAGE = 0.5;
const SHORT_MIN_MARGIN = 0.2;
// A title word at most this many products have names the product ("Hobbit").
const DISTINCTIVE_FREQUENCY = 2;

export class ProductTextIndex {
  private readonly entries: Array<{ id: string; title: string; tokens: Set<string> }>;
  private readonly documentFrequency = new Map<string, number>();
  private readonly postings = new Map<string, number[]>();

  constructor(candidates: Iterable<ProductTextCandidate>) {
    this.entries = [];
    for (const candidate of candidates) {
      const tokens = new Set(productTextTokens(candidate.title));
      if (!tokens.size) continue;
      const position = this.entries.length;
      this.entries.push({ id: candidate.id, title: candidate.title, tokens });
      for (const token of tokens) {
        this.documentFrequency.set(token, (this.documentFrequency.get(token) ?? 0) + 1);
        const list = this.postings.get(token);
        if (list) list.push(position); else this.postings.set(token, [position]);
      }
    }
  }

  get size(): number {
    return this.entries.length;
  }

  private weight(token: string): number {
    const frequency = this.documentFrequency.get(token) ?? 0;
    if (!frequency) return 0;
    const weight = Math.log(1 + this.entries.length / frequency);
    return CODE_TOKEN.test(token) ? weight * 1.5 : weight;
  }

  match(text: string, limit = 5): ProductTextMatchResult {
    const query = new Set(productTextTokens(text));
    const known = [...query].filter((token) => this.documentFrequency.has(token));
    const queryWeight = known.reduce((sum, token) => sum + this.weight(token), 0);
    const empty = (reason: string): ProductTextMatchResult => ({ best: null, runnerUp: null, confident: false, reason, ranked: [] });
    if (!this.entries.length) return empty("No products to match against.");
    if (!known.length || queryWeight <= 0) return empty("No words in the message match a product name.");
    const candidates = new Set<number>();
    for (const token of known) for (const position of this.postings.get(token) ?? []) candidates.add(position);
    const scored: Array<{ match: ProductTextMatch; matchedWeight: number; tokens: Set<string> }> = [];
    for (const position of candidates) {
      const entry = this.entries[position];
      if (!entry) continue;
      let titleWeight = 0;
      let matchedWeight = 0;
      const matched: string[] = [];
      for (const token of entry.tokens) {
        const weight = this.weight(token);
        titleWeight += weight;
        if (query.has(token)) {
          matchedWeight += weight;
          matched.push(token);
        }
      }
      if (!matchedWeight || !titleWeight) continue;
      const coverage = matchedWeight / titleWeight;
      const precision = matchedWeight / queryWeight;
      const score = (2 * coverage * precision) / (coverage + precision);
      scored.push({
        match: {
          id: entry.id,
          title: entry.title,
          score: Math.round(score * 1_000) / 1_000,
          coverage: Math.round(coverage * 1_000) / 1_000,
          matched: matched.sort()
        },
        matchedWeight,
        tokens: entry.tokens
      });
    }
    scored.sort((first, second) => second.match.score - first.match.score
      || second.match.coverage - first.match.coverage
      || first.match.title.localeCompare(second.match.title));
    const ranked = scored.map((item) => item.match);
    const best = ranked[0] ?? null;
    const runnerUp = ranked[1] ?? null;
    const bestWeight = scored[0]?.matchedWeight ?? 0;
    const margin = best && runnerUp ? best.score - runnerUp.score : 1;
    // A word the catalog has never seen ("Worm" in "Gummy Worm") may name a
    // product Yoink doesn't have, so only a message without one may leave
    // title words out.
    const unknownWords = [...query].some((token) => !this.documentFrequency.has(token));
    const codes = [...query].filter((token) => CODE_TOKEN.test(token));
    const fullMatch = Boolean(best) && best!.score >= MIN_SCORE && best!.coverage >= MIN_COVERAGE;
    const shortMatch = Boolean(best) && !unknownWords && best!.score >= SHORT_MIN_SCORE
      && best!.coverage >= SHORT_MIN_COVERAGE && margin >= SHORT_MIN_MARGIN;
    // "OP-17 booster box": the set code picks the products; the other words pick among them.
    const codeMatch = Boolean(best) && codes.length > 0 && !unknownWords
      && codes.every((code) => best!.matched.includes(code));
    // "Magic: The Gathering | Star Trek Collector Booster Box" is not "… The Hobbit
    // Collector Booster Box" (Kevin's PC, 2026-10-13): a word that names the
    // product can't be left out while the message has words of its own instead.
    const bestTokens = scored[0]?.tokens ?? new Set<string>();
    const missing = [...bestTokens].filter((token) => !query.has(token)
      && (this.documentFrequency.get(token) ?? 0) <= DISTINCTIVE_FREQUENCY);
    const instead = [...query].filter((token) => !bestTokens.has(token));
    let reason = "";
    if (!best) reason = "No product shares enough words with the message.";
    else if (!fullMatch && !shortMatch && !codeMatch) {
      reason = `The closest product, ${best.title}, shares too few words with the message.`;
    } else if (missing.length && instead.length) {
      reason = `The message says “${instead.join(" ")}” where ${best.title} says “${missing.join(" ")}”, so it may be another product.`;
    } else if (bestWeight < MIN_MATCHED_WEIGHT) {
      reason = `The message shares only common words with ${best.title}.`;
    } else if (runnerUp && margin < MIN_MARGIN) {
      reason = `The message fits ${best.title} and ${runnerUp.title} about equally.`;
    }
    return { best, runnerUp, confident: Boolean(best) && !reason, reason, ranked: ranked.slice(0, Math.max(1, limit)) };
  }
}
