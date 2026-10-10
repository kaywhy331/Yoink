import type { TrackalackerKnownListing, TrackalackerMsrpReference, TrackalackerSyncPlan } from "../../../packages/contracts/src/index.js";
import { referenceFromHistoryRows, trackalackerHistoryUrl, type TrackalackerHistoryRow } from "../../../packages/domain/src/trackalacker-history.js";

const FOLLOWED_URL = "https://www.trackalacker.com/products/followed";
const MAX_DECLARED_PAGES = 100_000;
const FETCH_TIMEOUT_MS = 15_000;
// Every product Yoink has no picture for gets its page's share image (Kevin,
// 2026-10-09: "The items needs images"); 25 left most of the catalog bare.
const MAX_ENRICHMENT_FETCHES = 800;
// TrackaLacker's image host: photo_items may give paths on it rather than full URLs.
const TRACKALACKER_IMAGE_HOST = "https://static.trackalacker.com";
const IMAGE_FILE = /\.(?:jpe?g|png|webp|gif|avif)$/i;
const ENRICHMENT_DELAY_MS = 200;
const SAMPLE_MAX_BYTES = 4_096;
// Faster sync (Kevin, 2026-10-09: a full pass took 1 h 45 min). Products run
// a few at a time behind one shared pace for every TrackaLacker request, in
// place of fixed pauses; work Yoink already has is skipped.
const REQUESTS_PER_SECOND = 3;
// TrackaLacker answers in about 2 s, so 6 in flight are needed to reach the pace.
const PARALLEL_PRODUCTS = 6;
const PROGRESS_INTERVAL_MS = 2_000;
const HISTORY_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
/** History pages are the slow part: a full pass refreshes at most this many listings, the rest on later passes. */
const HISTORY_LISTINGS_PER_RUN = 300;

interface FollowedProduct {
  sourceProductId: string;
  sourceProductSlug: string;
  sourceProductUrl: string;
  title: string;
  imageUrl: string;
  msrpCents: number | null;
}

// Captured once per sync run, from the first followed product only. TrackaLacker's real
// field names for image/MSRP are unconfirmed from the repo alone (the extraction below is
// best-effort guessing); this sink lets the run report back exactly what it saw so a real
// payload can be inspected via the audit log without ever touching the database schema.
interface RawFieldSampleSink {
  listItem: Record<string, unknown> | null;
  productDetail: Record<string, unknown> | null;
  // One listing of an "All New …" entry and how TrackaLacker groups its listings:
  // whether a listing names its item, its barcode, or the same item at other stores.
  collectionListing?: Record<string, unknown> | null;
  collectionGrouping?: Record<string, unknown> | null;
}

interface CatalogListing {
  sourceListingId: string;
  storeName: string;
  retailerId: string;
  retailerSku: string;
  canonicalUrl: string;
  sourceListingUrl: string;
  outboundUrl: string;
  availability: "in_stock" | "preorder" | "out_of_stock" | "unknown";
  unitPriceCents: number | null;
  sellerType: "first_party" | "third_party" | "unknown";
  sellerName: string;
  msrpReference?: TrackalackerMsrpReference | null;
  historyChecked?: boolean;
}

type SyncMode = "quick" | "full";

/** Spaces the start of every TrackaLacker request across all parallel products. */
function createPacer(perSecond: number) {
  let next = 0;
  return async function paced<T>(task: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const start = Math.max(now, next);
    next = start + 1_000 / perSecond;
    if (start > now) await delay(start - now);
    return task();
  };
}

/** TrackaLacker asking us to stop: rate limit, sign-in or its browser check. Never worked around. */
function stopReasonFor(error: unknown): "" | "blocked" | "signed_out" | "challenged" {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/security verification|verify you are human|checking your browser/i.test(message)) return "challenged";
  if (/Sign in to TrackaLacker|HTTP 401/i.test(message)) return "signed_out";
  if (/HTTP (?:403|429)/i.test(message)) return "blocked";
  return "";
}

interface TrackalackerProductPayload extends FollowedProduct {
  observedAt: string;
  listings: CatalogListing[];
}

interface RuntimeResponse {
  ok?: boolean;
  reason?: string;
  message?: string;
  identity?: { retailerId?: string; retailerSku?: string; canonicalUrl?: string };
  mode?: SyncMode;
  plan?: TrackalackerSyncPlan;
}

let runningSyncId = "";

function cleanText(value: unknown, maximum = 300): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function numericId(value: unknown): string {
  const text = cleanText(value, 30);
  return /^\d{1,20}$/.test(text) ? text : "";
}

function moneyCents(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(String(value).replaceAll(",", "").replace("$", "").trim());
  return Number.isFinite(amount) && amount > 0 && amount <= 1_000_000 ? Math.round(amount * 100) : null;
}

// Units come from the field's contract, never from the amount's magnitude.
// Guessing that a small *_cents value is dollars can inflate a purchase cap 100x.
function normalizeMoneyToCents(value: unknown, unit: "dollars" | "cents" = "dollars"): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (unit === "cents") {
    if (!/^\d+$/.test(text)) return null;
    const cents = Number(text);
    return Number.isSafeInteger(cents) && cents > 0 && cents <= 100_000_000 ? cents : null;
  }
  const dollars = text.replace(/^(?:USD\s*|\$\s*)/i, "");
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(dollars)) return null;
  const cents = Math.round(Number(dollars.replaceAll(",", "")) * 100);
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 100_000_000 ? cents : null;
}

