import type { AuthorizationPermission } from "../../../packages/database/src/authorization-repository.js";
import type { OperationalRouteKey } from "../../../packages/database/src/operational-telemetry-repository.js";

export type ApiSurface = "public" | "user" | "admin" | "device" | "internal";

export interface ApiRoutePolicy {
  pathname: string;
  surface: ApiSurface;
  permission: AuthorizationPermission | null;
  legacy: boolean;
  classified: boolean;
  surfaceMismatch: boolean;
}

const ADMIN_PERMISSIONS = new Set<AuthorizationPermission>([
  "admin.read",
  "support.read",
  "catalog.review",
  "catalog.identity.propose",
  "catalog.identity.approve",
  "identity.review",
  "affiliate.manage",
  "retailer.manage",
  "recipe.manage",
  "qualification.manage",
  "source.manage",
  "security.manage",
  "user.lifecycle.manage",
  "alert.manage",
  "worker.manage",
  "change.approve"
]);

function permissionSurface(permission: AuthorizationPermission | null): ApiSurface {
  if (!permission) return "public";
  if (permission === "device.self") return "device";
  if (permission.startsWith("internal.")) return "internal";
  if (ADMIN_PERMISSIONS.has(permission)) return "admin";
  return "user";
}

function legacyPermission(method: string, pathname: string): AuthorizationPermission | null | undefined {
  if (["/api/v1/health", "/api/v1/extension/release", "/api/v1/extension/release/download", "/api/v1/devices/pair"].includes(pathname)) {
    return null;
  }
  if (pathname.startsWith("/api/v1/devices/self/")) return "device.self";
  if (pathname === "/api/v1/hosted/principals") return "internal.principal";
  if (pathname === "/api/v1/observer-recipe-eligibility") return "internal.eligibility";
  if (pathname.startsWith("/api/v1/hosted-delivery/")) return "internal.delivery";

  if (pathname === "/api/v1/snapshot") return "admin.read";
  if (pathname === "/api/v1/operations/telemetry") return "admin.read";
  if (pathname === "/api/v1/workers") return "admin.read";
  if (pathname.startsWith("/api/v1/workers/")) return method === "GET" ? "admin.read" : "worker.manage";
  if (/^\/api\/v1\/change-requests\/[A-Za-z0-9_-]{3,120}\/decision$/.test(pathname)) return "change.approve";
  if (pathname.startsWith("/api/v1/change-requests")) return "admin.read";
  if (pathname === "/api/v1/admin/attribution-policies") return "affiliate.manage";
  if (pathname.startsWith("/api/v1/admin/authorization")) return "security.manage";
  if (/^\/api\/v1\/identity\/claims\/[A-Za-z0-9_-]{3,120}\/review$/.test(pathname)) return "identity.review";
  if (pathname.startsWith("/api/v1/observer-recipes")) return "recipe.manage";
  if (pathname.startsWith("/api/v1/qualifications/")) return "qualification.manage";
  if (pathname.startsWith("/api/v1/admin/catalog/identity-operations")) {
    if (/\/decision$/.test(pathname)) return "catalog.identity.approve";
    if (method === "POST") return "catalog.identity.propose";
    return "admin.read";
  }
  if (pathname.startsWith("/api/v1/admin/catalog/")) return "catalog.review";
  if (pathname === "/api/v1/alerts") return "admin.read";
  if (pathname.startsWith("/api/v1/alerts/")) return method === "GET" ? "admin.read" : "alert.manage";

  if (pathname === "/api/v1/user/overview" || pathname === "/api/v1/user/authorization") return "user.read";
  if (pathname.startsWith("/api/v1/user/purchase-intents")) return "user.intent.manage";
  if (pathname === "/api/v1/user/spend" || pathname === "/api/v1/user/spend-ledger") return "user.read";
  if (pathname === "/api/v1/user/spend-policy") return "user.settings.manage";
  if (pathname === "/api/v1/user/privacy" || pathname === "/api/v1/user/privacy/export") return "user.privacy.export";
  if (["/api/v1/library", "/api/v1/library/products", "/api/v1/missions", "/api/v1/signals", "/api/v1/jobs", "/api/v1/audit", "/api/v1/strategies"].includes(pathname)
    || /^\/api\/v1\/missions\/[A-Za-z0-9_-]{3,120}$/.test(pathname)) {
    return method === "GET" ? "user.read" : "user.intent.manage";
  }
  if (pathname === "/api/v1/devices/pairing-code" || /^\/api\/v1\/devices\/[A-Za-z0-9_-]{3,120}\/revoke$/.test(pathname)) {
    return "user.device.manage";
  }
  if (pathname.startsWith("/api/v1/community/") || pathname.startsWith("/api/v1/identity/claims")) return "user.community.manage";
  if (pathname === "/api/v1/catalog/listings" || pathname.startsWith("/api/v1/user/catalog/")) return "user.catalog.propose";
  if (pathname === "/api/v1/attribution-policies") return "user.attribution.manage";
  if (pathname === "/api/v1/settings" || pathname === "/api/v1/settings/actions") return "user.settings.manage";
  if (pathname === "/api/v1/purchase-profiles" || /^\/api\/v1\/purchase-profiles\/[A-Za-z0-9_-]{3,120}$/.test(pathname)) {
    return method === "GET" ? "user.read" : "user.intent.manage";
  }
  if (pathname === "/api/v1/signals" || /^\/api\/v1\/jobs\/[A-Za-z0-9_-]{3,120}\/resolve$/.test(pathname)) return "user.intent.manage";
  return undefined;
}

