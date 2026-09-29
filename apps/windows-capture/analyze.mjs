import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const eventTypes = new Set(["session_started", "session_stopped", "heartbeat", "capture_error", "access_lost", "notification"]);

export function createAnalysis() {
  const summary = {
    schemaVersion: 1, records: 0, malformedLines: 0, unsupportedRecords: 0,
    firstCapturedAt: null, lastCapturedAt: null, sessions: 0, sessionsWithoutStop: 0,
    captureErrors: 0, accessLosses: 0, longestObservedGapSeconds: 0,
    notificationRecords: 0, windowsNotifications: 0, uniqueSnapshots: 0, repeatedSnapshots: 0,
    observations: { existing: 0, added: 0, updated: 0 },
    features: { withUrls: 0, withPriceLikeText: 0, withAvailabilityWords: 0, withoutText: 0, possibleTruncation: 0 },
    textElementCounts: {}, bindingTemplates: {}, urlHosts: {}
  };
  const sessions = new Map();
  const identities = new Set();
  const snapshots = new Set();
  const increment = (record, key) => Object.defineProperty(record, key, {
    value: (Object.hasOwn(record, key) ? record[key] : 0) + 1, enumerable: true, configurable: true, writable: true
  });

  function addLine(line) {
    if (!line.trim()) return;
    let record;
    try { record = JSON.parse(line.replace(/^\uFEFF/, "")); }
    catch { summary.malformedLines++; return; }
    if (!record || record.schemaVersion !== 1 || !eventTypes.has(record.eventType)) {
      summary.unsupportedRecords++;
      return;
    }
    const { eventType, sessionId, capturedAt, details } = record;
    if (typeof sessionId !== "string" || !sessionId || typeof capturedAt !== "string" ||
        !Number.isFinite(Date.parse(capturedAt)) || !details || typeof details !== "object" || Array.isArray(details)) {
      summary.malformedLines++;
      return;
    }
    if (eventType === "notification" && (
      details.source !== "windows_notification" || !Object.hasOwn(summary.observations, details.observation) ||
      !Number.isInteger(details.notificationId) || details.notificationId < 0 || details.notificationId > 0xffffffff ||
      typeof details.appId !== "string" || typeof details.appName !== "string" ||
      typeof details.createdAt !== "string" || !Number.isFinite(Date.parse(details.createdAt)) ||
      !Array.isArray(details.bindings) || details.bindings.some(binding => !binding ||
        typeof binding.template !== "string" || typeof binding.language !== "string" ||
        !Array.isArray(binding.textElements) || binding.textElements.some(text => typeof text !== "string"))
    )) { summary.malformedLines++; return; }

    summary.records++;
    const instant = new Date(capturedAt).toISOString();
    if (!summary.firstCapturedAt || instant < summary.firstCapturedAt) summary.firstCapturedAt = instant;
    if (!summary.lastCapturedAt || instant > summary.lastCapturedAt) summary.lastCapturedAt = instant;
    const session = sessions.get(sessionId) ?? { stopped: false, times: [] };
    session.times.push(Date.parse(capturedAt));
    if (eventType === "session_stopped") session.stopped = true;
    sessions.set(sessionId, session);
    if (eventType === "capture_error") summary.captureErrors++;
    if (eventType === "access_lost") summary.accessLosses++;
    if (eventType !== "notification") return;

    summary.notificationRecords++;
    summary.observations[details.observation]++;
    const identity = JSON.stringify([details.appId, details.notificationId, new Date(details.createdAt).toISOString()]);
    identities.add(identity);
    const snapshot = JSON.stringify([identity, details.appName, details.bindings]);
    if (snapshots.has(snapshot)) { summary.repeatedSnapshots++; return; }
    snapshots.add(snapshot);
    const textElements = details.bindings.flatMap(binding => binding.textElements);
    const text = textElements.join("\n");
    increment(summary.textElementCounts, String(textElements.length));
    for (const binding of details.bindings) increment(summary.bindingTemplates, binding.template || "(empty)");
    const urls = text.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
    const hosts = new Set();
    for (const url of urls) {
      try { hosts.add(new URL(url.replace(/[),.;!?\]}]+$/, "")).hostname.toLowerCase()); }
      catch { /* Retain the raw sample; do not treat a partial URL as a valid URL. */ }
    }
    if (hosts.size) summary.features.withUrls++;
    for (const host of hosts) increment(summary.urlHosts, host);
    if (/(?:[$€£]\s*\d|\b(?:USD|EUR|GBP)\s*\d|\d[\d,.]*\s*(?:USD|EUR|GBP)\b)/i.test(text)) summary.features.withPriceLikeText++;
    if (/\b(?:in[ -]stock|out[ -]of[ -]stock|restock(?:ed)?|sold[ -]out|pre[ -]?order)\b/i.test(text)) summary.features.withAvailabilityWords++;
    if (!text.trim()) summary.features.withoutText++;
    if (textElements.some(text => /(?:…|\.{3})\s*$/.test(text))) summary.features.possibleTruncation++;
  }

  function finish() {
    summary.sessions = sessions.size;
    summary.sessionsWithoutStop = [...sessions.values()].filter(session => !session.stopped).length;
    summary.windowsNotifications = identities.size;
    summary.uniqueSnapshots = snapshots.size;
    for (const session of sessions.values()) {
      session.times.sort((a, b) => a - b);
      for (let index = 1; index < session.times.length; index++) {
        summary.longestObservedGapSeconds = Math.max(summary.longestObservedGapSeconds,
          (session.times[index] - session.times[index - 1]) / 1000);
      }
    }
    return structuredClone(summary);
  }
  return { addLine, finish };
}

