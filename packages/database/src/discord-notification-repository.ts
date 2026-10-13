import { isAllNewCollectionTitle } from "../../domain/src/collections.js";
import { DomainNotFoundError } from "../../domain/src/domain-request-error.js";
import { newId, nowIso } from "../../domain/src/ids.js";
import { InputValidationError } from "../../domain/src/input-validation-error.js";
import { cleanText } from "../../domain/src/normalize.js";
import { ProductTextIndex, productTextKey } from "../../domain/src/product-text-match.js";
import { AuditRepository } from "./audit-repository.js";
import type { YoinkDatabase } from "./database.js";
import { currentRequestScope } from "./request-scope.js";

/**
 * Traces a Discord notification to the Yoink product it is about (Kevin,
 * 2026-10-12: "be able to trace the listing to the yoink product"), in order
 * of certainty: a store link in the message, a store item number or barcode,
 * a product name the shopper linked before, then the product name itself.
 * The result names one store listing when the message (or the product's only
 * store) says which store; the call then goes through the usual plan checks.
 */

export const DISCORD_TEXT_ALIAS_KIND = "discord_text";

export interface DiscordTraceInput {
  links: ReadonlyArray<{ retailerId: string; retailerSku: string; canonicalUrl: string }>;
  stores: readonly string[];
  otherStore: string;
  identifiers: ReadonlyArray<{ retailerId: string; retailerSku: string; label: string }>;
  gtins: readonly string[];
  productText: string;
}

export interface DiscordTraceListing {
  id: string;
  retailerId: string;
  retailerSku: string;
  canonicalUrl: string;
}

export type DiscordTraceMethod = "link" | "item_number" | "barcode" | "remembered" | "name" | "none";

export interface DiscordTrace {
  method: DiscordTraceMethod;
  variantId: string;
  variantTitle: string;
  listing: DiscordTraceListing | null;
  /** The name match's score (0–1); null for exact traces. */
  score: number | null;
  /** The key a shopper's link for this product name is remembered under ("" without a name). */
  textKey: string;
  /** One sentence for the call's Why. */
  explanation: string;
}

export interface DiscordNotificationSettings {
  enabled: boolean;
}

export interface DiscordProductSuggestion {
  variantId: string;
  title: string;
  score: number;
  imageUrl: string;
  stores: string[];
}

interface ListingRow {
  id: string;
  variantId: string;
  title: string;
  retailerId: string;
  retailerSku: string;
  canonicalUrl: string;
  offerRole: string;
}

const LISTING_SELECT = `SELECT l.id, l.variant_id AS variantId, v.title, l.retailer_id AS retailerId,
  l.retailer_sku AS retailerSku, l.canonical_url AS canonicalUrl, l.offer_role AS offerRole
  FROM listings l JOIN variants v ON v.id = l.variant_id`;

function settingsFrom(value: unknown): DiscordNotificationSettings {
  try {
    const parsed = JSON.parse(String(value ?? "{}")) as { enabled?: unknown };
    return { enabled: parsed?.enabled !== false };
  } catch {
    return { enabled: true };
  }
}

function percent(score: number): string {
  return `${Math.round(score * 100)}%`;
}

export class DiscordNotificationRepository {
  private readonly audit: AuditRepository;
  private index: { stamp: string; value: ProductTextIndex } | null = null;

  constructor(private readonly db: YoinkDatabase) {
    this.audit = new AuditRepository(db);
  }

  settings(): DiscordNotificationSettings {
    const row = this.db.get<{ value: string }>(
      "SELECT discord_notifications_json AS value FROM app_settings WHERE user_id = ?",
      currentRequestScope().userId
    );
    return settingsFrom(row?.value);
  }

  updateSettings(input: unknown, now = Date.now()): DiscordNotificationSettings {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
    if (typeof value.enabled !== "boolean") throw new InputValidationError("Choose whether Yoink reads Discord notifications.");
    const settings: DiscordNotificationSettings = { enabled: value.enabled };
    this.db.run(
      "UPDATE app_settings SET discord_notifications_json = ?, updated_at = ? WHERE user_id = ?",
      JSON.stringify(settings),
      nowIso(now),
      currentRequestScope().userId
    );
    this.audit.record({
      correlationId: currentRequestScope().userId,
      aggregateType: "user_settings",
      eventType: "discord_notifications_updated",
      reasonCode: settings.enabled ? "enabled" : "disabled",
      message: settings.enabled
        ? "Yoink reads Discord notifications on this PC as calls."
        : "Yoink stopped reading Discord notifications.",
      data: { ...settings }
    }, now);
    return this.settings();
  }

  private storeNames(): Map<string, string> {
    return new Map(this.db.all<{ id: string; name: string }>("SELECT id, display_name AS name FROM retailers")
      .map((row) => [row.id, row.name]));
  }

