import { userBotMessage } from "./user-bot-message.js";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import type { UserConnectorKind } from "../../contracts/src/action-platform.js";
import { stableHash } from "../../domain/src/ids.js";

const REGISTRY_ENV = "YOINK_USER_ACTION_CONNECTORS_JSON";
const REFERENCE = /^[A-Za-z][A-Za-z0-9_.:-]{2,119}$/;
const SECRET_ENV = /^YOINK_USER_ACTION_CONNECTOR_SECRET_[A-Z0-9_]{3,80}$/;
const KINDS = new Set<UserConnectorKind>(["discord", "slack", "webhook"]);
const MAX_CONNECTORS = 20;

export interface UserActionWebhookDefinition {
  reference: string;
  kind: UserConnectorKind;
  endpoint: string;
  signingSecretEnvironment: string;
  bindingFingerprint: string;
}

export interface UserActionWebhookRegistry {
  definitions: readonly UserActionWebhookDefinition[];
  bindings: Readonly<Record<string, string>>;
  fingerprint: string;
}

export interface UserActionWebhookRequest {
  deliveryId: string;
  connectorKind: UserConnectorKind;
  endpointReference: string;
  payload: Record<string, unknown>;
}

export interface UserActionWebhookResult {
  delivered: boolean;
  retryable: boolean;
  reasonCode: string;
  httpStatus: number;
  providerMessageId?: string;
  retryAfterMs?: number;
}

export interface UserActionWebhookTransport {
  deliver(request: UserActionWebhookRequest): Promise<UserActionWebhookResult>;
}

interface RuntimeDefinition extends UserActionWebhookDefinition {
  signingSecret: string;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function publicEndpoint(value: unknown): string {
  const raw = String(value ?? "").trim();
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("User connector endpoints must be exact HTTPS URLs."); }
  const hostname = url.hostname.toLocaleLowerCase("en-US");
  if (raw.length > 2_048 || url.protocol !== "https:" || url.username || url.password
    || url.search || url.hash || (url.port && url.port !== "443") || !hostname
    || hostname === "localhost" || hostname.endsWith(".localhost") || isIP(hostname) !== 0) {
    throw new Error("User connector endpoints must be public HTTPS URLs without credentials, query strings, fragments, IP literals, or nonstandard ports.");
  }
  return url.toString();
}

export function loadUserActionWebhookRegistry(env: NodeJS.ProcessEnv): UserActionWebhookRegistry {
  const raw = String(env[REGISTRY_ENV] ?? "").trim();
  if (!raw) {
    return { definitions: Object.freeze([]), bindings: Object.freeze({}), fingerprint: stableHash("yoink_user_action_registry_v1", "[]") };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; } catch { throw new Error(`${REGISTRY_ENV} must be a JSON array.`); }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > MAX_CONNECTORS) {
    throw new Error(`${REGISTRY_ENV} must contain 1 through ${MAX_CONNECTORS} connector definitions.`);
  }
  const seen = new Set<string>();
  const definitions = parsed.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Each user connector definition must be an object.");
    const value = entry as Record<string, unknown>;
    const reference = String(value.reference ?? "").trim();
    const kind = String(value.kind ?? "") as UserConnectorKind;
    const signingSecretEnvironment = String(value.signingSecretEnvironment ?? "").trim();
    if (!REFERENCE.test(reference) || seen.has(reference) || !KINDS.has(kind)
      || (signingSecretEnvironment && !SECRET_ENV.test(signingSecretEnvironment))) {
      throw new Error("User connector definitions require a unique reference, supported kind, and optional dedicated secret environment variable.");
    }
    seen.add(reference);
    const endpoint = publicEndpoint(value.endpoint);
    return Object.freeze({
      reference,
      kind,
      endpoint,
      signingSecretEnvironment,
      bindingFingerprint: stableHash("yoink_user_action_binding_v1", reference, kind, endpoint, signingSecretEnvironment)
    });
  }).sort((left, right) => left.reference.localeCompare(right.reference));
  const bindings = Object.fromEntries(definitions.map((definition) => [definition.reference, definition.bindingFingerprint]));
  return {
    definitions: Object.freeze(definitions),
    bindings: Object.freeze(bindings),
    fingerprint: stableHash("yoink_user_action_registry_v1", stableJson(definitions.map(({ reference, kind, bindingFingerprint }) => ({ reference, kind, bindingFingerprint }))))
  };
}

