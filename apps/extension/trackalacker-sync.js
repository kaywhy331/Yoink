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
    startTrackalackerSync: () => startTrackalackerSync
  });
  var FOLLOWED_URL = "https://www.trackalacker.com/products/followed";
  var MAX_DECLARED_PAGES = 1e5;
  var FETCH_TIMEOUT_MS = 15e3;
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
  function parseFollowedPage(documentValue, pageUrl) {
    const hydration = reactPropsFor(documentValue, "products/YourProductsApp");
    const props = hydration.value?.searchResultsProps;
    const rawResults = Array.isArray(props?.results) ? props.results : [];
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
        msrpCents: moneyCents(item.default_price)
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
  async function parseProductPayload(data, summary) {
    const product = data.product && typeof data.product === "object" && !Array.isArray(data.product) ? data.product : {};
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
      const identity = await resolveListingIdentity(candidates, expectedRetailer);
      const current = raw.current_status && typeof raw.current_status === "object" && !Array.isArray(raw.current_status) ? raw.current_status : {};
      const sourceListingUrl = trackalackerUrl(
        raw.show_path || `${summary.sourceProductUrl.replace(/\/$/, "")}/listings/${sourceListingId}/${summary.sourceProductSlug || "item"}`,
        summary.sourceProductUrl
      );
      if (!sourceListingUrl) continue;
      listings.push({
        sourceListingId,
        storeName,
        retailerId: identity.retailerId,
        retailerSku: identity.retailerSku,
        canonicalUrl: identity.canonicalUrl,
        sourceListingUrl,
        outboundUrl: identity.outboundUrl,
        availability: availabilityFrom(current.short_stock_status_text || current.stock_status || raw.status),
        unitPriceCents: moneyCents(current.price ?? raw.price)
      });
      await delay(40);
    }
    return {
      ...summary,
      title: cleanText(product.name, 300) || summary.title,
      observedAt: (/* @__PURE__ */ new Date()).toISOString(),
      listings
    };
  }
  async function progress(syncId, value) {
    await runtimeMessage({ type: "yoink:trackalacker-sync-progress", syncId, ...value });
  }
  async function runTrackalackerSync(syncId) {
    let processed = 0;
    let imported = 0;
    let failed = 0;
    try {
      await progress(syncId, { phase: "discovering", processed, imported, failed, message: "Reading followed products from your signed-in TrackaLacker session\u2026" });
      const items = [];
      const seen = /* @__PURE__ */ new Set();
      let totalPages = 1;
      for (let page = 1; page <= totalPages; page += 1) {
        const fetched = await fetchText(page === 1 ? FOLLOWED_URL : `${FOLLOWED_URL}?page=${page}`);
        const documentValue = new DOMParser().parseFromString(fetched.text, "text/html");
        const parsed = parseFollowedPage(documentValue, fetched.url);
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
      if (!items.length) throw new Error("No followed products were found. Confirm your TrackaLacker followed page has products, then retry.");
      for (const item of items) {
        await progress(syncId, {
          phase: "importing",
          discovered: items.length,
          processed,
          imported,
          failed,
          currentTitle: item.title,
          message: `Capturing every store listing for ${item.title}\u2026`
        });
        try {
          const detail = await fetchJson(`${item.sourceProductUrl.replace(/\/$/, "")}.json`);
          const product = await parseProductPayload(detail.data, item);
          const result = await runtimeMessage({ type: "yoink:trackalacker-sync-item", syncId, item: product });
          if (!result.ok) throw new Error(result.message || "Yoink rejected one catalog product.");
          imported += 1;
        } catch {
          failed += 1;
        }
        processed += 1;
        await delay(125);
      }
      await progress(syncId, {
        phase: "complete",
        discovered: items.length,
        processed,
        imported,
        failed,
        currentTitle: "",
        message: `Imported ${imported} followed product${imported === 1 ? "" : "s"}${failed ? `; ${failed} could not be read` : ""}.`
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
  function startTrackalackerSync(syncIdValue) {
    const syncId = cleanText(syncIdValue, 120);
    if (!/^[A-Za-z0-9_-]{8,120}$/.test(syncId)) throw new Error("The TrackaLacker sync ID is invalid.");
    if (runningSyncId) return { ok: true, syncId: runningSyncId, alreadyRunning: true };
    runningSyncId = syncId;
    void runTrackalackerSync(syncId);
    return { ok: true, syncId, alreadyRunning: false };
  }
  Object.defineProperty(globalThis, "YoinkTrackalackerSync", {
    value: Object.freeze({ startTrackalackerSync }),
    configurable: true
  });
  return __toCommonJS(trackalacker_sync_exports);
})();
