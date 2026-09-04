import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import test from "node:test";
// @ts-expect-error The promotion command is intentionally an importable JavaScript module.
import { promoteCapsule } from "../scripts/promote-capsule.mjs";

function capsule(path: string, html: string, id: string): void {
  const compressed = gzipSync(Buffer.from(html, "utf8"));
  writeFileSync(path, JSON.stringify({
    contractVersion: 1,
    id,
    capturedAt: "2026-09-04T20:00:00.000Z",
    retailerId: "walmart",
    retailerSku: "20895014480",
    operation: "observe",
    trigger: "diagnostic_failed",
    outcome: "rejected",
    failureStage: "availability_binding",
    reasonCode: "listing_unavailable_layout",
    observerVersion: "walmart-observer-v7",
    addAdapterVersion: "walmart-add-v8",
    packVersion: "walmart-pack-v1",
    extensionVersion: "1.22.0",
    url: "https://www.walmart.com/ip/20895014480",
    requiredFulfillment: "shipping",
    snapshot: {
      encoding: "gzip+base64",
      bytes: compressed.length,
      sha256: createHash("sha256").update(compressed).digest("hex"),
      html: compressed.toString("base64")
    }
  }));
}

function options(identifier: string, outputDirectory: string, slug: string, allowReason = "") {
  return {
    identifier,
    slug,
    outcome: "rejected",
    stage: "availability_binding",
    reason: "listing_unavailable_layout",
    allowReason,
    notes: "Synthetic promotion-command regression fixture.",
    stripStyles: false,
    dataDirectory: outputDirectory,
    outputDirectory,
    observation: { availability: "out_of_stock" }
  };
}

test("promotion writes a scanned fixture and records an explicitly reviewed exception", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-promote-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const safePath = join(directory, "safe.json");
  capsule(safePath, "<!doctype html><html><body><button data-yoink-vis=\"1\">Add to cart</button></body></html>", "cap_promotesafe12345678");
  const safe = await promoteCapsule(options(safePath, directory, "safe-page"));
  assert.equal(readFileSync(safe.htmlPath).subarray(0, 2).toString("hex"), "1f8b");
  assert.equal(JSON.parse(readFileSync(safe.metadataPath, "utf8")).allowReason, "");

  const unsafePath = join(directory, "unsafe.json");
  capsule(unsafePath, "<!doctype html><html><body><button data-contact=\"person@example.com\" data-yoink-vis=\"1\">Add to cart</button></body></html>", "cap_promoteunsafe123456");
  await assert.rejects(
    promoteCapsule(options(unsafePath, directory, "unsafe-page")),
    /Privacy scan refused promotion/
  );
  const reviewed = await promoteCapsule(options(
    unsafePath,
    directory,
    "reviewed-page",
    "Known synthetic address retained to verify the scanner exception path."
  ));
  const metadata = JSON.parse(readFileSync(reviewed.metadataPath, "utf8"));
  assert.equal(metadata.allowReason, "Known synthetic address retained to verify the scanner exception path.");
  assert.ok(reviewed.scanHits.some((hit: { kind: string }) => hit.kind === "email"));
});