export class BoundUserActionWebhookTransport implements UserActionWebhookTransport {
  private readonly runtime = new Map<string, RuntimeDefinition>();

  constructor(
    registry: UserActionWebhookRegistry,
    env: NodeJS.ProcessEnv,
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly clock: () => number = Date.now
  ) {
    for (const definition of registry.definitions) {
      const signingSecret = definition.signingSecretEnvironment
        ? String(env[definition.signingSecretEnvironment] ?? "")
        : "";
      if (definition.signingSecretEnvironment && (Buffer.byteLength(signingSecret, "utf8") < 32
        || Buffer.byteLength(signingSecret, "utf8") > 512)) {
        throw new Error(`The signing secret for user connector ${definition.reference} must contain 32 through 512 bytes.`);
      }
      this.runtime.set(definition.reference, { ...definition, signingSecret });
    }
  }

  async deliver(request: UserActionWebhookRequest): Promise<UserActionWebhookResult> {
    const definition = this.runtime.get(request.endpointReference);
    if (!definition || definition.kind !== request.connectorKind) {
      return { delivered: false, retryable: false, reasonCode: "connector_binding_unavailable", httpStatus: 0 };
    }
    const coreMessage = userBotMessage(request.payload, definition.kind === "discord" ? "discord" : "plain").text.slice(0, 1_900);
    const outbound = definition.kind === "discord" ? { username: "YoinkBot", content: coreMessage, allowed_mentions: { parse: [] } }
      : definition.kind === "slack" ? { text: coreMessage }
        : request.payload;
    const body = stableJson(outbound);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "Yoink-User-Action-Connector/1",
      "X-Yoink-Delivery-ID": request.deliveryId
    };
    if (definition.signingSecret) {
      headers["X-Yoink-Signature"] = `sha256=${createHmac("sha256", definition.signingSecret).update(body, "utf8").digest("hex")}`;
      // The body-only signature is replayable. V2 also binds the send time and
      // delivery ID: receivers verify HMAC("<timestamp>.<delivery id>.<body>"),
      // reject a timestamp more than 5 minutes old, and dedupe the delivery ID.
      // The body-only header stays for receivers that predate V2.
      const timestamp = String(Math.floor(this.clock() / 1_000));
      headers["X-Yoink-Timestamp"] = timestamp;
      headers["X-Yoink-Signature-V2"] = `sha256=${createHmac("sha256", definition.signingSecret)
        .update(`${timestamp}.${request.deliveryId}.${body}`, "utf8")
        .digest("hex")}`;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    timeout.unref?.();
    try {
      const response = await this.fetchImplementation(definition.kind === "discord" ? `${definition.endpoint}?wait=true` : definition.endpoint, {
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
        headers,
        body
      });
      const data = definition.kind === "discord" ? await response.json().catch(() => ({})) as Record<string, unknown> : {};
      if (definition.kind !== "discord") void response.body?.cancel().catch(() => undefined);
      if (response.status >= 200 && response.status < 300 && (definition.kind !== "discord" || typeof data.id === "string")) {
        return { delivered: true, retryable: false, reasonCode: "connector_delivered", httpStatus: response.status,
          ...(typeof data.id === "string" ? { providerMessageId: data.id } : {}) };
      }
      if ([408, 425, 429].includes(response.status) || response.status >= 500 || response.ok) {
        return { delivered: false, retryable: true, reasonCode: "connector_retryable_status", httpStatus: response.status, retryAfterMs: Math.max(0, Number(data.retry_after ?? response.headers.get("retry-after")) * 1000) || 0 };
      }
      return { delivered: false, retryable: false, reasonCode: "connector_rejected", httpStatus: response.status };
    } catch {
      return { delivered: false, retryable: true, reasonCode: "connector_transport_failed", httpStatus: 0 };
    } finally {
      clearTimeout(timeout);
    }
  }
}
