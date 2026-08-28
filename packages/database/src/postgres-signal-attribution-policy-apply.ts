import { createHash } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { BackgroundWorkerPrincipal } from "../../contracts/src/background-worker.js";
import type { AttributionPolicyUpdateInput } from "../../contracts/src/index.js";
import {
  attributionPolicyValidity,
  isAttributionProvider,
  normalizedArticleBaseUrl
} from "../../domain/src/attribution.js";
import { cleanText } from "../../domain/src/normalize.js";
import {
  POSTGRES_CUTOVER_CONTRACT_VERSION,
  POSTGRES_CUTOVER_DEFAULT_SCHEMA,
  type PostgresCutoverConnectionConfig,
  type PostgresCutoverDatabase
} from "./postgres-cutover.js";
import {
  applyPostgresQualifiedFunctionBoundary,
  verifyPostgresQualifiedFunctionBoundary,
  type PostgresQualifiedFunctionBoundaryReceipt,
  type PostgresQualifiedFunctionBoundarySpec
} from "./postgres-qualified-function-boundary.js";
import {
  POSTGRES_SIGNAL_SOURCE_PROVISIONING_APPLY_CONTRACT_VERSION,
  buildPostgresSignalSourceProvisioningApplyManifest,
  verifyPostgresSignalSourceProvisioningApplyBoundary,
  type PostgresSignalSourceProvisioningApplyManifest
} from "./postgres-signal-source-provisioning-apply.js";
import { POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE } from "./postgres-tenant-session.js";
import { canonicalPortabilityJson } from "./portability.js";

export const POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_CONTRACT_VERSION = 1;
export const POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_RECEIPT_TABLE =
  "yoink_signal_attribution_policy_apply_receipt";
export const POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_FUNCTION =
  "yoink_apply_signal_attribution_policy";
export const POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_CONFIRMATION =
  "ATTRIBUTION_POLICY_REPLACE_V1";

/**
 * The exact bounded set of retailers every principal's `attribution_policies`
 * rows must cover, mirroring the `RETAILERS` set in `attribution-repository.ts`
 * (the SQLite truth this boundary is replacement-parity with) — reordered
 * alphabetically so the same sequence can serve as both the canonical
 * TypeScript-side payload order and the PostgreSQL-side `FOR UPDATE ORDER BY
 * retailer_id` lock order (see the row-lock comment in the generated
 * function source below).
 */
export const POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS = Object.freeze([
  "amazon", "bestbuy", "booksamillion", "disney", "fanatics", "kohls", "macys",
  "pbandai", "pokemoncenter", "ravensburger", "riot", "target", "walmart"
] as const);

/** Mirrors `AttributionProvider` in `contracts/src/index.ts`. */
export const POSTGRES_SIGNAL_ATTRIBUTION_POLICY_PROVIDERS = Object.freeze([
  "canonical", "howl", "amazon_associates"
] as const);

const MAXIMUM_REQUEST_PAYLOAD_BYTES = 65_536;
const SAFE_SCHEMA = /^[a-z][a-z0-9_]{2,62}$/;
const SAFE_ROLE_NAMESPACE = /^[a-z][a-z0-9_]{2,31}$/;
const REQUEST_ID = /^attribution_policy_replace_[a-f0-9]{32}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const FUNCTION_ARGUMENT_TYPES = Object.freeze([
  "text", "text", "text", "text", "text"
] as const);
const FUNCTION_ARGUMENTS_SQL = `
  expected_tenant_id TEXT, expected_user_id TEXT, operation_name TEXT,
  request_id TEXT, request_payload_json TEXT
`;
const FUNCTION_RESULT_TYPE = "TABLE(result_json text)";
const PROTECTED_TENANT_TABLES = Object.freeze([
  "attribution_policies",
  "audit_events",
  "outbox_events"
] as const);
const MUTATION_TABLES = Object.freeze([...PROTECTED_TENANT_TABLES] as const);

export type PostgresSignalAttributionPolicyOperation = "replace_attribution_policies";

export interface PostgresSignalAttributionPolicyReplaceEntry {
  retailerId: string;
  enabled: boolean;
  provider: typeof POSTGRES_SIGNAL_ATTRIBUTION_POLICY_PROVIDERS[number];
  publisherSlug: string;
  articleBaseUrl: string;
  associateTag: string;
}

export interface PostgresSignalAttributionPolicyReplacePayload {
  policies: PostgresSignalAttributionPolicyReplaceEntry[];
  confirmation: typeof POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_CONFIRMATION;
}

type PostgresSignalSourceProvisioningPredecessor = Pick<
  PostgresSignalSourceProvisioningApplyManifest,
  "schemaName" | "fingerprint" | "sourceProvisioningRoleNamespace"
>;

export interface PostgresSignalAttributionPolicyApplyManifest {
  contractVersion: 1;
  cutoverContractVersion: 3;
  sourceProvisioningApplyContractVersion: 1;
  schemaName: string;
  attributionPolicyRoleNamespace: string;
  sourceProvisioningApplyManifestFingerprint: string;
  predecessorManifest: PostgresSignalSourceProvisioningPredecessor;
  attributionPolicyRole: {
    kind: "signal_attribution_policy_apply_boundary";
    name: string;
    functionName: typeof POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_FUNCTION;
    functionArgumentTypes: string[];
    protectedTenantTableNames: string[];
    mutationTableNames: string[];
    login: false;
    inherit: false;
    bypassRls: false;
    directTableAccess: false;
  };
  operationCount: 1;
  supportedRetailers: typeof POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS;
  supportedRetailerCount: 13;
  providerAllowlist: typeof POSTGRES_SIGNAL_ATTRIBUTION_POLICY_PROVIDERS;
  protectedTenantTableCount: 3;
  forcedRlsTableCount: 3;
  mutationTableCount: 3;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  serverBoundPrincipalLookup: true;
  provisionedRowExistenceRequired: true;
  completeRetailerSetRequired: true;
  fixedRetailerOrderNormalization: true;
  rowLevelLockSerialization: true;
  writerLockProtocolConsumed: false;
  deterministicRequestIdentity: true;
  immutableAuditedReplay: true;
  zeroWriteWhenUnchanged: true;
  missingRowFailsClosed: true;
  atomicReplaceAuditOutbox: true;
  databaseOwnedTimestamps: true;
  sqliteValidationParity: true;
  sourceTrustWriterParity: true;
  sourceStatusWriterParity: true;
  sourceSyncWriterParity: true;
  catalogImportWriterParity: true;
  connectionProvisioningWriterParity: true;
  sourceWriterParity: true;
  retailerQualificationWriterParity: true;
  missionPolicyWriterParity: true;
  settingsWriterParity: false;
  configurationWriterParity: false;
  reservationWriterParity: true;
  attributionPolicyParity: true;
  writerLockProtocolParity: false;
  activePrincipalCount: 0;
  runtimeAuthority: false;
  fingerprint: string;
}

