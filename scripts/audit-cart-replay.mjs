#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { replayCapsuleObject, loadCapsule } from "./replay-capsule.mjs";

const output = resolve(process.argv[2] || "docs/evidence/cart-audit-2026-09-06");
const inventory = JSON.parse(readFileSync(join(output, "inventory.json"), "utf8"));
const report = { generatedAt: new Date().toISOString(), definition: "Read-only source/packaged replay of every saved capsule. Passing rehearsal is not live cart proof.", cases: [] };
for (const entry of inventory.snapshots) {
  try {
    let capsule, html;
    if (entry.kind === "captured") capsule = loadCapsule(entry.path);
    else {
      const meta = JSON.parse(readFileSync(entry.path, "utf8"));
      html = gunzipSync(readFileSync(entry.path.replace(/\.json$/, ".html.gz"))).toString("utf8");
      capsule = { ...meta, id: meta.capsuleId, contractVersion: 1, extensionVersion: "audit", operation: "rehearse_add", ...meta.expectations };
    }
    capsule = { ...capsule, operation: "rehearse_add" };
    const source = await replayCapsuleObject(capsule, { ...(html ? { html } : {}), fulfillment: entry.requiredFulfillment });
    const bundle = await replayCapsuleObject(capsule, { ...(html ? { html } : {}), fulfillment: entry.requiredFulfillment, bundle: true });
    const fields = result => ({ actual: result.actual, rehearsal: result.rehearsal ? { ok: result.rehearsal.ok, reason: result.rehearsal.reason } : null,
      offer: Object.fromEntries(["retailerSku", "availability", "unitPriceCents", "sellerName", "sellerType", "fulfillment", "interactiveBlock", "securityChallenge", "addControlActionable"].map(k => [k,result.observation[k]])) });
    const a = fields(source), b = fields(bundle);
    report.cases.push({ ...entry, source: a, bundle: b, parity: JSON.stringify(a) === JSON.stringify(b), liveCartVerified: false });
  } catch (error) { report.cases.push({ ...entry, error: error.message, parity: false, liveCartVerified: false }); }
  writeFileSync(join(output, "replay-results.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`${entry.retailerId} ${entry.retailerSku} ${entry.path}: ${JSON.stringify(report.cases.at(-1).source?.actual || report.cases.at(-1).error)}`);
}
console.log(JSON.stringify({ cases: report.cases.length, parityFailures: report.cases.filter(c => !c.parity).length,
  rehearsalsPassed: report.cases.filter(c=>c.source?.rehearsal?.ok).length,
  rejected: report.cases.filter(c=>c.source?.actual?.outcome === "rejected").length,
  failed: report.cases.filter(c=>c.source?.actual?.outcome === "failed").length }));
process.exitCode = report.cases.some(c=>!c.parity) ? 1 : 0;
