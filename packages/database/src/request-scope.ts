import { AsyncLocalStorage } from "node:async_hooks";
import {
  INTERNAL_SERVICE_CAPABILITIES,
  type InternalServiceCapability
} from "../../contracts/src/index.js";
import { stableHash } from "../../domain/src/ids.js";
import { DomainRequestError } from "../../domain/src/domain-request-error.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID } from "./database.js";

const SCOPE_ID_PATTERN = /^[A-Za-z0-9_-]{3,120}$/;

/**
 * The caller is not (or no longer) authenticated: a missing, malformed,
 * expired, replayed or unsigned request scope. Answers 401 so clients know
 * to re-authenticate, instead of a masked 500 (API-11).
 */
export class AuthenticationRequiredError extends DomainRequestError {
  constructor(message: string) {
    super("authentication_required", 401, message);
    this.name = "AuthenticationRequiredError";
  }
}

export interface RequestScope {
  tenantId: string;
  userId: string;
  actorKind: "maintainer" | "user" | "device" | "service";
  actorId: string;
  /** Singular deployment-owned workload capability. Never accepted from hosted request headers. */
  internalServiceCapability?: InternalServiceCapability;
  /** Internal marker set only by the in-process loopback resolver. Never read from hosted headers. */
  requestBoundary?: "local_loopback";
  authenticationAssurance?: "baseline" | "step_up";
  authenticationTime?: number;
  sessionId?: string;
}

export const LOCAL_REQUEST_SCOPE: Readonly<RequestScope> = Object.freeze({
  tenantId: LOCAL_TENANT_ID,
  userId: LOCAL_USER_ID,
  actorKind: "maintainer",
  actorId: "local_control_center",
  requestBoundary: "local_loopback"
});

const storage = new AsyncLocalStorage<RequestScope>();

export function normalizedRequestScope(value: RequestScope): RequestScope {
  const assurance = value?.authenticationAssurance;
  const hasAuthenticationContext = assurance !== undefined
    || value?.authenticationTime !== undefined
    || value?.sessionId !== undefined;
  if (!value || typeof value !== "object"
    || !SCOPE_ID_PATTERN.test(String(value.tenantId || ""))
    || !SCOPE_ID_PATTERN.test(String(value.userId || ""))
    || !["maintainer", "user", "device", "service"].includes(value.actorKind)
    || !SCOPE_ID_PATTERN.test(String(value.actorId || ""))
    || (value.internalServiceCapability !== undefined
      && (value.actorKind !== "service"
        || !INTERNAL_SERVICE_CAPABILITIES.includes(value.internalServiceCapability)))
    || (value.requestBoundary !== undefined && value.requestBoundary !== "local_loopback")
    || (hasAuthenticationContext && !["baseline", "step_up"].includes(String(assurance ?? "")))
    || (hasAuthenticationContext && (!Number.isSafeInteger(value.authenticationTime)
      || Number(value.authenticationTime) <= 0
      || !SCOPE_ID_PATTERN.test(String(value.sessionId ?? ""))))) {
    throw new AuthenticationRequiredError("The authenticated tenant/user request scope is invalid.");
  }
  return {
    tenantId: value.tenantId,
    userId: value.userId,
    actorKind: value.actorKind,
    actorId: value.actorId,
    ...(value.internalServiceCapability ? {
      internalServiceCapability: value.internalServiceCapability
    } : {}),
    ...(value.requestBoundary ? { requestBoundary: value.requestBoundary } : {}),
    ...(hasAuthenticationContext ? {
      authenticationAssurance: assurance,
      authenticationTime: value.authenticationTime,
      sessionId: value.sessionId
    } : {})
  };
}

export function isExactLocalRequestScope(scope: RequestScope = currentRequestScope()): boolean {
  return scope.requestBoundary === "local_loopback"
    && scope.tenantId === LOCAL_REQUEST_SCOPE.tenantId
    && scope.userId === LOCAL_REQUEST_SCOPE.userId
    && scope.actorKind === LOCAL_REQUEST_SCOPE.actorKind
    && scope.actorId === LOCAL_REQUEST_SCOPE.actorId;
}

export function currentRequestScope(): RequestScope {
  return storage.getStore() ?? LOCAL_REQUEST_SCOPE;
}

export function runWithRequestScope<T>(scope: RequestScope, operation: () => T): T {
  return storage.run(normalizedRequestScope(scope), operation);
}

export function ownedIdForUser(namespace: string, userId: string, localId: string): string {
  const prefix = String(namespace).toLocaleLowerCase("en-US").replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "owned";
  return userId === LOCAL_USER_ID ? localId : `${prefix}_${stableHash("yoink_owned_id_v1", userId, prefix).slice(0, 24)}`;
}

export function scopedSourceConnectionId(source: "trackalacker" | "browser" | "discord"): string {
  return ownedIdForUser(`source_${source}`, currentRequestScope().userId, `source_${source}_local`);
}