export interface PostgresSignalAttributionPolicyCapabilityProjection {
  contractVersion: 1;
  cutoverContractVersion: 3;
  sourceProvisioningApplyContractVersion: 1;
  deterministicManifestImplemented: true;
  atomicQualificationApplyImplemented: true;
  exactEffectivePrivilegeVerification: true;
  immutableBoundaryCatalogFingerprint: true;
  qualificationSuiteParity: true;
  noLogin: true;
  noInherit: true;
  noBypassRls: true;
  securityDefinerRoutineVerified: true;
  phase: "qualified_inactive";
  serverBoundPrincipalLookup: true;
  provisionedRowExistenceRequired: true;
  completeRetailerSetRequired: true;
  fixedRetailerOrderNormalization: true;
  rowLevelLockSerialization: true;
  writerLockProtocolConsumed: false;
  deterministicRequestIdentity: true;
  immutableAuditedReplay: true;
  zeroWriteWhenUnchanged: true;
  missingRowFailsClosed: true;
  atomicReplaceAuditOutbox: true;
  databaseOwnedTimestamps: true;
  sqliteValidationParity: true;
  sourceTrustWriterParity: true;
  sourceStatusWriterParity: true;
  sourceSyncWriterParity: true;
  catalogImportWriterParity: true;
  connectionProvisioningWriterParity: true;
  sourceWriterParity: true;
  retailerQualificationWriterParity: true;
  missionPolicyWriterParity: true;
  settingsWriterParity: false;
  configurationWriterParity: false;
  reservationWriterParity: true;
  attributionPolicyParity: true;
  writerLockProtocolParity: false;
  operationCount: 1;
  supportedRetailerCount: 13;
  protectedTenantTableCount: 3;
  forcedRlsTableCount: 3;
  mutationTableCount: 3;
  directTableGrantCount: 0;
  functionGrantCount: 1;
  activePrincipalCount: 0;
  activeRuntimeRoleApplied: false;
  mutationAuthority: true;
  sharedCatalogMutationAuthority: false;
  actionAuthority: false;
  runtimeAuthority: false;
  productionReady: false;
  roleTemplateFingerprint: string;
}

export interface PostgresSignalAttributionPolicyApplyResult {
  contractVersion: 1;
  operation: PostgresSignalAttributionPolicyOperation;
  requestId: string;
  requestFingerprint: string;
  outcome: "applied" | "unchanged" | "already_applied";
  mutationApplied: boolean;
  idempotentReplay: boolean;
  mutationStatementCount: number;
  mutationRowCount: number;
  changedRetailerCount: number;
  changedRetailers: string[];
  policiesMutated: boolean;
  auditMutated: boolean;
  outboxMutated: boolean;
  policies: PostgresSignalAttributionPolicyReplaceEntry[];
  supportedRetailerCount: 13;
  attributionPolicyParity: true;
  writerLockProtocolParity: false;
  mutationAuthority: true;
  sharedCatalogMutationAuthority: false;
  actionAuthority: false;
  runtimeAuthority: false;
}

export interface NodePostgresSignalAttributionPolicyApplyDatabaseOptions {
  maxConnections?: 1 | 2;
}

interface FunctionRow extends Record<string, unknown> {
  resultJson: string;
}

let cachedCapabilityProjection:
Readonly<PostgresSignalAttributionPolicyCapabilityProjection> | null = null;

export class PostgresSignalAttributionPolicyApplyQualificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSignalAttributionPolicyApplyQualificationError";
  }
}

function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function relation(schema: string, name: string): string {
  return `${identifier(schema)}.${identifier(name)}`;
}

function safeSchema(value: string): string {
  const normalized = String(value ?? POSTGRES_CUTOVER_DEFAULT_SCHEMA).trim();
  if (!SAFE_SCHEMA.test(normalized) || normalized === "public" || normalized.startsWith("pg_")) {
    throw new PostgresSignalAttributionPolicyApplyQualificationError(
      "The PostgreSQL attribution-policy schema is invalid."
    );
  }
  return normalized;
}

function safeNamespace(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!SAFE_ROLE_NAMESPACE.test(normalized)) {
    throw new PostgresSignalAttributionPolicyApplyQualificationError(
      "The PostgreSQL attribution-policy role namespace is invalid."
    );
  }
  return normalized;
}

function roleName(namespace: string): string {
  const value = `${namespace}_attribution_policy`;
  if (value.length > 63) {
    throw new PostgresSignalAttributionPolicyApplyQualificationError(
      "The PostgreSQL attribution-policy role name exceeds PostgreSQL's limit."
    );
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalPortabilityJson(value)).digest("hex");
}

function collectRoleNamespaces(value: unknown, namespaces = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return namespaces;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key.endsWith("RoleNamespace") && typeof entry === "string") namespaces.add(entry);
    else if (entry && typeof entry === "object") collectRoleNamespaces(entry, namespaces);
  }
  return namespaces;
}

function stableHashInput(parts: string[]): string {
  return parts.map((part) => `${Buffer.byteLength(part, "utf8")}:${part}`).join("|");
}

/**
 * Normalizes and validates a caller-supplied set of attribution-policy
 * update inputs into the exact, canonically ordered (alphabetical by
 * retailer id) payload shape the PostgreSQL boundary function accepts.
 *
 * This reuses the exact same domain validation the SQLite
 * `AttributionRepository.replacePolicies` truth uses —
 * `isAttributionProvider`, `normalizedArticleBaseUrl`, and
 * `attributionPolicyValidity` — so an enabled policy that would be
 * rejected there is rejected here too, before the request ever reaches
 * the database. `normalizedArticleBaseUrl` in particular performs full
 * `URL`-object parsing (protocol/credential/fragment/query rejection,
 * trailing-slash normalization) that is impractical to reproduce
 * byte-for-byte in PL/pgSQL; the database function instead re-checks only
 * the *structural* invariants a normalized value must satisfy (a
 * credential-free `https://.../` shape, pattern-bounded slug/tag text,
 * byte-length ceilings) — see `signalAttributionPolicyApplyFunctionSource`
 * for the exact split. A caller that bypasses this TypeScript layer and
 * invokes the security-definer function directly still cannot smuggle a
 * structurally invalid policy past it, even though only this layer
 * enforces full URL semantics.
 */
