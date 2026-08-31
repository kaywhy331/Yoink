import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("drop-window and watch-queue controls expose supersession, mode, countdown, and per-item readiness", () => {
  const root = process.cwd();
  const adminHtml = readFileSync(join(root, "apps", "web", "index.html"), "utf8");
  const adminScript = readFileSync(join(root, "apps", "web", "app.js"), "utf8");
  const userHtml = readFileSync(join(root, "apps", "web", "user.html"), "utf8");
  const userScript = readFileSync(join(root, "apps", "web", "user.js"), "utf8");

  assert.match(adminHtml, /id="dropWindowSupersedes"/);
  assert.match(adminScript, /supersedesId: values\.supersedesId/);
  assert.match(adminScript, /\["scheduled", "active"\]\.includes\(window\.status\)/);
  assert.match(adminScript, /data-use-restock-pattern/);
  assert.match(adminScript, /function useRestockPatternForWindow/);
  assert.match(adminScript, /form\.elements\.confidencePercent\.value/);

  assert.match(userHtml, /id="watchQueueMode"/);
  assert.match(userHtml, /Auto-watch armed plans/);
  assert.match(userScript, /\/api\/v1\/user\/watch-queue\/settings/);
  assert.match(userScript, /SET_WATCH_QUEUE_MODE/);
  assert.match(userScript, /function watchWindowSummary/);
  assert.match(userScript, /function watchReadinessSummary/);
  assert.match(userScript, /Auto-enrolled from armed plan/);
  assert.match(userHtml, /id="analyticsLatency"/);
  assert.match(userScript, /Daily cap headroom/);
  assert.match(userScript, /Monthly cap headroom/);
  assert.match(userScript, /leaseToCartReadyMs: "Chrome → cart ready"/);
});
