import { join } from "node:path";
import { createYoinkServer } from "../../apps/api/src/app.js";
import { YoinkDatabase } from "../../packages/database/src/database.js";
const db = new YoinkDatabase();
const server = createYoinkServer({db, webRoot: join(process.cwd(), "apps/web"), version: "yoinkbot-browser-test"});
server.listen(33993, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => {db.close(); process.exit(0);}));
