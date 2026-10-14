import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { YoinkDatabase, LOCAL_TENANT_ID, LOCAL_USER_ID } from "../packages/database/src/database.js";
import { runWithRequestScope, type RequestScope } from "../packages/database/src/request-scope.js";
import { UserActionConnectorRepository } from "../packages/database/src/user-action-connector-repository.js";
import { UserBotConnections, UserBotTransport } from "../packages/engine/src/user-bot-connections.js";
import { UserActionConnectorDispatchService } from "../packages/engine/src/user-action-connector-dispatch.js";
import { loadUserActionWebhookRegistry } from "../packages/engine/src/user-action-webhook.js";

const NOW = Date.now();
const ORIGIN = "http://127.0.0.1:3000";
const TOKEN = `123456789:${"a".repeat(35)}`;
const BOT = "123456789012345678";
const GUILD = "223456789012345678";
const DISCORD_USER = "323456789012345678";
const CHANNEL = "423456789012345678";
const CLIENT_SECRET = "c".repeat(32);
const user = (userId = LOCAL_USER_ID): RequestScope => ({tenantId: LOCAL_TENANT_ID, userId, actorKind: "user", actorId: userId});

test("the admin-provider migration preserves encrypted v1.30.44 destinations and their queued messages", async () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-admin-bot-upgrade-"));
  const path = join(directory, "yoink.sqlite"); const key = Buffer.alloc(32, 8);
  try {
    const db = new YoinkDatabase(path);
    const webhookUrl = `https://discord.com/api/webhooks/${BOT}/${"a".repeat(60)}`;
    const legacy = new UserBotConnections(db, key, async () => Response.json({id: BOT, channel_id: CHANNEL, type: 1}));
    const c = await legacy.connectDiscord({webhookUrl, optedIn: true}, NOW);
    new UserActionConnectorRepository(db).queueTest(c.id, NOW);
    db.exec(`ALTER TABLE user_bot_credentials DROP COLUMN provider_id;
      ALTER TABLE user_bot_credentials DROP COLUMN provider_identity;
      ALTER TABLE user_bot_pairings DROP COLUMN provider_id;
      ALTER TABLE user_bot_pairings DROP COLUMN provider_identity;
      ALTER TABLE user_bot_pairings DROP COLUMN kind;
      ALTER TABLE user_bot_pairings DROP COLUMN recipient_id;
      DROP TABLE bot_providers; DELETE FROM schema_migrations WHERE version=83;`);
    db.close();
    const upgraded = new YoinkDatabase(path);
    try {
      assert.deepEqual(new UserBotConnections(upgraded, key).credential(c.endpointReference), {kind: "discord", webhookUrl});
      const repo = new UserActionConnectorRepository(upgraded);
      assert.equal(repo.list()[0]?.runtimeBound, true);
      assert.equal(repo.listDeliveries()[0]?.state, "pending");
      assert.deepEqual(upgraded.all("PRAGMA foreign_key_check"), []);
    } finally {upgraded.close();}
  } finally {rmSync(directory, {recursive: true, force: true});}
});
function secondUser(db: YoinkDatabase) {
  db.run("INSERT INTO users(id, tenant_id, display_name, created_at) VALUES(?, ?, 'Second shopper', ?)", "shopper_two", LOCAL_TENANT_ID, new Date(NOW).toISOString());
  return user("shopper_two");
}
function telegramFixture() {
  const db = new YoinkDatabase();
  let botId = 123456789;
  let updates: any[] = [];
  const offsets: number[] = [];
  const service = new UserBotConnections(db, Buffer.alloc(32, 3), async (url, init) => {
    const path = String(url);
    if (path.endsWith("getMe")) return Response.json({ok: true, result: {id: botId, is_bot: true, username: "YoinkTestBot"}});
    if (path.endsWith("getWebhookInfo")) return Response.json({ok: true, result: {url: ""}});
    assert.ok(path.endsWith("getUpdates"));
    const request = JSON.parse(String(init?.body)); offsets.push(request.offset);
    return Response.json({ok: true, result: updates.filter(update => update.update_id >= request.offset)});
  });
  const start = (pairing: {url: string}, id: number, updateId: number, type = "private") => ({update_id: updateId,
    message: {text: `/start ${new URL(pairing.url).searchParams.get("start")}`, chat: {type, id}, from: {id, is_bot: false}}});
  return {db, service, start, offsets, setUpdates: (items: any[]) => {updates = items;}, changeBot: () => {botId++;}};
}