  private productIndex(): ProductTextIndex {
    const stamp = this.db.get<{ count: number; updated: string }>(
      "SELECT COUNT(*) AS count, COALESCE(MAX(updated_at), '') AS updated FROM variants"
    );
    const key = `${stamp?.count ?? 0}|${stamp?.updated ?? ""}`;
    if (this.index?.stamp === key) return this.index.value;
    // Products with a store listing; an "All New …" entry is a collection, not a product.
    const rows = this.db.all<{ id: string; title: string }>(
      `SELECT v.id, v.title FROM variants v
       WHERE EXISTS (SELECT 1 FROM listings l WHERE l.variant_id = v.id)`
    ).filter((row) => !isAllNewCollectionTitle(row.title));
    const value = new ProductTextIndex(rows);
    this.index = { stamp: key, value };
    return value;
  }

  private listingBySku(retailerId: string, retailerSku: string): ListingRow | null {
    return this.db.get<ListingRow>(`${LISTING_SELECT} WHERE l.retailer_id = ? AND l.retailer_sku = ?`, retailerId, retailerSku) ?? null;
  }

  private variantTitle(variantId: string): string {
    return String(this.db.get<{ title: string }>("SELECT title FROM variants WHERE id = ?", variantId)?.title ?? "");
  }

  /** The store listing a product-level trace points at, and the words saying why. */
  private listingFor(
    variantId: string,
    input: DiscordTraceInput,
    names: Map<string, string>
  ): { listing: DiscordTraceListing | null; note: string } {
    const rows = this.db.all<ListingRow>(
      `${LISTING_SELECT} WHERE l.variant_id = ?
       ORDER BY (l.offer_role = 'alternate'), l.execution_supported DESC, l.created_at, l.id`,
      variantId
    );
    const store = (id: string): string => names.get(id) ?? id;
    const listing = (row: ListingRow): DiscordTraceListing => ({
      id: row.id, retailerId: row.retailerId, retailerSku: row.retailerSku, canonicalUrl: row.canonicalUrl
    });
    if (input.stores.length) {
      for (const retailerId of input.stores) {
        const row = rows.find((item) => item.retailerId === retailerId);
        if (row) return { listing: listing(row), note: ` at ${store(retailerId)}` };
      }
      return { listing: null, note: `, but Yoink has no ${store(input.stores[0] ?? "")} listing for it` };
    }
    if (input.otherStore) {
      return { listing: null, note: `, but the message is about ${input.otherStore}, which isn't a Yoink store` };
    }
    const primaryStores = [...new Set(rows.filter((row) => row.offerRole !== "alternate").map((row) => row.retailerId))];
    const only = primaryStores.length === 1 ? rows.find((row) => row.retailerId === primaryStores[0]) : undefined;
    if (only) {
      return { listing: listing(only), note: `. The message names no store; ${store(only.retailerId)} is the only store Yoink has it at` };
    }
    return { listing: null, note: ", but the message names no store and Yoink has it at more than one" };
  }

  trace(input: DiscordTraceInput): DiscordTrace {
    const names = this.storeNames();
    const store = (id: string): string => names.get(id) ?? id;
    const textKey = productTextKey(input.productText);
    const exact = (method: DiscordTraceMethod, row: ListingRow, what: string): DiscordTrace => ({
      method,
      variantId: row.variantId,
      variantTitle: row.title,
      listing: { id: row.id, retailerId: row.retailerId, retailerSku: row.retailerSku, canonicalUrl: row.canonicalUrl },
      score: null,
      textKey,
      explanation: `Yoink matched ${what} to ${row.title} at ${store(row.retailerId)}.`
    });
    let unknownLink = "";
    for (const link of input.links) {
      const row = this.listingBySku(link.retailerId, link.retailerSku);
      if (row) return exact("link", row, `the ${store(link.retailerId)} link in the message`);
      unknownLink ||= `The ${store(link.retailerId)} link is for item ${link.retailerSku}, which isn't in Yoink.`;
    }
    for (const identifier of input.identifiers) {
      const row = this.listingBySku(identifier.retailerId, identifier.retailerSku);
      if (row) return exact("item_number", row, `${store(identifier.retailerId)} ${identifier.label} ${identifier.retailerSku}`);
    }
    for (const gtin of input.gtins) {
      const rows = this.db.all<ListingRow>(`${LISTING_SELECT} WHERE l.gtin = ? ORDER BY (l.offer_role = 'alternate'), l.id`, gtin);
      const row = rows.find((item) => input.stores.includes(item.retailerId))
        ?? (new Set(rows.map((item) => item.variantId)).size === 1 && !input.stores.length ? rows[0] : undefined);
      if (row) return exact("barcode", row, `barcode ${gtin.replace(/^0+(?=\d{12})/, "")}`);
    }
    const product = (method: DiscordTraceMethod, variantId: string, title: string, score: number | null, how: string): DiscordTrace => {
      const { listing, note } = this.listingFor(variantId, input, names);
      return {
        method,
        variantId,
        variantTitle: title,
        listing,
        score,
        textKey,
        explanation: `${unknownLink ? `${unknownLink} ` : ""}${how} ${title}${note}.`
      };
    };
    if (textKey) {
      const remembered = this.db.get<{ variantId: string; title: string }>(
        `SELECT alias.variant_id AS variantId, v.title
         FROM source_product_aliases alias
         JOIN source_connections connection ON connection.id = alias.source_connection_id
         JOIN variants v ON v.id = alias.variant_id
         WHERE connection.user_id = ? AND connection.source = 'discord'
           AND alias.alias_kind = ? AND alias.alias_value = ?
         ORDER BY alias.observed_at DESC, alias.id DESC LIMIT 1`,
        currentRequestScope().userId,
        DISCORD_TEXT_ALIAS_KIND,
        textKey
      );
      if (remembered) {
        return product("remembered", remembered.variantId, remembered.title, null, "You linked this product name to");
      }
    }
    if (!input.productText) {
      return {
        method: "none", variantId: "", variantTitle: "", listing: null, score: null, textKey,
        explanation: unknownLink || "The message names no product Yoink could read."
      };
    }
    const match = this.productIndex().match(input.productText);
    if (match.confident && match.best) {
      return product("name", match.best.id, match.best.title, match.best.score,
        `Yoink matched the product name (${percent(match.best.score)} match) to`);
    }
    return {
      method: "none", variantId: "", variantTitle: "", listing: null, score: null, textKey,
      explanation: `${unknownLink ? `${unknownLink} ` : ""}Yoink couldn't match the product name: ${match.reason.charAt(0).toLowerCase()}${match.reason.slice(1)}`
    };
  }

