"use strict";
var YoinkTrackalackerSyncModule = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // apps/extension/src/trackalacker-sync.ts
  var trackalacker_sync_exports = {};
  __export(trackalacker_sync_exports, {
    fetchHistoryReference: () => fetchHistoryReference,
    parseHistoryPage: () => parseHistoryPage,
    startTrackalackerSync: () => startTrackalackerSync
  });

  // packages/domain/src/trackalacker-history.ts
  function trackalackerHistoryUrl(value, listingUrl, listingId) {
    try {
      const url = new URL(value, listingUrl);
      const expected = new URL(listingUrl);
      for (const item of [url, expected]) {
        if (item.protocol !== "https:" || item.username || item.password || item.port || !["trackalacker.com", "www.trackalacker.com"].includes(item.hostname)) return "";
      }
      const path = expected.pathname.replace(/\/$/, "");
      const id = path.match(/\/listings\/(\d{1,20})(?:\/[^/]+)?$/)?.[1];
      if (!id || listingId !== void 0 && id !== listingId || url.pathname.replace(/\/$/, "") !== path) return "";
      if ([...url.searchParams.keys()].some((key) => key !== "page") || url.searchParams.getAll("page").length > 1) return "";
      const page = url.searchParams.get("page");
      if (page !== null && !/^[1-9]\d{0,4}$/.test(page)) return "";
      url.hostname = "www.trackalacker.com";
      url.hash = "";
      return url.href;
    } catch {
      return "";
    }
  }
  function historyTimeOrder(value) {
    const text = value.trim();
    if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) {
      const time = Date.parse(text);
      return Number.isFinite(time) ? time : null;
    }
    const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return null;
    const [, month, day, year, hour, minute, second, meridian] = match;
    if (Number(hour) < 1 || Number(hour) > 12 || Number(minute) > 59 || Number(second) > 59) return null;
    const date = new Date(Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour) % 12 + (meridian.toUpperCase() === "PM" ? 12 : 0),
      Number(minute),
      Number(second)
    ));
    return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day) ? date.getTime() : null;
  }
  function historyMsrpKind(value) {
    const text = value.replace(/\s+/g, " ").trim();
    if (/^in\s+stock\s*\(\s*msrp\s*\)$/i.test(text)) return "reported_msrp";
    return /^in\s+stock\s*\(\s*[~≈]\s*msrp\s*\)$/i.test(text) ? "approximate_msrp" : null;
  }
  function priceCents(value) {
    const match = value.trim().match(/^\$\s*((?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?)$/);
    if (!match) return null;
    const cents = Math.round(Number(match[1].replaceAll(",", "")) * 100);
    return Number.isSafeInteger(cents) && cents > 0 && cents <= 1e8 ? cents : null;
  }
  function referenceFromHistoryRows(rows, sourceUrl, timeZone, observedAt) {
    const seen = /* @__PURE__ */ new Set();
    const candidates = rows.slice(0, 2e3).flatMap((row) => {
      const price = priceCents(row.price);
      const order = historyTimeOrder(row.time);
      const kind = historyMsrpKind(row.status);
      const key = `${kind}:${price}:${order}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return kind && price !== null && order !== null ? [{ kind, price, order, time: row.time.trim() }] : [];
    }).sort((a, b) => Number(a.kind !== "reported_msrp") - Number(b.kind !== "reported_msrp") || b.order - a.order);
    const latest = candidates[0];
    if (!latest || candidates.some((row) => row.kind === latest.kind && row.order === latest.order && row.price !== latest.price)) return null;
    return {
      kind: latest.kind,
      priceCents: latest.price,
      currency: "USD",
      label: latest.kind === "reported_msrp" ? "In Stock (MSRP)" : "In Stock (~ MSRP)",
      sourceUrl,
      reportedAt: latest.time,
      timeZone,
      sampleCount: candidates.filter((row) => row.kind === latest.kind && row.price === latest.price).length,
      observedAt
    };
  }

  // apps/extension/src/trackalacker-sync.ts
  var FOLLOWED_URL = "https://www.trackalacker.com/products/followed";
  var MAX_DECLARED_PAGES = 1e5;
  var FETCH_TIMEOUT_MS = 15e3;
  var MAX_ENRICHMENT_FETCHES = 800;
  var TRACKALACKER_IMAGE_HOST = "https://static.trackalacker.com";
  var IMAGE_FILE = /\.(?:jpe?g|png|webp|gif|avif)$/i;
  var ENRICHMENT_DELAY_MS = 200;
  var SAMPLE_MAX_BYTES = 4096;
  var REQUESTS_PER_SECOND = 3;
  var PARALLEL_PRODUCTS = 6;
  var PROGRESS_INTERVAL_MS = 2e3;
  var HISTORY_MAX_AGE_MS = 7 * 24 * 60 * 6e4;
  var HISTORY_LISTINGS_PER_RUN = 300;
  function createPacer(perSecond) {
    let next = 0;
    return async function paced(task) {
      const now = Date.now();
      const start = Math.max(now, next);
      next = start + 1e3 / perSecond;
      if (start > now) await delay(start - now);
      return task();
    };
  }
  function stopReasonFor(error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    if (/security verification|verify you are human|checking your browser/i.test(message)) return "challenged";
    if (/Sign in to TrackaLacker|HTTP 401/i.test(message)) return "signed_out";
    if (/HTTP (?:403|429)/i.test(message)) return "blocked";
    return "";
  }
  var runningSyncId = "";
  function cleanText(value, maximum = 300) {
    return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
  }
  function numericId(value) {
    const text = cleanText(value, 30);
    return /^\d{1,20}$/.test(text) ? text : "";
  }
  function moneyCents(value) {
    if (value === null || value === void 0 || value === "") return null;
    const amount = Number(String(value).replaceAll(",", "").replace("$", "").trim());
    return Number.isFinite(amount) && amount > 0 && amount <= 1e6 ? Math.round(amount * 100) : null;
  }
  function normalizeMoneyToCents(value, unit = "dollars") {
    if (value === null || value === void 0 || value === "") return null;
    if (typeof value !== "string" && typeof value !== "number") return null;
    const text = String(value).trim();
    if (unit === "cents") {
      if (!/^\d+$/.test(text)) return null;
      const cents2 = Number(text);
      return Number.isSafeInteger(cents2) && cents2 > 0 && cents2 <= 1e8 ? cents2 : null;
    }
    const dollars = text.replace(/^(?:USD\s*|\$\s*)/i, "");
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(dollars)) return null;
    const cents = Math.round(Number(dollars.replaceAll(",", "")) * 100);
    return Number.isSafeInteger(cents) && cents > 0 && cents <= 1e8 ? cents : null;
  }
  var MSRP_FIELDS = ["msrp", "msrp_cents", "msrpCents"];
  function productMsrpCents(...sources) {
    for (const record of sources) {
      if (!record) continue;
      const currency = cleanText(record.currency ?? record.currency_code, 10).toUpperCase();
      if (currency && currency !== "USD") continue;
      const candidates = /* @__PURE__ */ new Set();
      for (const field of MSRP_FIELDS) {
        const cents = normalizeMoneyToCents(record[field], field === "msrp" ? "dollars" : "cents");
        if (cents !== null) candidates.add(cents);
      }
      if (candidates.size > 1) return null;
      if (candidates.size === 1) return [...candidates][0] ?? null;
    }
    return null;
  }
  function trackalackerUrl(value, base = FOLLOWED_URL) {
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
  function productSlug(value) {
    const text = cleanText(value, 240).toLowerCase();
    return /^[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?$/.test(text) ? text : "";
  }
  function imageAddress(value) {
    const text = cleanText(value, 2048);
    if (/^https?:\/\//i.test(text)) return text;
    if (text.startsWith("//")) return `https:${text}`;
    if (/^\/?uploads\//i.test(text)) return `${TRACKALACKER_IMAGE_HOST}/${text.replace(/^\//, "")}`;
    return text;
  }
  function trackalackerImage(value) {
    try {
      const url = new URL(imageAddress(value));
      const host = url.hostname.toLowerCase();
      return url.protocol === "https:" && (host === "trackalacker.com" || host.endsWith(".trackalacker.com")) && (/\/uploads\//i.test(url.pathname) || IMAGE_FILE.test(url.pathname));
    } catch {
      return false;
    }
  }
  function trackalackerImageStrings(value, depth = 0) {
    if (depth > 3) return [];
    if (typeof value === "string") return trackalackerImage(value) ? [imageAddress(value)] : [];
    if (Array.isArray(value)) return value.slice(0, 16).flatMap((item) => trackalackerImageStrings(item, depth + 1));
    if (!value || typeof value !== "object") return [];
    return Object.values(value).slice(0, 40).flatMap((item) => trackalackerImageStrings(item, depth + 1));
  }
  function photoItemImages(items) {
    if (!Array.isArray(items)) return [];
    const found = [];
    for (const item of items.slice(0, 16)) {
      found.push(...imageValues(item).map(imageAddress), ...trackalackerImageStrings(item));
      const record = item && typeof item === "object" && !Array.isArray(item) ? item : null;
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
  function sanitizeImageCandidate(value) {
    try {
      const url = new URL(imageAddress(value));
      if (url.protocol !== "https:" || url.username || url.password) return "";
      url.hash = "";
      return url.href;
    } catch {
      return "";
    }
  }
  function firstSrcsetUrl(value) {
    return value.trim().split(/\s+/)[0]?.replace(/,$/, "") ?? "";
  }
  function imageValues(candidate, depth = 0) {
    if (depth > 4) return [];
    if (typeof candidate === "string") return [candidate];
    if (Array.isArray(candidate)) return candidate.slice(0, 16).flatMap((value) => imageValues(value, depth + 1));
    if (!candidate || typeof candidate !== "object") return [];
    const record = candidate;
    const values = typeof record.srcset === "string" ? [firstSrcsetUrl(record.srcset)] : [];
    for (const key of ["url", "src", "image_url", "imageUrl", "photo_url", "photo", "image", "original", "thumbnail"]) {
      values.push(...imageValues(record[key], depth + 1));
    }
    return values;
  }
  var SELLER_NAME_FIELDS = ["seller_name", "sellerName", "seller", "sold_by", "soldBy", "merchant", "vendor"];
  var MARKETPLACE_FLAG_FIELDS = ["is_marketplace", "marketplace", "third_party", "is_third_party", "thirdParty"];
  var FIRST_PARTY_FLAG_FIELDS = ["is_first_party", "first_party", "firstParty", "sold_by_retailer"];
  function listingSeller(...records) {
    let sellerName = "";
    let sellerType = "unknown";
    for (const record of records) {
      for (const field of SELLER_NAME_FIELDS) {
        const value = record[field];
        const name = typeof value === "string" ? value : value && typeof value === "object" && !Array.isArray(value) ? String(value.name ?? value.display_name ?? "") : "";
        if (!sellerName && cleanText(name, 160)) sellerName = cleanText(name, 160);
      }
      for (const field of MARKETPLACE_FLAG_FIELDS) if (record[field] === true) sellerType = "third_party";
      for (const field of FIRST_PARTY_FLAG_FIELDS) if (record[field] === true) sellerType = "first_party";
    }
    return { sellerType, sellerName };
  }
  var IMAGE_FIELDS = [
    "image_url",
    "imageUrl",
    "image",
    "photo_url",
    "primary_image_url",
    "thumbnail_url",
    "thumb_url",
    "img",
    "picture",
    "media",
    "images",
    "photo_items",
    "photo",
    "canonical_image_url"
  ];
  function productImageUrl(...sources) {
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
  function slugFromUrl(value) {
    try {
      return productSlug(new URL(value).pathname.match(/\/products\/showcase\/([^/]+)/i)?.[1]);
    } catch {
      return "";
    }
  }
  function reactPropsFor(documentValue, componentName) {
    const root = [...documentValue.querySelectorAll("[data-react-class][data-react-props]")].find((candidate) => candidate.getAttribute("data-react-class") === componentName);
    if (!root) return { found: false, value: null };
    const raw = root.getAttribute("data-react-props") ?? "";
    if (!raw || raw.length > 5e6) return { found: true, value: null };
    try {
      const value = JSON.parse(raw);
      return { found: true, value: value && typeof value === "object" && !Array.isArray(value) ? value : null };
    } catch {
      return { found: true, value: null };
    }
  }
  function parseFollowedPage(documentValue, pageUrl, sampleSink) {
    const hydration = reactPropsFor(documentValue, "products/YourProductsApp");
    const props = hydration.value?.searchResultsProps;
    const rawResults = Array.isArray(props?.results) ? props.results : [];
    if (sampleSink && !sampleSink.listItem) {
      const first = rawResults[0];
      if (first && typeof first === "object" && !Array.isArray(first)) sampleSink.listItem = first;
    }
    const items = [];
    const seen = /* @__PURE__ */ new Set();
    for (const raw of rawResults) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const item = raw;
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
    const pagination = props?.pagination;
    const pages = Number(pagination?.total_pages);
    const body = cleanText(documentValue.body?.innerText, 2e4).toLowerCase();
    return {
      items,
      totalPages: Number.isSafeInteger(pages) && pages > 0 ? Math.min(MAX_DECLARED_PAGES, pages) : 1,
      signedOut: Boolean(documentValue.querySelector('form[action*="login"], input[type="password"]')) || /sign in to continue|log in to continue/.test(body),
      challenged: /checking your browser|verify you are human|security verification|cf-chl-/.test(body)
    };
  }
  function retailerForStore(value) {
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
  function availabilityFrom(value) {
    const text = cleanText(value, 500).toLowerCase();
    if (/pre-?order/.test(text)) return "preorder";
    if (/out of stock|unavailable|sold out/.test(text)) return "out_of_stock";
    if (/in stock|available|on sale|sale/.test(text)) return "in_stock";
    return "unknown";
  }
  function safeOutboundUrl(value) {
    try {
      const url = new URL(cleanText(value, 4096));
      if (url.protocol !== "https:" || url.username || url.password) return "";
      url.hash = "";
      return url.href;
    } catch {
      return "";
    }
  }
  function runtimeMessage(message) {
    const chromeRuntime = globalThis.chrome?.runtime;
    if (!chromeRuntime?.sendMessage) return Promise.resolve({ ok: false, reason: "extension_runtime_unavailable" });
    return chromeRuntime.sendMessage(message).catch(() => ({ ok: false, reason: "extension_message_failed" }));
  }
  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
  async function fetchText(url) {
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
  async function fetchJson(url) {
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
      const value = await response.json();
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("TrackaLacker returned unreadable product data.");
      return { data: value, url: response.url };
    } finally {
      clearTimeout(timeout);
    }
  }
  async function resolveListingIdentity(candidates, expectedRetailer) {
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
  async function parseProductPayload(data, summary, sampleSink, known = {}, resolve = resolveListingIdentity, recheckUnresolved = true) {
    const product = data.product && typeof data.product === "object" && !Array.isArray(data.product) ? data.product : {};
    if (sampleSink && !sampleSink.productDetail && Object.keys(product).length) {
      sampleSink.productDetail = product;
    }
    const rawListings = Array.isArray(product.listings) ? product.listings : [];
    const listings = [];
    const seen = /* @__PURE__ */ new Set();
    for (const rawValue of rawListings) {
      if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) continue;
      const raw = rawValue;
      const sourceListingId = numericId(raw.id);
      if (!sourceListingId || seen.has(sourceListingId)) continue;
      seen.add(sourceListingId);
      const provider = raw.provider && typeof raw.provider === "object" && !Array.isArray(raw.provider) ? raw.provider : {};
      const storeName = cleanText(provider.display_name || provider.short_display_name || "Other store", 120) || "Other store";
      const candidates = [raw.url, raw.preferred_product_url, raw.purchase_url, raw.affiliate_url].map(safeOutboundUrl).filter(Boolean);
      const expectedRetailer = retailerForStore(storeName);
      const previous = known[sourceListingId];
      const reusable = previous && (!candidates.length || candidates.includes(previous.outboundUrl)) && (previous.retailerSku || !recheckUnresolved || !expectedRetailer);
      const identity = reusable ? { retailerId: previous.retailerId, retailerSku: previous.retailerSku, canonicalUrl: previous.canonicalUrl, outboundUrl: previous.outboundUrl } : await resolve(candidates, expectedRetailer);
      const current = raw.current_status && typeof raw.current_status === "object" && !Array.isArray(raw.current_status) ? raw.current_status : {};
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
      observedAt: (/* @__PURE__ */ new Date()).toISOString(),
      listings
    };
  }
  var SENSITIVE_SAMPLE_KEY = /(?:^|_)(?:token|secret|password|auth|cookie|session|csrf|credential|api_?key)(?:$|_)/i;
  function sampledPrimitive(value) {
    if (typeof value === "string") return value.length > 120 ? `${value.slice(0, 120)}\u2026` : value;
    return value;
  }
  function sanitizedFieldSample(record, depth = 0) {
    if (!record) return {};
    const output = {};
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
        output[safeKey] = depth < 1 ? sanitizedFieldSample(value, depth + 1) : "[object]";
        continue;
      }
      output[safeKey] = value === void 0 ? null : sampledPrimitive(value);
    }
    return output;
  }
  function boundedSample(value) {
    const entries = Object.entries(value);
    const originalCount = entries.length;
    while (entries.length && JSON.stringify(Object.fromEntries(entries)).length > SAMPLE_MAX_BYTES) {
      entries.pop();
    }
    const bounded = Object.fromEntries(entries);
    return entries.length === originalCount ? bounded : { ...bounded, truncated: true };
  }
  function photoItemSample(value, depth = 0) {
    if (typeof value === "string") return value.length > 300 ? `${value.slice(0, 300)}\u2026` : value;
    if (value === null || typeof value !== "object") return value ?? null;
    if (depth >= 3) return Array.isArray(value) ? `[array:${value.length}]` : "[object]";
    if (Array.isArray(value)) return value.slice(0, 2).map((item) => photoItemSample(item, depth + 1));
    const output = {};
    for (const [key, item] of Object.entries(value).slice(0, 30)) {
      output[cleanText(key, 100)] = SENSITIVE_SAMPLE_KEY.test(key) ? "[stripped]" : photoItemSample(item, depth + 1);
    }
    return output;
  }
  async function sendRawFieldSample(syncId, sink) {
    if (!sink.listItem && !sink.productDetail) return;
    const photoItems = [sink.productDetail?.photo_items, sink.listItem?.photo_items].find((value) => Array.isArray(value) && value.length);
    const sample = boundedSample({
      // First, so the size cap (which drops from the end) keeps it.
      ...photoItems ? { photoItem: photoItemSample(photoItems[0]) } : {},
      ...sink.listItem ? { listItem: sanitizedFieldSample(sink.listItem) } : {},
      ...sink.productDetail ? { productDetail: sanitizedFieldSample(sink.productDetail) } : {}
    });
    try {
      await runtimeMessage({ type: "yoink:trackalacker-sync-sample", syncId, sample });
    } catch {
    }
  }
  function extractOgImage(html) {
    const metaTagPattern = /<meta\b[^>]*>/gi;
    let match;
    while (match = metaTagPattern.exec(html)) {
      const tag = match[0];
      if (!/\bproperty\s*=\s*["']og:image["']/i.test(tag)) continue;
      const content = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(tag);
      if (content?.[1]) return sanitizeImageCandidate(content[1].replace(/&amp;|&#0*38;|&#x0*26;/gi, "&"));
    }
    return "";
  }
  async function fetchOgImage(productUrl, fetchPage = fetchText) {
    try {
      const fetched = await fetchPage(productUrl);
      return extractOgImage(fetched.text);
    } catch {
      return "";
    }
  }
  async function enrichMissingImage(product, cache, budget, fetchPage = fetchText, pause = delay) {
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
  async function progress(syncId, value) {
    await runtimeMessage({ type: "yoink:trackalacker-sync-progress", syncId, ...value });
  }
  function parseHistoryPage(documentValue, pageUrl) {
    const text = documentValue.body?.textContent ?? "";
    const blocked = /checking your browser|verify you are human|security verification|cf-chl-|just a moment/i.test(text) || Boolean(documentValue.querySelector('input[type="password"], #challenge-form, script[src*="/cdn-cgi/challenge"]'));
    const result = { rows: [], timeZone: "", nextUrl: "", blocked };
    if (blocked) return result;
    for (const table of Array.from(documentValue.querySelectorAll("table"))) {
      const headings = Array.from(table.querySelectorAll("tr")).find((row) => {
        const cells = Array.from(row.cells).map((cell) => cleanText(cell.textContent));
        return cells.some((cell) => /^Time(?:\s*\([^)]+\))?$/i.test(cell)) && cells.includes("Price") && cells.includes("Status");
      });
      if (!headings) continue;
      const headers = Array.from(headings.cells).map((cell) => cleanText(cell.textContent));
      const timeIndex = headers.findIndex((cell) => /^Time(?:\s*\([^)]+\))?$/i.test(cell));
      result.timeZone = headers[timeIndex]?.match(/\(([^)]+)\)/)?.[1] ?? "";
      for (const row of Array.from(table.querySelectorAll("tr")).slice(0, 2001)) {
        if (row === headings) continue;
        result.rows.push({
          time: cleanText(row.cells[timeIndex]?.textContent, 80),
          price: cleanText(row.cells[headers.indexOf("Price")]?.textContent, 80),
          status: cleanText(row.cells[headers.indexOf("Status")]?.textContent, 120)
        });
      }
      for (const link of Array.from(documentValue.querySelectorAll('a[rel="next"], .pagination a, nav[aria-label*="agination"] a'))) {
        if (link.getAttribute("rel") !== "next" && !/^next\b|^[›»→]$/i.test(cleanText(link.textContent))) continue;
        const next = trackalackerHistoryUrl(link.getAttribute("href") ?? "", pageUrl);
        if (next && next !== pageUrl && new URL(next).searchParams.has("page")) {
          result.nextUrl = next;
          break;
        }
      }
      break;
    }
    return result;
  }
  async function fetchHistoryReference(listing, observedAt, budget, fetchPage = fetchText, pause = delay) {
    let pageUrl = trackalackerHistoryUrl(listing.sourceListingUrl, listing.sourceListingUrl, listing.sourceListingId);
    const rows = [];
    const pageRows = [];
    const seen = /* @__PURE__ */ new Set();
    let timeZone = "";
    for (let page = 0; page < 3 && pageUrl && !seen.has(pageUrl) && budget.remaining > 0 && !budget.blocked; page++) {
      seen.add(pageUrl);
      budget.remaining--;
      try {
        const fetched = await fetchPage(pageUrl);
        if (!trackalackerHistoryUrl(fetched.url, listing.sourceListingUrl, listing.sourceListingId)) break;
        const parsed = parseHistoryPage(new DOMParser().parseFromString(fetched.text, "text/html"), pageUrl);
        if (parsed.blocked) {
          budget.blocked = true;
          break;
        }
        if (rows.length && parsed.timeZone !== timeZone) break;
        timeZone = parsed.timeZone;
        rows.push(...parsed.rows);
        pageRows.push({ url: fetched.url, rows: parsed.rows });
        if (rows.length >= 2e3) break;
        pageUrl = parsed.nextUrl;
      } catch (error) {
        if (/HTTP (?:401|403|429)|Sign in to TrackaLacker/i.test(error instanceof Error ? error.message : "")) budget.blocked = true;
        break;
      } finally {
        await pause(ENRICHMENT_DELAY_MS);
      }
    }
    const reference = referenceFromHistoryRows(rows, listing.sourceListingUrl, timeZone, observedAt);
    if (reference) {
      const source = pageRows.find((page) => page.rows.some((row) => row.time === reference.reportedAt && referenceFromHistoryRows([row], page.url, timeZone, observedAt)?.priceCents === reference.priceCents));
      if (source) reference.sourceUrl = source.url;
    }
    return reference;
  }
  async function runTrackalackerSync(syncId, requestedMode) {
    const counts = { discovered: 0, processed: 0, imported: 0, failed: 0, page: 0, pages: 0 };
    const history = { read: 0, reported: 0, estimated: 0, deferred: 0 };
    let phase = "discovering";
    let currentTitle = "";
    let stopReason = "";
    let lastProgressAt = 0;
    const report = async (message, force = false) => {
      const now = Date.now();
      if (!force && now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
      lastProgressAt = now;
      await progress(syncId, { phase, ...counts, currentTitle, message });
    };
    try {
      const paced = createPacer(REQUESTS_PER_SECOND);
      const pacedText = (url) => paced(() => fetchText(url));
      const pacedJson = (url) => paced(() => fetchJson(url));
      const pacedResolve = (candidates, expectedRetailer) => paced(() => resolveListingIdentity(candidates, expectedRetailer));
      const planned = await runtimeMessage({ type: "yoink:trackalacker-sync-plan", syncId });
      const mode = planned.mode === "quick" || planned.mode === "full" ? planned.mode : requestedMode;
      const known = planned.ok && planned.plan?.listings && typeof planned.plan.listings === "object" ? planned.plan.listings : {};
      const pictured = new Set(planned.ok && Array.isArray(planned.plan?.productsWithImages) ? planned.plan.productsWithImages.map(String) : []);
      const skip = new Set(planned.ok && Array.isArray(planned.plan?.skipProductIds) ? planned.plan.skipProductIds.map(String) : []);
      if (skip.size) phase = "importing";
      await report("Reading followed products from your signed-in TrackaLacker session\u2026", true);
      const items = [];
      const seen = /* @__PURE__ */ new Set();
      const sampleSink = { listItem: null, productDetail: null };
      const enrichmentCache = /* @__PURE__ */ new Map();
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
      const queue = items.filter((item) => !skip.has(item.sourceProductId));
      counts.processed = counts.imported = items.length - queue.length;
      phase = "importing";
      await report(`Updating ${queue.length} product${queue.length === 1 ? "" : "s"}\u2026`, true);
      let historyBudget = mode === "full" ? HISTORY_LISTINGS_PER_RUN : 0;
      const historyStale = (listing) => {
        const checked = Date.parse(known[listing.sourceListingId]?.historyCheckedAt || "");
        return !Number.isFinite(checked) || Date.now() - checked > HISTORY_MAX_AGE_MS;
      };
      const importOne = async (item) => {
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
            }, async () => {
            });
            if (budget.blocked) stopReason = stopReason || "blocked";
            listing.historyChecked = pagesRead > 0 && !budget.blocked;
            history.read += 1;
            if (listing.msrpReference?.kind === "reported_msrp") history.reported += 1;
            else if (listing.msrpReference?.kind === "approximate_msrp") history.estimated += 1;
          }
          if (!product.imageUrl && !pictured.has(product.sourceProductId)) {
            try {
              product.imageUrl = await enrichMissingImage(product, enrichmentCache, enrichmentBudget, pacedText, async () => {
              });
            } catch {
            }
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
        while (!stopReason && cursor < queue.length) await importOne(queue[cursor++]);
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL_PRODUCTS, queue.length) }, worker));
      await sendRawFieldSample(syncId, sampleSink);
      currentTitle = "";
      if (stopReason) {
        await progress(syncId, {
          phase: "error",
          ...counts,
          currentTitle,
          stopReason,
          message: stopReason === "signed_out" ? "Sign in to TrackaLacker in this browser; Yoink tries again later." : stopReason === "challenged" ? "TrackaLacker asked this browser to verify itself. Open TrackaLacker and complete it; Yoink tries again later." : `TrackaLacker asked Yoink to slow down after ${counts.processed} of ${counts.discovered} products. Yoink stopped and tries again later.`
        });
        return;
      }
      const historyNote = mode === "full" ? ` History read for ${history.read} listing${history.read === 1 ? "" : "s"} (${history.reported} MSRP, ${history.estimated} estimates)${history.deferred ? `; ${history.deferred} more on later passes` : ""}.` : " Prices and stock refreshed; History is read on the nightly pass.";
      await progress(syncId, {
        phase: "complete",
        ...counts,
        currentTitle,
        message: `Updated ${counts.imported} followed product${counts.imported === 1 ? "" : "s"}${counts.failed ? `; ${counts.failed} could not be read` : ""}.${historyNote}`
      });
    } catch (error) {
      await progress(syncId, {
        phase: "error",
        ...counts,
        currentTitle: "",
        stopReason: stopReasonFor(error),
        message: cleanText(error instanceof Error ? error.message : "TrackaLacker sync failed.", 300)
      });
    } finally {
      runningSyncId = "";
    }
  }
  function startTrackalackerSync(syncIdValue, modeValue = "full") {
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
  return __toCommonJS(trackalacker_sync_exports);
})();