test("business Telegram bot pairs concurrent customers privately without losing either Start", async () => {
  const f = telegramFixture(); const second = secondUser(f.db);
  try {
    const managed = f.service.managed;
    await managed.configure("telegram", {token: TOKEN}, ORIGIN, NOW);
    assert.throws(() => managed.begin("telegram", {}, ORIGIN, NOW), /Choose to receive/);
    assert.throws(() => managed.begin("telegram", {optedIn: true, chatId: "attacker"}, ORIGIN, NOW), /Choose to receive/);
    const firstPair = managed.begin("telegram", {optedIn: true}, ORIGIN, NOW);
    const secondPair = runWithRequestScope(second, () => managed.begin("telegram", {optedIn: true}, ORIGIN, NOW));
    await assert.rejects(runWithRequestScope(second, () => managed.finishTelegram(firstPair.id, NOW + 1)), /expired/);
    assert.equal(f.offsets.length, 0, "another customer cannot trigger a pairing lookup");
    f.setUpdates([f.start(firstPair, 101, 1, "group"), f.start(firstPair, 101, 2), f.start(secondPair, 202, 3)]);
    const [one, two] = await Promise.all([managed.finishTelegram(firstPair.id, NOW + 2),
      runWithRequestScope(second, () => managed.finishTelegram(secondPair.id, NOW + 2))]);
    assert.equal(one.pending, false); assert.equal(two.pending, false);
    const repo = new UserActionConnectorRepository(f.db);
    const firstConnector = repo.list()[0]!;
    const secondConnector = runWithRequestScope(second, () => repo.list()[0]!);
    assert.equal(f.service.credential(firstConnector.endpointReference)?.kind, "telegram");
    assert.deepEqual(f.service.credential(firstConnector.endpointReference), {kind: "telegram", token: TOKEN, chatId: "101"});
    assert.equal(f.service.credential(secondConnector.endpointReference), null);
    assert.deepEqual(runWithRequestScope(second, () => f.service.credential(secondConnector.endpointReference)), {kind: "telegram", token: TOKEN, chatId: "202"});
    assert.equal(f.offsets.length, 1, "one bot poll processes all current customer handshakes");
    assert.equal(f.db.get<{offset: number}>("SELECT update_offset AS offset FROM bot_providers")?.offset, 4);
    await assert.rejects(managed.finishTelegram(firstPair.id, NOW + 3), /expired/);
    const raw = JSON.stringify(f.db.all("SELECT * FROM bot_providers")) + JSON.stringify(f.db.all("SELECT * FROM user_bot_credentials"));
    assert.ok(!raw.includes(TOKEN)); assert.ok(!raw.includes('"chatId"'));
    const publicStatus = JSON.stringify(managed.customerStatus());
    for (const secret of [TOKEN, "encrypted", "endpoint", "providerId", "recipient", "guild"]) assert.ok(!publicStatus.includes(secret));
    managed.disconnect("telegram");
    assert.equal(repo.list().length, 0);
    assert.equal(runWithRequestScope(second, () => repo.list().length), 1);
  } finally {f.db.close();}
});

test("provider pause, opt-out and bot replacement stop deliveries; token rotation preserves identity", async () => {
  const f = telegramFixture();
  try {
    const m = f.service.managed;
    await m.configure("telegram", {token: TOKEN}, ORIGIN, NOW);
    const pair = m.begin("telegram", {optedIn: true}, ORIGIN, NOW);
    f.setUpdates([f.start(pair, 101, 1)]); await m.finishTelegram(pair.id, NOW + 1);
    const repo = new UserActionConnectorRepository(f.db); const c = repo.list()[0]!;
    repo.queueTest(c.id, NOW + 2);
    m.preference("telegram", false);
    assert.equal(repo.listDeliveries()[0]?.state, "cancelled");
    assert.equal(repo.leaseNext(NOW + 3), null);
    m.preference("telegram", true); repo.queueTest(c.id, NOW + 4);
    m.setProviderEnabled("telegram", false);
    assert.deepEqual(m.customerStatus().find(p => p.kind === "telegram"), {kind: "telegram", available: false,
      connected: true, enabled: true, needsReconnect: false, deliveryIssue: false});
    assert.equal(f.service.credential(c.endpointReference), null);
    assert.equal(repo.list()[0]?.runtimeBound, false);
    assert.equal(repo.leaseNext(NOW + 5), null);
    m.preference("telegram", false);
    m.setProviderEnabled("telegram", true);
    assert.equal(repo.list()[0]?.runtimeBound, true);
    assert.equal(repo.list()[0]?.enabled, false, "an admin enabling the bot never opts a customer back in");
    const rotated = TOKEN.replace(/a/g, "b");
    await m.configure("telegram", {token: rotated}, ORIGIN, NOW + 6);
    assert.deepEqual(f.service.credential(c.endpointReference), {kind: "telegram", token: rotated, chatId: "101"});
    f.changeBot(); await m.configure("telegram", {token: TOKEN}, ORIGIN, NOW + 7);
    assert.equal(repo.list()[0]?.runtimeBound, false);
    assert.equal(f.service.credential(c.endpointReference), null);
    assert.equal(m.customerStatus().find(p => p.kind === "telegram")?.needsReconnect, true);
  } finally {f.db.close();}
});

