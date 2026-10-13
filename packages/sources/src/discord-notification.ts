import { exactRetailerProductLink, type ExactRetailerProductLink } from "../../domain/src/attribution.js";
import { stableHash } from "../../domain/src/ids.js";
import { cleanText } from "../../domain/src/normalize.js";
import type { WindowsToast } from "./windows-toast.js";

/**
 * Kevin, 2026-10-12: "make it discord signal will be able to be captured by
 * various notifications that populates to my windows notification tab and be
 * able to trace the listing to the yoink product."
 *
 * A Discord message reaches Yoink only as the notification Windows showed:
 * a title such as "Bot (#target-restocks, Cook Group)" and the message text.
 * This reads what a call needs from those two lines (store links, item
 * numbers, the stores named, restock or sold-out words) and the words left
 * over to match a product by name. Embeds, images and hidden links never reach
 * a notification, so a message with only an embed carries no product.
 */
export const DISCORD_NOTIFICATION_PARSER_VERSION = "discord-notification-v1" as const;

export type DiscordNotificationApp = "desktop" | "browser";

export interface DiscordToast {
  app: DiscordNotificationApp;
  title: string;
  body: string;
}

export interface DiscordNotificationChannel {
  /** Lowercase server + channel, stable across notifications; never shown. */
  key: string;
  /** "#target-restocks · Cook Group", "#restocks", or "Direct messages". */
  name: string;
  author: string;
  channel: string;
  server: string;
}

export interface DiscordStoreIdentifier {
  retailerId: string;
  retailerSku: string;
  label: string;
}

export interface DiscordNotificationFacts {
  channel: DiscordNotificationChannel;
  /** The notification as one line: "title: message". */
  text: string;
  /** Exact store item links in the message. */
  links: ExactRetailerProductLink[];
  /** Yoink stores the notification names, most specific first (links, message, channel, server, sender). */
  stores: string[];
  /** A store Yoink doesn't cover is named and no Yoink store is (e.g. "GameStop restock"). */
  otherStore: string;
  identifiers: DiscordStoreIdentifier[];
  /** 14-digit barcodes named in the message. */
  gtins: string[];
  priceCents: number | null;
  eventType: "restock" | "preorder" | "price_change" | "unknown";
  availability: "in_stock" | "preorder" | "out_of_stock" | "unknown";
  /** Whether this notification counts as a call at all. */
  relevant: boolean;
  /** Why it does or doesn't, for the dashboard. */
  relevance: string;
  /** The message with links, prices, labels and mentions taken out: what is matched by name. */
  productText: string;
}

const DESKTOP_APP = /discord|vesktop|legcord|armcord|webcord/i;
const BROWSER_APP = /chrome|chromium|brave|msedge|opera|vivaldi|firefox|browsercompany/i;
const DISCORD_SITE = /^(?:(?:ptb|canary)\.)?discord(?:app)?\.com$/i;

