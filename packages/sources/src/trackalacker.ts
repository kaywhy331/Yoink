import type {
  SignalEventInput,
  TrackalackerPushEnvelope
} from "../../contracts/src/index.js";
import { cleanText } from "../../domain/src/normalize.js";

const TRACKALACKER_DOMAIN = "trackalacker.com";
const ALLOWED_TRANSPORTS = new Set(["chrome_extension_web_push", "synthetic_replay"]);
const RETAILER_NAMES: Record<string, string> = {
  amazon: "amazon",
  target: "target",
  walmart: "walmart",
  "best buy": "bestbuy",
  bestbuy: "bestbuy",
  "disney store": "disney",
  disney: "disney",
  ravensburger: "ravensburger",
  "riot games merch": "riot",
  "riot games store": "riot",
  "riot games": "riot",
  riot: "riot",
  "books a million": "booksamillion",
  bam: "booksamillion",
  booksamillion: "booksamillion",
  fanatics: "fanatics",
  "kohl s": "kohls",
  kohls: "kohls",
  "macy s": "macys",
  macys: "macys",
  "premium bandai": "pbandai",
  "p bandai": "pbandai",
  pbandai: "pbandai",
  "pokemon center": "pokemoncenter",
  pokemoncenter: "pokemoncenter"
};
const SKU_PATTERNS: Record<string, RegExp> = {
  amazon: /^[A-Z0-9]{10}$/,
  target: /^\d{6,12}$/,
  walmart: /^\d{5,20}$/,
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
};
const RETAILER_TEXT = "amazon|target|walmart|best buy|disney store|disney|ravensburger|riot games(?: merch| store)?|riot|books[- ]a[- ]million|bam|fanatics|kohl'?s|macys?|macy'?s|premium bandai|p[- ]?bandai|pokemon center";
const EVENT_HEADERS = [
  { pattern: new RegExp(`^in stock\\s+at\\s+(${RETAILER_TEXT})!?$`, "i"), eventType: "in_stock" as const },
  { pattern: new RegExp(`^(?:restock|back in stock)\\s+at\\s+(${RETAILER_TEXT})!?$`, "i"), eventType: "restock" as const },
  { pattern: new RegExp(`^pre-?order(?: available)?\\s+at\\s+(${RETAILER_TEXT})!?$`, "i"), eventType: "preorder" as const },
  { pattern: /^(?:available for pre-?order|pre-?order available)!?$/i, eventType: "preorder" as const }
];
const PRODUCT_EVENTS = [
  { pattern: new RegExp(`^(.{1,300}?)\\s+is\\s+in stock\\s+at\\s+(${RETAILER_TEXT})!?$`, "i"), eventType: "in_stock" as const },
  { pattern: new RegExp(`^(.{1,300}?)\\s+is\\s+back in stock\\s+at\\s+(${RETAILER_TEXT})!?$`, "i"), eventType: "restock" as const },
  { pattern: new RegExp(`^(.{1,300}?)\\s+is\\s+(?:now\\s+)?available for pre-?order\\s+at\\s+(${RETAILER_TEXT})!?$`, "i"), eventType: "preorder" as const },
  { pattern: /^(.{1,300}?)\s+is\s+(?:now\s+)?available for pre-?order!?$/i, eventType: "preorder" as const }
];
const OFFER_PATTERN = /(?:in stock|available|back in stock|pre-?order(?: available)?)\s+(?:at|for)\s+\$?([\d,]+(?:\.\d{1,2})?)(?:\s*\(([^)]{1,100})\))?/i;

export interface ParsedTrackalackerNotification {
  envelope: TrackalackerPushEnvelope;
  parseState: "parsed" | "unsupported";
  eventType: SignalEventInput["eventType"];
  retailerId: string;
  title: string;
  sourceProductId: string;
  sourceListingId: string;
  sourceProductSlug: string;
  retailerSku: string;
  canonicalUrl: string;
  unitPriceCents: number | null;
  msrpStatus: string;
  test: boolean;
  lines: readonly string[];
}

function cleanBody(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 4_000);
}

