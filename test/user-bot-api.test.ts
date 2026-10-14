import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { YoinkDatabase, LOCAL_TENANT_ID, LOCAL_USER_ID } from "../packages/database/src/database.js";
import { LOCAL_REQUEST_SCOPE } from "../packages/database/src/request-scope.js";
import { UserBotConnections } from "../packages/engine/src/user-bot-connections.js";

const TOKEN = `123456789:${"a".repeat(35)}`;
test("only admins configure business bots; customers only connect, opt in and test their own destination", async () => {
  const db = new YoinkDatabase(); let wakes = 0; let providerCalls = 0; let start = "";
  const connections = new UserBotConnections(db, Buffer.alloc(32, 5), async url => {
    providerCalls++;
    const path = String(url);
    return Response.json({ok: true, result: path.endsWith("getMe") ? {id: 123456789, is_bot: true, username: "YoinkFixtureBot"}
      : path.endsWith("getWebhookInfo") ? {url: ""} : [{update_id: 1, message: {text: `/start ${start}`, chat: {id: 101, type: "private"}, from: {id: 101}}}]});
  });
  const server = createYoinkServer({db, webRoot: join(process.cwd(), "apps/web"), version: "bot-api-test",
    botConnections: connections, userActionConnectorWake: () => {wakes++;},
    requestScopeResolver: req => req.headers["x-test-principal"] === "admin" ? LOCAL_REQUEST_SCOPE
      : {tenantId: LOCAL_TENANT_ID, userId: LOCAL_USER_ID, actorKind: "user", actorId: LOCAL_USER_ID}});
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (path: string, method = "GET", body: unknown = {}, admin = false, origin = base) => fetch(`${base}${path}`, {
    method, headers: {"Content-Type": "application/json", Origin: origin, "X-Test-Principal": admin ? "admin" : "customer"},
    ...(method === "GET" ? {} : {body: JSON.stringify(body)})});
  try {
    const provider = "/api/v1/admin/notification-providers/telegram";
    assert.equal((await request(provider, "PUT", {token: TOKEN})).status, 403);
    assert.equal((await request("/api/v1/admin/notification-providers")).status, 403);
    assert.equal((await request(provider, "PATCH", {enabled: false})).status, 403);
    assert.equal((await request(provider, "PUT", {token: TOKEN}, true, "https://untrusted.example")).status, 403);
    for (const [path, method] of [
      ["/api/v1/user/connectors/yoinkbot/telegram", "POST"], ["/api/v1/user/connectors", "POST"],
      ["/api/v1/user/connectors", "GET"], ["/api/v1/user/settings", "PATCH"],
      ["/api/v1/user/settings/restock-retry", "PATCH"], ["/api/v1/user/discord/settings", "PATCH"],
      ["/api/v1/user/stores/amazon/turn-on", "POST"], ["/api/v1/user/stores/amazon/turn-off", "POST"]
    ]) {
      assert.equal((await request(path!, method!, {token: TOKEN}, true)).status, 404, `retired customer route ${path}`);
    }
    for (const path of ["/api/v1/settings", "/api/v1/settings/restock-retry", "/api/v1/admin/settings", "/api/v1/admin/discord/settings"]) {
      assert.equal((await request(path, "PATCH", {enabled: true})).status, 403, `customer cannot call admin configuration ${path}`);
    }
    assert.equal(providerCalls, 0);
    const configured = await request(provider, "PUT", {token: TOKEN}, true);
    assert.equal(configured.status, 200, await configured.clone().text());
    assert.ok(!(await configured.text()).includes(TOKEN));
    const connect = "/api/v1/user/notifications/telegram/connect";
    assert.equal((await request(connect, "POST", {})).status, 400);
    assert.equal((await request(connect, "POST", {optedIn: true, token: TOKEN})).status, 400);
    const response = await request(connect, "POST", {optedIn: true}); assert.equal(response.status, 201);
    const {pairing} = await response.json() as {pairing: {id: string; url: string}};
    start = new URL(pairing.url).searchParams.get("start")!;
    assert.equal((await request("/api/v1/user/notifications/telegram/verify", "POST", {id: pairing.id})).status, 200);
    const status = await (await request("/api/v1/user/notifications")).json() as any;
    assert.deepEqual(status.items.find((item: any) => item.kind === "telegram"), {
      kind: "telegram", available: true, connected: true, enabled: true, needsReconnect: false, deliveryIssue: false});
    assert.equal((await request("/api/v1/user/notifications/telegram", "PATCH", {enabled: true, endpointReference: "attacker"})).status, 400);
    assert.equal((await request("/api/v1/user/notifications/telegram/test", "POST")).status, 202);
    assert.equal(wakes, 1);
    assert.equal((await request("/api/v1/user/notifications/telegram", "PATCH", {enabled: false})).status, 200);
    assert.equal((await request("/api/v1/user/notifications/telegram/test", "POST")).status, 400);
    const overview = await (await request("/api/v1/user/overview")).json() as any;
    assert.equal(overview.settings.restockRetry, undefined);
    assert.equal(overview.settings.affiliateMode, undefined);
    const platform = await (await request("/api/v1/user/action-platform")).json() as any;
    assert.equal(platform.connectors, undefined); assert.equal(platform.connectorDeliveries, undefined);
    const discord = await (await request("/api/v1/user/discord")).json() as any;
    assert.equal(discord.settings, undefined); assert.equal(discord.reader, undefined); assert.equal(discord.channels, undefined);
    const exported = await (await request("/api/v1/user/privacy/export")).text();
    assert.ok(!exported.includes(TOKEN)); assert.ok(!exported.includes("encrypted_secret"));
    const customerHtml = await (await request("/")).text();
    assert.ok(!customerHtml.includes('href="/admin"')); assert.ok(!customerHtml.includes('name="secret"'));
    assert.equal((await request("/admin")).status, 403);
    assert.equal((await request("/admin", "GET", {}, true)).status, 200);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); }
});
