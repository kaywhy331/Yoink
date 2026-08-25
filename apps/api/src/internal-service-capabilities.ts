import {
  INTERNAL_SERVICE_CAPABILITIES,
  INTERNAL_SERVICE_CAPABILITY_POLICY_VERSION,
  type InternalServiceCapability
} from "../../../packages/contracts/src/index.js";
import { stableHash } from "../../../packages/domain/src/ids.js";

const ACTOR_ID_PATTERN = /^[A-Za-z0-9_-]{3,120}$/;
const MAXIMUM_SERVICE_IDENTITIES = 64;
const CAPABILITY_SET = new Set<string>(INTERNAL_SERVICE_CAPABILITIES);

export interface InternalServiceCapabilityDefinition {
  actorRef: string;
  capability: InternalServiceCapability;
}

export interface InternalServiceCapabilityProjection {
  policyVersion: number;
  configured: boolean;
  configuredServiceCount: number;
  oneCapabilityPerService: true;
  unconfiguredServicesDenied: true;
  clientCapabilityHeadersAccepted: false;
  fingerprint: string;
  coverage: {
    delivery: number;
    eligibility: number;
    principal: number;
  };
  definitions: readonly InternalServiceCapabilityDefinition[];
}

export interface InternalServiceCapabilityRegistry extends InternalServiceCapabilityProjection {
  /** Deployment-private actor IDs. Never serialize this object into an API response. */
  assignments: Readonly<Record<string, InternalServiceCapability>>;
}

function emptyCoverage(): InternalServiceCapabilityProjection["coverage"] {
  return { delivery: 0, eligibility: 0, principal: 0 };
}

function projection(
  assignments: Readonly<Record<string, InternalServiceCapability>>,
  configured: boolean
): InternalServiceCapabilityRegistry {
  const entries = Object.entries(assignments).sort(([left], [right]) => left.localeCompare(right, "en-US"));
  const coverage = emptyCoverage();
  const definitions = entries.map(([actorId, capability]) => {
    if (capability === "internal.delivery") coverage.delivery += 1;
    if (capability === "internal.eligibility") coverage.eligibility += 1;
    if (capability === "internal.principal") coverage.principal += 1;
    return Object.freeze({
      actorRef: `service_${stableHash("yoink_internal_service_actor_ref_v1", actorId).slice(0, 24)}`,
      capability
    });
  });
  const canonical = entries.map(([actorId, capability]) => `${actorId}:${capability}`).join("\n");
  const privateAssignments = Object.assign(
    Object.create(null) as Record<string, InternalServiceCapability>,
    assignments
  );
  return Object.freeze({
    policyVersion: INTERNAL_SERVICE_CAPABILITY_POLICY_VERSION,
    configured,
    configuredServiceCount: entries.length,
    oneCapabilityPerService: true,
    unconfiguredServicesDenied: true,
    clientCapabilityHeadersAccepted: false,
    fingerprint: stableHash("yoink_internal_service_capability_registry_v1", canonical),
    coverage: Object.freeze(coverage),
    definitions: Object.freeze(definitions),
    assignments: Object.freeze(privateAssignments)
  });
}

export function loadInternalServiceCapabilityRegistry(
  value: string | undefined,
  required = false
): InternalServiceCapabilityRegistry {
  if (value === undefined) {
    if (required) {
      throw new Error("Hosted mode requires an explicit YOINK_HOSTED_SERVICE_CAPABILITIES_JSON object; use {} to deny every internal service identity.");
    }
    return projection({}, false);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("YOINK_HOSTED_SERVICE_CAPABILITIES_JSON must be an exact JSON object mapping service actor IDs to one fixed internal capability.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("YOINK_HOSTED_SERVICE_CAPABILITIES_JSON must be an exact JSON object mapping service actor IDs to one fixed internal capability.");
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > MAXIMUM_SERVICE_IDENTITIES) {
    throw new Error(`YOINK_HOSTED_SERVICE_CAPABILITIES_JSON supports at most ${MAXIMUM_SERVICE_IDENTITIES} service identities.`);
  }
  const assignments: Record<string, InternalServiceCapability> = Object.create(null) as Record<string, InternalServiceCapability>;
  for (const [actorId, rawCapability] of entries) {
    if (!ACTOR_ID_PATTERN.test(actorId)) {
      throw new Error("Every hosted service capability actor ID must contain 3 through 120 letters, numbers, underscores, or hyphens.");
    }
    if (typeof rawCapability !== "string" || !CAPABILITY_SET.has(rawCapability)) {
      throw new Error(`Hosted service ${actorId} must have exactly one of: ${INTERNAL_SERVICE_CAPABILITIES.join(", ")}.`);
    }
    assignments[actorId] = rawCapability as InternalServiceCapability;
  }
  return projection(assignments, true);
}

export function safeInternalServiceCapabilityProjection(
  registry: InternalServiceCapabilityRegistry
): InternalServiceCapabilityProjection {
  return {
    policyVersion: registry.policyVersion,
    configured: registry.configured,
    configuredServiceCount: registry.configuredServiceCount,
    oneCapabilityPerService: true,
    unconfiguredServicesDenied: true,
    clientCapabilityHeadersAccepted: false,
    fingerprint: registry.fingerprint,
    coverage: { ...registry.coverage },
    definitions: registry.definitions.map((definition) => ({ ...definition }))
  };
}

export function emptyInternalServiceCapabilityProjection(): InternalServiceCapabilityProjection {
  return safeInternalServiceCapabilityProjection(loadInternalServiceCapabilityRegistry(undefined));
}
