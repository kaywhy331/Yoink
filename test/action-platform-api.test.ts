import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { WATCH_QUEUE_MODE_CONFIRMATION } from "../packages/contracts/src/action-platform.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

test("watch-queue mode requires an explicit user confirmation and persists through the user API", async () => {
  const db = new YoinkDatabase();
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "action-platform-api-test"
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const patchMode = (body: Record<string, unknown>) => fetch(`${baseUrl}/api/v1/user/watch-queue/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify(body)
  });

  try {
    const initial = await fetch(`${baseUrl}/api/v1/user/action-platform`);
    assert.equal(initial.status, 200);
    assert.equal(initial.headers.get("x-yoink-api-surface"), "user");
    assert.equal((await initial.json() as { watchQueueMode: string }).watchQueueMode, "manual");

    const unconfirmed = await patchMode({ mode: "auto_armed" });
    assert.equal(unconfirmed.status, 400);
    const unconfirmedProblem = await unconfirmed.json() as { error: string; message: string };
    assert.equal(unconfirmedProblem.error, "request_rejected");
    assert.match(unconfirmedProblem.message, /confirmation/i);

    const invalid = await patchMode({
      mode: "automatic",
      confirmation: WATCH_QUEUE_MODE_CONFIRMATION
    });
    assert.equal(invalid.status, 400);

    const enabled = await patchMode({
      mode: "auto_armed",
      confirmation: WATCH_QUEUE_MODE_CONFIRMATION
    });
    assert.equal(enabled.status, 200);
    assert.equal(enabled.headers.get("x-yoink-api-surface"), "user");
    assert.deepEqual((await enabled.json() as { watchQueue: Record<string, unknown> }).watchQueue, {
      mode: "auto_armed",
      previousMode: "manual",
      newlyEnrolledCount: 0
    });

    const queue = await fetch(`${baseUrl}/api/v1/user/watch-queue`);
    assert.equal(queue.status, 200);
    assert.deepEqual(await queue.json(), { items: [], mode: "auto_armed" });
    assert.equal(db.get<{ mode: string }>(
      "SELECT watch_queue_mode AS mode FROM app_settings WHERE user_id = 'user_local'"
    )?.mode, "auto_armed");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});