export function normalizedPostgresSignalAttributionPolicyReplacePayload(
  entries: readonly AttributionPolicyUpdateInput[]
): PostgresSignalAttributionPolicyReplacePayload {
  if (!Array.isArray(entries) || entries.length !== POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS.length) {
    throw new PostgresSignalAttributionPolicyApplyQualificationError(
      "Submit one attribution policy for every supported retailer."
    );
  }
  // Mirrors `AttributionRepository.replacePolicies` exactly: validate each
  // entry independently first (duplicates are not rejected here — a
  // resubmitted retailer id is simply a valid entry, same as SQLite's
  // `input.map(...)` pass), then check completeness once over the whole
  // set, then (the one deliberate departure from SQLite, which preserves
  // caller order) re-key into the fixed alphabetical order this boundary's
  // request identity and row locking both depend on.
  const normalized = entries.map((raw) => {
    const retailerId = cleanText(raw?.retailerId, 60).toLocaleLowerCase("en-US");
    if (!(POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS as readonly string[]).includes(retailerId)
      || typeof raw?.enabled !== "boolean"
      || !isAttributionProvider(raw?.provider)) {
      throw new PostgresSignalAttributionPolicyApplyQualificationError(
        "Every attribution policy needs a supported retailer, enabled state, and provider."
      );
    }
    const value: PostgresSignalAttributionPolicyReplaceEntry = {
      retailerId,
      enabled: raw.enabled,
      provider: raw.provider,
      publisherSlug: cleanText(raw.publisherSlug, 80).toLocaleLowerCase("en-US"),
      articleBaseUrl: raw.articleBaseUrl ? normalizedArticleBaseUrl(raw.articleBaseUrl) : "",
      associateTag: cleanText(raw.associateTag, 80)
    };
    const validity = attributionPolicyValidity(value);
    if (value.enabled && !validity.valid) {
      throw new PostgresSignalAttributionPolicyApplyQualificationError(`${retailerId}: ${validity.reason}`);
    }
    return value;
  });
  if (new Set(normalized.map((policy) => policy.retailerId)).size
    !== POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS.length) {
    throw new PostgresSignalAttributionPolicyApplyQualificationError(
      "Every supported retailer must appear exactly once."
    );
  }
  const byRetailer = new Map(normalized.map((policy) => [policy.retailerId, policy] as const));
  return {
    policies: POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS.map((retailerId) => {
      const entry = byRetailer.get(retailerId);
      if (!entry) {
        throw new PostgresSignalAttributionPolicyApplyQualificationError(
          "A supported retailer's normalized policy is unexpectedly missing."
        );
      }
      return entry;
    }),
    confirmation: POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_CONFIRMATION
  };
}

/**
 * Derives the deterministic request id from the principal and the complete
 * normalized payload. The PostgreSQL function only validates this id's
 * *format* (`^attribution_policy_replace_[a-f0-9]{32}$`) rather than
 * re-deriving and comparing it — the same choice
 * `postgres-signal-mission-policy-apply.ts` and
 * `postgres-signal-constraint-config-apply.ts` make, since faithfully
 * reproducing `canonicalPortabilityJson`'s recursive key-sorting in
 * PL/pgSQL for a 13-element nested array is impractical. Replay safety is
 * instead provided by `requestFingerprint`, which the database computes
 * itself from the jsonb-normalized request payload text and checks against
 * every replayed request with the same id (see the generated function
 * source) — a caller that reuses a request id with a different payload is
 * still rejected.
 */
export function buildPostgresSignalAttributionPolicyReplaceRequestId(
  principal: Pick<BackgroundWorkerPrincipal, "tenantId" | "userId">,
  payload: PostgresSignalAttributionPolicyReplacePayload
): string {
  const parts = [
    "postgres-signal-attribution-policy-replace-request-v1",
    String(principal?.tenantId ?? ""),
    String(principal?.userId ?? ""),
    canonicalPortabilityJson(payload?.policies ?? []),
    String(payload?.confirmation ?? "")
  ];
  return `attribution_policy_replace_${createHash("sha256").update(stableHashInput(parts)).digest("hex").slice(0, 32)}`;
}

export function buildPostgresSignalAttributionPolicyApplyManifest(
  predecessorManifest = buildPostgresSignalSourceProvisioningApplyManifest(),
  requestedRoleNamespace = "yoink_attribution_policy_qual"
): PostgresSignalAttributionPolicyApplyManifest {
  const schemaName = safeSchema(predecessorManifest.schemaName);
  const attributionPolicyRoleNamespace = safeNamespace(requestedRoleNamespace);
  if (collectRoleNamespaces(predecessorManifest).has(attributionPolicyRoleNamespace)) {
    throw new PostgresSignalAttributionPolicyApplyQualificationError(
      "The PostgreSQL attribution-policy role namespace must be independent."
    );
  }
  const withoutFingerprint: Omit<PostgresSignalAttributionPolicyApplyManifest, "fingerprint"> = {
    contractVersion: 1,
    cutoverContractVersion: POSTGRES_CUTOVER_CONTRACT_VERSION,
    sourceProvisioningApplyContractVersion:
      POSTGRES_SIGNAL_SOURCE_PROVISIONING_APPLY_CONTRACT_VERSION,
    schemaName,
    attributionPolicyRoleNamespace,
    sourceProvisioningApplyManifestFingerprint: predecessorManifest.fingerprint,
    predecessorManifest,
    attributionPolicyRole: {
      kind: "signal_attribution_policy_apply_boundary",
      name: roleName(attributionPolicyRoleNamespace),
      functionName: POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_FUNCTION,
      functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
      protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
      mutationTableNames: [...MUTATION_TABLES],
      login: false,
      inherit: false,
      bypassRls: false,
      directTableAccess: false
    },
    operationCount: 1,
    supportedRetailers: POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS,
    supportedRetailerCount: 13,
    providerAllowlist: POSTGRES_SIGNAL_ATTRIBUTION_POLICY_PROVIDERS,
    protectedTenantTableCount: 3,
    forcedRlsTableCount: 3,
    mutationTableCount: 3,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    serverBoundPrincipalLookup: true,
    provisionedRowExistenceRequired: true,
    completeRetailerSetRequired: true,
    fixedRetailerOrderNormalization: true,
    rowLevelLockSerialization: true,
    writerLockProtocolConsumed: false,
    deterministicRequestIdentity: true,
    immutableAuditedReplay: true,
    zeroWriteWhenUnchanged: true,
    missingRowFailsClosed: true,
    atomicReplaceAuditOutbox: true,
    databaseOwnedTimestamps: true,
    sqliteValidationParity: true,
    sourceTrustWriterParity: true,
    sourceStatusWriterParity: true,
    sourceSyncWriterParity: true,
    catalogImportWriterParity: true,
    connectionProvisioningWriterParity: true,
    sourceWriterParity: true,
    retailerQualificationWriterParity: true,
    missionPolicyWriterParity: true,
    settingsWriterParity: false,
    configurationWriterParity: false,
    reservationWriterParity: true,
    attributionPolicyParity: true,
    writerLockProtocolParity: false,
    activePrincipalCount: 0,
    runtimeAuthority: false
  };
  return { ...withoutFingerprint, fingerprint: fingerprint(withoutFingerprint) };
}