  /** Products a shopper can link a Discord message to, closest first. */
  suggestions(text: string, limit = 6): DiscordProductSuggestion[] {
    const bounded = Math.max(1, Math.min(20, Math.floor(Number(limit) || 6)));
    const ranked = this.productIndex().match(cleanText(text, 300), bounded).ranked;
    if (!ranked.length) return [];
    const names = this.storeNames();
    return ranked.map((match) => {
      const row = this.db.get<{ imageUrl: string; stores: string }>(
        `SELECT v.image_url AS imageUrl,
                (SELECT group_concat(DISTINCT l.retailer_id) FROM listings l WHERE l.variant_id = v.id) AS stores
         FROM variants v WHERE v.id = ?`,
        match.id
      );
      return {
        variantId: match.id,
        title: match.title,
        score: match.score,
        imageUrl: String(row?.imageUrl ?? ""),
        stores: String(row?.stores ?? "").split(",").filter(Boolean).map((id) => names.get(id) ?? id)
      };
    });
  }

  /**
   * The shopper says which product a Discord call was about. Later messages with
   * the same product words trace to it ("remembered"); this call stays as it was.
   */
  rememberLink(signalIdValue: unknown, variantIdValue: unknown, now = Date.now()): { variantId: string; title: string } {
    const signalId = cleanText(signalIdValue, 180);
    const variantId = cleanText(variantIdValue, 120);
    if (!signalId || !variantId) throw new InputValidationError("Choose the Discord call and the product it was about.");
    const scope = currentRequestScope();
    const event = this.db.get<{ sourceConnectionId: string; textKey: string }>(
      `SELECT event.source_connection_id AS sourceConnectionId,
              COALESCE(json_extract(event.identity_json, '$.globalIdentifiers.discord_text'), '') AS textKey
       FROM signal_events event
       WHERE event.signal_id = ? AND event.user_id = ? AND event.source = 'discord'`,
      signalId,
      scope.userId
    );
    if (!event) throw new DomainNotFoundError("discord_call_not_found", "That Discord call isn't in your call log.");
    const textKey = String(event.textKey).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(textKey)) {
      throw new InputValidationError("This Discord message names no product, so there is nothing to remember.");
    }
    const title = this.variantTitle(variantId);
    if (!title) throw new DomainNotFoundError("product_not_found", "That product isn't in Yoink.");
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO source_product_aliases(id, source_connection_id, alias_kind, alias_value, variant_id, observed_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_connection_id, alias_kind, alias_value)
         DO UPDATE SET variant_id = excluded.variant_id, observed_at = excluded.observed_at`,
        newId("source_alias"),
        event.sourceConnectionId,
        DISCORD_TEXT_ALIAS_KIND,
        textKey,
        variantId,
        nowIso(now)
      );
      this.audit.record({
        correlationId: signalId,
        aggregateType: "signal_provider_feedback",
        eventType: "discord_product_name_linked",
        reasonCode: "user_linked_product",
        message: `Discord messages with this product name now trace to ${title}.`,
        data: { signalId, variantId }
      }, now);
    });
    return { variantId, title };
  }
}
