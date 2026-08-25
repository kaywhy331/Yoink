import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { stableHash } from "../../domain/src/ids.js";

const REGISTRY_ENVIRONMENT_VARIABLE = "YOINK_OPERATOR_ALERT_WEBHOOKS_JSON";
const REFERENCE_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{2,119}$/;
const SECRET_ENVIRONMENT_PATTERN = /^YOINK_OPERATOR_ALERT_WEBHOOK_SECRET_[A-Z0-9_]{3,80}$/;
const MAXIMUM_CONNECTORS = 20;
const MAXIMUM_RESPONSE_WAIT_MS = 10_000;

export interface OperatorAlertWebhookDefinition {
  reference: string;
  endpoint: string;
  signingSecretEnvironment: string;
  bindingFingerprint: string;
}

export interface OperatorAlertWebhookRegistry {
  definitions: readonly OperatorAlertWebhookDefinition[];
  bindings: Readonly<Record<string, string>>;
  fingerprint: string;
}

interface RuntimeWebhookDefinition extends OperatorAlertWebhookDefinition {
  signingSecret: string;
}

export interface OperatorAlertWebhookDeliveryRequest {
  deliveryId: string;
  eventId: string;
  endpointReference: string;
  payload: Record<string, unknown>;
}

export interface OperatorAlertWebhookDeliveryResult {
  disposition: "delivered" | "retry" | "dead_letter";
  reasonCode: string;
  httpStatus: number;
}

export interface OperatorAlertWebhookTransport {
  deliver(request: OperatorAlertWebhookDeliveryRequest): Promise<OperatorAlertWebhookDeliveryResult>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function endpoint(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 2_048) throw new Error("Each operator alert webhook requires a bounded HTTPS endpoint.");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Each operator alert webhook requires a bounded HTTPS endpoint.");
  }
  const hostname = parsed.hostname.toLocaleLowerCase("en-US");
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash
    || (parsed.port && parsed.port !== "443") || !hostname || hostname === "localhost"
    || hostname.endsWith(".localhost") || isIP(hostname) !== 0) {
    throw new Error("Operator alert webhook endpoints must be exact public HTTPS URLs without credentials, query strings, fragments, IP literals, or nonstandard ports.");
  }
  return parsed.toString();
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