export function signalAttributionPolicyApplyFunctionSource(
  manifest = buildPostgresSignalAttributionPolicyApplyManifest()
): string {
  const retailersSql = POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS
    .map((retailerId) => `'${retailerId}'`)
    .join(", ");
  return `
DECLARE
  fixed_retailers CONSTANT TEXT[] := ARRAY[${retailersSql}];
  request_payload JSONB;
  request_fingerprint_value TEXT;
  resolved_tenant_id TEXT;
  resolved_user_id TEXT;
  resolved_principal_count BIGINT;
  audit_id_value TEXT;
  outbox_id_value TEXT;
  audit_count BIGINT;
  outbox_count BIGINT;
  replay_record RECORD;
  existing_count BIGINT;
  current_policies_value JSONB;
  submitted_policies_value JSONB;
  changed_retailers_value JSONB;
  changed_retailer_count_value BIGINT;
  policies_result_value JSONB;
  mutation_timestamp TEXT;
  mutation_row_count_value BIGINT := 0;
  result_value JSONB;
  audit_data_value JSONB;
  outbox_payload_value JSONB;
  affected_rows BIGINT;
BEGIN
  IF pg_catalog.octet_length(expected_tenant_id) NOT BETWEEN 1 AND 200
    OR pg_catalog.octet_length(expected_user_id) NOT BETWEEN 1 AND 200
    OR operation_name <> 'replace_attribution_policies'
    OR request_id !~ '^attribution_policy_replace_[a-f0-9]{32}$'
    OR pg_catalog.octet_length(request_payload_json) > ${MAXIMUM_REQUEST_PAYLOAD_BYTES} THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal attribution-policy request is invalid';
  END IF;
  BEGIN
    request_payload := request_payload_json::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal attribution-policy payload is invalid JSON';
  END;
  IF pg_catalog.jsonb_typeof(request_payload) IS DISTINCT FROM 'object'
    OR request_payload - ARRAY['policies', 'confirmation']::text[] IS DISTINCT FROM '{}'::jsonb
    OR (SELECT COUNT(*) FROM pg_catalog.jsonb_object_keys(request_payload)) <> 2
    OR pg_catalog.jsonb_typeof(request_payload->'confirmation') IS DISTINCT FROM 'string'
    OR request_payload->>'confirmation' <> '${POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_CONFIRMATION}'
    OR pg_catalog.jsonb_typeof(request_payload->'policies') IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_array_length(request_payload->'policies') <> 13 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal attribution-policy payload shape is invalid';
  END IF;

  -- Structural shape: exactly the six known fields, positioned at the one
  -- fixed alphabetical retailer slot the client-side normalization layer
  -- (normalizedPostgresSignalAttributionPolicyReplacePayload) always
  -- produces. A caller that bypasses that layer and submits an out-of-order,
  -- duplicated, or incomplete retailer set fails this positional equality
  -- check the same as an unsupported retailer id would.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(request_payload->'policies')
      WITH ORDINALITY AS entry(value, ordinality)
    WHERE pg_catalog.jsonb_typeof(entry.value) <> 'object'
      OR entry.value - ARRAY[
        'retailerId', 'enabled', 'provider', 'publisherSlug', 'articleBaseUrl', 'associateTag'
      ]::text[] IS DISTINCT FROM '{}'::jsonb
      OR entry.value->>'retailerId' IS DISTINCT FROM fixed_retailers[entry.ordinality::int]
      OR pg_catalog.jsonb_typeof(entry.value->'enabled') IS DISTINCT FROM 'boolean'
      OR pg_catalog.jsonb_typeof(entry.value->'provider') IS DISTINCT FROM 'string'
      OR entry.value->>'provider' NOT IN ('canonical', 'howl', 'amazon_associates')
      OR pg_catalog.jsonb_typeof(entry.value->'publisherSlug') IS DISTINCT FROM 'string'
      OR pg_catalog.octet_length(entry.value->>'publisherSlug') > 80
      OR pg_catalog.jsonb_typeof(entry.value->'articleBaseUrl') IS DISTINCT FROM 'string'
      OR pg_catalog.octet_length(entry.value->>'articleBaseUrl') > 4096
      OR pg_catalog.jsonb_typeof(entry.value->'associateTag') IS DISTINCT FROM 'string'
      OR pg_catalog.octet_length(entry.value->>'associateTag') > 80
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'signal attribution-policy entry shape is invalid';
  END IF;

  -- Structural translation of \`attributionPolicyValidity\` (domain/src/attribution.ts):
  -- a disabled policy or a 'canonical' policy is always valid, so only an
  -- *enabled* 'howl' or 'amazon_associates' policy is checked further here.
  -- This reproduces the pattern-shaped rules exactly (SLUG_PATTERN,
  -- TAG_PATTERN, the amazon-only retailer restriction, and a structural
  -- https://.../ shape for the article base URL) but does not reproduce
  -- \`normalizedArticleBaseUrl\`'s full URL-object semantics (no
  -- credentials, no fragment, no query string, exact trailing-slash
  -- normalization) — those are TypeScript-only, enforced before this
  -- function is ever called (see
  -- \`normalizedPostgresSignalAttributionPolicyReplacePayload\`).
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(request_payload->'policies') AS entry(value)
    WHERE (entry.value->>'enabled')::boolean
      AND (
        (entry.value->>'provider' = 'howl' AND (
          entry.value->>'publisherSlug' !~ '^[a-z0-9][a-z0-9_-]{1,79}$'
          OR entry.value->>'articleBaseUrl' = ''
          OR entry.value->>'articleBaseUrl' !~ '^https://[^\\s#]+/$'
        ))
        OR (entry.value->>'provider' = 'amazon_associates' AND (
          entry.value->>'retailerId' <> 'amazon'
          OR entry.value->>'associateTag' !~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$'
        ))
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal attribution-policy enabled policy fails validity';
  END IF;

  SELECT MIN(principal.tenant_id), MIN(principal.user_id), COUNT(*)
    INTO resolved_tenant_id, resolved_user_id, resolved_principal_count
  FROM ${relation(manifest.schemaName, POSTGRES_TENANT_SESSION_PRINCIPAL_TABLE)} AS principal
  WHERE principal.principal_role = session_user::text AND principal.active = TRUE;
  IF resolved_principal_count <> 1 OR resolved_tenant_id IS NULL OR resolved_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'tenant session principal is not active';
  END IF;
  IF resolved_tenant_id <> expected_tenant_id OR resolved_user_id <> expected_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'tenant session principal does not match the expected authenticated principal';
  END IF;

  request_fingerprint_value := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    request_payload::text, 'UTF8'
  )), 'hex');
  audit_id_value := 'audit_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(
      'postgres_signal_attribution_policy_request_v1|' || resolved_tenant_id || '|' ||
      resolved_user_id || '|' || request_id, 'UTF8'
    )
  ), 'hex'), 1, 32);
  outbox_id_value := 'outbox_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to('postgres_signal_attribution_policy_outbox_v1|' || audit_id_value, 'UTF8')
  ), 'hex'), 1, 32);

  SELECT COUNT(*) INTO audit_count
  FROM ${relation(manifest.schemaName, "audit_events")} AS audit
  WHERE audit.id = audit_id_value;
  SELECT COUNT(*) INTO outbox_count
  FROM ${relation(manifest.schemaName, "outbox_events")} AS outbox
  WHERE outbox.id = outbox_id_value;
  IF audit_count <> outbox_count OR audit_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal attribution-policy request graph is partial';
  END IF;
  IF audit_count = 1 THEN
    SELECT audit.tenant_id, audit.user_id, audit.correlation_id,
           audit.event_type, audit.reason_code, audit.message,
           audit.data_json::jsonb AS audit_data, audit.created_at AS audit_created_at,
           outbox.tenant_id AS outbox_tenant_id, outbox.aggregate_type,
           outbox.aggregate_id, outbox.event_type AS outbox_event_type,
           outbox.payload_json::jsonb AS outbox_payload,
           outbox.created_at AS outbox_created_at
      INTO STRICT replay_record
    FROM ${relation(manifest.schemaName, "audit_events")} AS audit
    JOIN ${relation(manifest.schemaName, "outbox_events")} AS outbox
      ON outbox.id = outbox_id_value
    WHERE audit.id = audit_id_value;
    IF replay_record.tenant_id <> resolved_tenant_id
      OR replay_record.user_id <> resolved_user_id
      OR replay_record.correlation_id <> resolved_user_id
      OR replay_record.event_type <> 'attribution_policies_replaced'
      OR replay_record.reason_code <> 'saved'
      OR replay_record.message <> 'Affiliate-routing policies were validated and saved for every supported retailer.'
      OR replay_record.audit_data->>'contractVersion' <> '1'
      OR replay_record.audit_data->>'operation' <> operation_name
      OR replay_record.audit_data->>'requestId' <> request_id
      OR replay_record.audit_data->>'requestFingerprint' <> request_fingerprint_value
      OR pg_catalog.jsonb_typeof(replay_record.audit_data->'result') IS DISTINCT FROM 'object'
      OR replay_record.outbox_tenant_id <> resolved_tenant_id
      OR replay_record.aggregate_type <> 'attribution_policy_set'
      OR replay_record.aggregate_id <> resolved_user_id
      OR replay_record.outbox_event_type <> 'attribution_policies_replaced'
      OR replay_record.outbox_payload->>'auditId' <> audit_id_value
      OR replay_record.outbox_payload->>'correlationId' <> resolved_user_id
      OR replay_record.outbox_payload->>'reasonCode' <> 'saved'
      OR replay_record.outbox_payload->>'message' <> replay_record.message
      OR replay_record.outbox_payload->'data' IS DISTINCT FROM replay_record.audit_data
      OR replay_record.audit_created_at <> replay_record.outbox_created_at THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal attribution-policy replay graph changed';
    END IF;
    RETURN QUERY SELECT (replay_record.audit_data->'result' || pg_catalog.jsonb_build_object(
      'outcome', 'already_applied',
      'mutationApplied', FALSE,
      'idempotentReplay', TRUE,
      'mutationStatementCount', 0,
      'mutationRowCount', 0,
      'changedRetailerCount', 0,
      'changedRetailers', '[]'::jsonb,
      'policiesMutated', FALSE,
      'auditMutated', FALSE,
      'outboxMutated', FALSE
    ))::text;
    RETURN;
  END IF;

  -- attribution_policies is not one of the five domains the shared
  -- writer-lock protocol function guards — its scopes are source,
  -- retailer_qualification, settings, mission_policy, and spend only. This
  -- boundary therefore never calls that function, and instead serializes
  -- concurrent replacements the ordinary PostgreSQL way: a
  -- SELECT ... FOR UPDATE ORDER BY retailer_id over exactly the 13 rows
  -- this call touches. Every call — including a concurrent one for the same
  -- principal — locks those rows in the same fixed alphabetical order (the
  -- same order fixed_retailers and the normalized payload already use),
  -- so two concurrent replacements for one principal block in a consistent
  -- order rather than deadlock; different principals never contend, since
  -- the WHERE clause is already tenant/user scoped.
  SELECT COUNT(*),
         pg_catalog.jsonb_object_agg(locked.retailer_id, pg_catalog.jsonb_build_object(
           'enabled', locked.enabled = 1,
           'provider', locked.provider,
           'publisherSlug', locked.publisher_slug,
           'articleBaseUrl', locked.article_base_url,
           'associateTag', locked.associate_tag
         ))
    INTO existing_count, current_policies_value
  FROM (
    SELECT policy.retailer_id, policy.enabled, policy.provider,
           policy.publisher_slug, policy.article_base_url, policy.associate_tag
    FROM ${relation(manifest.schemaName, "attribution_policies")} AS policy
    WHERE policy.tenant_id = resolved_tenant_id AND policy.user_id = resolved_user_id
      AND policy.retailer_id = ANY(fixed_retailers)
    ORDER BY policy.retailer_id
    FOR UPDATE OF policy
  ) AS locked;
  IF existing_count <> 13 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'signal attribution-policy rows are not fully provisioned';
  END IF;

  SELECT pg_catalog.jsonb_object_agg(submitted."retailerId", pg_catalog.jsonb_build_object(
      'enabled', submitted.enabled,
      'provider', submitted.provider,
      'publisherSlug', submitted."publisherSlug",
      'articleBaseUrl', submitted."articleBaseUrl",
      'associateTag', submitted."associateTag"
    ))
    INTO submitted_policies_value
  FROM pg_catalog.jsonb_to_recordset(request_payload->'policies') AS submitted(
      "retailerId" text, "enabled" boolean, "provider" text,
      "publisherSlug" text, "articleBaseUrl" text, "associateTag" text
    );

  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'retailerId', retailer.value,
      'enabled', (submitted_policies_value->retailer.value->>'enabled')::boolean,
      'provider', submitted_policies_value->retailer.value->>'provider',
      'publisherSlug', submitted_policies_value->retailer.value->>'publisherSlug',
      'articleBaseUrl', submitted_policies_value->retailer.value->>'articleBaseUrl',
      'associateTag', submitted_policies_value->retailer.value->>'associateTag'
    ) ORDER BY retailer.value)
    INTO policies_result_value
  FROM pg_catalog.unnest(fixed_retailers) AS retailer(value);

  SELECT COALESCE(pg_catalog.jsonb_agg(retailer.value ORDER BY retailer.value), '[]'::jsonb)
    INTO changed_retailers_value
  FROM pg_catalog.unnest(fixed_retailers) AS retailer(value)
  WHERE (submitted_policies_value->retailer.value) IS DISTINCT FROM (current_policies_value->retailer.value);
  changed_retailer_count_value := pg_catalog.jsonb_array_length(changed_retailers_value);

  mutation_timestamp := pg_catalog.to_char(
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  -- An identical submitted set is a true zero-write success: no row is
  -- touched, and no audit or outbox record is appended.
  IF changed_retailer_count_value = 0 THEN
    RETURN QUERY SELECT pg_catalog.jsonb_build_object(
      'contractVersion', 1,
      'operation', operation_name,
      'requestId', request_id,
      'requestFingerprint', request_fingerprint_value,
      'outcome', 'unchanged',
      'mutationApplied', FALSE,
      'idempotentReplay', FALSE,
      'mutationStatementCount', 0,
      'mutationRowCount', 0,
      'changedRetailerCount', 0,
      'changedRetailers', '[]'::jsonb,
      'policiesMutated', FALSE,
      'auditMutated', FALSE,
      'outboxMutated', FALSE,
      'policies', policies_result_value,
      'supportedRetailerCount', 13,
      'attributionPolicyParity', TRUE,
      'writerLockProtocolParity', FALSE,
      'mutationAuthority', TRUE,
      'sharedCatalogMutationAuthority', FALSE,
      'actionAuthority', FALSE,
      'runtimeAuthority', FALSE
    )::text;
    RETURN;
  END IF;

  UPDATE ${relation(manifest.schemaName, "attribution_policies")} AS policy
  SET enabled = CASE WHEN submitted.enabled THEN 1 ELSE 0 END,
      provider = submitted.provider,
      publisher_slug = submitted."publisherSlug",
      article_base_url = submitted."articleBaseUrl",
      associate_tag = submitted."associateTag",
      updated_at = mutation_timestamp
  FROM pg_catalog.jsonb_to_recordset(request_payload->'policies') AS submitted(
      "retailerId" text, "enabled" boolean, "provider" text,
      "publisherSlug" text, "articleBaseUrl" text, "associateTag" text
    )
  WHERE policy.tenant_id = resolved_tenant_id
    AND policy.user_id = resolved_user_id
    AND policy.retailer_id = submitted."retailerId"
    AND (
      policy.enabled <> (CASE WHEN submitted.enabled THEN 1 ELSE 0 END)
      OR policy.provider <> submitted.provider
      OR policy.publisher_slug <> submitted."publisherSlug"
      OR policy.article_base_url <> submitted."articleBaseUrl"
      OR policy.associate_tag <> submitted."associateTag"
    );
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> changed_retailer_count_value THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'signal attribution-policy update was ambiguous';
  END IF;
  mutation_row_count_value := affected_rows;

  result_value := pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'operation', operation_name,
    'requestId', request_id,
    'requestFingerprint', request_fingerprint_value,
    'outcome', 'applied',
    'mutationApplied', TRUE,
    'idempotentReplay', FALSE,
    'mutationStatementCount', 3,
    'mutationRowCount', mutation_row_count_value + 2,
    'changedRetailerCount', changed_retailer_count_value,
    'changedRetailers', changed_retailers_value,
    'policiesMutated', TRUE,
    'auditMutated', TRUE,
    'outboxMutated', TRUE,
    'policies', policies_result_value,
    'supportedRetailerCount', 13,
    'attributionPolicyParity', TRUE,
    'writerLockProtocolParity', FALSE,
    'mutationAuthority', TRUE,
    'sharedCatalogMutationAuthority', FALSE,
    'actionAuthority', FALSE,
    'runtimeAuthority', FALSE
  );
  audit_data_value := pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'operation', operation_name,
    'requestId', request_id,
    'requestFingerprint', request_fingerprint_value,
    'changedRetailerCount', changed_retailer_count_value,
    'changedRetailers', changed_retailers_value,
    'result', result_value
  );
  outbox_payload_value := pg_catalog.jsonb_build_object(
    'auditId', audit_id_value,
    'correlationId', resolved_user_id,
    'reasonCode', 'saved',
    'message', 'Affiliate-routing policies were validated and saved for every supported retailer.',
    'data', audit_data_value
  );
  INSERT INTO ${relation(manifest.schemaName, "audit_events")}(
    id, tenant_id, user_id, correlation_id, event_type,
    reason_code, message, data_json, created_at
  ) VALUES (
    audit_id_value, resolved_tenant_id, resolved_user_id, resolved_user_id,
    'attribution_policies_replaced', 'saved',
    'Affiliate-routing policies were validated and saved for every supported retailer.',
    audit_data_value::text, mutation_timestamp
  );
  INSERT INTO ${relation(manifest.schemaName, "outbox_events")}(
    id, tenant_id, aggregate_type, aggregate_id, event_type,
    payload_json, created_at, delivered_at
  ) VALUES (
    outbox_id_value, resolved_tenant_id, 'attribution_policy_set', resolved_user_id,
    'attribution_policies_replaced', outbox_payload_value::text, mutation_timestamp, ''
  );

  RETURN QUERY SELECT result_value::text;
END
`;
}