function canonicalPath(pathname: string): { pathname: string; requestedSurface: ApiSurface | null } {
  if (pathname === "/api/v1/user/overview" || pathname === "/api/v1/user/authorization"
    || pathname.startsWith("/api/v1/user/privacy")
    || pathname.startsWith("/api/v1/user/catalog/")
    || pathname.startsWith("/api/v1/user/purchase-intents")
    || pathname.startsWith("/api/v1/user/spend")) {
    return { pathname, requestedSurface: "user" };
  }
  if (pathname.startsWith("/api/v1/user/")) {
    return { pathname: `/api/v1/${pathname.slice("/api/v1/user/".length)}`, requestedSurface: "user" };
  }
  if (pathname.startsWith("/api/v1/admin/authorization") || pathname.startsWith("/api/v1/admin/catalog/")
    || pathname === "/api/v1/admin/attribution-policies") {
    return { pathname, requestedSurface: "admin" };
  }
  if (pathname.startsWith("/api/v1/admin/")) {
    return { pathname: `/api/v1/${pathname.slice("/api/v1/admin/".length)}`, requestedSurface: "admin" };
  }
  if (pathname === "/api/v1/internal/hosted/principals") {
    return { pathname: "/api/v1/hosted/principals", requestedSurface: "internal" };
  }
  if (pathname === "/api/v1/internal/observer-recipes/contributor-eligibility") {
    return { pathname: "/api/v1/observer-recipe-eligibility", requestedSurface: "internal" };
  }
  if (pathname.startsWith("/api/v1/internal/delivery/")) {
    return {
      pathname: `/api/v1/hosted-delivery/${pathname.slice("/api/v1/internal/delivery/".length)}`,
      requestedSurface: "internal"
    };
  }
  return { pathname, requestedSurface: null };
}

export function resolveApiRoutePolicy(method: string, pathname: string): ApiRoutePolicy | null {
  if (!pathname.startsWith("/api/v1/")) return null;
  const canonical = canonicalPath(pathname);
  const permission = legacyPermission(method.toUpperCase(), canonical.pathname);
  const classified = permission !== undefined;
  const surface = permissionSurface(permission ?? null);
  const legacy = canonical.requestedSurface === null
    && !["public", "device"].includes(surface)
    && !pathname.startsWith("/api/v1/admin/");
  return {
    pathname: canonical.pathname,
    surface,
    permission: permission ?? null,
    legacy,
    classified,
    surfaceMismatch: canonical.requestedSurface !== null && canonical.requestedSurface !== surface
  };
}

const OPERATIONAL_RESOURCES: Readonly<Record<ApiSurface, Readonly<Record<string, string>>>> = Object.freeze({
  public: Object.freeze({
    health: "health",
    extension: "extension_release",
    devices: "device_pair"
  }),
  user: Object.freeze({
    overview: "overview",
    authorization: "authorization",
    catalog: "catalog",
    "purchase-intents": "purchase_intents",
    "purchase-profiles": "purchase_intents",
    spend: "spend",
    library: "library",
    missions: "missions",
    signals: "signals",
    jobs: "jobs",
    audit: "audit",
    strategies: "strategies",
    devices: "devices",
    community: "community",
    identity: "identity",
    "attribution-policies": "attribution",
    settings: "settings",
    privacy: "privacy"
  }),
  admin: Object.freeze({
    snapshot: "snapshot",
    operations: "operations",
    authorization: "authorization",
    catalog: "catalog",
    identity: "identity",
    "observer-recipes": "observer_recipes",
    qualifications: "qualifications",
    alerts: "alerts",
    sources: "sources",
    "attribution-policies": "attribution",
    "change-requests": "change_control",
    workers: "workers"
  }),
  device: Object.freeze({
    heartbeat: "heartbeat",
    "credential-rotation": "credential_rotation",
    "adapter-diagnostics": "adapter_diagnostics",
    "shadow-observations": "observations",
    "walmart-draw": "drawings",
    "qualification-trials": "qualification_trials",
    jobs: "jobs",
    notifications: "notifications",
    sources: "sources",
    community: "community",
    "observer-recipes": "recipes",
    "observer-recipe-trials": "recipes"
  }),
  internal: Object.freeze({
    hosted: "principals",
    "hosted-delivery": "delivery",
    "observer-recipe-eligibility": "eligibility"
  })
});

function requestedOperationalSurface(pathname: string): ApiSurface | null {
  if (pathname.startsWith("/api/v1/admin/")) return "admin";
  if (pathname.startsWith("/api/v1/user/")) return "user";
  if (pathname.startsWith("/api/v1/internal/")) return "internal";
  if (pathname.startsWith("/api/v1/devices/self/")) return "device";
  return null;
}

export function operationalRouteKey(pathname: string, policy: ApiRoutePolicy | null): OperationalRouteKey {
  const surface = policy?.classified
    ? policy.surface
    : requestedOperationalSurface(pathname) ?? policy?.surface ?? "public";
  const canonicalPath = policy?.pathname ?? pathname;
  const segments = canonicalPath.split("/").filter(Boolean).slice(2);
  if (segments[0] === "user" || segments[0] === "admin" || segments[0] === "internal") segments.shift();
  if (segments[0] === "devices" && segments[1] === "self") segments.splice(0, 2);
  const resource = segments[0] ?? "";
  const group = OPERATIONAL_RESOURCES[surface][resource] ?? "other";
  return `${surface}.${group}` as OperationalRouteKey;
}
