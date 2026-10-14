import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { UserBotConnections } from "../packages/engine/src/user-bot-connections.js";

const WEBHOOK = `https://discord.com/api/webhooks/123456789012345678/${"b".repeat(60)}`;
test("YoinkBot setup API enforces opt-in and same-origin, returns no secrets, and wakes delivery immediately", async () => {
  const db = new YoinkDatabase();
  let wakes = 0;
  let providerCalls = 0;
  const connections = new UserBotConnections(db, Buffer.alloc(32, 5), async () => {
    providerCalls++;
    return Response.json({id: "1", channel_id: "2", type: 1});
  });
  const server = createYoinkServer({db, webRoot: join(process.cwd(), "apps/web"), version: "bot-api-test",
    botConnections: connections, userActionConnectorWake: () => {wakes++;}});
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, origin = base) => fetch(`${base}${path}`, {method: "POST",
    headers: {"Content-Type": "application/json", Origin: origin}, body: JSON.stringify(body)});
  try {
    const path = "/api/v1/user/connectors/yoinkbot/discord";
    assert.equal((await post(path, {webhookUrl: WEBHOOK})).status, 400);
    assert.equal((await post(path, {webhookUrl: WEBHOOK, optedIn: true}, "https://untrusted.example")).status, 403);
    assert.equal(providerCalls, 0);
    const response = await post(path, {webhookUrl: WEBHOOK, optedIn: true});
    assert.equal(response.status, 201);
    const body = await response.json() as {connector: {id: string; runtimeBound: boolean}};
    assert.equal(body.connector.runtimeBound, true);
    assert.ok(!JSON.stringify(body).includes(WEBHOOK));
    assert.equal((await post(`/api/v1/user/connectors/${body.connector.id}/test`, {})).status, 202);
    assert.equal(wakes, 1);
    const listed = await (await fetch(`${base}/api/v1/user/connectors`)).text();
    assert.ok(!listed.includes(WEBHOOK));
    const exported = await (await fetch(`${base}/api/v1/user/privacy/export`)).text();
    assert.ok(!exported.includes(WEBHOOK));
    assert.ok(!exported.includes("encrypted_secret"));
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve())); db.close();
  }
});