function boundarySpec(
  manifest: PostgresSignalAttributionPolicyApplyManifest
): PostgresQualifiedFunctionBoundarySpec {
  return {
    boundaryKind: "signal_attribution_policy_apply",
    schemaName: manifest.schemaName,
    roleName: manifest.attributionPolicyRole.name,
    functionName: POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_FUNCTION,
    functionArgumentsSql: FUNCTION_ARGUMENTS_SQL,
    functionArgumentTypes: [...FUNCTION_ARGUMENT_TYPES],
    functionResultType: FUNCTION_RESULT_TYPE,
    functionSource: signalAttributionPolicyApplyFunctionSource(manifest),
    receiptTableName: POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_RECEIPT_TABLE,
    receiptGuardFunctionName: "yoink_guard_signal_attribution_policy_apply_receipt",
    receiptTriggerName: "yoink_signal_attribution_policy_apply_receipt_immutable",
    manifestFingerprint: manifest.fingerprint,
    predecessorFingerprint: manifest.sourceProvisioningApplyManifestFingerprint,
    protectedTenantTableNames: [...PROTECTED_TENANT_TABLES],
    mutationTableNames: [...MUTATION_TABLES],
    metadata: {
      contractVersion: 1,
      cutoverContractVersion: 3,
      sourceProvisioningApplyContractVersion: 1,
      operationCount: 1,
      supportedRetailers: POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS,
      supportedRetailerCount: 13,
      providerAllowlist: POSTGRES_SIGNAL_ATTRIBUTION_POLICY_PROVIDERS,
      serverBoundPrincipalLookup: true,
      provisionedRowExistenceRequired: true,
      completeRetailerSetRequired: true,
      fixedRetailerOrderNormalization: true,
      rowLevelLockSerialization: true,
      writerLockProtocolConsumed: false,
      deterministicRequestIdentity: true,
      immutableAuditedReplay: true,
      zeroWriteWhenUnchanged: true,
      missingRowFailsClosed: true,
      atomicReplaceAuditOutbox: true,
      databaseOwnedTimestamps: true,
      sqliteValidationParity: true,
      sourceTrustWriterParity: true,
      sourceStatusWriterParity: true,
      sourceSyncWriterParity: true,
      catalogImportWriterParity: true,
      connectionProvisioningWriterParity: true,
      sourceWriterParity: true,
      retailerQualificationWriterParity: true,
      missionPolicyWriterParity: true,
      settingsWriterParity: false,
      configurationWriterParity: false,
      reservationWriterParity: true,
      attributionPolicyParity: true,
      writerLockProtocolParity: false,
      sharedCatalogMutationAuthority: false,
      actionAuthority: false,
      runtimeAuthority: false
    }
  };
}