export async function analyzePath(input) {
  const location = resolve(input);
  const metadata = await stat(location);
  const files = metadata.isDirectory()
    ? (await readdir(location)).filter(name => /^capture-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort().map(name => join(location, name))
    : [location];
  if (!files.length) throw new Error("No capture-YYYY-MM-DD.jsonl files found in this directory.");
  const analysis = createAnalysis();
  for (const file of files) {
    const stream = createReadStream(file, { encoding: "utf8" });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try { for await (const line of lines) analysis.addLine(line); }
    finally { lines.close(); stream.destroy(); }
  }
  return { files: files.length, ...analysis.finish() };
}

export function formatAnalysis(summary) {
  const lines = [
    `Capture files: ${summary.files}`,
    `Observed range: ${summary.firstCapturedAt ?? "none"} to ${summary.lastCapturedAt ?? "none"}`,
    `Sessions: ${summary.sessions}; without a stop record in these files: ${summary.sessionsWithoutStop}`,
    `Health: ${summary.captureErrors} capture errors; ${summary.accessLosses} access losses; longest observed session gap ${summary.longestObservedGapSeconds}s`,
    `Samples: ${summary.notificationRecords} records; ${summary.windowsNotifications} Windows notification identities; ${summary.uniqueSnapshots} unique snapshots`,
    `Observations: ${summary.observations.existing} existing, ${summary.observations.added} added, ${summary.observations.updated} updated; ${summary.repeatedSnapshots} repeated snapshots`,
    "Features below count unique snapshots; these are text hints, not verified product facts:",
    `  URLs: ${summary.features.withUrls}; price-like text: ${summary.features.withPriceLikeText}; availability words: ${summary.features.withAvailabilityWords}`,
    `  No text: ${summary.features.withoutText}; possible truncation (trailing ellipsis): ${summary.features.possibleTruncation}`,
    `Text element counts: ${JSON.stringify(summary.textElementCounts)}`,
    `Binding templates: ${JSON.stringify(summary.bindingTemplates)}`,
    `URL hosts: ${JSON.stringify(summary.urlHosts)}`,
    `Unreadable lines: ${summary.malformedLines}; unsupported records: ${summary.unsupportedRecords}`,
    "A quiet log does not prove delivery. Missing stop records may mean a running app, a partial file set, or an interrupted session.",
    "Notifications suppressed by Discord are not measurable from this log. No message text or URL paths are included in this summary."
  ];
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.length > 2 || args[0].startsWith("--") || (args[1] && args[1] !== "--json")) {
    throw new Error('Usage: node analyze.mjs "path/to/logs-or-file.jsonl" [--json]');
  }
  const summary = await analyzePath(args[0]);
  console.log(args[1] === "--json" ? JSON.stringify(summary, null, 2) : formatAnalysis(summary));
  if (summary.malformedLines || summary.unsupportedRecords) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
