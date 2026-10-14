import { join } from "node:path";
import { createYoinkServer } from "../../apps/api/src/app.js";
import { YoinkDatabase, LOCAL_TENANT_ID, LOCAL_USER_ID } from "../../packages/database/src/database.js";
import { LOCAL_REQUEST_SCOPE } from "../../packages/database/src/request-scope.js";
import { UserBotConnections } from "../../packages/engine/src/user-bot-connections.js";
const db = new YoinkDatabase();
let telegramStart = "";
const connections = new UserBotConnections(db, Buffer.alloc(32, 7), async url => {
  const path = String(url);
  return Response.json({ok: true, result: path.endsWith("getMe") ? {id: 123456789, is_bot: true, username: "YoinkFixtureBot"}
    : path.endsWith("getWebhookInfo") ? {url: ""} : telegramStart ? [{update_id: 1,
      message: {text: `/start ${telegramStart}`, chat: {type: "private", id: 101}, from: {id: 101}}}] : []});
});
await connections.managed.configure("telegram", {token: `123456789:${"a".repeat(35)}`}, "http://127.0.0.1:33993");
const server = createYoinkServer({db, webRoot: join(process.cwd(), "apps/web"), version: "yoinkbot-browser-test", botConnections: connections,
  requestScopeResolver(request) {
    // This test-only header simulates pressing Start in Telegram; no live provider requests are sent.
    if (request.headers["x-test-telegram-start"]) telegramStart = String(request.headers["x-test-telegram-start"]);
    return request.headers["x-test-principal"] === "admin" ? LOCAL_REQUEST_SCOPE
      : {tenantId: LOCAL_TENANT_ID, userId: LOCAL_USER_ID, actorKind: "user", actorId: LOCAL_USER_ID};
  }});
server.listen(33993, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => {db.close(); process.exit(0);}));