export function postgresSignalAttributionPolicyCapabilityProjection():
PostgresSignalAttributionPolicyCapabilityProjection {
  if (cachedCapabilityProjection) return { ...cachedCapabilityProjection };
  const manifest = buildPostgresSignalAttributionPolicyApplyManifest();
  cachedCapabilityProjection = Object.freeze({
    contractVersion: 1,
    cutoverContractVersion: 3,
    sourceProvisioningApplyContractVersion: 1,
    deterministicManifestImplemented: true,
    atomicQualificationApplyImplemented: true,
    exactEffectivePrivilegeVerification: true,
    immutableBoundaryCatalogFingerprint: true,
    qualificationSuiteParity: true,
    noLogin: true,
    noInherit: true,
    noBypassRls: true,
    securityDefinerRoutineVerified: true,
    phase: "qualified_inactive",
    serverBoundPrincipalLookup: true,
    provisionedRowExistenceRequired: true,
    completeRetailerSetRequired: true,
    fixedRetailerOrderNormalization: true,
    rowLevelLockSerialization: true,
    writerLockProtocolConsumed: false,
    deterministicRequestIdentity: true,
    immutableAuditedReplay: true,
    zeroWriteWhenUnchanged: true,
    missingRowFailsClosed: true,
    atomicReplaceAuditOutbox: true,
    databaseOwnedTimestamps: true,
    sqliteValidationParity: true,
    sourceTrustWriterParity: true,
    sourceStatusWriterParity: true,
    sourceSyncWriterParity: true,
    catalogImportWriterParity: true,
    connectionProvisioningWriterParity: true,
    sourceWriterParity: true,
    retailerQualificationWriterParity: true,
    missionPolicyWriterParity: true,
    settingsWriterParity: false,
    configurationWriterParity: false,
    reservationWriterParity: true,
    attributionPolicyParity: true,
    writerLockProtocolParity: false,
    operationCount: 1,
    supportedRetailerCount: 13,
    protectedTenantTableCount: 3,
    forcedRlsTableCount: 3,
    mutationTableCount: 3,
    directTableGrantCount: 0,
    functionGrantCount: 1,
    activePrincipalCount: 0,
    activeRuntimeRoleApplied: false,
    mutationAuthority: true,
    sharedCatalogMutationAuthority: false,
    actionAuthority: false,
    runtimeAuthority: false,
    productionReady: false,
    roleTemplateFingerprint: manifest.fingerprint
  });
  return { ...cachedCapabilityProjection };
}