function timestamp(value: unknown, field: string): string {
  const parsed = new Date(cleanText(value, 80));
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be a valid timestamp.`);
  return parsed.toISOString();
}

function numericId(value: unknown): string {
  const text = cleanText(value, 30);
  return /^\d{1,20}$/.test(text) ? text : "";
}

function productSlug(value: unknown): string {
  const text = cleanText(value, 240).toLocaleLowerCase("en-US");
  return /^[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?$/.test(text) ? text : "";
}

function retailerId(value: unknown): string {
  return RETAILER_NAMES[cleanText(value, 40).toLocaleLowerCase("en-US").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()] ?? "";
}

function retailerIdentity(retailerValue: unknown, skuValue: unknown): { retailerId: string; retailerSku: string } {
  const retailer = retailerId(retailerValue);
  const sku = ["amazon", "riot", "booksamillion", "pbandai"].includes(retailer)
    ? cleanText(skuValue, 64).toUpperCase()
    : cleanText(skuValue, 64);
  return retailer && SKU_PATTERNS[retailer]?.test(sku)
    ? { retailerId: retailer, retailerSku: sku }
    : { retailerId: "", retailerSku: "" };
}

function canonicalRetailerUrl(retailer: string, sku: string): string {
  if (retailer === "target" && SKU_PATTERNS.target?.test(sku)) return `https://www.target.com/p/-/A-${sku}`;
  if (retailer === "walmart" && SKU_PATTERNS.walmart?.test(sku)) return `https://www.walmart.com/ip/${sku}`;
  if (retailer === "amazon" && SKU_PATTERNS.amazon?.test(sku)) return `https://www.amazon.com/dp/${sku}`;
  if (retailer === "bestbuy" && SKU_PATTERNS.bestbuy?.test(sku)) return `https://www.bestbuy.com/site/-/${sku}.p`;
  if (retailer === "riot" && SKU_PATTERNS.riot?.test(sku)) return `https://merch.riotgames.com/en-us/product/${sku.toLocaleLowerCase("en-US")}/`;
  if (retailer === "booksamillion" && SKU_PATTERNS.booksamillion?.test(sku)) return `https://www.booksamillion.com/p/-/${sku}`;
  if (retailer === "kohls" && SKU_PATTERNS.kohls?.test(sku)) return `https://www.kohls.com/product/prd-${sku}/product.jsp`;
  if (retailer === "macys" && SKU_PATTERNS.macys?.test(sku)) return `https://www.macys.com/shop/product/-?ID=${sku}`;
  if (retailer === "pbandai" && SKU_PATTERNS.pbandai?.test(sku)) return `https://p-bandai.com/us/item/${sku}`;
  if (retailer === "pokemoncenter" && SKU_PATTERNS.pokemoncenter?.test(sku)) return `https://www.pokemoncenter.com/product/${sku}/-`;
  return "";
}

export function validateTrackalackerPushEnvelope(input: unknown): TrackalackerPushEnvelope {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("TrackaLacker signal payload must be an object.");
  const value = input as Partial<TrackalackerPushEnvelope>;
  if (value.schemaVersion !== 1) throw new Error("TrackaLacker signal schemaVersion must be 1.");
  const signalId = cleanText(value.signalId, 180);
  if (!/^[A-Za-z0-9:._-]{8,180}$/.test(signalId)) throw new Error("TrackaLacker signal ID is invalid.");
  const source = value.source && typeof value.source === "object" ? value.source : null;
  const notification = value.notification && typeof value.notification === "object" ? value.notification : null;
  if (!source || !notification) throw new Error("TrackaLacker source and notification objects are required.");
  const transport = cleanText(source.transport, 60).toLocaleLowerCase("en-US");
  if (cleanText(source.provider, 40).toLocaleLowerCase("en-US") !== "trackalacker" || !ALLOWED_TRANSPORTS.has(transport)) {
    throw new Error("TrackaLacker signal transport is not allowed.");
  }
  const domain = cleanText(source.domain, 200).toLocaleLowerCase("en-US").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  if (domain !== TRACKALACKER_DOMAIN) throw new Error("TrackaLacker signal domain is invalid.");
  const notificationId = cleanText(source.notificationId, 180);
  if (!notificationId) throw new Error("TrackaLacker notification ID is required.");
  const title = cleanText(notification.title, 500);
  const body = cleanBody(notification.body);
  const textElements = (Array.isArray(notification.textElements) ? notification.textElements : [])
    .slice(0, 16)
    .map((entry) => cleanText(entry, 500))
    .filter(Boolean);
  if (!title && !body && !textElements.length) throw new Error("TrackaLacker notification text is empty.");
  const identity = retailerIdentity(notification.sourceRetailer, notification.sourceRetailerSku);
  return {
    schemaVersion: 1,
    signalId,
    testSignal: value.testSignal === true,
    source: {
      provider: "trackalacker",
      transport: transport as TrackalackerPushEnvelope["source"]["transport"],
      notificationId,
      applicationName: cleanText(source.applicationName, 160),
      applicationId: cleanText(source.applicationId, 240).replace(/[\\/]/g, "."),
      domain: "trackalacker.com",
      createdAt: timestamp(source.createdAt, "source.createdAt"),
      receivedAt: timestamp(source.receivedAt, "source.receivedAt")
    },
    notification: {
      title,
      body,
      textElements,
      sourceProductId: numericId(notification.sourceProductId),
      sourceListingId: numericId(notification.sourceListingId),
      sourceProductSlug: productSlug(notification.sourceProductSlug),
      sourceRetailer: identity.retailerId,
      sourceRetailerSku: identity.retailerSku
    }
  };
}

