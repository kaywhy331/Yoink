import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer, type AppDependencies } from "../apps/api/src/app.js";
import {
  allowHostedExtensionOrigins,
  createHostedRequestScopeResolver
} from "../apps/api/src/hosted-request-auth.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID, YoinkDatabase } from "../packages/database/src/database.js";
import { DeviceRepository } from "../packages/database/src/device-repository.js";
import { runWithRequestScope } from "../packages/database/src/request-scope.js";

/**
 * C03 / EXT-SW-19: replay every /devices/self/ request the Chrome companion
 * makes, the way Chrome sends it (GET/HEAD: no Origin header; other methods:
 * Origin chrome-extension://<id>), with a valid bearer, and require that no
 * server gate rejects it. A 403 origin rejection here is exactly the bug that
 * delivered 0 of 148 notifications: the companion was polling, the server
 * refused every originless GET before telemetry.
 */

const COMPANION_ORIGIN = `chrome-extension://${"a".repeat(32)}`;
const HOSTED_SECRET = "hosted-device-contract-secret-with-at-least-thirty-two-bytes";
const GATE_REJECTIONS = new Set([
  "extension_origin_rejected",
  "origin_rejected",
  "mutation_header_required",
  "api_route_unclassified",
  "api_surface_mismatch",
  "not_found",
  "method_not_allowed",
  "device_unauthorized"
]);

interface CompanionRequest {
  line: number;
  method: string;
  path: string;
}

/** Placeholder values for the template expressions background.js interpolates. */
function placeholder(expression: string): string {
  if (/retailers\b/.test(expression) && /join|null/.test(expression)) return "";
  if (/wait/i.test(expression)) return "0";
  if (/retailer|trialRouteSlug/i.test(expression)) return "target";
  if (/active\.id|jobId/.test(expression)) return "job_contract_probe";
  if (/notification\.id|deliveryId/.test(expression)) return "delivery_contract_probe";
  if (/lease\.id/.test(expression)) return `watch_item_${"0".repeat(32)}`;
  if (/syncId/.test(expression)) return "sync_contract_probe";
  return "contract_probe";
}

/** Reads one string or template literal starting at `start`, substituting interpolations. */
function readLiteral(source: string, start: number): { value: string; end: number } | null {
  const quote = source[start];
  if (quote !== "\"" && quote !== "'" && quote !== "`") return null;
  let value = "";
  let index = start + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === "\\") { value += source[index + 1] ?? ""; index += 2; continue; }
    if (character === quote) return { value, end: index + 1 };
    if (quote === "`" && character === "$" && source[index + 1] === "{") {
      let depth = 1;
      let cursor = index + 2;
      while (cursor < source.length && depth > 0) {
        if (source[cursor] === "{") depth += 1;
        else if (source[cursor] === "}") depth -= 1;
        cursor += 1;
      }
      value += placeholder(source.slice(index + 2, cursor - 1));
      index = cursor;
      continue;
    }
    value += character;
    index += 1;
  }
  return null;
}

