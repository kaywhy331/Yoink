import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { resolveExtensionRelease } from "../apps/api/src/extension-release.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

test("the local extension release descriptor binds one exact versioned archive and hash", () => {
  const releaseRoot = mkdtempSync(join(tmpdir(), "yoink-release-"));
  try {
    const body = Buffer.from("fixture unpacked extension archive");
    writeFileSync(join(releaseRoot, "Yoink-Companion-1.2.3.zip"), body, { mode: 0o600 });
    writeFileSync(join(releaseRoot, "Yoink-Companion-9.9.9.zip"), "wrong version", { mode: 0o600 });
    const release = resolveExtensionRelease(releaseRoot, "1.2.3");
    assert.equal(release.descriptor.packageReady, true);
    assert.equal(release.descriptor.filename, "Yoink-Companion-1.2.3.zip");
    assert.equal(release.descriptor.sha256, createHash("sha256").update(body).digest("hex"));
    assert.equal(release.descriptor.sizeBytes, body.length);
    assert.equal(resolveExtensionRelease(releaseRoot, "../../9.9.9").descriptor.packageReady, false);
    assert.equal(resolveExtensionRelease(releaseRoot, "1.2.4").descriptor.packageReady, false);
  } finally {
    rmSync(releaseRoot, { recursive: true, force: true });
  }
});

test("the loopback release feed serves only the current exact companion package", async () => {
  const releaseRoot = mkdtempSync(join(tmpdir(), "yoink-release-api-"));
  const body = Buffer.from("fixture zip bytes");
  writeFileSync(join(releaseRoot, "Yoink-Companion-1.2.3.zip"), body, { mode: 0o600 });
  const db = new YoinkDatabase();
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    releaseRoot,
    version: "1.2.3"
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const metadataResponse = await fetch(`${baseUrl}/api/v1/extension/release`);
    assert.equal(metadataResponse.status, 200);
    const metadata = await metadataResponse.json() as Record<string, unknown>;
    assert.equal(metadata.version, "1.2.3");
    assert.equal(metadata.packageReady, true);
    assert.equal(metadata.downloadUrl, "/api/v1/extension/release/download");

    const download = await fetch(`${baseUrl}/api/v1/extension/release/download`);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "application/zip");
    assert.match(download.headers.get("content-disposition") ?? "", /Yoink-Companion-1\.2\.3\.zip/);
    assert.equal(download.headers.get("x-content-sha256"), metadata.sha256);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), body);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
    rmSync(releaseRoot, { recursive: true, force: true });
  }
});
