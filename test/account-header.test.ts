import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

test("user and admin responses expose the signed-in actor and both headers use one account menu", async () => {
  const db = new YoinkDatabase();
  const webRoot = join(process.cwd(), "apps", "web");
  const server = createYoinkServer({ db, webRoot, version: "account-header-test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const [overviewResponse, snapshotResponse] = await Promise.all([
      fetch(`${baseUrl}/api/v1/user/overview`),
      fetch(`${baseUrl}/api/v1/admin/snapshot?view=overview`)
    ]);
    assert.equal(overviewResponse.status, 200);
    assert.equal(snapshotResponse.status, 200);
    const overview = await overviewResponse.json() as { actor: Record<string, unknown> };
    const snapshot = await snapshotResponse.json() as { actor: Record<string, unknown> };
    const expected = {
      displayName: "Local user",
      userId: "user_local",
      tenantName: "Local",
      roleLabels: ["Local administrator"],
      assuranceLevel: "local_trusted",
      assuranceFresh: true,
      assuranceExpiresAt: "local_session",
      sessionKind: "local",
      signOutUrl: ""
    };
    assert.deepEqual(overview.actor, expected);
    assert.deepEqual(snapshot.actor, expected);

    const adminHtml = readFileSync(join(webRoot, "index.html"), "utf8");
    const userHtml = readFileSync(join(webRoot, "user.html"), "utf8");
    assert.match(adminHtml, /<details class="account-menu" id="adminAccountMenu">/);
    assert.match(adminHtml, /<a href="\/">Shopping<\/a>/);
    assert.match(adminHtml, /id="adminAccountSession"/);
    assert.match(userHtml, /<details class="account-menu" id="userAccountMenu">/);
    assert.doesNotMatch(userHtml, /href=["']\/admin(?:["'#?\/])|id="adminLink"/);
    assert.match(userHtml, /id="userAccountSession"/);
    assert.match(adminHtml, /href="\/docs"/);
    assert.match(userHtml, /href="\/privacy"/);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
