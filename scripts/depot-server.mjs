#!/usr/bin/env node
// The release and diagnostics depot on the development workstation (TrixBot).
// The Windows tray app on the shopper's PC calls it over Tailscale:
//
//   GET  /v1/releases/latest          signed release manifest (latest.json + latest.sig)
//   GET  /v1/releases/files/<name>    a published release ZIP
//   POST /v1/diagnostics              one diagnostics ZIP from the PC (logs, status, store pages)
//   GET  /v1/health                   liveness, no token needed
//
// Every other route needs `Authorization: Bearer <token>` (depot token file).
// Releases are signed with the release key (scripts/publish-release.mjs); the
// tray verifies that signature itself, so the token only gates access.
//
//   node scripts/depot-server.mjs                       # binds YOINK_DEPOT_HOST:YOINK_DEPOT_PORT
//   node scripts/depot-server.mjs --print-unit          # systemd user unit for it
//
// Storage (YOINK_DEPOT_ROOT, default ~/yoink-depot):
//   releases/latest.json, releases/latest.sig, releases/<zip>
//   diagnostics/<device>/<received-at>.zip   (kept 30 days)
//   depot-token                              (created on first start, owner-only)
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEPOT_ROOT = resolve(process.env.YOINK_DEPOT_ROOT || join(homedir(), "yoink-depot"));
const HOST = process.env.YOINK_DEPOT_HOST || "127.0.0.1";
const PORT = Number(process.env.YOINK_DEPOT_PORT || 32990);
export const MAX_DIAGNOSTICS_BYTES = 64 * 1024 * 1024;
export const DIAGNOSTICS_RETENTION_DAYS = 30;
const RELEASE_FILE = /^Yoink-win-x64-\d+\.\d+\.\d+(?:-[a-z0-9.]+)?\.zip$/;
const DEVICE = /^[A-Za-z0-9._-]{1,64}$/;

/** The shared token, created owner-only on first use. */
export function depotToken(root = DEPOT_ROOT) {
  const path = join(root, "depot-token");
  if (!existsSync(path)) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    writeFileSync(path, `${randomBytes(32).toString("base64url")}\n`, { mode: 0o600, flag: "wx" });
  }
  return readFileSync(path, "utf8").trim();
}

export function authorized(header, token) {
  const presented = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(String(header || ""))?.[1] ?? "";
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(token).digest();
  return presented.length > 0 && timingSafeEqual(a, b);
}

/** Removes diagnostics older than the retention period. */
export function pruneDiagnostics(root = DEPOT_ROOT, now = Date.now()) {
  const base = join(root, "diagnostics");
  if (!existsSync(base)) return 0;
  let removed = 0;
  for (const device of readdirSync(base)) {
    const folder = join(base, device);
    for (const file of readdirSync(folder)) {
      const path = join(folder, file);
      if (now - statSync(path).mtimeMs > DIAGNOSTICS_RETENTION_DAYS * 86_400_000) {
        rmSync(path, { force: true });
        removed += 1;
      }
    }
  }
  return removed;
}

function send(response, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  response.writeHead(status, { "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json", "Cache-Control": "no-store", ...headers });
  response.end(payload);
}

export function createDepotServer({ root = DEPOT_ROOT, token = depotToken(root), log = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const releases = join(root, "releases");
  return createServer((request, response) => {
    const url = new URL(request.url || "/", "http://depot");
    const device = String(request.headers["x-yoink-device"] || "");
    if (request.method === "GET" && url.pathname === "/v1/health") return send(response, 200, { ok: true });
    if (!authorized(request.headers.authorization, token)) return send(response, 401, { error: "unauthorized" });

    if (request.method === "GET" && url.pathname === "/v1/releases/latest") {
      const manifest = join(releases, "latest.json");
      const signature = join(releases, "latest.sig");
      if (!existsSync(manifest) || !existsSync(signature)) return send(response, 404, { error: "no_release" });
      return send(response, 200, {
        manifest: readFileSync(manifest, "utf8"),
        signature: readFileSync(signature, "utf8").trim()
      });
    }

    if (request.method === "GET" && url.pathname.startsWith("/v1/releases/files/")) {
      const name = decodeURIComponent(url.pathname.slice("/v1/releases/files/".length));
      const path = join(releases, name);
      if (!RELEASE_FILE.test(name) || !existsSync(path)) return send(response, 404, { error: "not_found" });
      response.writeHead(200, { "Content-Type": "application/zip", "Content-Length": statSync(path).size, "Cache-Control": "no-store" });
      createReadStream(path).pipe(response);
      return undefined;
    }

    if (request.method === "POST" && url.pathname === "/v1/diagnostics") {
      if (!DEVICE.test(device)) return send(response, 400, { error: "device_header_required" });
      const declared = Number(request.headers["content-length"] || 0);
      if (declared > MAX_DIAGNOSTICS_BYTES) return send(response, 413, { error: "too_large" });
      const folder = join(root, "diagnostics", device);
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const final = join(folder, `${stamp}.zip`);
      const partial = `${final}.part`;
      const out = createWriteStream(partial, { mode: 0o600 });
      let received = 0;
      let failed = false;
      request.on("data", (chunk) => {
        received += chunk.length;
        if (received > MAX_DIAGNOSTICS_BYTES && !failed) {
          failed = true;
          request.destroy();
          out.destroy();
          rmSync(partial, { force: true });
          send(response, 413, { error: "too_large" });
        }
      });
      request.pipe(out);
      out.on("finish", () => {
        if (failed) return;
        renameSync(partial, final);
        log(`diagnostics ${device} ${basename(final)} ${received} bytes`);
        send(response, 201, { stored: basename(final), bytes: received });
      });
      out.on("error", () => { if (!failed) { failed = true; send(response, 500, { error: "store_failed" }); } });
      return undefined;
    }
    return send(response, 404, { error: "not_found" });
  });
}

export function renderUnit({ host, port, nodePath = process.execPath } = {}) {
  return [
    "[Unit]",
    "Description=Yoink release and diagnostics depot (Windows tray updates)",
    "After=network-online.target tailscaled.service",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${ROOT}`,
    `Environment="YOINK_DEPOT_HOST=${host}"`,
    `Environment="YOINK_DEPOT_PORT=${port}"`,
    `ExecStart="${nodePath}" scripts/depot-server.mjs`,
    "Restart=on-failure",
    "RestartSec=5s",
    "UMask=0077",
    "",
    "[Install]",
    "WantedBy=default.target",
    ""
  ].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--print-unit")) {
    process.stdout.write(renderUnit({ host: HOST, port: PORT }));
  } else {
    const token = depotToken();
    const server = createDepotServer({ token });
    pruneDiagnostics();
    setInterval(() => pruneDiagnostics(), 6 * 3_600_000).unref();
    server.listen(PORT, HOST, () => process.stdout.write(`Yoink depot on http://${HOST}:${PORT} (root ${DEPOT_ROOT})\n`));
    const stop = () => server.close(() => process.exit(0));
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  }
}