/** Which Discord app raised a toast, from its app ID or a browser's site line; never from message text. */
export function discordToastApp(appId: string, toast: Pick<WindowsToast, "attribution">): DiscordNotificationApp | null {
  if (DESKTOP_APP.test(appId)) return "desktop";
  const site = String(toast.attribution || "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/:].*$/, "");
  return DISCORD_SITE.test(site) ? "browser" : null;
}

/** A browser's toast is read only to see whether its site is Discord. */
export function mayBeDiscordToastApp(appId: string): boolean {
  return DESKTOP_APP.test(appId) || BROWSER_APP.test(appId);
}

export function discordToast(appId: string, toast: WindowsToast): DiscordToast | null {
  const app = discordToastApp(appId, toast);
  if (!app) return null;
  const lines = toast.texts.filter((line) => line.placement !== "attribution" && line.text).map((line) => line.text);
  if (!lines.length) return null;
  return { app, title: lines[0] ?? "", body: lines.slice(1).join("\n") };
}

/**
 * Discord titles a server message "Sender (#channel, Server)"; a DM is the
 * sender's name. Anything else is kept whole as the sender.
 */
export function discordNotificationChannel(titleValue: string): DiscordNotificationChannel {
  const title = cleanText(titleValue, 300);
  const open = title.indexOf(" (");
  const inner = open > 0 && title.endsWith(")") ? title.slice(open + 2, -1) : "";
  const parts = inner ? inner.split(", ").map((part) => part.trim()).filter(Boolean) : [];
  const channelPart = parts.find((part) => part.startsWith("#")) ?? "";
  if (open > 0 && channelPart) {
    const author = title.slice(0, open).trim();
    const channel = cleanText(channelPart.slice(1), 100);
    const server = cleanText(parts.slice(parts.indexOf(channelPart) + 1).join(", "), 100);
    return {
      key: `${server.toLocaleLowerCase("en-US")}\u0000${channel.toLocaleLowerCase("en-US")}`,
      name: server ? `#${channel} · ${server}` : `#${channel}`,
      author,
      channel,
      server
    };
  }
  if (open > 0 && parts.length) {
    // A group DM: "Sender (Group name)".
    const group = cleanText(parts.join(", "), 100);
    return { key: `group\u0000${group.toLocaleLowerCase("en-US")}`, name: group, author: title.slice(0, open).trim(), channel: "", server: "" };
  }
  return { key: "direct", name: "Direct messages", author: title, channel: "", server: "" };
}

/** Lowercase, accents and curly quotes folded, for word tests only. */
export function foldedText(value: string): string {
  return String(value ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’‘`]/g, "'").toLocaleLowerCase("en-US");
}

const STORE_WORDS: ReadonlyArray<readonly [RegExp, string]> = Object.freeze([
  [/\bwal[\s-]?mart\b|\bwmt\b/, "walmart"],
  [/\btarget\b|\btgt\b/, "target"],
  [/\bamazon\b|\bamzn\b/, "amazon"],
  [/\bbest[\s-]?buy\b|\bbby\b/, "bestbuy"],
  // "Pokémon Center Elite Trainer Box" is a product, not the store.
  [/\bpokemon[\s-]?center\b(?![\s-]+(?:elite|etb|exclusive|edition|ex\b))|\bpokemoncenter\b|\bpkc\b/, "pokemoncenter"],
  [/\bdisney[\s-]?store\b|\bshop[\s-]?disney\b/, "disney"],
  [/\bbooks[\s-]?a[\s-]?million\b/, "booksamillion"],
  [/\bkohl'?s\b/, "kohls"],
  [/\bmacy'?s\b/, "macys"],
  [/\bp[\s-]?bandai\b|\bpremium bandai\b/, "pbandai"],
  [/\bfanatics\b/, "fanatics"],
  [/\briot (?:merch|store)\b/, "riot"],
  [/\bravensburger\b/, "ravensburger"]
] as const);

const OTHER_STORES: ReadonlyArray<readonly [RegExp, string]> = Object.freeze([
  [/\bgame ?stop\b/, "GameStop"],
  [/\bcostco\b/, "Costco"],
  [/\bsam'?s club\b/, "Sam's Club"],
  [/\bbarnes (?:&|and) noble\b/, "Barnes & Noble"],
  [/\bwalgreens\b/, "Walgreens"],
  [/\bcvs\b/, "CVS"],
  [/\bfive below\b/, "Five Below"],
  [/\btcg ?player\b/, "TCGplayer"],
  [/\bebay\b/, "eBay"],
  [/\bmeijer\b/, "Meijer"],
  [/\bkroger\b/, "Kroger"],
  [/\bhot topic\b/, "Hot Topic"],
  [/\bbox ?lunch\b/, "BoxLunch"],
  [/\btoys ?r ?us\b/, "Toys\"R\"Us"],
  [/\bnewegg\b/, "Newegg"],
  [/\bmicro center\b/, "Micro Center"]
] as const);

function otherStoreNamed(value: string): string {
  const text = foldedText(value);
  let found = { name: "", index: Number.POSITIVE_INFINITY };
  for (const [pattern, name] of OTHER_STORES) {
    const match = pattern.exec(text);
    if (match && match.index < found.index) found = { name, index: match.index };
  }
  return found.name;
}

function storesNamed(value: string): Array<{ retailerId: string; index: number }> {
  const text = foldedText(value);
  const found: Array<{ retailerId: string; index: number }> = [];
  for (const [pattern, retailerId] of STORE_WORDS) {
    const match = pattern.exec(text);
    if (match) found.push({ retailerId, index: match.index });
  }
  return found.sort((first, second) => first.index - second.index);
}

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`)\]]+|\b(?:www\.)?(?:walmart|target|amazon|bestbuy|pokemoncenter)\.com\/[^\s<>"'`)\]]+/gi;

function urlsIn(value: string): string[] {
  return [...value.matchAll(URL_PATTERN)].map((match) => {
    const raw = match[0].replace(/[.,!?;:]+$/, "");
    return /^https?:\/\//i.test(raw) ? raw.replace(/^http:/i, "https:") : `https://${raw}`;
  });
}

const STORE_SKU: Readonly<Record<string, RegExp>> = Object.freeze({
  walmart: /^\d{5,20}$/,
  target: /^\d{6,10}$/,
  amazon: /^[A-Z0-9]{10}$/,
  bestbuy: /^\d{5,20}$/,
  pokemoncenter: /^\d{2,3}-\d{5}(?:-\d{3})?$/
});

const LABELLED_ID = /\b(sku|tcin|asin|item\s*(?:id|#|no\.?|number)|product\s*id|pid|upc|ean|gtin)\s*[:#=]?\s*#?\s*([A-Za-z0-9][A-Za-z0-9-]{3,19})\b/gi;

function gtin14(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 14 ? digits.padStart(14, "0") : "";
}

function identifiersIn(value: string, stores: string[]): { identifiers: DiscordStoreIdentifier[]; gtins: string[] } {
  const identifiers: DiscordStoreIdentifier[] = [];
  const gtins: string[] = [];
  const add = (retailerId: string, sku: string, label: string): void => {
    const retailerSku = sku.toUpperCase();
    if (!retailerId || !STORE_SKU[retailerId]?.test(retailerSku)) return;
    if (!identifiers.some((item) => item.retailerId === retailerId && item.retailerSku === retailerSku)) {
      identifiers.push({ retailerId, retailerSku, label });
    }
  };
  for (const match of value.matchAll(LABELLED_ID)) {
    const label = String(match[1]).toLowerCase().replace(/\s+/g, " ");
    const id = String(match[2]);
    if (["upc", "ean", "gtin"].includes(label)) {
      const gtin = gtin14(id);
      if (gtin && !gtins.includes(gtin)) gtins.push(gtin);
    } else if (label === "tcin") add("target", id, "TCIN");
    else if (label === "asin") add("amazon", id, "ASIN");
    else if (stores[0]) add(stores[0], id, label === "sku" ? "SKU" : "item number");
  }
  // Amazon item numbers are recognisable on their own.
  for (const match of value.matchAll(/\bB0[A-Z0-9]{8}\b/g)) add("amazon", match[0], "ASIN");
  return { identifiers, gtins };
}

function priceIn(value: string): number | null {
  // "Price: $64.99" before any other amount; an "MSRP: $49.99" line is the reference, not the price.
  const labelled = /\b(?:price|now|sale)\s*[:=-]?\s*\$\s?(\d{1,5}(?:,\d{3})*(?:\.\d{1,2})?)/i.exec(value);
  const unlabelled = value.replace(/\b(?:msrp|retail|was|reg(?:ular)?)\s*[:=-]?\s*\$\s?\d[\d,]*(?:\.\d{1,2})?/gi, " ");
  const any = labelled ?? /(?:^|[^\w$])\$\s?(\d{1,5}(?:,\d{3})*(?:\.\d{1,2})?)(?![\d.])/.exec(unlabelled)
    ?? /(?:^|[^\w$])\$\s?(\d{1,5}(?:,\d{3})*(?:\.\d{1,2})?)(?![\d.])/.exec(value);
  if (!any?.[1]) return null;
  const cents = Math.round(Number(any[1].replace(/,/g, "")) * 100);
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 10_000_000 ? cents : null;
}

// "Pickup: Unavailable" says nothing about shipping, so only these mean sold out.
const OUT_OF_STOCK = /\b(?:out of stock|out-of-stock|oos|sold out|sold-out)\b/g;
const PREORDER = /\bpre-?orders?\b|\bpre-?sale\b/;
const RESTOCK = /\b(?:restock(?:ed|ing|s)?|back in stock|in stock|in-stock|instock|available now|now available|is live|now live|live now|went live|just dropped|dropped|dropping|atc|add to cart|available)\b/g;
const PRICE_CHANGE = /\b(?:price (?:drop|cut|change|decrease)|price dropped|on sale|clearance|\d{1,2}% off)\b/;
// Channels and senders whose every message is a store alert.
const MONITOR = /restock|monitor|in-?stock|drops?\b|alerts?|checkout|\bcop\b|\bping/;
const CHAT = /chat|general|talk|discuss|question|help|off-?topic|lounge|memes?|success|wins?\b|pics?\b|showcase|intro/;
const QUESTION = /\?\s*$|^(?:anyone|any1|anybody|does|did|is|are|was|were|when|where|has|have|can|could|will|would|how|who|what|why|should)\b/;

const LABEL_LINE = /^\s*(?:price|retail|msrp|sku|tcin|dpci|asin|upc|ean|gtin|pid|item\s*(?:id|#|no\.?|number)|product\s*id|seller|sold by|store|site|retailer|stock|status|qty|quantity|limit|type|region|shipping|delivery|pickup|offer|condition|links?|atc|cart|checkout|time|date|monitor|powered by)\s*[:=|-]/i;
const NAME_LABEL = /^\s*(?:product|name|title|item)\s*[:=|-]\s*/i;

function productTextOf(body: string): string {
  const lines = body.split("\n").map((line) => {
    let text = line.replace(URL_PATTERN, " ");
    if (LABEL_LINE.test(text)) return "";
    text = text.replace(NAME_LABEL, "");
    return text
      .replace(/@\S+/g, " ")
      .replace(/<[@#][^>]*>/g, " ")
      .replace(/:[a-z0-9_+-]{2,40}:/gi, " ")
      .replace(/\p{Extended_Pictographic}|️|‍/gu, " ")
      .replace(/(?:^|\s)\$\s?\d[\d,]*(?:\.\d{1,2})?/g, " ")
      .replace(/[*_~|>]+/g, " ");
  });
  return cleanText(lines.filter((line) => line.trim()).join(" "), 300);
}

export function readDiscordNotification(toast: DiscordToast): DiscordNotificationFacts {
  const channel = discordNotificationChannel(toast.title);
  const body = String(toast.body ?? "").replace(/\r\n?/g, "\n").slice(0, 4_000);
  const urls = urlsIn(body);
  const links: ExactRetailerProductLink[] = [];
  const linkStores: string[] = [];
  for (const url of urls) {
    const exact = exactRetailerProductLink(url);
    if (exact && !links.some((link) => link.retailerId === exact.retailerId && link.retailerSku === exact.retailerSku)) {
      links.push(exact);
    }
    const host = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } })();
    const named = storesNamed(host.replace(/\./g, " "))[0]?.retailerId;
    if (exact) linkStores.push(exact.retailerId);
    else if (named) linkStores.push(named);
  }
  const bodyStores = storesNamed(body.replace(URL_PATTERN, " ")).map((store) => store.retailerId);
  const placeStores = [channel.channel.replace(/[-_]/g, " "), channel.server, channel.author]
    .flatMap((value) => storesNamed(value).map((store) => store.retailerId));
  const stores = [...new Set([...linkStores, ...bodyStores, ...placeStores])];
  const folded = foldedText(body);
  const otherStore = stores.length ? "" : otherStoreNamed(`${body} ${channel.channel.replace(/[-_]/g, " ")} ${channel.server}`);
  const { identifiers, gtins } = identifiersIn(body, stores);
  const priceCents = priceIn(body);
  const productText = productTextOf(body);

  // "Out of stock → In stock" is a restock and "In stock → Sold out" a sellout: the later word wins.
  const lastOut = Math.max(-1, ...[...folded.matchAll(OUT_OF_STOCK)].map((match) => match.index ?? -1));
  const lastIn = Math.max(-1, ...[...folded.matchAll(RESTOCK)].map((match) => match.index ?? -1));
  const outOfStock = lastOut > lastIn;
  const preorder = PREORDER.test(folded);
  const restock = lastIn >= 0 && !outOfStock;
  const priceChange = PRICE_CHANGE.test(folded);
  const place = foldedText(`${channel.channel} ${channel.author}`);
  const monitorPlace = MONITOR.test(place) && !CHAT.test(foldedText(channel.channel));
  const eventType: DiscordNotificationFacts["eventType"] = outOfStock ? "unknown"
    : preorder ? "preorder"
    : restock || monitorPlace ? "restock"
    : priceChange ? "price_change" : "unknown";
  const availability: DiscordNotificationFacts["availability"] = outOfStock ? "out_of_stock"
    : preorder ? "preorder"
    : restock || monitorPlace ? "in_stock" : "unknown";

  const exact = links.length > 0 || identifiers.length > 0 || gtins.length > 0;
  const question = QUESTION.test(folded.trim());
  let relevant = false;
  let relevance = "";
  if (!body.trim()) {
    relevance = "The notification has no message text (an embed or image only), so it names no product.";
  } else if (exact) {
    relevant = true;
    relevance = links.length ? "It links a store item." : "It names a store item number.";
  } else if (question) {
    relevance = "It reads as a question in chat, not a store alert.";
  } else if (restock || preorder || outOfStock || priceChange) {
    relevant = true;
    relevance = "It reports stock or price.";
  } else if (priceCents !== null && stores.length) {
    relevant = true;
    relevance = "It names a store and a price.";
  } else if (monitorPlace && productText.length >= 3) {
    relevant = true;
    relevance = "It came from a store-alert channel.";
  } else {
    relevance = "It doesn't mention a store item, stock or a price.";
  }
  const header = cleanText(toast.title, 200);
  return {
    channel,
    text: cleanText(body.trim() ? `${header}: ${body}` : header, 500),
    links,
    stores,
    otherStore,
    identifiers,
    gtins,
    priceCents,
    eventType,
    availability,
    relevant,
    relevance,
    productText
  };
}

/** A stable reference for one Windows notification, unique across reused Windows IDs. */
export function discordNotificationReference(notificationId: string | number | bigint, arrivalTicks: string | number | bigint): string {
  return `wpn:${String(notificationId)}:${String(arrivalTicks)}`;
}

export function discordNotificationSignalId(channelId: string, reference: string): string {
  return `discord:${stableHash("yoink_discord_notification_v1", channelId, reference)}`;
}
