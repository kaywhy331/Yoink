import { randomBytes } from "node:crypto";
import type { YoinkDatabase } from "../../database/src/database.js";
import { currentRequestScope } from "../../database/src/request-scope.js";
import { UserActionConnectorRepository } from "../../database/src/user-action-connector-repository.js";
import { AuditRepository } from "../../database/src/audit-repository.js";
import { InputValidationError } from "../../domain/src/input-validation-error.js";
import { newId, nowIso, stableHash } from "../../domain/src/ids.js";
import { BotSecretVault } from "./bot-secret-vault.js";

export type BotProviderKind = "discord" | "telegram";
export type ManagedBotCredential = { kind: "discord"; token: string; channelId: string }
  | { kind: "telegram"; token: string; chatId: string };
interface Provider {
  id: string; kind: BotProviderKind; enabled: number; identity: string; username: string;
  redirectUri: string; guildId: string; encryptedSecret: string; offset: number; verifiedAt: string;
}
interface ProviderSecret { token: string; clientSecret?: string }
const KINDS = ["discord", "telegram"] as const;
const EVENTS = ["carted", "needs_you", "test"] as const;
const DISCORD = "https://discord.com/api/v10";
const SNOWFLAKE = /^\d{10,25}$/;
export const DISCORD_BOT_CALLBACK = "/api/v1/user/notifications/discord/callback";

export function botProviderKind(value: string): BotProviderKind {
  if (value !== "discord" && value !== "telegram") throw new InputValidationError("Choose Discord or Telegram.");
  return value;
}

/** Business-owned providers; customer connections contain only a private recipient. */
export class ManagedBotConnections {
  private readonly vault: BotSecretVault;
  private readonly polls = new Map<string, Promise<void>>();
  constructor(private readonly db: YoinkDatabase, key: Buffer, private readonly fetcher: typeof fetch = fetch) {
    this.vault = new BotSecretVault(key);
  }