function notificationLines(envelope: TrackalackerPushEnvelope): string[] {
  const ordered = [
    envelope.notification.title,
    ...(envelope.notification.textElements ?? []),
    ...String(envelope.notification.body ?? "").split(/\r?\n/)
  ];
  const seen = new Set<string>();
  return ordered.map((line) => cleanText(line, 500)).filter((line) => {
    const key = line.toLocaleLowerCase("en-US");
    if (!line || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function statusFromText(value: string): string {
  const text = value.toLocaleLowerCase("en-US");
  if (/price surge|surge|scalper/.test(text)) return "surge";
  if (/above msrp|greater than|over msrp/.test(text)) return "above_msrp";
  if (/below msrp|less than/.test(text)) return "below_msrp";
  if (/~\s*msrp|near msrp|close to/.test(text)) return "near_msrp";
  if (/at msrp|equal to msrp|^msrp$/.test(text)) return "at_msrp";
  return "unknown";
}

function metadataLine(line: string): boolean {
  const normalized = line.toLocaleLowerCase("en-US").replace(/^www\./, "").replace(/\/$/, "");
  return normalized === TRACKALACKER_DOMAIN
    || normalized === "affiliate"
    || EVENT_HEADERS.some(({ pattern }) => pattern.test(line))
    || PRODUCT_EVENTS.some(({ pattern }) => pattern.test(line))
    || OFFER_PATTERN.test(line);
}

export function parseTrackalackerNotification(input: unknown): ParsedTrackalackerNotification {
  const envelope = validateTrackalackerPushEnvelope(input);
  const lines = notificationLines(envelope);
  let event: { index: number; eventType: SignalEventInput["eventType"]; retailerId: string; title: string } | null = null;
  for (let index = 0; index < lines.length && !event; index += 1) {
    const line = lines[index] ?? "";
    for (const candidate of PRODUCT_EVENTS) {
      const match = line.match(candidate.pattern);
      if (match) {
        event = { index, eventType: candidate.eventType, retailerId: retailerId(match[2]), title: cleanText(match[1], 300) };
        break;
      }
    }
  }
  for (let index = 0; index < lines.length && !event; index += 1) {
    const line = lines[index] ?? "";
    for (const candidate of EVENT_HEADERS) {
      const match = line.match(candidate.pattern);
      if (match) {
        event = { index, eventType: candidate.eventType, retailerId: retailerId(match[1]), title: "" };
        break;
      }
    }
  }
  let unitPriceCents: number | null = null;
  let msrpStatus = "unknown";
  for (const line of lines) {
    const match = line.match(OFFER_PATTERN);
    if (!match) continue;
    const amount = Number(String(match[1]).replaceAll(",", ""));
    if (Number.isFinite(amount) && amount > 0 && amount <= 1_000_000) {
      unitPriceCents = Math.round(amount * 100);
      msrpStatus = statusFromText(match[2] || line);
      break;
    }
  }
  if (unitPriceCents === null) {
    for (const line of lines) {
      const match = line.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
      if (!match) continue;
      const amount = Number(String(match[1]).replaceAll(",", ""));
      if (Number.isFinite(amount) && amount > 0 && amount <= 1_000_000) {
        unitPriceCents = Math.round(amount * 100);
        msrpStatus = statusFromText(line);
        break;
      }
    }
  }
  const sourceRetailer = envelope.notification.sourceRetailer ?? "";
  const textRetailer = event?.retailerId || lines.map((line) => {
    const match = line.match(new RegExp(`\\b(?:at|from)\\s+(${RETAILER_TEXT})\\b`, "i"));
    return retailerId(match?.[1]) || retailerId(line);
  }).find(Boolean) || "";
  const conflict = Boolean(sourceRetailer && textRetailer && sourceRetailer !== textRetailer);
  const resolvedRetailer = conflict ? "" : sourceRetailer || textRetailer;
  const sourceSku = resolvedRetailer === sourceRetailer ? envelope.notification.sourceRetailerSku ?? "" : "";
  const retailerSku = SKU_PATTERNS[resolvedRetailer]?.test(sourceSku) ? sourceSku : "";
  const sourceProductSlug = envelope.notification.sourceProductSlug ?? "";
  const sourceProductId = envelope.notification.sourceProductId || (sourceProductSlug ? `slug:${sourceProductSlug}` : "");
  const title = event?.title || lines.find((line) => !metadataLine(line)
    && !/\btest restock alert from trackalacker\b/i.test(line)) || "";
  const test = envelope.testSignal === true
    || lines.some((line) => /\btest notification\b|\bthis is a test\b|\btest restock alert from trackalacker\b/i.test(line));
  return {
    envelope,
    parseState: event && !conflict && resolvedRetailer ? "parsed" : "unsupported",
    eventType: event && !conflict ? event.eventType : "unknown",
    retailerId: resolvedRetailer,
    title: cleanText(title, 300),
    sourceProductId,
    sourceListingId: envelope.notification.sourceListingId ?? "",
    sourceProductSlug,
    retailerSku,
    canonicalUrl: canonicalRetailerUrl(resolvedRetailer, retailerSku),
    unitPriceCents,
    msrpStatus,
    test,
    lines
  };
}

export function trackalackerSignalInput(
  input: unknown,
  idempotencyKey: unknown,
  sourceConnectionId = "source_trackalacker_local"
): SignalEventInput {
  const parsed = parseTrackalackerNotification(input);
  const key = cleanText(idempotencyKey, 180);
  if (!key || key !== parsed.envelope.signalId) throw new Error("Idempotency-Key must match the TrackaLacker signal ID.");
  return {
    schemaVersion: 1,
    signalId: parsed.envelope.signalId,
    sourceConnectionId,
    source: "trackalacker",
    externalEventId: parsed.envelope.source.notificationId,
    eventType: parsed.eventType,
    observedAt: parsed.envelope.source.createdAt,
    receivedAt: parsed.envelope.source.receivedAt,
    test: parsed.test,
    identity: {
      sourceProductId: parsed.sourceProductId,
      sourceListingId: parsed.sourceListingId,
      retailerId: parsed.retailerId,
      retailerSku: parsed.retailerSku,
      canonicalUrl: parsed.canonicalUrl,
      title: parsed.title,
      globalIdentifiers: parsed.sourceProductSlug ? { trackalacker_slug: parsed.sourceProductSlug } : {}
    },
    offer: {
      availability: parsed.eventType === "preorder" ? "preorder"
        : ["in_stock", "restock"].includes(parsed.eventType) ? "in_stock" : "unknown",
      unitPriceCents: parsed.unitPriceCents,
      currency: "USD",
      sellerName: "",
      sellerType: "unknown",
      orderLimit: null,
      fulfillment: "unknown"
    },
    evidence: {
      headline: parsed.envelope.notification.title ?? "",
      body: parsed.envelope.notification.body ?? "",
      msrpStatus: parsed.msrpStatus,
      clickUrl: parsed.canonicalUrl
    },
    parserVersion: "trackalacker-push-v1"
  };
}

export function trackalackerCanonicalIdentity(value: unknown): { retailerId: string; retailerSku: string; canonicalUrl: string } {
  const raw = cleanText(value, 4_096);
  if (!raw) return { retailerId: "", retailerSku: "", canonicalUrl: "" };
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return { retailerId: "", retailerSku: "", canonicalUrl: "" };
    const host = url.hostname.toLocaleLowerCase("en-US");
    let retailer = "";
    let sku = "";
    if (host === "target.com" || host.endsWith(".target.com")) {
      retailer = "target";
      sku = url.pathname.match(/(?:\/|-)A-(\d{6,12})(?:\/|$)/i)?.[1] ?? "";
    } else if (host === "walmart.com" || host.endsWith(".walmart.com")) {
      retailer = "walmart";
      sku = url.pathname.match(/\/ip\/(?:[^/]+\/)?(\d{5,20})(?:\/|$)/i)?.[1]
        ?? numericId(url.searchParams.get("itemId") || url.searchParams.get("items"));
    } else if (host === "amazon.com" || host.endsWith(".amazon.com")) {
      retailer = "amazon";
      sku = (url.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]
        ?? url.searchParams.get("ASIN") ?? "").toUpperCase();
    } else if (host === "bestbuy.com" || host.endsWith(".bestbuy.com")) {
      retailer = "bestbuy";
      sku = url.pathname.match(/^\/product\/[^/]+\/(?:[^/]+\/sku\/)?(\d{5,20})(?:\/|$)/i)?.[1]
        ?? url.pathname.match(/\/(\d{5,20})\.p(?:\/|$)/i)?.[1]
        ?? numericId(url.searchParams.get("skuId"));
    } else if (host === "disneystore.com" || host.endsWith(".disneystore.com")) {
      retailer = "disney";
      sku = url.pathname.match(/-(\d{10,20})\.html(?:\/|$)/i)?.[1] ?? "";
    } else if (host === "ravensburger.us" || host.endsWith(".ravensburger.us")) {
      retailer = "ravensburger";
      sku = /^\/en-US\/products\//i.test(url.pathname) ? url.pathname.match(/-(\d{5,20})(?:\/|$)/i)?.[1] ?? "" : "";
    } else if (host === "merch.riotgames.com") {
      retailer = "riot";
      sku = (url.pathname.match(/^\/en-us\/product\/([a-z0-9](?:[a-z0-9-]{1,118}[a-z0-9])?)\/?$/i)?.[1] ?? "").toUpperCase();
    } else if (host === "booksamillion.com" || host.endsWith(".booksamillion.com")) {
      retailer = "booksamillion";
      sku = (url.pathname.match(/^\/p\/-\/([a-z0-9]{10,20})(?:\/|$)/i)?.[1]
        ?? url.pathname.match(/^\/p\/([a-z0-9]{10,20})(?:\/|$)/i)?.[1] ?? "").toUpperCase();
    } else if (host === "fanatics.com" || host.endsWith(".fanatics.com")) {
      retailer = "fanatics";
      sku = numericId(url.pathname.replace(/%2B/gi, "+").match(/(?:^|\+)p-(\d{6,20})(?:\+|$)/i)?.[1]);
    } else if (host === "kohls.com" || host.endsWith(".kohls.com")) {
      retailer = "kohls";
      sku = url.pathname.match(/^\/product\/prd-(\d{5,12})\//i)?.[1] ?? "";
    } else if (host === "macys.com" || host.endsWith(".macys.com")) {
      retailer = "macys";
      sku = /^\/shop\/product\//i.test(url.pathname) ? numericId(url.searchParams.get("ID") || url.searchParams.get("id")) : "";
    } else if (host === "p-bandai.com" || host.endsWith(".p-bandai.com")) {
      retailer = "pbandai";
      sku = (url.pathname.match(/^\/us\/item\/([A-Z]\d{10})(?:\/|$)/i)?.[1] ?? "").toUpperCase();
    } else if (host === "pokemoncenter.com" || host.endsWith(".pokemoncenter.com")) {
      retailer = "pokemoncenter";
      sku = url.pathname.match(/^\/product\/(\d{2,3}-\d{5}(?:-\d{3})?)(?:\/|$)/i)?.[1] ?? "";
    }
    if (!retailer || !SKU_PATTERNS[retailer]?.test(sku)) return { retailerId: "", retailerSku: "", canonicalUrl: "" };
    if (["bestbuy", "disney", "ravensburger", "fanatics", "kohls", "macys", "pokemoncenter"].includes(retailer)) {
      url.search = "";
      url.hash = "";
      if (retailer === "macys") url.searchParams.set("ID", sku);
      return { retailerId: retailer, retailerSku: sku, canonicalUrl: url.href };
    }
    return { retailerId: retailer, retailerSku: sku, canonicalUrl: canonicalRetailerUrl(retailer, sku) };
  } catch {
    return { retailerId: "", retailerSku: "", canonicalUrl: "" };
  }
}
