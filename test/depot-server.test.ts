import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
// @ts-expect-error -- plain .mjs script without type declarations
import { authorized, createDepotServer, depotToken, pruneDiagnostics } from "../scripts/depot-server.mjs";
// @ts-expect-error -- plain .mjs script without type declarations
import { releaseSigningKey, publicKeyText, renderManifest, signManifest } from "../scripts/publish-release.mjs";
import { createPublicKey, verify } from "node:crypto";

async function withDepot(run: (base: string, token: string, root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "yoink-depot-"));
  const token = depotToken(root) as string;
  const server = createDepotServer({ root, token, log: () => undefined });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, token, root);
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
}

test("the depot token is created owner-only once and compared in constant time", () => {
  const root = mkdtempSync(join(tmpdir(), "yoink-depot-"));
  try {
    const token = depotToken(root) as string;
    assert.equal(depotToken(root), token);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(authorized(`Bearer ${token}`, token), true);
    assert.equal(authorized(`Bearer ${"x".repeat(43)}`, token), false);
    assert.equal(authorized("", token), false);
    assert.equal(authorized(`Basic ${token}`, token), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("releases and diagnostics need the token; health does not", async () => {
  await withDepot(async (base, token) => {
    assert.equal((await fetch(`${base}/v1/health`)).status, 200);
    assert.equal((await fetch(`${base}/v1/releases/latest`)).status, 401);
    assert.equal((await fetch(`${base}/v1/releases/latest`, { headers: { Authorization: `Bearer ${token}` } })).status, 404);
    assert.equal((await fetch(`${base}/v1/diagnostics`, { method: "POST", body: "x" })).status, 401);
  });
});

test("only published release ZIP names are served; path tricks are not found", async () => {
  await withDepot(async (base, token, root) => {
    mkdirSync(join(root, "releases"), { recursive: true });
    writeFileSync(join(root, "releases", "Yoink-win-x64-1.2.3.zip"), "zip");
    writeFileSync(join(root, "secret.txt"), "no");
    const headers = { Authorization: `Bearer ${token}` };
    assert.equal(await (await fetch(`${base}/v1/releases/files/Yoink-win-x64-1.2.3.zip`, { headers })).text(), "zip");
    for (const name of ["..%2Fsecret.txt", "..%2F..%2Fdepot-token", "latest.json", "Yoink-win-x64-1.2.3.zip%2F..%2F..%2Fsecret.txt"]) {
      assert.equal((await fetch(`${base}/v1/releases/files/${name}`, { headers })).status, 404, name);
    }
  });
});

test("diagnostics are stored per device, need a device header, and are pruned after 30 days", async () => {
  await withDepot(async (base, token, root) => {
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/zip" };
    assert.equal((await fetch(`${base}/v1/diagnostics`, { method: "POST", headers, body: "zip" })).status, 400);
    assert.equal((await fetch(`${base}/v1/diagnostics`, { method: "POST", headers: { ...headers, "X-Yoink-Device": "../etc" }, body: "zip" })).status, 400);
    const stored = await fetch(`${base}/v1/diagnostics`, { method: "POST", headers: { ...headers, "X-Yoink-Device": "redpc" }, body: "zip-bytes" });
    assert.equal(stored.status, 201);
    const files = readdirSync(join(root, "diagnostics", "redpc"));
    assert.equal(files.length, 1);
    const old = join(root, "diagnostics", "redpc", files[0]!);
    const ancient = new Date(Date.now() - 31 * 86_400_000);
    utimesSync(old, ancient, ancient);
    assert.equal(pruneDiagnostics(root), 1);
    assert.equal(existsSync(old), false);
  });
});

test("a release manifest signature is P-256 IEEE P1363 over the exact manifest bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "yoink-key-"));
  try {
    const key = releaseSigningKey(join(root, "key.pem"));
    const manifest = renderManifest({ version: "1.2.3", file: "Yoink-win-x64-1.2.3.zip", sha256: "a".repeat(64), size: 3, commit: "c" }) as string;
    const signature = Buffer.from(signManifest(manifest, key) as string, "base64");
    assert.equal(signature.length, 64, "raw r||s, as .NET's IeeeP1363FixedFieldConcatenation expects");
    const publicKey = createPublicKey({ key: Buffer.from(publicKeyText(key) as string, "base64"), format: "der", type: "spki" });
    assert.equal(verify("sha256", Buffer.from(manifest), { key: publicKey, dsaEncoding: "ieee-p1363" }, signature), true);
    assert.equal(verify("sha256", Buffer.from(manifest.replace("1.2.3", "1.2.4")), { key: publicKey, dsaEncoding: "ieee-p1363" }, signature), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
