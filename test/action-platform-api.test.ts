import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { WATCH_QUEUE_MODE_CONFIRMATION } from "../packages/contracts/src/action-platform.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { LOCAL_REQUEST_SCOPE } from "../packages/database/src/request-scope.js";

function seedDropWindowListing(db: YoinkDatabase): void {
  db.exec(`
    INSERT INTO product_families(id, title, brand, created_at, updated_at)
      VALUES ('family_drop_window_api', 'Drop window product', 'Yoink',
        '2026-08-30T17:00:00.000Z', '2026-08-30T17:00:00.000Z');
    INSERT INTO variants(id, family_id, title, attributes_json, created_at, updated_at)
      VALUES ('variant_drop_window_api', 'family_drop_window_api', 'Drop window API product', '{}',
        '2026-08-30T17:00:00.000Z', '2026-08-30T17:00:00.000Z');
    INSERT INTO listings(
      id, variant_id, retailer_id, retailer_sku, canonical_url,
      status, execution_supported, currency, created_at, updated_at
    ) VALUES (
      'listing_drop_window_api', 'variant_drop_window_api', 'target', '94972381',
      'https://www.target.com/p/-/A-94972381', 'in_stock', 1, 'USD',
      '2026-08-30T17:00:00.000Z', '2026-08-30T17:00:00.000Z'
    );
  `);
}

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

    const actionHandoff = await fetch(`${baseUrl}/api/v1/user/action-handoff`);
    assert.equal(actionHandoff.status, 200);
    assert.equal(actionHandoff.headers.get("x-yoink-api-surface"), "user");
    const actionHandoffBody = await actionHandoff.json() as {
      actionHandoff: { contractVersion: number; generatedAt: string; counts: Record<string, number>; primary: unknown };
    };
    assert.match(actionHandoffBody.actionHandoff.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual({ ...actionHandoffBody.actionHandoff, generatedAt: "<iso>" }, {
      contractVersion: 1,
      generatedAt: "<iso>",
      counts: { queued: 0, checking: 0, readyToCheckout: 0, needsYou: 0 },
      primary: null
    });

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

test("admin drop-window detail, edit, and cancel routes preserve the bounded action boundary", async () => {
  const db = new YoinkDatabase();
  seedDropWindowListing(db);
  db.exec(`
    INSERT INTO users(id, tenant_id, display_name, created_at, status)
      VALUES ('admin_drop_window_second', 'tenant_local', 'Second drop admin',
        '2026-08-30T17:00:00.000Z', 'active');
    INSERT INTO authorization_memberships(
      tenant_id, user_id, role_id, status, granted_by_actor_id, created_at, updated_at
    ) VALUES (
      'tenant_local', 'admin_drop_window_second', 'tenant_admin', 'active', 'user_local',
      '2026-08-30T17:00:00.000Z', '2026-08-30T17:00:00.000Z'
    );
  `);
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "drop-window-admin-api-test",
    requestScopeResolver(request) {
      if (request.headers["x-test-principal"] === "second-admin") {
        return {
          tenantId: "tenant_local",
          userId: "admin_drop_window_second",
          actorKind: "user" as const,
          actorId: "admin_drop_window_second"
        };
      }
      return LOCAL_REQUEST_SCOPE;
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const startsAt = new Date(Date.now() + 60 * 60_000).toISOString();
  const closesAt = new Date(Date.now() + 3 * 60 * 60_000).toISOString();
  const secondAdminHeaders = { "X-Test-Principal": "second-admin" };
  try {
    const create = await fetch(`${baseUrl}/api/v1/admin/drop-windows`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        contractVersion: 1,
        kind: "drop_window",
        retailerId: "target",
        title: "API-managed Target window",
        startsAt,
        closesAt,
        spreadSeconds: 0,
        confidenceBps: 8000,
        timezone: "America/Los_Angeles",
        products: [{ listingId: "listing_drop_window_api" }]
      })
    });
    assert.equal(create.status, 201);
    const created = await create.json() as { window: { id: string } };

    const shopperCalls = await fetch(`${baseUrl}/api/v1/user/calls`);
    assert.equal(shopperCalls.status, 200);
    const scheduledCall = (await shopperCalls.json() as {
      items: Array<{ kind: string; timezone?: string; startsAt?: string; closesAt?: string }>;
    }).items.find((item) => item.kind === "drop_window");
    assert.equal(scheduledCall?.timezone, "America/Los_Angeles");
    assert.equal(scheduledCall?.startsAt, startsAt);
    assert.equal(scheduledCall?.closesAt, closesAt);

    const list = await fetch(`${baseUrl}/api/v1/admin/drop-windows`, { headers: secondAdminHeaders });
    assert.equal(list.status, 200);
    assert.deepEqual((await list.json() as { items: Array<{ id: string }> }).items.map((item) => item.id), [created.window.id]);

    const detail = await fetch(`${baseUrl}/api/v1/admin/drop-windows/${created.window.id}`, {
      headers: secondAdminHeaders
    });
    assert.equal(detail.status, 200);
    const detailWindow = (await detail.json() as {
      window: { items: unknown[]; optInCount: number; optedInUsers: Array<{ userId: string; displayName: string }> };
    }).window;
    assert.equal(detailWindow.items.length, 1);
    assert.equal(detailWindow.optInCount, 0);
    assert.deepEqual(detailWindow.optedInUsers, [], "the detail names opted-in shoppers without a new table");

    const patch = await fetch(`${baseUrl}/api/v1/admin/drop-windows/${created.window.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: baseUrl, ...secondAdminHeaders },
      body: JSON.stringify({ title: "Edited Target window", confidenceBps: 10_000 })
    });
    assert.equal(patch.status, 200);
    assert.equal((await patch.json() as { window: { title: string } }).window.title, "Edited Target window");

    const cancel = await fetch(`${baseUrl}/api/v1/admin/drop-windows/${created.window.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl, ...secondAdminHeaders },
      body: JSON.stringify({ reasonCode: "incorrect_schedule" })
    });
    assert.equal(cancel.status, 200);
    assert.equal((await cancel.json() as { window: { status: string } }).window.status, "cancelled");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});
