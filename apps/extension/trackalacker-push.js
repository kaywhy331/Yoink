"use strict";

(function exposeYoinkTrackalackerPush(root) {
  const DEVICE_REGISTRATION_URL = "https://www.trackalacker.com/api/v1/users/devices";
  const DEVICE_TOKEN_UPDATE_URL = "https://www.trackalacker.com/api/v1/users/devices/update_token";
  const VAPID_PUBLIC_KEY = "BPUDGH3jRyYkLhTOkC4L_qLreblXGxBEq2amt8cFTqlfp3IduF8wIkAc9VbKlSyW_UCuPKt6DTOq64uMS_m6vIg";
  const TRACKALACKER_ROOT_URL = "https://www.trackalacker.com/";
  const TRACKALACKER_ICON_URL = "https://www.trackalacker.com/images/logo.webp";

  function cleanText(value, maximum = 500) {
    return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
  }

  function cleanBody(value) {
    return String(value || "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
      .split("\n")
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .filter(Boolean)
      .join("\n")
      .slice(0, 4_000);
  }

  function bytesFrom(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return null;
  }

  function base64Encode(value, encoder = globalThis.btoa) {
    const bytes = bytesFrom(value);
    if (!bytes?.length || typeof encoder !== "function") return "";
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return encoder(binary);
  }

  function applicationServerKeyFromBase64Url(value, decoder = globalThis.atob) {
    if (typeof decoder !== "function") throw new Error("Base64 decoding is unavailable.");
    const encoded = String(value || "").trim();
    const padded = `${encoded.replace(/-/g, "+").replace(/_/g, "/")}${"=".repeat((4 - encoded.length % 4) % 4)}`;
    const binary = decoder(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (bytes.length !== 65 || bytes[0] !== 4) throw new Error("TrackaLacker's Web Push key is invalid.");
    return bytes;
  }

  function vapidApplicationServerKey(decoder = globalThis.atob) {
    return applicationServerKeyFromBase64Url(VAPID_PUBLIC_KEY, decoder);
  }

  function applicationServerKeyMatches(subscription, expected) {
    const actual = bytesFrom(subscription?.options?.applicationServerKey);
    if (!actual) return true;
    if (actual.length !== expected.length) return false;
    return actual.every((byte, index) => byte === expected[index]);
  }

  function deviceRegistrationPayload(subscription, nickname, encoder = globalThis.btoa) {
    if (!subscription || typeof subscription.getKey !== "function") return { ok: false, reason: "missing_subscription" };
    const endpoint = String(subscription.endpoint || "").trim();
    const p256dh = base64Encode(subscription.getKey("p256dh"), encoder);
    const auth = base64Encode(subscription.getKey("auth"), encoder);
    const safeNickname = cleanText(nickname, 80);
    if (!endpoint || !p256dh || !auth || !safeNickname) return { ok: false, reason: "incomplete_subscription" };
    return { ok: true, payload: { device: { platform: "web", endpoint, p256dh, auth, nickname: safeNickname } } };
  }

  function deviceTokenUpdatePayload(oldEndpointValue, subscription, encoder = globalThis.btoa) {
    const oldEndpoint = String(oldEndpointValue || "").trim();
    const registration = deviceRegistrationPayload(subscription, "runtime migration", encoder);
    if (!oldEndpoint || !registration.ok) return { ok: false, reason: oldEndpoint ? registration.reason : "missing_old_endpoint" };
    const { endpoint, p256dh, auth } = registration.payload.device;
    return { ok: true, payload: { device: { platform: "web", old_endpoint: oldEndpoint, endpoint, p256dh, auth } } };
  }

  async function ensureSilentPushSubscription(pushManager, applicationServerKey) {
    if (!pushManager?.getSubscription || !pushManager?.subscribe) return { ok: false, reason: "push_api_unavailable", subscription: null };
    let subscription;
    try {
      subscription = await pushManager.getSubscription();
    } catch {
      return { ok: false, reason: "push_subscription_read_failed", subscription: null };
    }
    if (subscription && !applicationServerKeyMatches(subscription, applicationServerKey)) {
      return { ok: false, reason: "subscription_key_mismatch", subscription: null };
    }
    if (subscription?.options?.userVisibleOnly === false) {
      return { ok: true, subscription, previousEndpoint: "", silent: true };
    }
    const previousEndpoint = String(subscription?.endpoint || "");
    if (subscription) {
      try {
        if (typeof subscription.unsubscribe !== "function" || await subscription.unsubscribe() !== true) {
          return { ok: false, reason: "push_silent_migration_failed", subscription: null };
        }
      } catch {
        return { ok: false, reason: "push_silent_migration_failed", subscription: null };
      }
    }
    try {
      subscription = await pushManager.subscribe({ userVisibleOnly: false, applicationServerKey });
      return subscription
        ? { ok: true, subscription, previousEndpoint, silent: true }
        : { ok: false, reason: "missing_subscription", subscription: null };
    } catch {
      if (previousEndpoint) {
        try {
          subscription = await pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
          if (subscription) return { ok: true, subscription, previousEndpoint, silent: false, warning: "silent_push_unavailable" };
        } catch {
          // The caller reports a bounded failure without exposing push data.
        }
      }
      return { ok: false, reason: "push_subscribe_failed", subscription: null };
    }
  }

  async function inspectPagePushSubscription(runtime) {
    const pageNavigator = runtime?.navigator || (typeof navigator !== "undefined" ? navigator : null);
    try {
      const pageRegistration = await pageNavigator?.serviceWorker?.getRegistration?.();
      const subscription = await pageRegistration?.pushManager?.getSubscription?.();
      if (!subscription) return { subscriptionPresent: false, applicationServerKey: "" };
      const key = subscription?.options?.applicationServerKey;
      let bytes;
      if (key instanceof Uint8Array) bytes = key;
      else if (key instanceof ArrayBuffer) bytes = new Uint8Array(key);
      else if (ArrayBuffer.isView(key)) bytes = new Uint8Array(key.buffer, key.byteOffset, key.byteLength);
      if (!bytes || bytes.length !== 65 || bytes[0] !== 4) return { subscriptionPresent: true, applicationServerKey: "" };
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const encoded = (runtime?.btoa || btoa)(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      return { subscriptionPresent: true, applicationServerKey: encoded };
    } catch {
      return { subscriptionPresent: false, applicationServerKey: "" };
    }
  }

  async function registerDeviceInPage(payload, runtime) {
    const pageDocument = runtime?.document || document;
    const pageFetch = runtime?.fetch || fetch;
    const pageNavigator = runtime?.navigator || (typeof navigator !== "undefined" ? navigator : null);
    const headers = { Accept: "application/json", "Content-Type": "application/json" };
    const csrf = pageDocument?.querySelector?.('meta[name="csrf-token"]')?.getAttribute?.("content") || "";
    if (csrf) headers["X-CSRF-Token"] = csrf;
    let pageSubscriptionPresent = false;
    try {
      const pageRegistration = await pageNavigator?.serviceWorker?.getRegistration?.();
      pageSubscriptionPresent = Boolean(await pageRegistration?.pushManager?.getSubscription?.());
    } catch {
      // The page subscription is diagnostic only and is never modified.
    }
    try {
      const response = await pageFetch("https://www.trackalacker.com/api/v1/users/devices", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        redirect: "follow",
        headers,
        body: JSON.stringify(payload)
      });
      if (response.redirected === true) return { ok: false, duplicate: false, status: 0, code: "network_error", pageSubscriptionPresent };
      const responseBody = await response.json().catch(() => ({}));
      const status = Number.isInteger(Number(response.status)) ? Math.max(0, Math.min(599, Number(response.status))) : 0;
      const messages = [];
      const collect = (value, depth = 0) => {
        if (depth > 4 || messages.length >= 40) return;
        if (typeof value === "string") messages.push(value.slice(0, 500).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
        else if (Array.isArray(value)) for (const entry of value.slice(0, 20)) collect(entry, depth + 1);
        else if (value && typeof value === "object") for (const entry of Object.values(value).slice(0, 20)) collect(entry, depth + 1);
      };
      collect([responseBody?.message, responseBody?.error, responseBody?.errors]);
      const enrolled = messages.some((message) => message === "device enrolled successfully");
      const duplicate = messages.some((message) => (
        /\b(?:already registered|already enrolled|device already exists|endpoint already exists|endpoint has already been taken)\b/.test(message)
        || message === "has already been taken"
      ));
      if (status === 200 || enrolled) return { ok: true, duplicate, status, code: duplicate ? "already_registered" : "enrolled", pageSubscriptionPresent };
      if ([409, 422].includes(status) && duplicate) return { ok: true, duplicate: true, status, code: "already_registered", pageSubscriptionPresent };
      return { ok: false, duplicate: false, status, code: status ? "http_error" : "network_error", pageSubscriptionPresent };
    } catch {
      return { ok: false, duplicate: false, status: 0, code: "network_error", pageSubscriptionPresent };
    }
  }

  async function updateDeviceTokenInPage(payload, runtime) {
    const pageDocument = runtime?.document || document;
    const pageFetch = runtime?.fetch || fetch;
    const headers = { Accept: "application/json", "Content-Type": "application/json" };
    const csrf = pageDocument?.querySelector?.('meta[name="csrf-token"]')?.getAttribute?.("content") || "";
    if (csrf) headers["X-CSRF-Token"] = csrf;
    try {
      const response = await pageFetch("https://www.trackalacker.com/api/v1/users/devices/update_token", {
        method: "PATCH",
        credentials: "include",
        cache: "no-store",
        redirect: "follow",
        headers,
        body: JSON.stringify(payload)
      });
      if (response.redirected === true) return { ok: false, duplicate: false, status: 0, code: "network_error" };
      const status = Number.isInteger(Number(response.status)) ? Math.max(0, Math.min(599, Number(response.status))) : 0;
      return { ok: response.ok === true, duplicate: false, status, code: response.ok ? "updated" : status ? "http_error" : "network_error" };
    } catch {
      return { ok: false, duplicate: false, status: 0, code: "network_error" };
    }
  }

  async function subscriptionFingerprint(subscription, subtle = globalThis.crypto?.subtle) {
    const endpoint = String(subscription?.endpoint || "");
    if (!endpoint || !subtle?.digest) return "";
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function notificationUrl(value) {
    try {
      const url = new URL(String(value || ""), TRACKALACKER_ROOT_URL);
      if (url.protocol !== "https:" || url.username || url.password) return "";
      url.hash = "";
      return url.href.slice(0, 2_000);
    } catch {
      return "";
    }
  }

  function numericIdentifier(value) {
    const text = String(value || "").trim();
    return /^\d{1,20}$/.test(text) ? text : "";
  }

  function productSlug(value) {
    let text;
    try { text = decodeURIComponent(String(value || "")).trim().toLowerCase(); } catch { return ""; }
    return /^[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?$/.test(text) ? text : "";
  }

  const RETAILER_SKU_PATTERNS = Object.freeze({
    target: /^\d{6,12}$/,
    walmart: /^\d{5,20}$/,
    amazon: /^[A-Z0-9]{10}$/,
    bestbuy: /^\d{5,20}$/,
    disney: /^\d{10,20}$/,
    ravensburger: /^\d{5,20}$/,
    riot: /^[A-Z0-9](?:[A-Z0-9-]{1,118}[A-Z0-9])?$/,
    booksamillion: /^[A-Z0-9]{10,20}$/,
    fanatics: /^\d{6,20}$/,
    kohls: /^\d{5,12}$/,
    macys: /^\d{5,20}$/,
    pbandai: /^[A-Z]\d{10}$/,
    pokemoncenter: /^\d{2,3}-\d{5}(?:-\d{3})?$/
  });

  function preservedRetailerIdentity(retailerValue, skuValue) {
    const retailer = String(retailerValue || "").trim().toLowerCase();
    const sku = ["amazon", "riot", "booksamillion", "pbandai"].includes(retailer)
      ? String(skuValue || "").trim().toUpperCase()
      : String(skuValue || "").trim();
    return RETAILER_SKU_PATTERNS[retailer]?.test(sku)
      ? { retailer, sku }
      : { retailer: "", sku: "" };
  }

  function trackalackerSignalIdentity(value) {
    try {
      const url = new URL(String(value || ""), TRACKALACKER_ROOT_URL);
      const host = url.hostname.toLowerCase();
      if (url.protocol !== "https:" || url.username || url.password || !["trackalacker.com", "www.trackalacker.com"].includes(host)) {
        return { sourceProductId: "", listingId: "", productSlug: "" };
      }
      const listingId = numericIdentifier(url.pathname.match(/\/listings\/(\d{1,20})(?:\/|$)/i)?.[1]);
      const segment = url.pathname.match(/\/products\/showcase\/([^/]{1,240})(?:\/|$)/i)?.[1] || "";
      return {
        sourceProductId: numericIdentifier(url.searchParams.get("utm_term")) || numericIdentifier(segment),
        listingId,
        productSlug: productSlug(segment)
      };
    } catch {
      return { sourceProductId: "", listingId: "", productSlug: "" };
    }
  }

  function retailerSignalIdentity(value) {
    try {
      const url = new URL(String(value || ""));
      const host = url.hostname.toLowerCase();
      if (url.protocol !== "https:" || url.username || url.password) return { retailer: "", sku: "" };
      if (["target.com", "www.target.com"].includes(host)) {
        const sku = numericIdentifier(url.pathname.match(/(?:\/|-)A-(\d{6,12})(?:\/|$)/i)?.[1]);
        return { retailer: sku ? "target" : "", sku };
      }
      if (["walmart.com", "www.walmart.com"].includes(host)) {
        const sku = numericIdentifier(url.pathname.match(/\/ip\/(?:[^/]+\/)?(\d{5,20})(?:\/|$)/i)?.[1]);
        return { retailer: sku ? "walmart" : "", sku };
      }
      if (["amazon.com", "www.amazon.com"].includes(host)) {
        const sku = String(url.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1] || "").toUpperCase();
        return { retailer: /^[A-Z0-9]{10}$/.test(sku) ? "amazon" : "", sku };
      }
      if (["bestbuy.com", "www.bestbuy.com"].includes(host)) {
        const sku = numericIdentifier(
          url.pathname.match(/^\/product\/[^/]+\/(?:[^/]+\/sku\/)?(\d{5,20})(?:\/|$)/i)?.[1]
          || url.pathname.match(/^\/site\/[^/]+\/(\d{5,20})\.p(?:\/|$)/i)?.[1]
          || url.searchParams.get("skuId")
        );
        return { retailer: sku ? "bestbuy" : "", sku };
      }
      if (["disneystore.com", "www.disneystore.com"].includes(host)) {
        const sku = numericIdentifier(url.pathname.match(/-(\d{10,20})\.html(?:\/|$)/i)?.[1]);
        return { retailer: sku ? "disney" : "", sku };
      }
      if (["ravensburger.us", "www.ravensburger.us"].includes(host)) {
        const sku = /^\/en-US\/products\//i.test(url.pathname)
          ? numericIdentifier(url.pathname.match(/-(\d{5,20})(?:\/|$)/i)?.[1]) : "";
        return { retailer: sku ? "ravensburger" : "", sku };
      }
      if (host === "merch.riotgames.com") {
        const sku = String(url.pathname.match(/^\/en-us\/product\/([a-z0-9](?:[a-z0-9-]{1,118}[a-z0-9])?)\/?$/i)?.[1] || "").toUpperCase();
        return { retailer: RETAILER_SKU_PATTERNS.riot.test(sku) ? "riot" : "", sku };
      }
      if (["booksamillion.com", "www.booksamillion.com"].includes(host)) {
        const sku = String(url.pathname.match(/^\/p\/(?:-\/)?([a-z0-9]{10,20})(?:\/|$)/i)?.[1] || "").toUpperCase();
        return { retailer: RETAILER_SKU_PATTERNS.booksamillion.test(sku) ? "booksamillion" : "", sku };
      }
      if (["fanatics.com", "www.fanatics.com"].includes(host)) {
        const sku = numericIdentifier(url.pathname.replace(/%2B/gi, "+").match(/(?:^|\+)p-(\d{6,20})(?:\+|$)/i)?.[1]);
        return { retailer: RETAILER_SKU_PATTERNS.fanatics.test(sku) ? "fanatics" : "", sku };
      }
      if (["kohls.com", "www.kohls.com"].includes(host)) {
        const sku = numericIdentifier(url.pathname.match(/^\/product\/prd-(\d{5,12})\//i)?.[1]);
        return { retailer: sku ? "kohls" : "", sku };
      }
      if (["macys.com", "www.macys.com"].includes(host)) {
        const sku = /^\/shop\/product\//i.test(url.pathname)
          ? numericIdentifier(url.searchParams.get("ID") || url.searchParams.get("id")) : "";
        return { retailer: sku ? "macys" : "", sku };
      }
      if (["p-bandai.com", "www.p-bandai.com"].includes(host)) {
        const sku = String(url.pathname.match(/^\/us\/item\/([A-Z]\d{10})(?:\/|$)/i)?.[1] || "").toUpperCase();
        return { retailer: RETAILER_SKU_PATTERNS.pbandai.test(sku) ? "pbandai" : "", sku };
      }
      if (["pokemoncenter.com", "www.pokemoncenter.com"].includes(host)) {
        const sku = url.pathname.match(/^\/product\/(\d{2,3}-\d{5}(?:-\d{3})?)(?:\/|$)/i)?.[1] || "";
        return { retailer: RETAILER_SKU_PATTERNS.pokemoncenter.test(sku) ? "pokemoncenter" : "", sku };
      }
      return { retailer: "", sku: "" };
    } catch {
      return { retailer: "", sku: "" };
    }
  }

  function pushNotificationData(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const nested = value.data && typeof value.data === "object" && !Array.isArray(value.data) ? value.data : {};
    const notification = value.notification && typeof value.notification === "object" && !Array.isArray(value.notification) ? value.notification : {};
    const title = cleanText(value.title || notification.title || nested.title, 500);
    const body = cleanBody(value.body || notification.body || nested.body || value.message || nested.message);
    const url = notificationUrl(value.url || notification.url || nested.url || value.link || nested.link || value.click_action || nested.click_action);
    if (!title && !body) return null;
    return { title, body, url };
  }

  function signalEnvelopeFromPush(value, signalId, receivedAt, extensionId, preservedIdentity = {}) {
    const notification = pushNotificationData(value);
    const id = cleanText(signalId, 180);
    const timestamp = new Date(receivedAt || "");
    if (!notification || !/^[A-Za-z0-9:._-]{8,180}$/.test(id) || Number.isNaN(timestamp.getTime())) return null;
    const sourceIdentity = trackalackerSignalIdentity(notification.url);
    const retailerIdentity = retailerSignalIdentity(notification.url);
    const preservedRetailer = preservedRetailerIdentity(preservedIdentity.retailer, preservedIdentity.sku);
    const sourceRetailer = retailerIdentity.retailer || preservedRetailer.retailer;
    const sourceRetailerSku = retailerIdentity.sku || (sourceRetailer === preservedRetailer.retailer ? preservedRetailer.sku : "");
    return {
      schemaVersion: 1,
      signalId: id,
      testSignal: false,
      source: {
        provider: "trackalacker",
        transport: "chrome_extension_web_push",
        notificationId: id,
        applicationName: "Google Chrome",
        applicationId: cleanText(extensionId, 240),
        domain: "trackalacker.com",
        createdAt: timestamp.toISOString(),
        receivedAt: timestamp.toISOString()
      },
      notification: {
        title: notification.title,
        body: notification.body,
        textElements: [],
        sourceProductId: sourceIdentity.sourceProductId || numericIdentifier(preservedIdentity.sourceProductId),
        sourceListingId: sourceIdentity.listingId || numericIdentifier(preservedIdentity.listingId),
        sourceProductSlug: sourceIdentity.productSlug || productSlug(preservedIdentity.productSlug),
        sourceRetailer,
        sourceRetailerSku
      }
    };
  }

  function notificationPresentation(value, signalId) {
    const notification = pushNotificationData(value) || { title: "TrackaLacker Notification", body: "You have a notification from TrackaLacker", url: "" };
    return {
      title: notification.title || "TrackaLacker Notification",
      options: {
        body: notification.body || "You have a notification from TrackaLacker",
        icon: TRACKALACKER_ICON_URL,
        tag: `tl-${cleanText(signalId, 180) || "notification"}`,
        requireInteraction: true,
        data: { yoinkTrackalacker: true, url: notification.url || TRACKALACKER_ROOT_URL }
      }
    };
  }

  function safeRegistrationDiagnostic(result = {}) {
    const status = Number.isInteger(Number(result.status)) ? Math.max(0, Math.min(599, Number(result.status))) : 0;
    if (result.ok && result.duplicate) return "Device already registered";
    if (result.ok) return `Device registration succeeded: HTTP ${status || 200}`;
    if (status) return `Device registration failed: HTTP ${status}`;
    return "Device registration failed";
  }

  root.YoinkTrackalackerPush = Object.freeze({
    DEVICE_REGISTRATION_URL,
    DEVICE_TOKEN_UPDATE_URL,
    VAPID_PUBLIC_KEY,
    applicationServerKeyFromBase64Url,
    deviceRegistrationPayload,
    deviceTokenUpdatePayload,
    ensureSilentPushSubscription,
    inspectPagePushSubscription,
    notificationPresentation,
    notificationUrl,
    registerDeviceInPage,
    safeRegistrationDiagnostic,
    signalEnvelopeFromPush,
    subscriptionFingerprint,
    updateDeviceTokenInPage,
    vapidApplicationServerKey
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