  private provider(kind: BotProviderKind): Provider | undefined {
    return this.db.get<Provider>(`SELECT id, kind, enabled, bot_identity AS identity, username,
      redirect_uri AS redirectUri, guild_id AS guildId, encrypted_secret AS encryptedSecret,
      update_offset AS offset, verified_at AS verifiedAt FROM bot_providers WHERE tenant_id=? AND kind=?`,
    currentRequestScope().tenantId, kind);
  }
  private context(kind: BotProviderKind) { return `${currentRequestScope().tenantId}:yoinkbot-provider:${kind}`; }
  private secret(provider: Provider) { return this.vault.decrypt<ProviderSecret>(provider.encryptedSecret, this.context(provider.kind)); }
  private available(kind: BotProviderKind) {
    const provider = this.provider(kind);
    if (!provider?.enabled) throw new InputValidationError("This notification option is unavailable. Try again later.");
    return provider;
  }
  private async api(url: string, init: RequestInit = {}): Promise<Record<string, any>> {
    try {
      const response = await this.fetcher(url, { ...init, redirect: "error", signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error("provider_rejected");
      if (response.status === 204) return {};
      const data = await response.json() as Record<string, any>;
      if (data.ok === false) throw new Error("provider_rejected");
      return data;
    } catch { throw new InputValidationError("The messaging service could not complete the connection. Please try again."); }
  }
  private discord(token: string, path: string, method = "GET", body?: unknown) {
    return this.api(`${DISCORD}${path}`, { method, headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }

  adminStatus() {
    return KINDS.map(kind => {
      const p = this.provider(kind);
      return { kind, configured: Boolean(p), enabled: Boolean(p?.enabled), username: p?.username || "",
        redirectUri: p?.redirectUri || "", guildId: p?.guildId || "", verifiedAt: p?.verifiedAt || "" };
    });
  }

  async configure(kind: BotProviderKind, input: Record<string, unknown>, origin: string, now = Date.now()) {
    const token = String(input.token || "").trim();
    if (!token || token.length > 250 || /\s/.test(token)) throw new InputValidationError("Enter the business bot token.");
    let identity: string; let username: string; let redirectUri = ""; let guildId = "";
    const secret: ProviderSecret = { token };
    if (kind === "telegram") {
      if (!/^\d{5,20}:[A-Za-z0-9_-]{25,100}$/.test(token)) throw new InputValidationError("Enter the Telegram bot token from BotFather.");
      const bot = (await this.api(`https://api.telegram.org/bot${token}/getMe`)).result;
      if (bot?.is_bot !== true || !Number.isSafeInteger(bot.id) || !/^[A-Za-z0-9_]{5,64}$/.test(bot.username)) {
        throw new InputValidationError("Telegram did not verify this bot.");
      }
      const hook = (await this.api(`https://api.telegram.org/bot${token}/getWebhookInfo`)).result;
      if (!hook || hook.url) throw new InputValidationError("Use a dedicated Telegram bot with no other webhook or update reader.");
      identity = String(bot.id); username = bot.username;
    } else {
      secret.clientSecret = String(input.clientSecret || "").trim();
      if (!/^[A-Za-z0-9_-]{20,200}$/.test(secret.clientSecret)) throw new InputValidationError("Enter the Discord application client secret.");
      guildId = String(input.guildId || "").trim();
      if (!SNOWFLAKE.test(guildId)) throw new InputValidationError("Enter the business Discord server ID.");
      const originUrl = new URL(origin);
      if (originUrl.protocol !== "https:" && !(originUrl.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(originUrl.hostname))) {
        throw new InputValidationError("Discord requires HTTPS, or a loopback address for local use.");
      }
      redirectUri = `${originUrl.origin}${DISCORD_BOT_CALLBACK}`;
      const bot = await this.discord(token, "/users/@me");
      const application = await this.discord(token, "/oauth2/applications/@me");
      if (!bot.bot || !SNOWFLAKE.test(bot.id) || !SNOWFLAKE.test(application.id)) throw new InputValidationError("Discord did not verify this bot application.");
      // Verify the bot belongs to the business server before offering customer connections.
      await this.discord(token, `/guilds/${guildId}/members/${bot.id}`);
      identity = application.id; username = String(bot.username || "YoinkBot");
    }
    const previous = this.provider(kind);
    const id = previous?.id || newId("bot_provider");
    this.db.transaction(() => {
      this.db.run(`INSERT INTO bot_providers(id, tenant_id, kind, enabled, bot_identity, username, redirect_uri,
        guild_id, encrypted_secret, update_offset, verified_at) VALUES(?, ?, ?, 1, ?, ?, ?, ?, ?, 0, ?)
        ON CONFLICT(tenant_id, kind) DO UPDATE SET enabled=1, bot_identity=excluded.bot_identity,
        username=excluded.username, redirect_uri=excluded.redirect_uri, guild_id=excluded.guild_id,
        encrypted_secret=excluded.encrypted_secret, verified_at=excluded.verified_at,
        update_offset=CASE WHEN bot_providers.bot_identity=excluded.bot_identity THEN bot_providers.update_offset ELSE 0 END`,
      id, currentRequestScope().tenantId, kind, identity, username, redirectUri, guildId,
      this.vault.encrypt(secret, this.context(kind)), nowIso(now));
      // A changed application/server invalidates in-progress authorizations. Token rotation is safe for existing recipients.
      this.db.run("DELETE FROM user_bot_pairings WHERE provider_id=? AND tenant_id=?", id, currentRequestScope().tenantId);
      new AuditRepository(this.db).record({correlationId: id, aggregateType: "bot_provider", eventType: "bot_provider_configured",
        reasonCode: "admin_configured", message: "An administrator configured a business notification provider.", data: {kind, enabled: true}}, now);
    });
    return this.adminStatus();
  }

  setProviderEnabled(kind: BotProviderKind, enabled: boolean) {
    const p = this.provider(kind);
    if (!p) throw new InputValidationError("Configure the bot first.");
    this.db.transaction(() => {
      this.db.run("UPDATE bot_providers SET enabled=? WHERE id=? AND tenant_id=?", enabled ? 1 : 0, p.id, currentRequestScope().tenantId);
      if (!enabled) {
        this.db.run("DELETE FROM user_bot_pairings WHERE provider_id=? AND tenant_id=?", p.id, currentRequestScope().tenantId);
        this.db.run(`UPDATE user_action_connector_deliveries SET state='cancelled', last_error_code='provider_paused'
          WHERE tenant_id=? AND state IN ('pending','retry_wait') AND connector_id IN
          (SELECT connector_id FROM user_bot_credentials WHERE provider_id=?)`, currentRequestScope().tenantId, p.id);
      }
      new AuditRepository(this.db).record({correlationId: p.id, aggregateType: "bot_provider", eventType: "bot_provider_status_changed",
        reasonCode: enabled ? "admin_enabled" : "admin_paused", message: "An administrator changed notification provider availability.", data: {kind, enabled}});
    });
    return this.adminStatus();
  }

  customerStatus() {
    const connectors = new UserActionConnectorRepository(this.db).list();
    const scope = currentRequestScope();
    const linked = new Set(this.db.all<{id: string}>(`SELECT c.connector_id AS id FROM user_bot_credentials c
      JOIN bot_providers p ON p.id=c.provider_id AND p.tenant_id=c.tenant_id AND p.bot_identity=c.provider_identity
      WHERE c.tenant_id=? AND c.user_id=?`, scope.tenantId, scope.userId).map(row => row.id));
    return KINDS.map(kind => {
      const own = connectors.filter(c => c.kind === kind);
      const connected = own.some(c => c.runtimeBound || linked.has(c.id));
      const available = Boolean(this.provider(kind)?.enabled) || own.some(c => c.runtimeBound);
      return { kind, available, connected,
        enabled: own.some(c => c.enabled), needsReconnect: own.length > 0 && !connected && available,
        deliveryIssue: own.some(c => c.enabled && Boolean(c.lastErrorCode)) };
    });
  }

  begin(kind: BotProviderKind, input: Record<string, unknown>, origin: string, now = Date.now()) {
    if (input.optedIn !== true || Object.keys(input).some(k => k !== "optedIn")) {
      throw new InputValidationError("Choose to receive checkout alerts before connecting.");
    }
    const p = this.available(kind);
    if (kind === "discord" && p.redirectUri !== `${origin}${DISCORD_BOT_CALLBACK}`) {
      throw new InputValidationError("Discord is unavailable at this dashboard address. Contact support.");
    }
    const scope = currentRequestScope(); const code = randomBytes(32).toString("base64url"); const id = newId("bot_pairing");
    const expiresAt = nowIso(now + 10 * 60_000);
    this.db.transaction(() => {
      this.db.run("DELETE FROM user_bot_pairings WHERE tenant_id=? AND (expires_at<=? OR (user_id=? AND kind=?))",
        scope.tenantId, nowIso(now), scope.userId, kind);
      this.db.run(`INSERT INTO user_bot_pairings(id, tenant_id, user_id, name, code_hash, encrypted_secret, expires_at,
        provider_id, provider_identity, kind) VALUES(?, ?, ?, ?, ?, '', ?, ?, ?, ?)`,
      id, scope.tenantId, scope.userId, `YoinkBot ${kind}`, stableHash("managed_bot_pairing", code), expiresAt, p.id, p.identity, kind);
    });
    const url = kind === "telegram" ? `https://t.me/${p.username}?start=${code}`
      : `https://discord.com/oauth2/authorize?${new URLSearchParams({client_id: p.identity, redirect_uri: p.redirectUri,
        response_type: "code", scope: "identify guilds.join", state: code, prompt: "consent"})}`;
    return { id, url, expiresAt };
  }

  private save(p: Provider, recipientId: string, now: number) {
    // Never connect a recipient after an administrator paused or replaced its bot while OAuth was in flight.
    const live = this.available(p.kind);
    if (live.identity !== p.identity || live.encryptedSecret !== p.encryptedSecret) throw new InputValidationError("The connection changed. Please connect again.");
    const scope = currentRequestScope(); const reference = newId("yoinkbot");
    const secret = { kind: p.kind, recipientId };
    const fingerprint = stableHash("managed_bot_binding", reference, p.id, p.identity, recipientId);
    const repo = new UserActionConnectorRepository(this.db, {[reference]: fingerprint});
    return this.db.transaction(() => {
      for (const old of repo.list().filter(c => c.kind === p.kind)) repo.remove(old.id);
      const connector = repo.save({ contractVersion: 1, kind: p.kind, name: `YoinkBot ${p.kind}`, endpointReference: reference,
        enabled: true, events: [...EVENTS] }, "", now);
      this.db.run(`INSERT INTO user_bot_credentials(connector_id, tenant_id, user_id, endpoint_reference,
        binding_fingerprint, encrypted_secret, provider_id, provider_identity) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      connector.id, scope.tenantId, scope.userId, reference, fingerprint,
      this.vault.encrypt(secret, `${scope.tenantId}:${scope.userId}:${reference}`), p.id, p.identity);
      return connector;
    });
  }

  private async pollTelegram(p: Provider, now: number) {
    const existing = this.polls.get(p.id);
    if (existing) return existing;
    const work = (async () => {
      const token = this.secret(p).token;
      // Process every pending handshake before advancing the shared bot cursor. Concurrent customers cannot consume each other's Start.
      for (let page = 0; page < 3; page++) {
        const current = this.available("telegram");
        if (current.identity !== p.identity) return;
        const updates = (await this.api(`https://api.telegram.org/bot${token}/getUpdates`, { method: "POST",
          headers: {"Content-Type": "application/json"}, body: JSON.stringify({offset: current.offset, timeout: 0, limit: 100, allowed_updates: ["message"]}) })).result;
        if (!Array.isArray(updates)) throw new InputValidationError("Telegram could not verify your connection.");
        this.db.transaction(() => {
          let offset = current.offset;
          for (const update of updates) {
            if (!Number.isSafeInteger(update?.update_id)) continue;
            offset = Math.max(offset, update.update_id + 1);
            const m = update.message;
            const code = /^\/start(?:@[A-Za-z0-9_]+)? ([A-Za-z0-9_-]{43})$/.exec(String(m?.text || ""))?.[1];
            if (!code || m.chat?.type !== "private" || !Number.isSafeInteger(m.chat.id) || m.chat.id <= 0
              || m.chat.id !== m.from?.id || m.from?.is_bot === true) continue;
            this.db.run(`UPDATE user_bot_pairings SET recipient_id=? WHERE tenant_id=? AND provider_id=?
              AND provider_identity=? AND code_hash=? AND expires_at>? AND recipient_id=''`,
            String(m.chat.id), currentRequestScope().tenantId, p.id, p.identity, stableHash("managed_bot_pairing", code), nowIso(now));
          }
          this.db.run("UPDATE bot_providers SET update_offset=MAX(update_offset, ?) WHERE id=? AND tenant_id=? AND bot_identity=?",
            offset, p.id, currentRequestScope().tenantId, p.identity);
        });
        if (updates.length < 100) return;
      }
    })();
    this.polls.set(p.id, work);
    try { await work; } finally { this.polls.delete(p.id); }
  }

  async finishTelegram(id: string, now = Date.now()) {
    const scope = currentRequestScope(); const p = this.available("telegram");
    const read = () => this.db.get<{recipientId: string}>(`SELECT recipient_id AS recipientId FROM user_bot_pairings
      WHERE id=? AND tenant_id=? AND user_id=? AND provider_id=? AND provider_identity=? AND expires_at>?`,
    id, scope.tenantId, scope.userId, p.id, p.identity, nowIso(now));
    if (!read()) throw new InputValidationError("This connection expired. Please connect again.");
    await this.pollTelegram(p, now);
    const row = read();
    if (!row) throw new InputValidationError("This connection expired. Please connect again.");
    if (!row.recipientId) return { pending: true };
    this.db.transaction(() => {
      const removed = this.db.run("DELETE FROM user_bot_pairings WHERE id=? AND tenant_id=? AND user_id=?", id, scope.tenantId, scope.userId);
      if (!Number(removed.changes)) throw new InputValidationError("This connection was already completed.");
      const connector = this.save(p, row.recipientId, now);
      // Commit the welcome with the connection, so a restart cannot silently lose
      // the reply. The existing delivery worker handles receipts and retries.
      new UserActionConnectorRepository(this.db).queueConnectionConfirmation(connector.id, now);
    });
    return { pending: false, items: this.customerStatus() };
  }

  async finishDiscord(code: string, state: string, now = Date.now()) {
    const scope = currentRequestScope(); const p = this.available("discord");
    if (!code || code.length > 300 || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new InputValidationError("Discord connection was cancelled or expired.");
    // Consume before network calls: an OAuth state is scoped to this authenticated customer and can only be used once.
    const removed = this.db.run(`DELETE FROM user_bot_pairings WHERE tenant_id=? AND user_id=? AND provider_id=?
      AND provider_identity=? AND kind='discord' AND code_hash=? AND expires_at>?`,
    scope.tenantId, scope.userId, p.id, p.identity, stableHash("managed_bot_pairing", state), nowIso(now));
    if (!Number(removed.changes)) throw new InputValidationError("Discord connection expired. Please connect again.");
    const secret = this.secret(p);
    const authorization = await this.api("https://discord.com/api/oauth2/token", { method: "POST",
      headers: {"Content-Type": "application/x-www-form-urlencoded"}, body: new URLSearchParams({
        client_id: p.identity, client_secret: secret.clientSecret!, grant_type: "authorization_code", code, redirect_uri: p.redirectUri }).toString() });
    if (typeof authorization.access_token !== "string") throw new InputValidationError("Discord did not authorize this connection.");
    const user = await this.api(`${DISCORD}/users/@me`, {headers: {Authorization: `Bearer ${authorization.access_token}`}});
    if (!SNOWFLAKE.test(user.id) || user.bot) throw new InputValidationError("Connect your personal Discord account.");
    await this.discord(secret.token, `/guilds/${p.guildId}/members/${user.id}`, "PUT", {access_token: authorization.access_token});
    const channel = await this.discord(secret.token, "/users/@me/channels", "POST", {recipient_id: user.id});
    if (!SNOWFLAKE.test(channel.id) || channel.type !== 1) throw new InputValidationError("Allow direct messages from YoinkBot in Discord, then reconnect.");
    this.save(p, channel.id, now);
    return this.customerStatus();
  }

  preference(kind: BotProviderKind, enabled: boolean) {
    const repo = new UserActionConnectorRepository(this.db);
    const own = repo.list().filter(c => c.kind === kind);
    if (!own.length) throw new InputValidationError("Connect your account first.");
    this.db.transaction(() => {
      for (const c of own) repo.setEnabled(c.id, enabled);
    });
    return this.customerStatus();
  }
  disconnect(kind: BotProviderKind) {
    const repo = new UserActionConnectorRepository(this.db);
    // Stop future messages even if a current send must finish before removal.
    for (const c of repo.list().filter(c => c.kind === kind)) repo.setEnabled(c.id, false);
    this.db.transaction(() => {
      for (const c of repo.list().filter(c => c.kind === kind)) repo.remove(c.id);
      this.db.run("DELETE FROM user_bot_pairings WHERE tenant_id=? AND user_id=? AND kind=?", currentRequestScope().tenantId, currentRequestScope().userId, kind);
    });
    return this.customerStatus();
  }
  test(kind: BotProviderKind) {
    const repo = new UserActionConnectorRepository(this.db);
    const own = repo.list().find(c => c.kind === kind && c.enabled && c.runtimeBound);
    if (!own) throw new InputValidationError("Connect your account and turn on alerts first.");
    return repo.queueTest(own.id);
  }

  credential(reference: string): ManagedBotCredential | null {
    const scope = currentRequestScope();
    const row = this.db.get<{kind: BotProviderKind; encryptedSecret: string}>(`SELECT p.kind, c.encrypted_secret AS encryptedSecret
      FROM user_bot_credentials c JOIN bot_providers p ON p.id=c.provider_id AND p.tenant_id=c.tenant_id
      WHERE c.endpoint_reference=? AND c.tenant_id=? AND c.user_id=? AND p.enabled=1 AND p.bot_identity=c.provider_identity`,
    reference, scope.tenantId, scope.userId);
    if (!row) return null;
    const recipient = this.vault.decrypt<{recipientId: string}>(row.encryptedSecret, `${scope.tenantId}:${scope.userId}:${reference}`);
    const token = this.secret(this.available(row.kind)).token;
    return row.kind === "discord" ? { kind: "discord", token, channelId: recipient.recipientId }
      : { kind: "telegram", token, chatId: recipient.recipientId };
  }
}