test("expired Telegram handshakes cannot connect and grouped/bot messages cannot bind a customer", async () => {
  const f = telegramFixture();
  try {
    const m = f.service.managed; await m.configure("telegram", {token: TOKEN}, ORIGIN, NOW);
    const pair = m.begin("telegram", {optedIn: true}, ORIGIN, NOW);
    const bot = f.start(pair, 101, 2); bot.message.from.is_bot = true;
    f.setUpdates([f.start(pair, 101, 1, "supergroup"), bot]);
    assert.deepEqual(await m.finishTelegram(pair.id, NOW + 1), {pending: true});
    await assert.rejects(m.finishTelegram(pair.id, NOW + 600001), /expired/);
    assert.equal(new UserActionConnectorRepository(f.db).list().length, 0);
  } finally {f.db.close();}
});

test("Discord authorization is scoped, expiring and single-use; delivery goes to a private DM", async () => {
  const db = new YoinkDatabase(); const second = secondUser(db); const requests: {url: string; init?: RequestInit}[] = [];
  try {
    const connections = new UserBotConnections(db, Buffer.alloc(32, 4), async (url, init) => {
      const path = String(url); requests.push({url: path, ...(init ? {init} : {})});
      if (path.endsWith("/oauth2/token")) {assert.equal(new URLSearchParams(String(init?.body)).get("client_secret"), CLIENT_SECRET); return Response.json({access_token: "private_access_token"});}
      if (path.endsWith("/users/@me")) return Response.json(new Headers(init?.headers).get("Authorization")?.startsWith("Bearer") ? {id: DISCORD_USER} : {id: BOT, username: "YoinkBot", bot: true});
      if (path.endsWith("/oauth2/applications/@me")) return Response.json({id: BOT});
      if (path.endsWith(`/members/${BOT}`)) return Response.json({user: {id: BOT}});
      if (path.endsWith(`/members/${DISCORD_USER}`)) {assert.equal(init?.method, "PUT"); return new Response(null, {status: 204});}
      if (path.endsWith("/users/@me/channels")) {assert.deepEqual(JSON.parse(String(init?.body)), {recipient_id: DISCORD_USER}); return Response.json({id: CHANNEL, type: 1});}
      throw new Error("unexpected request");
    });
    const m = connections.managed;
    await m.configure("discord", {token: "business_bot_token", clientSecret: CLIENT_SECRET, guildId: GUILD}, ORIGIN, NOW);
    assert.throws(() => m.begin("discord", {optedIn: true}, "http://127.0.0.1:4000", NOW), /address/);
    const pair = m.begin("discord", {optedIn: true}, ORIGIN, NOW);
    const state = new URL(pair.url).searchParams.get("state")!;
    assert.equal(new URL(pair.url).searchParams.get("scope"), "identify guilds.join");
    const before = requests.length;
    await assert.rejects(runWithRequestScope(second, () => m.finishDiscord("code", state, NOW + 1)), /expired/);
    assert.equal(requests.length, before);
    await m.finishDiscord("code", state, NOW + 2);
    await assert.rejects(m.finishDiscord("code", state, NOW + 3), /expired/);
    const repo = new UserActionConnectorRepository(db); const c = repo.list()[0]!;
    assert.deepEqual(connections.credential(c.endpointReference), {kind: "discord", token: "business_bot_token", channelId: CHANNEL});
    const transport = new UserBotTransport(connections, {deliver: async () => {throw new Error("unexpected fallback");}}, async (url, init) => {
      assert.equal(String(url), `https://discord.com/api/v10/channels/${CHANNEL}/messages`);
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bot business_bot_token");
      const body = JSON.parse(String(init?.body)); assert.deepEqual(body.allowed_mentions, {parse: []});
      assert.match(body.content, /same store account/); return Response.json({id: "message_receipt"});
    });
    repo.queueTest(c.id, NOW + 4);
    assert.equal((await new UserActionConnectorDispatchService(db, loadUserActionWebhookRegistry({}), transport).execute(NOW + 5)).userConnectorDeliveriesSucceeded, 1);
    const expired = m.begin("discord", {optedIn: true}, ORIGIN, NOW + 6);
    await assert.rejects(m.finishDiscord("code", new URL(expired.url).searchParams.get("state")!, NOW + 600007), /expired/);
    assert.ok(!JSON.stringify(m.adminStatus()).includes(CLIENT_SECRET));
    assert.ok(!JSON.stringify(db.all("SELECT * FROM user_bot_pairings")).includes("private_access_token"));
  } finally {db.close();}
});