const MSRP_FIELDS = ["msrp", "msrp_cents", "msrpCents"] as const;

function productMsrpCents(...sources: Array<Record<string, unknown> | undefined>): number | null {
  for (const record of sources) {
    if (!record) continue;
    const currency = cleanText(record.currency ?? record.currency_code, 10).toUpperCase();
    if (currency && currency !== "USD") continue;
    const candidates = new Set<number>();
    for (const field of MSRP_FIELDS) {
      const cents = normalizeMoneyToCents(record[field], field === "msrp" ? "dollars" : "cents");
      if (cents !== null) candidates.add(cents);
    }
    // Current/default/list/retail prices are not evidence of MSRP. Conflicting
    // explicitly named MSRP fields also require review instead of choosing a cap.
    if (candidates.size > 1) return null;
    if (candidates.size === 1) return [...candidates][0] ?? null;
  }
  return null;
}

function trackalackerUrl(value: unknown, base = FOLLOWED_URL): string {
  try {
    const url = new URL(String(value ?? ""), base);
    if (url.protocol !== "https:" || url.username || url.password || !["trackalacker.com", "www.trackalacker.com"].includes(url.hostname.toLowerCase())) return "";
    url.hostname = "www.trackalacker.com";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function productSlug(value: unknown): string {
  const text = cleanText(value, 240).toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?$/.test(text) ? text : "";
}

/** An image address as TrackaLacker writes it: full, protocol-relative ("//host/…") or a path on its image host. */
function imageAddress(value: string): string {
  const text = cleanText(value, 2_048);
  if (/^https?:\/\//i.test(text)) return text;
  if (text.startsWith("//")) return `https:${text}`;
  if (/^\/?uploads\//i.test(text)) return `${TRACKALACKER_IMAGE_HOST}/${text.replace(/^\//, "")}`;
  return text;
}

function trackalackerImage(value: string): boolean {
  try {
    const url = new URL(imageAddress(value));
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "trackalacker.com" || host.endsWith(".trackalacker.com"))
      && (/\/uploads\//i.test(url.pathname) || IMAGE_FILE.test(url.pathname));
  } catch {
    return false;
  }
}

/** Every TrackaLacker image address anywhere inside one photo_items entry. */
function trackalackerImageStrings(value: unknown, depth = 0): string[] {
  if (depth > 3) return [];
  if (typeof value === "string") return trackalackerImage(value) ? [imageAddress(value)] : [];
  if (Array.isArray(value)) return value.slice(0, 16).flatMap((item) => trackalackerImageStrings(item, depth + 1));
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, unknown>).slice(0, 40).flatMap((item) => trackalackerImageStrings(item, depth + 1));
}

/**
 * Pictures in TrackaLacker's photo_items: the explicit image fields, then any
 * address on TrackaLacker's image host inside the entry, then the entry's id
 * and file name in TrackaLacker's own upload layout
 * (uploads/products/photo_item/photo/<id>/<file>, as its share images show).
 * A wrong guess is harmless: the picture store keeps only real images.
 */
function photoItemImages(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  const found: string[] = [];
  for (const item of items.slice(0, 16)) {
    found.push(...imageValues(item).map(imageAddress), ...trackalackerImageStrings(item));
    const record = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : null;
    const id = record ? numericId(record.id ?? record.photo_item_id) : "";
    if (!record || !id) continue;
    for (const key of ["photo", "photo_file_name", "file_name", "filename", "image"]) {
      const name = typeof record[key] === "string" ? String(record[key]).trim() : "";
      if (name && !name.includes("/") && IMAGE_FILE.test(name)) {
        found.push(`${TRACKALACKER_IMAGE_HOST}/uploads/products/photo_item/photo/${id}/${encodeURIComponent(name)}`);
      }
    }
  }
  return found;
}

function sanitizeImageCandidate(value: string): string {
  try {
    const url = new URL(imageAddress(value));
    if (url.protocol !== "https:" || url.username || url.password) return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function firstSrcsetUrl(value: string): string {
  // Image CDN paths contain commas (e.g. width=1200,height=630). The URL
  // ends at whitespace before its descriptor, not at the first comma.
  return value.trim().split(/\s+/)[0]?.replace(/,$/, "") ?? "";
}

// TrackaLacker's retained list/detail sample uses photo_items. Inspect only
// explicit image fields, with bounded nesting and galleries; never infer a
// filename from a product ID or borrow an image from a different listing.
function imageValues(candidate: unknown, depth = 0): string[] {
  if (depth > 4) return [];
  if (typeof candidate === "string") return [candidate];
  if (Array.isArray(candidate)) return candidate.slice(0, 16).flatMap((value) => imageValues(value, depth + 1));
  if (!candidate || typeof candidate !== "object") return [];
  const record = candidate as Record<string, unknown>;
  const values = typeof record.srcset === "string" ? [firstSrcsetUrl(record.srcset)] : [];
  for (const key of ["url", "src", "image_url", "imageUrl", "photo_url", "photo", "image", "original", "thumbnail"]) {
    values.push(...imageValues(record[key], depth + 1));
  }
  return values;
}

// Marketplace retailers list every seller under its own item ID. TrackaLacker's
// seller field names are unconfirmed (see the raw-sample sink), so this reads the
// likely names and only asserts a seller type when the payload says so explicitly.
const SELLER_NAME_FIELDS = ["seller_name", "sellerName", "seller", "sold_by", "soldBy", "merchant", "vendor"] as const;
const MARKETPLACE_FLAG_FIELDS = ["is_marketplace", "marketplace", "third_party", "is_third_party", "thirdParty"] as const;
const FIRST_PARTY_FLAG_FIELDS = ["is_first_party", "first_party", "firstParty", "sold_by_retailer"] as const;

function listingSeller(
  ...records: Array<Record<string, unknown>>
): { sellerType: "first_party" | "third_party" | "unknown"; sellerName: string } {
  let sellerName = "";
  let sellerType: "first_party" | "third_party" | "unknown" = "unknown";
  for (const record of records) {
    for (const field of SELLER_NAME_FIELDS) {
      const value = record[field];
      const name = typeof value === "string"
        ? value
        : value && typeof value === "object" && !Array.isArray(value)
          ? String((value as Record<string, unknown>).name ?? (value as Record<string, unknown>).display_name ?? "")
          : "";
      if (!sellerName && cleanText(name, 160)) sellerName = cleanText(name, 160);
    }
    for (const field of MARKETPLACE_FLAG_FIELDS) if (record[field] === true) sellerType = "third_party";
    for (const field of FIRST_PARTY_FLAG_FIELDS) if (record[field] === true) sellerType = "first_party";
  }
  return { sellerType, sellerName };
}

const IMAGE_FIELDS = [
  "image_url", "imageUrl", "image", "photo_url", "primary_image_url", "thumbnail_url", "thumb_url",
  "img", "picture", "media", "images", "photo_items", "photo", "canonical_image_url"
];

function productImageUrl(...sources: Array<Record<string, unknown> | undefined>): string {
  for (const record of sources) {
    if (!record) continue;
    for (const field of IMAGE_FIELDS) {
      for (const value of field === "photo_items" ? photoItemImages(record[field]) : imageValues(record[field])) {
        const safe = sanitizeImageCandidate(value);
        if (safe) return safe;
      }
    }
    if (typeof record.srcset === "string" && record.srcset) {
      const safe = sanitizeImageCandidate(firstSrcsetUrl(record.srcset));
      if (safe) return safe;
    }
  }
  return "";
}

function slugFromUrl(value: string): string {
  try {
    return productSlug(new URL(value).pathname.match(/\/products\/showcase\/([^/]+)/i)?.[1]);
  } catch {
    return "";
  }
}

function reactPropsFor(documentValue: Document, componentName: string): { found: boolean; value: Record<string, unknown> | null } {
  const root = [...documentValue.querySelectorAll<HTMLElement>("[data-react-class][data-react-props]")]
    .find((candidate) => candidate.getAttribute("data-react-class") === componentName);
  if (!root) return { found: false, value: null };
  const raw = root.getAttribute("data-react-props") ?? "";
  if (!raw || raw.length > 5_000_000) return { found: true, value: null };
  try {
    const value = JSON.parse(raw) as unknown;
    return { found: true, value: value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null };
  } catch {
    return { found: true, value: null };
  }
}

function parseFollowedPage(
  documentValue: Document,
  pageUrl: string,
  sampleSink?: RawFieldSampleSink
): { items: FollowedProduct[]; totalPages: number; signedOut: boolean; challenged: boolean } {
  const hydration = reactPropsFor(documentValue, "products/YourProductsApp");
  const props = hydration.value?.searchResultsProps as Record<string, unknown> | undefined;
  const rawResults = Array.isArray(props?.results) ? props.results : [];
  if (sampleSink && !sampleSink.listItem) {
    const first = rawResults[0];
    if (first && typeof first === "object" && !Array.isArray(first)) sampleSink.listItem = first as Record<string, unknown>;
  }
  const items: FollowedProduct[] = [];
  const seen = new Set<string>();
  for (const raw of rawResults) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const sourceProductId = numericId(item.product_id ?? item.id);
    const slug = productSlug(item.slug);
    const sourceProductUrl = trackalackerUrl(item.show_path || (slug ? `/products/showcase/${slug}` : ""), pageUrl);
    const title = cleanText(item.name, 300);
    if (!sourceProductId || !sourceProductUrl || !title || seen.has(sourceProductId)) continue;
    seen.add(sourceProductId);
    items.push({
      sourceProductId,
      sourceProductSlug: slug || slugFromUrl(sourceProductUrl),
      sourceProductUrl,
      title,
      imageUrl: productImageUrl(item),
      msrpCents: productMsrpCents(item)
    });
  }
  const pagination = props?.pagination as Record<string, unknown> | undefined;
  const pages = Number(pagination?.total_pages);
  const body = cleanText(documentValue.body?.innerText, 20_000).toLowerCase();
  return {
    items,
    totalPages: Number.isSafeInteger(pages) && pages > 0 ? Math.min(MAX_DECLARED_PAGES, pages) : 1,
    signedOut: Boolean(documentValue.querySelector('form[action*="login"], input[type="password"]')) || /sign in to continue|log in to continue/.test(body),
    challenged: /checking your browser|verify you are human|security verification|cf-chl-/.test(body)
  };
}

function retailerForStore(value: unknown): string {
  const name = cleanText(value, 100).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (/\btarget\b/.test(name)) return "target";
  if (/\bwalmart\b/.test(name)) return "walmart";
  if (/\bamazon\b/.test(name)) return "amazon";
  if (/\bbest buy\b|\bbestbuy\b/.test(name)) return "bestbuy";
  if (/\bdisney store\b|^disney$/.test(name)) return "disney";
  if (/\bravensburger\b/.test(name)) return "ravensburger";
  if (/\briot games(?: merch| store)?\b|^riot$/.test(name)) return "riot";
  if (/\bbooks a million\b|\bbooksamillion\b|^bam$/.test(name)) return "booksamillion";
  if (/\bfanatics\b/.test(name)) return "fanatics";
  if (/\bkohl s\b|^kohls$/.test(name)) return "kohls";
  if (/\bmacy s\b|^macys$/.test(name)) return "macys";
  if (/\bpremium bandai\b|\bp bandai\b|^pbandai$/.test(name)) return "pbandai";
  if (/\bpokemon center\b|^pokemoncenter$/.test(name)) return "pokemoncenter";
  return "";
}

function availabilityFrom(value: unknown): CatalogListing["availability"] {
  const text = cleanText(value, 500).toLowerCase();
  if (/pre-?order/.test(text)) return "preorder";
  if (/out of stock|unavailable|sold out/.test(text)) return "out_of_stock";
  if (/in stock|available|on sale|sale/.test(text)) return "in_stock";
  return "unknown";
}

function safeOutboundUrl(value: unknown): string {
  try {
    const url = new URL(cleanText(value, 4_096));
    if (url.protocol !== "https:" || url.username || url.password) return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function runtimeMessage(message: Record<string, unknown>): Promise<RuntimeResponse> {
  const chromeRuntime = (globalThis as unknown as { chrome?: { runtime?: { sendMessage?: (value: unknown) => Promise<RuntimeResponse> } } }).chrome?.runtime;
  if (!chromeRuntime?.sendMessage) return Promise.resolve({ ok: false, reason: "extension_runtime_unavailable" });
  return chromeRuntime.sendMessage(message).catch(() => ({ ok: false, reason: "extension_message_failed" }));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchText(url: string): Promise<{ text: string; url: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { credentials: "include", redirect: "follow", cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`TrackaLacker returned HTTP ${response.status}.`);
    if (response.redirected && /\/(?:login|sign[_-]?in)(?:\/|$)/i.test(new URL(response.url).pathname)) throw new Error("Sign in to TrackaLacker in this browser, then retry.");
    return { text: await response.text(), url: response.url };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url: string): Promise<{ data: Record<string, unknown>; url: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      credentials: "include",
      redirect: "follow",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`TrackaLacker returned HTTP ${response.status}.`);
    if (response.redirected && /\/(?:login|sign[_-]?in)(?:\/|$)/i.test(new URL(response.url).pathname)) throw new Error("Sign in to TrackaLacker in this browser, then retry.");
    const value = await response.json() as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("TrackaLacker returned unreadable product data.");
    return { data: value as Record<string, unknown>, url: response.url };
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveListingIdentity(candidates: string[], expectedRetailer: string): Promise<{ retailerId: string; retailerSku: string; canonicalUrl: string; outboundUrl: string }> {
  for (const candidate of candidates) {
    const result = await runtimeMessage({ type: "yoink:resolve-trackalacker-listing", url: candidate, expectedRetailer });
    const retailerId = cleanText(result.identity?.retailerId, 60);
    const retailerSku = cleanText(result.identity?.retailerSku, 64);
    const canonicalUrl = safeOutboundUrl(result.identity?.canonicalUrl);
    if (result.ok && retailerId && retailerSku && canonicalUrl) {
      return { retailerId, retailerSku, canonicalUrl, outboundUrl: candidate };
    }
  }
  return { retailerId: expectedRetailer, retailerSku: "", canonicalUrl: "", outboundUrl: candidates[0] ?? "" };
}

async function parseProductPayload(
  data: Record<string, unknown>,
  summary: FollowedProduct,
  sampleSink?: RawFieldSampleSink,
  known: Record<string, TrackalackerKnownListing> = {},
  resolve: typeof resolveListingIdentity = resolveListingIdentity,
  recheckUnresolved = true
): Promise<TrackalackerProductPayload> {
  const product = data.product && typeof data.product === "object" && !Array.isArray(data.product)
    ? data.product as Record<string, unknown> : {};
  if (sampleSink && !sampleSink.productDetail && Object.keys(product).length) {
    sampleSink.productDetail = product;
  }
  if (sampleSink && !sampleSink.collectionListing && /^all new\s+\S/i.test(String(product.name ?? ""))
    && Array.isArray(product.listings) && product.listings[0] && typeof product.listings[0] === "object") {
    sampleSink.collectionListing = product.listings[0] as Record<string, unknown>;
    sampleSink.collectionGrouping = {
      name: product.name, grouped_listings: product.grouped_listings, grouped_listing_ids: product.grouped_listing_ids,
      listingCount: product.listings.length
    };
  }
  const rawListings = Array.isArray(product.listings) ? product.listings : [];
  const listings: CatalogListing[] = [];
  const seen = new Set<string>();
  for (const rawValue of rawListings) {
    if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) continue;
    const raw = rawValue as Record<string, unknown>;
    const sourceListingId = numericId(raw.id);
    if (!sourceListingId || seen.has(sourceListingId)) continue;
    seen.add(sourceListingId);
    const provider = raw.provider && typeof raw.provider === "object" && !Array.isArray(raw.provider)
      ? raw.provider as Record<string, unknown> : {};
    const storeName = cleanText(provider.display_name || provider.short_display_name || "Other store", 120) || "Other store";
    const candidates = [raw.url, raw.preferred_product_url, raw.purchase_url, raw.affiliate_url]
      .map(safeOutboundUrl)
      .filter(Boolean);
    const expectedRetailer = retailerForStore(storeName);
    // A listing's store item never changes: reuse the one Yoink found before.
    // An unresolved one is looked up again only for a store Yoink can add to.
    const previous = known[sourceListingId];
    const reusable = previous && (!candidates.length || candidates.includes(previous.outboundUrl))
      && (previous.retailerSku || !recheckUnresolved || !expectedRetailer);
    const identity = reusable
      ? { retailerId: previous.retailerId, retailerSku: previous.retailerSku, canonicalUrl: previous.canonicalUrl, outboundUrl: previous.outboundUrl }
      : await resolve(candidates, expectedRetailer);
    const current = raw.current_status && typeof raw.current_status === "object" && !Array.isArray(raw.current_status)
      ? raw.current_status as Record<string, unknown> : {};
    const sourceListingUrl = trackalackerUrl(
      raw.show_path || `${summary.sourceProductUrl.replace(/\/$/, "")}/listings/${sourceListingId}/${summary.sourceProductSlug || "item"}`,
      summary.sourceProductUrl
    );
    if (!sourceListingUrl) continue;
    const seller = listingSeller(raw, current);
    listings.push({
      sourceListingId,
      storeName,
      retailerId: identity.retailerId,
      retailerSku: identity.retailerSku,
      canonicalUrl: identity.canonicalUrl,
      sourceListingUrl,
      outboundUrl: identity.outboundUrl,
      availability: availabilityFrom(current.short_stock_status_text || current.stock_status || raw.status),
      unitPriceCents: moneyCents(current.price ?? raw.price),
      sellerType: seller.sellerType,
      sellerName: seller.sellerName
    });
  }
  return {
    ...summary,
    title: cleanText(product.name, 300) || summary.title,
    imageUrl: productImageUrl(product) || summary.imageUrl,
    msrpCents: productMsrpCents(product) ?? summary.msrpCents,
    observedAt: new Date().toISOString(),
    listings
  };
}

// --- Sanitized raw-sample capture (self-diagnosing extraction) ---------------------

const SENSITIVE_SAMPLE_KEY = /(?:^|_)(?:token|secret|password|auth|cookie|session|csrf|credential|api_?key)(?:$|_)/i;

function sampledPrimitive(value: string | number | boolean | null): string | number | boolean | null {
  if (typeof value === "string") return value.length > 120 ? `${value.slice(0, 120)}…` : value;
  return value;
}

function sanitizedFieldSample(record: Record<string, unknown> | null, depth = 0): Record<string, unknown> {
  if (!record) return {};
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record).slice(0, 60)) {
    const safeKey = cleanText(key, 100);
    if (!safeKey) continue;
    if (SENSITIVE_SAMPLE_KEY.test(safeKey)) {
      output[safeKey] = "[stripped]";
      continue;
    }
    if (Array.isArray(value)) {
      output[safeKey] = `[array:${value.length}]`;
      continue;
    }
    if (value && typeof value === "object") {
      output[safeKey] = depth < 1 ? sanitizedFieldSample(value as Record<string, unknown>, depth + 1) : "[object]";
      continue;
    }
    output[safeKey] = value === undefined
      ? null
      : sampledPrimitive(value as string | number | boolean | null);
  }
  return output;
}

function boundedSample(value: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(value);
  const originalCount = entries.length;
  while (entries.length && JSON.stringify(Object.fromEntries(entries)).length > SAMPLE_MAX_BYTES) {
    entries.pop();
  }
  const bounded = Object.fromEntries(entries);
  return entries.length === originalCount ? bounded : { ...bounded, truncated: true };
}

/** The first photo_items entry, deep enough to show where its picture address is. */
function photoItemSample(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.length > 300 ? `${value.slice(0, 300)}…` : value;
  if (value === null || typeof value !== "object") return value ?? null;
  if (depth >= 3) return Array.isArray(value) ? `[array:${value.length}]` : "[object]";
  if (Array.isArray(value)) return value.slice(0, 2).map((item) => photoItemSample(item, depth + 1));
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
    output[cleanText(key, 100)] = SENSITIVE_SAMPLE_KEY.test(key) ? "[stripped]" : photoItemSample(item, depth + 1);
  }
  return output;
}

async function sendRawFieldSample(syncId: string, sink: RawFieldSampleSink): Promise<void> {
  if (!sink.listItem && !sink.productDetail) return;
  const photoItems = [sink.productDetail?.photo_items, sink.listItem?.photo_items].find((value) => Array.isArray(value) && value.length);
  const sample = boundedSample({
    // First, so the size cap (which drops from the end) keeps it.
    ...(photoItems ? { photoItem: photoItemSample((photoItems as unknown[])[0]) } : {}),
    ...(sink.collectionGrouping ? { collectionGrouping: photoItemSample(sink.collectionGrouping) } : {}),
    ...(sink.collectionListing ? { collectionListing: photoItemSample(sink.collectionListing) } : {}),
    ...(sink.listItem ? { listItem: sanitizedFieldSample(sink.listItem) } : {}),
    ...(sink.productDetail ? { productDetail: sanitizedFieldSample(sink.productDetail) } : {})
  });
  try {
    await runtimeMessage({ type: "yoink:trackalacker-sync-sample", syncId, sample });
  } catch {
    // Best-effort diagnostics only; must never block or fail the sync.
  }
}

// --- Fallback image enrichment (og:image from the product's own page) --------------

function extractOgImage(html: string): string {
  const metaTagPattern = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = metaTagPattern.exec(html))) {
    const tag = match[0];
    if (!/\bproperty\s*=\s*["']og:image["']/i.test(tag)) continue;
    const content = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (content?.[1]) return sanitizeImageCandidate(content[1].replace(/&amp;|&#0*38;|&#x0*26;/gi, "&"));
  }
  return "";
}

async function fetchOgImage(productUrl: string, fetchPage = fetchText): Promise<string> {
  try {
    const fetched = await fetchPage(productUrl);
    return extractOgImage(fetched.text);
  } catch {
    return "";
  }
}

async function enrichMissingImage(
  product: TrackalackerProductPayload,
  cache: Map<string, string>,
  budget: { remaining: number },
  fetchPage = fetchText,
  pause = delay
): Promise<string> {
  if (product.imageUrl) return product.imageUrl;
  const slug = product.sourceProductSlug;
  if (slug && cache.has(slug)) return cache.get(slug) ?? "";
  if (budget.remaining <= 0) return "";
  budget.remaining -= 1;
  let image = "";
  try {
    image = await fetchOgImage(product.sourceProductUrl, fetchPage);
  } catch {
    image = "";
  }
  if (slug) cache.set(slug, image);
  await pause(ENRICHMENT_DELAY_MS);
  return image;
}

async function progress(syncId: string, value: Record<string, unknown>): Promise<void> {
  await runtimeMessage({ type: "yoink:trackalacker-sync-progress", syncId, ...value });
}

export function parseHistoryPage(documentValue: Document, pageUrl: string): {
  rows: TrackalackerHistoryRow[]; timeZone: string; nextUrl: string; blocked: boolean;
} {
  const text = documentValue.body?.textContent ?? "";
  const blocked = /checking your browser|verify you are human|security verification|cf-chl-|just a moment/i.test(text)
    || Boolean(documentValue.querySelector('input[type="password"], #challenge-form, script[src*="/cdn-cgi/challenge"]'));
  const result = { rows: [] as TrackalackerHistoryRow[], timeZone: "", nextUrl: "", blocked };
  if (blocked) return result;
  for (const table of Array.from(documentValue.querySelectorAll("table"))) {
    const headings = Array.from(table.querySelectorAll("tr")).find(row => {
      const cells = Array.from(row.cells).map(cell => cleanText(cell.textContent));
      return cells.some(cell => /^Time(?:\s*\([^)]+\))?$/i.test(cell)) && cells.includes("Price") && cells.includes("Status");
    });
    if (!headings) continue;
    const headers = Array.from(headings.cells).map(cell => cleanText(cell.textContent));
    const timeIndex = headers.findIndex(cell => /^Time(?:\s*\([^)]+\))?$/i.test(cell));
    result.timeZone = headers[timeIndex]?.match(/\(([^)]+)\)/)?.[1] ?? "";
    for (const row of Array.from(table.querySelectorAll("tr")).slice(0, 2_001)) {
      if (row === headings) continue;
      result.rows.push({ time: cleanText(row.cells[timeIndex]?.textContent, 80),
        price: cleanText(row.cells[headers.indexOf("Price")]?.textContent, 80),
        status: cleanText(row.cells[headers.indexOf("Status")]?.textContent, 120) });
    }
    // Pagination must stay on the exact listing. Never follow retailer or login links.
    for (const link of Array.from(documentValue.querySelectorAll('a[rel="next"], .pagination a, nav[aria-label*="agination"] a'))) {
      if (link.getAttribute("rel") !== "next" && !/^next\b|^[›»→]$/i.test(cleanText(link.textContent))) continue;
      const next = trackalackerHistoryUrl(link.getAttribute("href") ?? "", pageUrl);
      if (next && next !== pageUrl && new URL(next).searchParams.has("page")) { result.nextUrl = next; break; }
    }
    break;
  }
  return result;
}

export async function fetchHistoryReference(
  listing: Pick<CatalogListing, "sourceListingUrl" | "sourceListingId">,
  observedAt: string,
  budget: { remaining: number; blocked?: boolean },
  fetchPage = fetchText,
  pause = delay
): Promise<TrackalackerMsrpReference | null> {
  let pageUrl = trackalackerHistoryUrl(listing.sourceListingUrl, listing.sourceListingUrl, listing.sourceListingId);
  const rows: TrackalackerHistoryRow[] = [];
  const pageRows: Array<{ url: string; rows: TrackalackerHistoryRow[] }> = [];
  const seen = new Set<string>();
  let timeZone = "";
  for (let page = 0; page < 3 && pageUrl && !seen.has(pageUrl) && budget.remaining > 0 && !budget.blocked; page++) {
    seen.add(pageUrl);
    budget.remaining--;
    try {
      const fetched = await fetchPage(pageUrl);
      if (!trackalackerHistoryUrl(fetched.url, listing.sourceListingUrl, listing.sourceListingId)) break;
      const parsed = parseHistoryPage(new DOMParser().parseFromString(fetched.text, "text/html"), pageUrl);
      if (parsed.blocked) { budget.blocked = true; break; }
      if (rows.length && parsed.timeZone !== timeZone) break;
      timeZone = parsed.timeZone;
      rows.push(...parsed.rows);
      pageRows.push({ url: fetched.url, rows: parsed.rows });
      if (rows.length >= 2_000) break;
      pageUrl = parsed.nextUrl;
    } catch (error) {
      // History is optional; a failed request must not drop the catalog product.
      if (/HTTP (?:401|403|429)|Sign in to TrackaLacker/i.test(error instanceof Error ? error.message : "")) budget.blocked = true;
      break;
    } finally { await pause(ENRICHMENT_DELAY_MS); }
  }
  const reference = referenceFromHistoryRows(rows, listing.sourceListingUrl, timeZone, observedAt);
  if (reference) {
    const source = pageRows.find(page => page.rows.some(row => row.time === reference.reportedAt
      && referenceFromHistoryRows([row], page.url, timeZone, observedAt)?.priceCents === reference.priceCents));
    if (source) reference.sourceUrl = source.url;
  }
  return reference;
}

async function runTrackalackerSync(syncId: string, requestedMode: SyncMode): Promise<void> {
  const counts = { discovered: 0, processed: 0, imported: 0, failed: 0, page: 0, pages: 0 };
  const history = { read: 0, reported: 0, estimated: 0, deferred: 0 };
  let phase: "discovering" | "importing" = "discovering";
  let currentTitle = "";
  let stopReason: "" | "blocked" | "signed_out" | "challenged" = "";
  let lastProgressAt = 0;
  const report = async (message: string, force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
    lastProgressAt = now;
    await progress(syncId, { phase, ...counts, currentTitle, message });
  };
  try {
    const paced = createPacer(REQUESTS_PER_SECOND);
    const pacedText = (url: string) => paced(() => fetchText(url));
    const pacedJson = (url: string) => paced(() => fetchJson(url));
    const pacedResolve: typeof resolveListingIdentity = (candidates, expectedRetailer) =>
      paced(() => resolveListingIdentity(candidates, expectedRetailer));
    const planned = await runtimeMessage({ type: "yoink:trackalacker-sync-plan", syncId });
    const mode: SyncMode = planned.mode === "quick" || planned.mode === "full" ? planned.mode : requestedMode;
    const known = planned.ok && planned.plan?.listings && typeof planned.plan.listings === "object" ? planned.plan.listings : {};
    const pictured = new Set(planned.ok && Array.isArray(planned.plan?.productsWithImages) ? planned.plan.productsWithImages.map(String) : []);
    const skip = new Set(planned.ok && Array.isArray(planned.plan?.skipProductIds) ? planned.plan.skipProductIds.map(String) : []);
    // A resumed run continues as "importing": the server never moves a run back to discovering.
    if (skip.size) phase = "importing";
    await report("Reading followed products from your signed-in TrackaLacker session…", true);
    const items: FollowedProduct[] = [];
    const seen = new Set<string>();
    const sampleSink: RawFieldSampleSink = { listItem: null, productDetail: null };
    const enrichmentCache = new Map<string, string>();
    const enrichmentBudget = { remaining: MAX_ENRICHMENT_FETCHES };
    let totalPages = 1;
    for (let page = 1; page <= totalPages; page += 1) {
      const fetched = await pacedText(page === 1 ? FOLLOWED_URL : `${FOLLOWED_URL}?page=${page}`);
      const documentValue = new DOMParser().parseFromString(fetched.text, "text/html");
      const parsed = parseFollowedPage(documentValue, fetched.url, sampleSink);
      if (parsed.challenged) throw new Error("Complete TrackaLacker's browser security verification, then retry.");
      if (parsed.signedOut) throw new Error("Sign in to TrackaLacker in this browser, then retry.");
      totalPages = Math.min(MAX_DECLARED_PAGES, Math.max(totalPages, parsed.totalPages));
      for (const item of parsed.items) {
        if (!seen.has(item.sourceProductId)) {
          seen.add(item.sourceProductId);
          items.push(item);
        }
      }
      Object.assign(counts, { page, pages: totalPages, discovered: items.length });
      await report(`Found ${items.length} followed product${items.length === 1 ? "" : "s"} across page ${page} of ${totalPages}.`);
    }
    if (!items.length) {
      await sendRawFieldSample(syncId, sampleSink);
      throw new Error("No followed products were found. Confirm your TrackaLacker followed page has products, then retry.");
    }
    // Products the interrupted run already saved count as done.
    const queue = items.filter((item) => !skip.has(item.sourceProductId));
    counts.processed = counts.imported = items.length - queue.length;
    phase = "importing";
    await report(`Updating ${queue.length} product${queue.length === 1 ? "" : "s"}…`, true);
    let historyBudget = mode === "full" ? HISTORY_LISTINGS_PER_RUN : 0;
    const historyStale = (listing: CatalogListing) => {
      const checked = Date.parse(known[listing.sourceListingId]?.historyCheckedAt || "");
      return !Number.isFinite(checked) || Date.now() - checked > HISTORY_MAX_AGE_MS;
    };
    const importOne = async (item: FollowedProduct) => {
      currentTitle = item.title;
      try {
        const detail = await pacedJson(`${item.sourceProductUrl.replace(/\/$/, "")}.json`);
        const product = await parseProductPayload(detail.data, item, sampleSink, known, pacedResolve, mode === "full");
        for (const listing of product.listings) {
          if (!historyStale(listing)) continue;
          if (historyBudget <= 0 || stopReason) {
            history.deferred += 1;
            continue;
          }
          historyBudget -= 1;
          let pagesRead = 0;
          const budget = { remaining: 3, blocked: false };
          listing.msrpReference = await fetchHistoryReference(listing, product.observedAt, budget, async (url) => {
            const page = await pacedText(url);
            pagesRead += 1;
            return page;
          }, async () => {});
          if (budget.blocked) stopReason = stopReason || "blocked";
          // Recorded only when a page was read, so a failed request is retried next pass.
          listing.historyChecked = pagesRead > 0 && !budget.blocked;
          history.read += 1;
          if (listing.msrpReference?.kind === "reported_msrp") history.reported += 1;
          else if (listing.msrpReference?.kind === "approximate_msrp") history.estimated += 1;
        }
        // A product Yoink has no picture for gets its page's share image, on any pass.
        if (!product.imageUrl && !pictured.has(product.sourceProductId)) {
          try { product.imageUrl = await enrichMissingImage(product, enrichmentCache, enrichmentBudget, pacedText, async () => {}); } catch { /* optional */ }
        }
        const result = await runtimeMessage({ type: "yoink:trackalacker-sync-item", syncId, item: product });
        if (!result.ok) throw new Error(result.message || "Yoink rejected one catalog product.");
        counts.imported += 1;
      } catch (error) {
        counts.failed += 1;
        stopReason = stopReason || stopReasonFor(error);
      }
      counts.processed += 1;
      await report(`Updated ${counts.processed} of ${counts.discovered}: ${item.title}`);
    };
    let cursor = 0;
    const worker = async () => {
      while (!stopReason && cursor < queue.length) await importOne(queue[cursor++]!);
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_PRODUCTS, queue.length) }, worker));
    await sendRawFieldSample(syncId, sampleSink);
    currentTitle = "";
    if (stopReason) {
      await progress(syncId, {
        phase: "error", ...counts, currentTitle, stopReason,
        message: stopReason === "signed_out" ? "Sign in to TrackaLacker in this browser; Yoink tries again later."
          : stopReason === "challenged" ? "TrackaLacker asked this browser to verify itself. Open TrackaLacker and complete it; Yoink tries again later."
            : `TrackaLacker asked Yoink to slow down after ${counts.processed} of ${counts.discovered} products. Yoink stopped and tries again later.`
      });
      return;
    }
    const historyNote = mode === "full"
      ? ` History read for ${history.read} listing${history.read === 1 ? "" : "s"} (${history.reported} MSRP, ${history.estimated} estimates)${history.deferred ? `; ${history.deferred} more on later passes` : ""}.`
      : " Prices and stock refreshed; History is read on the nightly pass.";
    await progress(syncId, {
      phase: "complete", ...counts, currentTitle,
      message: `Updated ${counts.imported} followed product${counts.imported === 1 ? "" : "s"}${counts.failed ? `; ${counts.failed} could not be read` : ""}.${historyNote}`
    });
  } catch (error) {
    await progress(syncId, {
      phase: "error", ...counts, currentTitle: "",
      stopReason: stopReasonFor(error),
      message: cleanText(error instanceof Error ? error.message : "TrackaLacker sync failed.", 300)
    });
  } finally {
    runningSyncId = "";
  }
}

export function startTrackalackerSync(syncIdValue: string, modeValue: unknown = "full"): { ok: boolean; syncId: string; alreadyRunning: boolean } {
  const syncId = cleanText(syncIdValue, 120);
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(syncId)) throw new Error("The TrackaLacker sync ID is invalid.");
  if (runningSyncId) return { ok: true, syncId: runningSyncId, alreadyRunning: true };
  runningSyncId = syncId;
  void runTrackalackerSync(syncId, modeValue === "quick" ? "quick" : "full");
  return { ok: true, syncId, alreadyRunning: false };
}

Object.defineProperty(globalThis, "YoinkTrackalackerSync", {
  value: Object.freeze({
    startTrackalackerSync,
    // Exposed for direct unit testing of the extraction/sanitization logic only;
    // not part of the message-passing contract with the background service worker.
    productImageUrl,
    productMsrpCents,
    normalizeMoneyToCents,
    sanitizedFieldSample,
    boundedSample,
    extractOgImage,
    enrichMissingImage,
    parseHistoryPage,
    fetchHistoryReference,
    parseFollowedPage
  }),
  configurable: true
});
