import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
// @ts-expect-error The standalone Node CLI is intentionally usable without the Yoink TypeScript build.
import { createAnalysis, analyzePath, formatAnalysis } from "../apps/windows-capture/analyze.mjs";

const at = "2026-09-06T20:00:00Z";
function notification(overrides = {}, envelope = {}) {
  return JSON.stringify({ schemaVersion: 1, eventType: "notification", sessionId: "one", capturedAt: at,
    details: { source: "windows_notification", observation: "added", notificationId: 1,
      appId: "com.squirrel.Discord.Discord", appName: "Discord", createdAt: at,
      bindings: [{ template: "ToastGeneric", language: "", textElements: ["Private sender", "Restock $25 https://example.com/product?secret=value"] }],
      ...overrides }, ...envelope });
}

test("notification analysis deduplicates baselines across sessions while preserving updates and reused IDs", () => {
  const analysis = createAnalysis();
  analysis.addLine(notification());
  analysis.addLine(notification({ observation: "existing" }, { sessionId: "two" }));
  analysis.addLine(notification({ observation: "updated", bindings: [{ template: "ToastGeneric", language: "", textElements: ["Sold out…"] }] }));
  analysis.addLine(notification({ createdAt: "2026-09-06T20:01:00Z" }));
  const summary = analysis.finish();
  assert.equal(summary.notificationRecords, 4);
  assert.equal(summary.windowsNotifications, 2);
  assert.equal(summary.uniqueSnapshots, 3);
  assert.equal(summary.repeatedSnapshots, 1);
  assert.equal(summary.features.withUrls, 2);
  assert.equal(summary.features.possibleTruncation, 1);
  assert.equal(summary.features.withAvailabilityWords, 3);
  assert.doesNotMatch(formatAnalysis(summary), /Private sender|secret=value|\/product/);
});

test("empty, malformed, and future records are visible rather than silently treated as successful samples", () => {
  const analysis = createAnalysis();
  analysis.addLine(notification({ bindings: [] }));
  analysis.addLine('{"schemaVersion":1');
  analysis.addLine(notification({ bindings: [{}] }));
  analysis.addLine(notification({}, { schemaVersion: 2 }));
  analysis.addLine(notification({}, { capturedAt: "invalid" }));
  analysis.addLine(notification({}, { details: null }));
  const summary = analysis.finish();
  assert.equal(summary.features.withoutText, 1);
  assert.equal(summary.notificationRecords, 1);
  assert.equal(summary.malformedLines, 4);
  assert.equal(summary.unsupportedRecords, 1);
});

test("capture health and session gaps remain visible without exposing message content", () => {
  const analysis = createAnalysis();
  for (const [eventType, capturedAt] of [
    ["session_started", at], ["heartbeat", "2026-09-06T20:01:00Z"],
    ["access_lost", "2026-09-06T20:04:00Z"], ["capture_error", "2026-09-06T20:04:01Z"],
    ["session_stopped", "2026-09-06T20:04:02Z"]
  ]) analysis.addLine(JSON.stringify({ schemaVersion: 1, eventType, capturedAt, sessionId: "one", details: {} }));
  const summary = analysis.finish();
  assert.equal(summary.sessionsWithoutStop, 0);
  assert.equal(summary.longestObservedGapSeconds, 180);
  assert.equal(summary.accessLosses, 1);
  assert.equal(summary.captureErrors, 1);
});

test("daily files are analyzed together; an interrupted trailing append does not hide valid records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "yoink-notification-analysis-"));
  try {
    await writeFile(join(directory, "capture-2026-09-06.jsonl"), `${notification()}\n`);
    await writeFile(join(directory, "capture-2026-09-07.jsonl"), `${notification({ notificationId: 2 })}\n{"partial":`);
    await writeFile(join(directory, "unrelated.jsonl"), "private unrelated data");
    const summary = await analyzePath(directory);
    assert.equal(summary.files, 2);
    assert.equal(summary.windowsNotifications, 2);
    assert.equal(summary.malformedLines, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
