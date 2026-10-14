import { join } from "node:path";
import { createYoinkServer } from "../../apps/api/src/app.js";
import { YoinkDatabase, LOCAL_TENANT_ID, LOCAL_USER_ID } from "../../packages/database/src/database.js";
import { LOCAL_REQUEST_SCOPE } from "../../packages/database/src/request-scope.js";
import { UserBotConnections, UserBotTransport } from "../../packages/engine/src/user-bot-connections.js";
import { UserActionConnectorDispatchService } from "../../packages/engine/src/user-action-connector-dispatch.js";
import { UserBotDispatchRuntime } from "../../packages/engine/src/user-bot-dispatch-runtime.js";
import { loadUserActionWebhookRegistry } from "../../packages/engine/src/user-action-webhook.js";
const db = new YoinkDatabase();
let telegramStart = "";
let blocked = false;
let receipt = 0;
const connections = new UserBotConnections(db, Buffer.alloc(32, 7), async url => {
  const path = String(url);
  return Response.json({ok: true, result: path.endsWith("getMe") ? {id: 123456789, is_bot: true, username: "YoinkFixtureBot"}
    : path.endsWith("getWebhookInfo") ? {url: ""} : telegramStart ? [{update_id: 1,
      message: {text: `/start ${telegramStart}`, chat: {type: "private", id: 101}, from: {id: 101}}}] : []});
});
await connections.managed.configure("telegram", {token: `123456789:${"a".repeat(35)}`}, "http://127.0.0.1:33993");
const transport = new UserBotTransport(connections, {deliver: async () => {throw new Error("Unexpected provider");}}, async () =>
  blocked ? Response.json({ok: false}, {status: 403}) : Response.json({ok: true, result: {message_id: ++receipt}}));
const runtime = new UserBotDispatchRuntime(db, new UserActionConnectorDispatchService(db, loadUserActionWebhookRegistry({}), transport));
const server = createYoinkServer({db, webRoot: join(process.cwd(), "apps/web"), version: "yoinkbot-browser-test", botConnections: connections,
  userActionConnectorWake: () => runtime.wake(),
  requestScopeResolver(request) {
    // This test-only header simulates pressing Start in Telegram; no live provider requests are sent.
    if (request.headers["x-test-telegram-start"]) telegramStart = String(request.headers["x-test-telegram-start"]);
    if (request.headers["x-test-telegram-delivery"]) blocked = request.headers["x-test-telegram-delivery"] === "blocked";
    return request.headers["x-test-principal"] === "admin" ? LOCAL_REQUEST_SCOPE
      : {tenantId: LOCAL_TENANT_ID, userId: LOCAL_USER_ID, actorKind: "user", actorId: LOCAL_USER_ID};
  }});
runtime.start();
server.listen(33993, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(async () => {await runtime.stop(); db.close(); process.exit(0);}));