export type PostgresSignalAttributionPolicyApplyQualificationReceipt =
  PostgresQualifiedFunctionBoundaryReceipt;

export async function verifyPostgresSignalAttributionPolicyApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalAttributionPolicyApplyManifest()
): Promise<PostgresSignalAttributionPolicyApplyQualificationReceipt> {
  await verifyPostgresSignalSourceProvisioningApplyBoundary(
    database,
    manifest.predecessorManifest as unknown as PostgresSignalSourceProvisioningApplyManifest
  );
  return verifyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest));
}

export async function applyPostgresSignalAttributionPolicyApplyBoundary(
  database: PostgresCutoverDatabase,
  manifest = buildPostgresSignalAttributionPolicyApplyManifest(),
  now = Date.now()
): Promise<PostgresSignalAttributionPolicyApplyQualificationReceipt> {
  await verifyPostgresSignalSourceProvisioningApplyBoundary(
    database,
    manifest.predecessorManifest as unknown as PostgresSignalSourceProvisioningApplyManifest
  );
  return applyPostgresQualifiedFunctionBoundary(database, boundarySpec(manifest), now);
}

function exactText(value: unknown, label: string, maximum: number): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > maximum) {
    throw new PostgresSignalAttributionPolicyApplyQualificationError(
      `The PostgreSQL attribution-policy ${label} is invalid.`
    );
  }
  return normalized;
}

