import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { YoinkDatabase } from "../../database/src/database.js";
import { UserActionConnectorRepository } from "../../database/src/user-action-connector-repository.js";
import { currentRequestScope } from "../../database/src/request-scope.js";
import { InputValidationError } from "../../domain/src/input-validation-error.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import type { UserActionWebhookRequest, UserActionWebhookResult, UserActionWebhookTransport } from "./user-action-webhook.js";
import { userBotMessage } from "./user-bot-message.js";

type BotSecret = { kind: "discord"; webhookUrl: string } | { kind: "telegram"; token: string; chatId: string };
const DEFAULT_EVENTS = ["carted", "needs_you", "test"] as const;

export class UserBotConnections {
  constructor(private readonly db: YoinkDatabase, private readonly key: Buffer,
    private readonly fetcher: typeof fetch = fetch) {
    if (key.length !== 32) throw new Error("YoinkBot needs a 32-byte encryption key.");
  }

  static persistent(db: YoinkDatabase, directory: string): UserBotConnections {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, "yoinkbot-secret.key");
    try { writeFileSync(path, randomBytes(32), { flag: "wx", mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    return new UserBotConnections(db, readFileSync(path));
  }

  private associatedData(reference: string): string {
    const scope = currentRequestScope();
    return `${scope.tenantId}:${scope.userId}:${reference}`;
  }

  private encrypt(secret: BotSecret, reference: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(this.associatedData(reference)));
    const body = Buffer.concat([cipher.update(JSON.stringify(secret), "utf8"), cipher.final()]);
    return [nonce, cipher.getAuthTag(), body].map((part) => part.toString("base64url")).join(".");
  }

  private decrypt(value: string, reference: string): BotSecret {
    const [nonce, tag, body] = value.split(".").map((part) => Buffer.from(part, "base64url"));
    const cipher = createDecipheriv("aes-256-gcm", this.key, nonce!);
    cipher.setAAD(Buffer.from(this.associatedData(reference)));
    cipher.setAuthTag(tag!);
    return JSON.parse(Buffer.concat([cipher.update(body!), cipher.final()]).toString("utf8")) as BotSecret;
  }

  private async api(url: string, body?: Record<string, unknown>): Promise<Record<string, any>> {
    try {
      const response = await this.fetcher(url, { method: body ? "POST" : "GET", redirect: "error",
        signal: AbortSignal.timeout(5_000), ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
      if (!response.ok) throw new Error("provider_rejected");
      const data = await response.json() as Record<string, any>;
      if (data.ok === false) throw new Error("provider_rejected");
      return data;
    } catch { throw new InputValidationError("YoinkBot could not verify this connection. Check the credential and try again. Telegram needs a dedicated bot without another webhook or update reader."); }
  }

  private save(name: string, secret: BotSecret, now: number) {
    const scope = currentRequestScope();
    const reference = newId("yoinkbot");
    const fingerprint = stableHash("yoinkbot_binding_v1", reference, JSON.stringify(secret));
    return this.db.transaction(() => {
      const connector = new UserActionConnectorRepository(this.db, { [reference]: fingerprint }).save({
        contractVersion: 1, kind: secret.kind, name: String(name || `YoinkBot ${secret.kind}`).slice(0, 80),
        endpointReference: reference, enabled: true, events: [...DEFAULT_EVENTS]
      }, "", now);
      this.db.run(`INSERT INTO user_bot_credentials(connector_id, tenant_id, user_id, endpoint_reference, binding_fingerprint, encrypted_secret)
        VALUES (?, ?, ?, ?, ?, ?)`, connector.id, scope.tenantId, scope.userId, reference, fingerprint, this.encrypt(secret, reference));
      return connector;
    });
  }

  async connectDiscord(input: { name?: string; webhookUrl?: string; optedIn?: boolean }, now = Date.now()) {
    if (input.optedIn !== true) throw new InputValidationError("Choose to receive YoinkBot checkout alerts before connecting.");
    let url: URL;
    try { url = new URL(String(input.webhookUrl || "")); } catch { throw new InputValidationError("Enter a Discord webhook URL."); }
    if (url.origin !== "https://discord.com" || url.username || url.password || url.search || url.hash
      || !/^\/api(?:\/v\d+)?\/webhooks\/\d{10,25}\/[A-Za-z0-9_-]{30,200}$/.test(url.pathname)) {
      throw new InputValidationError("Use the webhook URL copied from your private Discord channel.");
    }
    const verified = await this.api(url.toString());
    if (!verified.id || !verified.channel_id || verified.type !== 1) throw new InputValidationError("This Discord webhook cannot receive channel messages.");
    return this.save(input.name || "YoinkBot Discord", { kind: "discord", webhookUrl: url.toString() }, now);
  }

  async beginTelegram(input: { name?: string; token?: string; optedIn?: boolean }, now = Date.now()) {
    if (input.optedIn !== true) throw new InputValidationError("Choose to receive YoinkBot checkout alerts before connecting.");
    const token = String(input.token || "").trim();
    if (!/^\d{5,20}:[A-Za-z0-9_-]{25,100}$/.test(token)) throw new InputValidationError("Enter the bot token provided by Telegram BotFather.");
    const bot = (await this.api(`https://api.telegram.org/bot${token}/getMe`)).result;
    if (bot?.is_bot !== true || !/^[A-Za-z0-9_]{5,64}$/.test(bot.username)) throw new InputValidationError("Telegram did not verify this bot.");
    const hook = (await this.api(`https://api.telegram.org/bot${token}/getWebhookInfo`)).result;
    if (!hook || hook.url) throw new InputValidationError("Use a dedicated Telegram bot without an existing webhook.");
    const id = newId("bot_pairing"); const code = randomBytes(24).toString("base64url");
    const scope = currentRequestScope();
    this.db.run("DELETE FROM user_bot_pairings WHERE expires_at <= ? OR (tenant_id=? AND user_id=?)", nowIso(now), scope.tenantId, scope.userId);
    this.db.run(`INSERT INTO user_bot_pairings(id, tenant_id, user_id, name, code_hash, encrypted_secret, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, id, scope.tenantId, scope.userId, String(input.name || "YoinkBot Telegram").slice(0, 80),
      stableHash("yoinkbot_pairing", code), this.encrypt({ kind: "telegram", token, chatId: "" }, id), nowIso(now + 10 * 60_000));
    return { id, url: `https://t.me/${bot.username}?start=${code}`, expiresAt: nowIso(now + 10 * 60_000) };
  }

  async finishTelegram(id: string, now = Date.now()) {
    const scope = currentRequestScope();
    const row = this.db.get<{ name: string; codeHash: string; encryptedSecret: string }>(
      `SELECT name, code_hash AS codeHash, encrypted_secret AS encryptedSecret FROM user_bot_pairings
       WHERE id=? AND tenant_id=? AND user_id=? AND expires_at>?`, id, scope.tenantId, scope.userId, nowIso(now));
    if (!row) throw new InputValidationError("This Telegram connection expired. Start connecting again.");
    const secret = this.decrypt(row.encryptedSecret, id);
    if (secret.kind !== "telegram") throw new InputValidationError("The Telegram connection is invalid.");
    // This dedicated bot only consumes Start handshakes. Read the recent tail so old
    // messages cannot leave a new connection stuck behind the first 100 updates.
    const updates = (await this.api(`https://api.telegram.org/bot${secret.token}/getUpdates`, { offset: -100, timeout: 0, limit: 100, allowed_updates: ["message"] })).result;
    const matching = Array.isArray(updates) ? updates.find((update) => {
      const message = update?.message;
      const code = /^\/start(?:@[A-Za-z0-9_]+)? ([A-Za-z0-9_-]+)$/.exec(String(message?.text || ""))?.[1];
      return code && stableHash("yoinkbot_pairing", code) === row.codeHash && message.chat?.type === "private"
        && Number.isSafeInteger(message.chat.id) && message.chat.id === message.from?.id && message.from?.is_bot !== true;
    }) : null;
    if (!matching) return { pending: true as const };
    return this.db.transaction(() => {
      // A concurrent verification cannot consume the pairing twice.
      const deleted = this.db.run("DELETE FROM user_bot_pairings WHERE id=? AND tenant_id=? AND user_id=?", id, scope.tenantId, scope.userId);
      if (!Number(deleted.changes)) throw new InputValidationError("This Telegram connection was already completed.");
      return { pending: false as const, connector: this.save(row.name, { ...secret, chatId: String(matching.message.chat.id) }, now) };
    });
  }

  credential(reference: string): BotSecret | null {
    const scope = currentRequestScope();
    const row = this.db.get<{ encryptedSecret: string }>(`SELECT encrypted_secret AS encryptedSecret FROM user_bot_credentials
      WHERE endpoint_reference=? AND tenant_id=? AND user_id=?`, reference, scope.tenantId, scope.userId);
    return row ? this.decrypt(row.encryptedSecret, reference) : null;
  }
}

export class UserBotTransport implements UserActionWebhookTransport {
  constructor(private readonly connections: UserBotConnections, private readonly fallback: UserActionWebhookTransport,
    private readonly fetcher: typeof fetch = fetch) {}

  async deliver(request: UserActionWebhookRequest): Promise<UserActionWebhookResult> {
    if (!request.endpointReference.startsWith("yoinkbot_")) return this.fallback.deliver(request);
    let secret: BotSecret | null;
    try { secret = this.connections.credential(request.endpointReference); } catch { secret = null; }
    if (!secret || secret.kind !== request.connectorKind) return { delivered: false, retryable: false, reasonCode: "bot_connection_unavailable", httpStatus: 0 };
    const message = userBotMessage(request.payload);
    const url = secret.kind === "discord" ? `${secret.webhookUrl}?wait=true` : `https://api.telegram.org/bot${secret.token}/sendMessage`;
    const body = secret.kind === "discord"
      ? { username: "YoinkBot", content: message.text, allowed_mentions: { parse: [] } }
      : { chat_id: secret.chatId, text: message.text, disable_notification: false, link_preview_options: { is_disabled: true },
        ...(message.cartUrl ? { reply_markup: { inline_keyboard: [[{ text: "Open store cart", url: message.cartUrl }]] } } : {}) };
    try {
      const response = await this.fetcher(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(5_000),
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({})) as Record<string, any>;
      const id = secret.kind === "discord" ? data.id : data.ok === true ? data.result?.message_id : undefined;
      const validReceipt = secret.kind === "discord" ? typeof id === "string" && id.length > 0
        : Number.isSafeInteger(id) && id > 0;
      if (response.ok && validReceipt) return { delivered: true, retryable: false, reasonCode: "provider_accepted", httpStatus: response.status, providerMessageId: String(id) };
      const retryAfterMs = Math.ceil(Number(data.parameters?.retry_after ?? data.retry_after ?? response.headers.get("retry-after")) * 1_000);
      return { delivered: false, retryable: [408, 425, 429].includes(response.status) || response.status >= 500 || response.ok,
        reasonCode: response.status === 403 ? "bot_blocked_or_removed" : "bot_provider_rejected", httpStatus: response.status,
        ...(Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? { retryAfterMs } : {}) };
    } catch { return { delivered: false, retryable: true, reasonCode: "bot_transport_failed", httpStatus: 0 }; }
  }
}