function companionRequests(): CompanionRequest[] {
  const source = readFileSync(join(process.cwd(), "apps", "extension", "background.js"), "utf8");
  const found = new Map<string, CompanionRequest>();
  const pattern = /(?:\brequest\(\s*|\bpath:\s*)(?=["'`]\/devices\/self\/)/g;
  for (const match of source.matchAll(pattern)) {
    const start = (match.index ?? 0) + match[0].length;
    const literal = readLiteral(source, start);
    if (!literal) continue;
    let path = literal.value;
    // "/devices/self/qualification-trials/" + lane.trialRouteSlug
    if (/^\s*\+/.test(source.slice(literal.end, literal.end + 4))) path += "target";
    const nextRequest = source.indexOf("request(", literal.end);
    const window = source.slice(literal.end, nextRequest === -1 ? literal.end + 400 : Math.min(nextRequest, literal.end + 400));
    const method = /method:\s*["'](GET|HEAD|POST|PUT|PATCH|DELETE)["']/.exec(window)?.[1] ?? "GET";
    const line = source.slice(0, start).split("\n").length;
    const key = `${method} ${path}`;
    if (!found.has(key)) found.set(key, { line, method, path });
  }
  // Destructive calls last, so they cannot revoke the credential mid-table.
  const destructive = (request: CompanionRequest) => /privacy|credential-rotation/.test(request.path) ? 1 : 0;
  return [...found.values()].sort((left, right) => destructive(left) - destructive(right));
}

async function pairedServer(mode: "local" | "hosted"): Promise<{
  baseUrl: string;
  token: string;
  close: () => Promise<void>;
}> {
  const db = new YoinkDatabase();
  const pairing = runWithRequestScope({
    tenantId: LOCAL_TENANT_ID,
    userId: LOCAL_USER_ID,
    actorKind: "user",
    actorId: LOCAL_USER_ID
  }, () => new DeviceRepository(db).createPairingCode());
  const dependencies: AppDependencies = {
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "1.28.4",
    ...(mode === "hosted" ? {
      requestScopeResolver: createHostedRequestScopeResolver(db, { proxySecret: HOSTED_SECRET }),
      hostValidator: () => true,
      extensionOriginValidator: allowHostedExtensionOrigins([COMPANION_ORIGIN]),
      localExtensionReleaseEnabled: false
    } : {})
  };
  const server = createYoinkServer(dependencies);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const paired = await fetch(`${baseUrl}/api/v1/devices/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: COMPANION_ORIGIN },
    body: JSON.stringify({
      pairingCode: pairing.code,
      name: "Contract companion",
      platform: "windows-chrome",
      extensionVersion: "1.28.4",
      capabilities: { notifications: true }
    })
  });
  assert.equal(paired.status, 201, `${mode} pairing failed`);
  const token = (await paired.json() as { device: { token: string } }).device.token;
  return {
    baseUrl,
    token,
    close: async () => {
      server.close();
      server.closeAllConnections();
      await once(server, "close");
      db.close();
    }
  };
}

test("the companion request table parses every self-device call in background.js", () => {
  const requests = companionRequests();
  assert.ok(requests.length >= 30, `only ${requests.length} companion requests were found`);
  const keys = requests.map((request) => `${request.method} ${request.path.split("?")[0]}`);
  for (const expected of [
    "GET /devices/self/notifications/next",
    "GET /devices/self/jobs/next",
    "GET /devices/self/watch-queue/next",
    "GET /devices/self/readiness/reverification-plan",
    "POST /devices/self/heartbeat"
  ]) {
    assert.ok(keys.includes(expected), `${expected} is missing from the parsed table`);
  }
});

for (const mode of ["local", "hosted"] as const) {
  test(`${mode}: every companion self-device request, sent the way Chrome sends it, passes the server gates`, async () => {
    const requests = companionRequests();
    const server = await pairedServer(mode);
    const failures: string[] = [];
    try {
      for (const entry of requests) {
        const safe = entry.method === "GET" || entry.method === "HEAD";
        const response = await fetch(`${server.baseUrl}/api/v1${entry.path}`, {
          method: entry.method,
          headers: {
            Authorization: `Bearer ${server.token}`,
            ...(safe ? {} : { Origin: COMPANION_ORIGIN, "Content-Type": "application/json" })
          },
          ...(safe ? {} : { body: "{}" })
        });
        const text = await response.text();
        let code = "";
        try { code = String((JSON.parse(text) as { error?: string }).error ?? ""); } catch { code = ""; }
        if (response.status === 403 || GATE_REJECTIONS.has(code)) {
          failures.push(`background.js:${entry.line} ${entry.method} ${entry.path} -> ${response.status} ${code}`);
        }
      }
    } finally {
      await server.close();
    }
    assert.deepEqual(failures, [], `companion requests rejected by a server gate:\n${failures.join("\n")}`);
  });
}