function parseFunctionResult(
  value: string,
  operation: PostgresSignalAttributionPolicyOperation,
  requestId: string
): PostgresSignalAttributionPolicyApplyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PostgresSignalAttributionPolicyApplyQualificationError(
      "The PostgreSQL attribution-policy result is invalid."
    );
  }
  const result = parsed as Record<string, unknown>;
  const outcome = String(result.outcome ?? "");
  const changedRetailers = result.changedRetailers;
  const policies = result.policies;
  const retailerSet = new Set<string>(POSTGRES_SIGNAL_ATTRIBUTION_POLICY_RETAILERS);
  const providerSet = new Set<string>(POSTGRES_SIGNAL_ATTRIBUTION_POLICY_PROVIDERS);
  const safeCount = (entry: unknown): boolean =>
    Number.isSafeInteger(entry) && Number(entry) >= 0 && Number(entry) <= 13;
  const validPolicyEntry = (entry: unknown): boolean => (
    !!entry && typeof entry === "object" && !Array.isArray(entry)
    && retailerSet.has(String((entry as Record<string, unknown>).retailerId))
    && typeof (entry as Record<string, unknown>).enabled === "boolean"
    && providerSet.has(String((entry as Record<string, unknown>).provider))
    && typeof (entry as Record<string, unknown>).publisherSlug === "string"
    && typeof (entry as Record<string, unknown>).articleBaseUrl === "string"
    && typeof (entry as Record<string, unknown>).associateTag === "string"
  );
  if (result.contractVersion !== 1
    || result.operation !== operation
    || result.requestId !== requestId
    || !SHA256.test(String(result.requestFingerprint ?? ""))
    || !new Set(["applied", "unchanged", "already_applied"]).has(outcome)
    || typeof result.mutationApplied !== "boolean"
    || typeof result.idempotentReplay !== "boolean"
    || (outcome === "applied"
      && (result.mutationApplied !== true || result.idempotentReplay !== false))
    || (outcome === "unchanged"
      && (result.mutationApplied !== false || result.idempotentReplay !== false))
    || (outcome === "already_applied"
      && (result.mutationApplied !== false || result.idempotentReplay !== true))
    || !Number.isSafeInteger(result.mutationStatementCount)
    || !Number.isSafeInteger(result.mutationRowCount)
    || !safeCount(result.changedRetailerCount)
    || (outcome !== "applied" && result.changedRetailerCount !== 0)
    || !Array.isArray(changedRetailers)
    || changedRetailers.length !== result.changedRetailerCount
    || !changedRetailers.every((entry) => typeof entry === "string" && retailerSet.has(entry))
    || typeof result.policiesMutated !== "boolean"
    || typeof result.auditMutated !== "boolean"
    || typeof result.outboxMutated !== "boolean"
    || (outcome === "applied" && (
      result.policiesMutated !== true || result.auditMutated !== true || result.outboxMutated !== true
    ))
    || (outcome !== "applied" && (
      result.policiesMutated !== false || result.auditMutated !== false || result.outboxMutated !== false
    ))
    || !Array.isArray(policies)
    || policies.length !== 13
    || !policies.every(validPolicyEntry)
    || new Set(policies.map((entry) => (entry as Record<string, unknown>).retailerId)).size !== 13
    || result.supportedRetailerCount !== 13
    || result.attributionPolicyParity !== true
    || result.writerLockProtocolParity !== false
    || result.mutationAuthority !== true
    || result.sharedCatalogMutationAuthority !== false
    || result.actionAuthority !== false
    || result.runtimeAuthority !== false) {
    throw new PostgresSignalAttributionPolicyApplyQualificationError(
      "The PostgreSQL attribution-policy result contract changed."
    );
  }
  return result as unknown as PostgresSignalAttributionPolicyApplyResult;
}

export class NodePostgresSignalAttributionPolicyApplyDatabase {
  private readonly pool: Pool;

  readonly manifest: PostgresSignalAttributionPolicyApplyManifest;

  constructor(
    config: PostgresCutoverConnectionConfig,
    manifest = buildPostgresSignalAttributionPolicyApplyManifest(),
    options: NodePostgresSignalAttributionPolicyApplyDatabaseOptions = {}
  ) {
    this.manifest = manifest;
    const maxConnections = options.maxConnections ?? 1;
    if (!(maxConnections === 1 || maxConnections === 2)) {
      throw new PostgresSignalAttributionPolicyApplyQualificationError(
        "The PostgreSQL attribution-policy connection pool is invalid."
      );
    }
    const base: PoolConfig = {
      connectionString: config.connectionString,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 300,
      statement_timeout: 120_000,
      application_name: "yoink_postgres_signal_attribution_policy"
    };
    this.pool = new Pool(config.tlsMode === "verify-full" ? {
      ...base,
      ssl: config.certificateAuthorityPem
        ? { rejectUnauthorized: true, ca: config.certificateAuthorityPem }
        : { rejectUnauthorized: true }
    } : { ...base, ssl: false });
    this.pool.on("error", () => undefined);
  }

  async replaceAttributionPolicies(
    principal: BackgroundWorkerPrincipal,
    operationValue: PostgresSignalAttributionPolicyOperation,
    requestIdValue: string,
    requestPayload: PostgresSignalAttributionPolicyReplacePayload
  ): Promise<PostgresSignalAttributionPolicyApplyResult> {
    const tenantId = exactText(principal?.tenantId, "expected tenant ID", 200);
    const userId = exactText(principal?.userId, "expected user ID", 200);
    const operation = String(operationValue ?? "") as PostgresSignalAttributionPolicyOperation;
    const requestId = String(requestIdValue ?? "");
    let payloadJson = "";
    try {
      payloadJson = JSON.stringify(requestPayload);
    } catch {
      payloadJson = "";
    }
    if (operation !== "replace_attribution_policies"
      || !REQUEST_ID.test(requestId)
      || requestId !== buildPostgresSignalAttributionPolicyReplaceRequestId(
        { tenantId, userId },
        requestPayload
      )
      || !payloadJson
      || Buffer.byteLength(payloadJson, "utf8") > MAXIMUM_REQUEST_PAYLOAD_BYTES) {
      throw new PostgresSignalAttributionPolicyApplyQualificationError(
        "The PostgreSQL attribution-policy apply request is invalid."
      );
    }
    const client: PoolClient = await this.pool.connect();
    let destroyed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
      await client.query(`SET LOCAL ROLE ${identifier(this.manifest.attributionPolicyRole.name)}`);
      const result = await client.query<FunctionRow>(
        `SELECT result_json AS "resultJson"
         FROM ${relation(
           this.manifest.schemaName,
           POSTGRES_SIGNAL_ATTRIBUTION_POLICY_APPLY_FUNCTION
         )}($1, $2, $3, $4, $5)`,
        [tenantId, userId, operation, requestId, payloadJson]
      );
      if (result.rows.length !== 1 || !result.rows[0]) {
        throw new PostgresSignalAttributionPolicyApplyQualificationError(
          "The PostgreSQL attribution-policy function returned an ambiguous result."
        );
      }
      const parsed = parseFunctionResult(result.rows[0].resultJson, operation, requestId);
      await client.query("COMMIT");
      return parsed;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        destroyed = true;
        client.release(true);
      }
      throw error;
    } finally {
      if (!destroyed) client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
