import { AsyncLocalStorage } from "node:async_hooks";
import { stableHash } from "../../domain/src/ids.js";
import { LOCAL_TENANT_ID, LOCAL_USER_ID } from "./database.js";

const SCOPE_ID_PATTERN = /^[A-Za-z0-9_-]{3,120}$/;

export interface RequestScope {
  tenantId: string;
  userId: string;
  actorKind: "maintainer" | "user" | "device" | "service";
  actorId: string;
}

export const LOCAL_REQUEST_SCOPE: Readonly<RequestScope> = Object.freeze({
  tenantId: LOCAL_TENANT_ID,
  userId: LOCAL_USER_ID,
  actorKind: "maintainer",
  actorId: "local_control_center"
});

const storage = new AsyncLocalStorage<RequestScope>();

export function normalizedRequestScope(value: RequestScope): RequestScope {
  if (!value || typeof value !== "object"
    || !SCOPE_ID_PATTERN.test(String(value.tenantId || ""))
    || !SCOPE_ID_PATTERN.test(String(value.userId || ""))
    || !["maintainer", "user", "device", "service"].includes(value.actorKind)
    || !SCOPE_ID_PATTERN.test(String(value.actorId || ""))) {
    throw new Error("The authenticated tenant/user request scope is invalid.");
  }
  return {
    tenantId: value.tenantId,
    userId: value.userId,
    actorKind: value.actorKind,
    actorId: value.actorId
  };
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
