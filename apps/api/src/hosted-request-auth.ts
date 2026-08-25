import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { nowIso, stableHash } from "../../../packages/domain/src/ids.js";
import type { YoinkDatabase } from "../../../packages/database/src/database.js";
import { DeviceRepository } from "../../../packages/database/src/device-repository.js";
import {
  currentRequestScope,
  normalizedRequestScope,
  type RequestScope
} from "../../../packages/database/src/request-scope.js";

const DEVICE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,100}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{24,100}$/;
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/;

export interface HostedRequestAuthOptions {
  proxySecret: string;
  maximumClockSkewSeconds?: number;
  nonceTtlSeconds?: number;
  maximumStepUpAgeSeconds?: number;
}

export interface HostedRequestAuthContext {
  body?: Record<string, unknown>;
}

export interface HostedScopeSignatureInput {
  method: string;
  path: string;
  scope: RequestScope;
  issuedAt: number;
  nonce: string;
}

function deviceTokenHash(token: string): string {
  return stableHash("yoink-device-token-v1", token);
}

function signaturePayload(input: HostedScopeSignatureInput): string {
  return [
    "yoink_hosted_scope_v1",
    input.method.toUpperCase(),
    input.path,
    input.scope.tenantId,
    input.scope.userId,
    input.scope.actorKind,
    input.scope.actorId,
    input.scope.authenticationAssurance ?? "baseline",
    String(input.scope.authenticationTime ?? 0),
    input.scope.sessionId ?? "",
    String(input.issuedAt),
    input.nonce
  ].join("\n");
}

export function signHostedRequestScope(secret: string, input: HostedScopeSignatureInput): Record<string, string> {
  if (Buffer.byteLength(secret, "utf8") < 32) throw new Error("The hosted request proxy secret must contain at least 32 bytes.");
  const scope = normalizedRequestScope(input.scope);
  if (!Number.isSafeInteger(input.issuedAt) || input.issuedAt <= 0 || !NONCE_PATTERN.test(input.nonce)) {
    throw new Error("A valid hosted request timestamp and nonce are required.");
  }
  const normalized = { ...input, method: input.method.toUpperCase(), scope };
  const signature = createHmac("sha256", secret).update(signaturePayload(normalized), "utf8").digest("hex");
  return {
    "X-Yoink-Tenant-Id": scope.tenantId,
    "X-Yoink-User-Id": scope.userId,
    "X-Yoink-Actor-Kind": scope.actorKind,
    "X-Yoink-Actor-Id": scope.actorId,
    ...(scope.authenticationAssurance ? {
      "X-Yoink-Authentication-Assurance": scope.authenticationAssurance,
      "X-Yoink-Authentication-Time": String(scope.authenticationTime),
      "X-Yoink-Session-Id": String(scope.sessionId)
    } : {}),
    "X-Yoink-Scope-Issued-At": String(input.issuedAt),
    "X-Yoink-Scope-Nonce": input.nonce,
    "X-Yoink-Scope-Signature": signature
  };
}

function header(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  return Array.isArray(value) ? "" : String(value ?? "").trim();
}

function suppliedBearer(request: IncomingMessage): string {
  const authorization = header(request, "authorization");
  return /^Bearer ([A-Za-z0-9_-]{40,100})$/.exec(authorization)?.[1] ?? "";
}

function pathname(request: IncomingMessage): string {
  try {
    return new URL(request.url ?? "/", "https://yoink.invalid").pathname;
  } catch {
    return "/api/v1/invalid";
  }
}

