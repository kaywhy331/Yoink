import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { resolveExtensionRelease } from "../apps/api/src/extension-release.js";
import { YoinkDatabase } from "../packages/database/src/database.js";
import {
  AMAZON_ADD_ADAPTER_VERSION,
  BESTBUY_ADD_ADAPTER_VERSION,
  POKEMONCENTER_ADD_ADAPTER_VERSION,
  RETAILER_OBSERVER_VERSIONS,
  TARGET_ADD_ADAPTER_VERSION,
  WALMART_ADD_ADAPTER_VERSION,
  WALMART_DRAW_OBSERVER_VERSION
} from "../packages/contracts/src/index.js";

test("the companion loads one generated adapter-version source with no worker literals", () => {
  const extensionRoot = join(process.cwd(), "apps", "extension");
  const background = readFileSync(join(extensionRoot, "background.js"), "utf8");
  assert.doesNotMatch(background, /-(?:add|observer)-v\d+/);
  assert.match(background, /importScripts\([^)]*adapter-versions\.js/);
  const scope: { YoinkAdapterVersions?: Record<string, any>; globalThis?: unknown } = {};
  scope.globalThis = scope;
  runInNewContext(readFileSync(join(extensionRoot, "adapter-versions.js"), "utf8"), scope);
  assert.deepEqual({ ...scope.YoinkAdapterVersions?.observer }, { ...RETAILER_OBSERVER_VERSIONS });
  assert.deepEqual({ ...scope.YoinkAdapterVersions?.add }, {
    target: TARGET_ADD_ADAPTER_VERSION,
    walmart: WALMART_ADD_ADAPTER_VERSION,
    amazon: AMAZON_ADD_ADAPTER_VERSION,
    bestbuy: BESTBUY_ADD_ADAPTER_VERSION,
    pokemoncenter: POKEMONCENTER_ADD_ADAPTER_VERSION, aninebing: "aninebing-add-v1", americaneagle: "americaneagle-add-v1", asus: "asus-add-v1", athleta: "athleta-add-v1",
    audioadvice: "audioadvice-add-v1", bananarepublic: "bananarepublic-add-v1", bananarepublicfactory: "bananarepublicfactory-add-v1"
  });
  assert.equal(scope.YoinkAdapterVersions?.walmartDrawObserver, WALMART_DRAW_OBSERVER_VERSION);
});

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

test("the local unpacked-extension release channel is absent when explicitly disabled", async () => {
  const db = new YoinkDatabase();
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "1.2.3",
    localExtensionReleaseEnabled: false
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    for (const path of ["/api/v1/extension/release", "/api/v1/extension/release/download"]) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 404);
      assert.equal((await response.json() as { error: string }).error, "local_extension_release_disabled");
    }
    const health = await fetch(`${baseUrl}/api/v1/admin/capabilities`).then((response) => response.json()) as {
      localExtensionUpdates: boolean;
    };
    assert.equal(health.localExtensionUpdates, false);
    const overview = await fetch(`${baseUrl}/api/v1/user/overview`).then((response) => response.json()) as {
      setup: { companion: { downloadUrl: string } };
    };
    assert.equal(overview.setup.companion.downloadUrl, "");
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
