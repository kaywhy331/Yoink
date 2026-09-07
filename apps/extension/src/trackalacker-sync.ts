import type { TrackalackerMsrpReference } from "../../../packages/contracts/src/index.js";
import { referenceFromHistoryRows, trackalackerHistoryUrl, type TrackalackerHistoryRow } from "../../../packages/domain/src/trackalacker-history.js";

const FOLLOWED_URL = "https://www.trackalacker.com/products/followed";
const MAX_DECLARED_PAGES = 100_000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_ENRICHMENT_FETCHES = 25;
const ENRICHMENT_DELAY_MS = 200;
const SAMPLE_MAX_BYTES = 4_096;

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

function sanitizeImageCandidate(value: string): string {
  try {
    const url = new URL(cleanText(value, 2_048));
    if (url.protocol !== "https:" || url.username || url.password) return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function firstSrcsetUrl(value: string): string {
  return value.split(",")[0]?.trim().split(/\s+/)[0] ?? "";
}

// Unwraps a candidate field's value down to a single image URL string, recursing
// into arrays (first element only — e.g. an `images` gallery array) and objects
// that carry the URL under a nested key (`{ url }`, `{ src }`, or `{ srcset }`).
function extractImageValue(candidate: unknown): string {
  if (typeof candidate === "string") return candidate;
  if (Array.isArray(candidate)) return extractImageValue(candidate[0]);
  if (candidate && typeof candidate === "object") {
    const record = candidate as Record<string, unknown>;
    if (typeof record.srcset === "string" && record.srcset) return firstSrcsetUrl(record.srcset);
    if (typeof record.url === "string") return record.url;
    if (typeof record.src === "string") return record.src;
  }
  return "";
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
  "img", "picture", "media", "images"
];

function productImageUrl(...sources: Array<Record<string, unknown> | undefined>): string {
  for (const record of sources) {
    if (!record) continue;
    for (const field of IMAGE_FIELDS) {
      const value = extractImageValue(record[field]);
      if (!value) continue;
      const safe = sanitizeImageCandidate(value);
      if (safe) return safe;
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
  sampleSink?: RawFieldSampleSink
): Promise<TrackalackerProductPayload> {
  const product = data.product && typeof data.product === "object" && !Array.isArray(data.product)
    ? data.product as Record<string, unknown> : {};
  if (sampleSink && !sampleSink.productDetail && Object.keys(product).length) {
    sampleSink.productDetail = product;
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
    const identity = await resolveListingIdentity(candidates, expectedRetailer);
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
    await delay(40);
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

async function sendRawFieldSample(syncId: string, sink: RawFieldSampleSink): Promise<void> {
  if (!sink.listItem && !sink.productDetail) return;
  const sample = boundedSample({
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
    if (content?.[1]) return sanitizeImageCandidate(content[1]);
  }
  return "";
}

async function fetchOgImage(productUrl: string): Promise<string> {
  try {
    const fetched = await fetchText(productUrl);
    return extractOgImage(fetched.text);
  } catch {
    return "";
  }
}

async function enrichMissingImage(
  product: TrackalackerProductPayload,
  cache: Map<string, string>,
  budget: { remaining: number }
): Promise<string> {
  if (product.imageUrl) return product.imageUrl;
  const slug = product.sourceProductSlug;
  if (slug && cache.has(slug)) return cache.get(slug) ?? "";
  if (budget.remaining <= 0) return "";
  budget.remaining -= 1;
  let image = "";
  try {
    image = await fetchOgImage(product.sourceProductUrl);
  } catch {
    image = "";
  }
  if (slug) cache.set(slug, image);
  await delay(ENRICHMENT_DELAY_MS);
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

async function runTrackalackerSync(syncId: string): Promise<void> {
  let processed = 0;
  let imported = 0;
  let failed = 0;
  let historyReported = 0;
  let historyEstimated = 0;
  let historyUnavailable = 0;
  try {
    await progress(syncId, { phase: "discovering", processed, imported, failed, message: "Reading followed products from your signed-in TrackaLacker session…" });
    const items: FollowedProduct[] = [];
    const seen = new Set<string>();
    const sampleSink: RawFieldSampleSink = { listItem: null, productDetail: null };
    const enrichmentCache = new Map<string, string>();
    const enrichmentBudget = { remaining: MAX_ENRICHMENT_FETCHES };
    const historyBudget = { remaining: 0, blocked: false };
    const historyCache = new Map<string, TrackalackerMsrpReference | null>();
    let totalPages = 1;
    for (let page = 1; page <= totalPages; page += 1) {
      const fetched = await fetchText(page === 1 ? FOLLOWED_URL : `${FOLLOWED_URL}?page=${page}`);
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
      await progress(syncId, {
        phase: "discovering",
        page,
        pages: totalPages,
        discovered: items.length,
        processed,
        imported,
        failed,
        message: `Found ${items.length} followed product${items.length === 1 ? "" : "s"} across page ${page} of ${totalPages}.`
      });
      await delay(125);
    }
    if (!items.length) {
      // Send whatever the discovery pass captured before failing — "everything got
      // filtered out" is exactly the scenario the sample exists to diagnose.
      await sendRawFieldSample(syncId, sampleSink);
      throw new Error("No followed products were found. Confirm your TrackaLacker followed page has products, then retry.");
    }
    for (const item of items) {
      await progress(syncId, {
        phase: "importing",
        discovered: items.length,
        processed,
        imported,
        failed,
        currentTitle: item.title,
        message: `Capturing every store listing for ${item.title}…`
      });
      try {
        const detail = await fetchJson(`${item.sourceProductUrl.replace(/\/$/, "")}.json`);
        const product = await parseProductPayload(detail.data, item, sampleSink);
        historyBudget.remaining = product.listings.length * 3;
        for (const listing of product.listings) {
          const key = listing.sourceListingUrl;
          if (!historyCache.has(key)) historyCache.set(key, await fetchHistoryReference(listing, product.observedAt, historyBudget));
          listing.msrpReference = historyCache.get(key) ?? null;
          if (listing.msrpReference?.kind === "reported_msrp") historyReported++;
          else if (listing.msrpReference?.kind === "approximate_msrp") historyEstimated++;
          else historyUnavailable++;
          await progress(syncId, { phase: "importing", discovered: items.length, processed, imported, failed,
            currentTitle: item.title, message: `Reading History for ${item.title}: ${historyReported} reported MSRP, ${historyEstimated} estimates, ${historyUnavailable} unavailable.` });
        }
        if (!product.imageUrl) {
          try {
            product.imageUrl = await enrichMissingImage(product, enrichmentCache, enrichmentBudget);
          } catch {
            // Enrichment is best-effort only; the item still imports without an image.
          }
        }
        const result = await runtimeMessage({ type: "yoink:trackalacker-sync-item", syncId, item: product });
        if (!result.ok) throw new Error(result.message || "Yoink rejected one catalog product.");
        imported += 1;
      } catch {
        failed += 1;
      }
      processed += 1;
      await delay(125);
    }
    await sendRawFieldSample(syncId, sampleSink);
    await progress(syncId, {
      phase: "complete",
      discovered: items.length,
      processed,
      imported,
      failed,
      currentTitle: "",
      message: `Imported ${imported} followed product${imported === 1 ? "" : "s"}${failed ? `; ${failed} could not be read` : ""}. History: ${historyReported} reported MSRP, ${historyEstimated} estimates, ${historyUnavailable} unavailable.${historyBudget.blocked ? " History access was blocked; check TrackaLacker and retry." : ""}`
    });
  } catch (error) {
    await progress(syncId, {
      phase: "error",
      processed,
      imported,
      failed,
      currentTitle: "",
      message: cleanText(error instanceof Error ? error.message : "TrackaLacker sync failed.", 300)
    });
  } finally {
    runningSyncId = "";
  }
}

export function startTrackalackerSync(syncIdValue: string): { ok: boolean; syncId: string; alreadyRunning: boolean } {
  const syncId = cleanText(syncIdValue, 120);
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(syncId)) throw new Error("The TrackaLacker sync ID is invalid.");
  if (runningSyncId) return { ok: true, syncId: runningSyncId, alreadyRunning: true };
  runningSyncId = syncId;
  void runTrackalackerSync(syncId);
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