export function loadOperatorAlertWebhookRegistry(env: NodeJS.ProcessEnv): OperatorAlertWebhookRegistry {
  const raw = String(env[REGISTRY_ENVIRONMENT_VARIABLE] ?? "").trim();
  if (!raw) {
    return {
      definitions: Object.freeze([]),
      bindings: Object.freeze({}),
      fingerprint: stableHash("yoink_operator_alert_webhook_registry_v1", "[]")
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${REGISTRY_ENVIRONMENT_VARIABLE} must be a JSON array of deployment-owned webhook references.`);
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > MAXIMUM_CONNECTORS) {
    throw new Error(`${REGISTRY_ENVIRONMENT_VARIABLE} must contain 1 through ${MAXIMUM_CONNECTORS} webhook definitions.`);
  }
  const seen = new Set<string>();
  const definitions = parsed.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)
      || !exactKeys(candidate as Record<string, unknown>, ["reference", "endpoint", "signingSecretEnvironment"])) {
      throw new Error("Each operator alert webhook definition must contain only reference, endpoint, and signingSecretEnvironment.");
    }
    const record = candidate as Record<string, unknown>;
    const reference = String(record.reference ?? "").trim();
    const signingSecretEnvironment = String(record.signingSecretEnvironment ?? "").trim();
    if (!REFERENCE_PATTERN.test(reference) || seen.has(reference)) {
      throw new Error("Operator alert webhook references must be unique bounded identifiers.");
    }
    if (!SECRET_ENVIRONMENT_PATTERN.test(signingSecretEnvironment)) {
      throw new Error("Operator alert webhook secret references must use a dedicated YOINK_OPERATOR_ALERT_WEBHOOK_SECRET_* environment variable.");
    }
    seen.add(reference);
    const normalizedEndpoint = endpoint(record.endpoint);
    return Object.freeze({
      reference,
      endpoint: normalizedEndpoint,
      signingSecretEnvironment,
      bindingFingerprint: stableHash(
        "yoink_operator_alert_webhook_binding_v1",
        reference,
        normalizedEndpoint,
        signingSecretEnvironment
      )
    });
  }).sort((left, right) => left.reference.localeCompare(right.reference));
  const publicMaterial = definitions.map((definition) => ({
    reference: definition.reference,
    bindingFingerprint: definition.bindingFingerprint
  }));
  const bindings = Object.fromEntries(definitions.map((definition) => [definition.reference, definition.bindingFingerprint]));
  return {
    definitions: Object.freeze(definitions),
    bindings: Object.freeze(bindings),
    fingerprint: stableHash("yoink_operator_alert_webhook_registry_v1", stableJson(publicMaterial))
  };
}

export function resolveOperatorAlertWebhookSecrets(
  registry: OperatorAlertWebhookRegistry,
  env: NodeJS.ProcessEnv
): Map<string, RuntimeWebhookDefinition> {
  const resolved = new Map<string, RuntimeWebhookDefinition>();
  for (const definition of registry.definitions) {
    const signingSecret = String(env[definition.signingSecretEnvironment] ?? "");
    const byteLength = Buffer.byteLength(signingSecret, "utf8");
    if (byteLength < 32 || byteLength > 512) {
      throw new Error(`The signing secret for operator alert webhook reference ${definition.reference} must contain 32 through 512 bytes.`);
    }
    resolved.set(definition.reference, { ...definition, signingSecret });
  }
  return resolved;
}

function responseDisposition(status: number): OperatorAlertWebhookDeliveryResult {
  if (status >= 200 && status < 300) return { disposition: "delivered", reasonCode: "webhook_accepted", httpStatus: status };
  if ([408, 425, 429].includes(status) || status >= 500) {
    return { disposition: "retry", reasonCode: "webhook_retryable_status", httpStatus: status };
  }
  return { disposition: "dead_letter", reasonCode: "webhook_rejected", httpStatus: status };
}

export class HmacOperatorAlertWebhookTransport implements OperatorAlertWebhookTransport {
  private readonly runtime: Map<string, RuntimeWebhookDefinition>;

  constructor(
    registry: OperatorAlertWebhookRegistry,
    env: NodeJS.ProcessEnv,
    private readonly fetchImplementation: typeof fetch = fetch
  ) {
    this.runtime = resolveOperatorAlertWebhookSecrets(registry, env);
  }

  async deliver(request: OperatorAlertWebhookDeliveryRequest): Promise<OperatorAlertWebhookDeliveryResult> {
    const definition = this.runtime.get(request.endpointReference);
    if (!definition) return { disposition: "dead_letter", reasonCode: "webhook_reference_unavailable", httpStatus: 0 };
    const body = stableJson(request.payload);
    const signature = createHmac("sha256", definition.signingSecret).update(body, "utf8").digest("hex");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MAXIMUM_RESPONSE_WAIT_MS);
    timeout.unref?.();
    try {
      const response = await this.fetchImplementation(definition.endpoint, {
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Yoink-Operator-Alert/1",
          "X-Yoink-Delivery-ID": request.deliveryId,
          "X-Yoink-Event-ID": request.eventId,
          "X-Yoink-Signature": `sha256=${signature}`
        },
        body
      });
      void response.body?.cancel().catch(() => undefined);
      if (response.status >= 300 && response.status < 400) {
        return { disposition: "dead_letter", reasonCode: "webhook_redirect_rejected", httpStatus: response.status };
      }
      return responseDisposition(response.status);
    } catch {
      return { disposition: "retry", reasonCode: "webhook_transport_failed", httpStatus: 0 };
    } finally {
      clearTimeout(timeout);
    }
  }
}