function safeEqualHex(expected: string, supplied: string): boolean {
  if (!SIGNATURE_PATTERN.test(expected) || !SIGNATURE_PATTERN.test(supplied)) return false;
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(supplied, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createHostedRequestScopeResolver(
  db: YoinkDatabase,
  options: HostedRequestAuthOptions
): (request: IncomingMessage, context?: HostedRequestAuthContext) => RequestScope {
  const secret = String(options.proxySecret ?? "");
  if (Buffer.byteLength(secret, "utf8") < 32) throw new Error("The hosted request proxy secret must contain at least 32 bytes.");
  const maximumClockSkewSeconds = Number.isSafeInteger(options.maximumClockSkewSeconds)
    && Number(options.maximumClockSkewSeconds) >= 10
    && Number(options.maximumClockSkewSeconds) <= 300
    ? Number(options.maximumClockSkewSeconds)
    : 60;
  const nonceTtlSeconds = Number.isSafeInteger(options.nonceTtlSeconds)
    && Number(options.nonceTtlSeconds) >= maximumClockSkewSeconds
    && Number(options.nonceTtlSeconds) <= 600
    ? Number(options.nonceTtlSeconds)
    : 120;
  const maximumStepUpAgeSeconds = Number.isSafeInteger(options.maximumStepUpAgeSeconds)
    && Number(options.maximumStepUpAgeSeconds) >= 60
    && Number(options.maximumStepUpAgeSeconds) <= 900
    ? Number(options.maximumStepUpAgeSeconds)
    : 300;

  const devices = new DeviceRepository(db);
  return (request: IncomingMessage, context: HostedRequestAuthContext = {}) => {
    const deviceToken = suppliedBearer(request);
    if (DEVICE_TOKEN_PATTERN.test(deviceToken)) {
      const tokenHash = deviceTokenHash(deviceToken);
      const requestPathname = pathname(request);
      const pendingCommit = request.method === "POST"
        && requestPathname === "/api/v1/devices/self/credential-rotation/commit";
      const timestamp = nowIso(Date.now());
      const device = db.get<{ tenantId: string; userId: string; deviceId: string }>(
        `SELECT tenant_id AS tenantId, user_id AS userId, id AS deviceId
         FROM extension_devices
         WHERE status = 'active'
           AND (
             token_hash = ?
             OR (previous_token_hash = ? AND previous_token_expires_at >= ?)
             OR (? = 1 AND pending_token_hash = ? AND pending_token_expires_at >= ?)
           )`,
        tokenHash,
        tokenHash,
        timestamp,
        pendingCommit ? 1 : 0,
        tokenHash,
        timestamp
      );
      if (device) {
        return normalizedRequestScope({
          tenantId: device.tenantId,
          userId: device.userId,
          actorKind: "device",
          actorId: device.deviceId
        });
      }
      throw new Error("The authenticated request scope is invalid.");
    }

    if (request.method === "POST" && pathname(request) === "/api/v1/devices/pair") {
      const pairing = devices.resolvePairingCodeScope(context.body?.pairingCode);
      if (pairing) {
        return normalizedRequestScope({
          tenantId: pairing.tenantId,
          userId: pairing.userId,
          actorKind: "device",
          actorId: pairing.pairingCodeId
        });
      }
      throw new Error("An authenticated request scope or valid one-time pairing code is required.");
    }

    const authenticationAssurance = header(request, "x-yoink-authentication-assurance");
    const authenticationTimeHeader = header(request, "x-yoink-authentication-time");
    const sessionId = header(request, "x-yoink-session-id");
    const scope = normalizedRequestScope({
      tenantId: header(request, "x-yoink-tenant-id"),
      userId: header(request, "x-yoink-user-id"),
      actorKind: header(request, "x-yoink-actor-kind") as RequestScope["actorKind"],
      actorId: header(request, "x-yoink-actor-id"),
      ...(authenticationAssurance ? {
        authenticationAssurance: authenticationAssurance as NonNullable<RequestScope["authenticationAssurance"]>,
        authenticationTime: Number(authenticationTimeHeader),
        sessionId
      } : {})
    });
    const issuedAt = Number(header(request, "x-yoink-scope-issued-at"));
    const nonce = header(request, "x-yoink-scope-nonce");
    const suppliedSignature = header(request, "x-yoink-scope-signature").toLocaleLowerCase("en-US");
    const now = Date.now();
    if (!Number.isSafeInteger(issuedAt) || !NONCE_PATTERN.test(nonce)
      || Math.abs(now - issuedAt * 1_000) > maximumClockSkewSeconds * 1_000) {
      throw new Error("The authenticated request scope is expired or malformed.");
    }
    if (scope.authenticationAssurance === "step_up"
      && (Number(scope.authenticationTime) * 1_000 > now + maximumClockSkewSeconds * 1_000
        || now - Number(scope.authenticationTime) * 1_000 > maximumStepUpAgeSeconds * 1_000)) {
      throw new Error("The authenticated step-up context is expired or malformed.");
    }
    const expectedSignature = createHmac("sha256", secret).update(signaturePayload({
      method: request.method ?? "GET",
      path: request.url ?? "/",
      scope,
      issuedAt,
      nonce
    }), "utf8").digest("hex");
    if (!safeEqualHex(expectedSignature, suppliedSignature)) {
      throw new Error("The authenticated request scope signature is invalid.");
    }
    const principal = db.get<{ found: number }>(
      `SELECT 1 AS found FROM users WHERE id = ? AND tenant_id = ?`,
      scope.userId,
      scope.tenantId
    );
    if (!principal) throw new Error("The authenticated tenant/user principal does not exist.");

    const timestamp = nowIso(now);
    const nonceHash = stableHash("yoink_hosted_request_nonce_v1", scope.tenantId, nonce);
    try {
      db.transaction(() => {
        db.run("DELETE FROM hosted_request_nonces WHERE expires_at < ?", timestamp);
        db.run(
          `INSERT INTO hosted_request_nonces(
             tenant_id, user_id, nonce_hash, issued_at, expires_at, created_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
          scope.tenantId,
          scope.userId,
          nonceHash,
          nowIso(issuedAt * 1_000),
          nowIso(now + nonceTtlSeconds * 1_000),
          timestamp
        );
      });
    } catch {
      throw new Error("The authenticated request scope nonce was already used.");
    }
    return scope;
  };
}

function normalizedExtensionOrigin(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "chrome-extension:"
    || !/^[a-p]{32}$/.test(parsed.hostname)
    || parsed.username || parsed.password
    || (parsed.pathname !== "" && parsed.pathname !== "/")
    || parsed.search || parsed.hash) {
    throw new Error("Hosted extension origins must be exact chrome-extension origins with a 32-character ID.");
  }
  return `chrome-extension://${parsed.hostname}`;
}

export function allowHostedExtensionOrigins(origins: readonly string[]): (request: IncomingMessage) => boolean {
  const allowed = new Set(origins.map((value) => normalizedExtensionOrigin(value.trim())));
  if (!allowed.size) throw new Error("At least one exact hosted Chrome extension origin is required.");
  return (request) => {
    try {
      return allowed.has(normalizedExtensionOrigin(header(request, "origin")));
    } catch {
      return false;
    }
  };
}

export function allowHostedHosts(hosts: readonly string[]): (request: IncomingMessage) => boolean {
  const allowed = new Set(hosts.map((value) => value.trim().toLocaleLowerCase("en-US")).filter((value) => /^[a-z0-9.-]+(?::\d+)?$/.test(value)));
  if (!allowed.size) throw new Error("At least one explicit hosted Host value is required.");
  return (request) => allowed.has(header(request, "host").toLocaleLowerCase("en-US"));
}

export function allowHostedMutationOrigins(origins: readonly string[]): (request: IncomingMessage) => boolean {
  const allowed = new Set(origins.map((value) => {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error("Hosted mutation origins must be credential-free HTTPS origins.");
    }
    return parsed.origin;
  }));
  if (!allowed.size) throw new Error("At least one explicit hosted mutation origin is required.");
  return (request) => {
    const origin = header(request, "origin");
    if (!origin) return currentRequestScope().actorKind === "service" || currentRequestScope().actorKind === "device";
    try {
      return allowed.has(new URL(origin).origin);
    } catch {
      return false;
    }
  };
}
