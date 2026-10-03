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
  "admin.users.read",
  "admin.users.support",
  "admin.users.manage",
  "admin.maintainer",
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

// Setup's store switch is a shopper route, but turning a store on needs the
// permission Admin's activation needs: a principal without it gets 403, not
// a route that only exists on the admin surface.
const USER_STORE_SWITCH_ROUTE = /^\/api\/v1\/user\/stores\/[a-z][a-z0-9]{1,31}\/turn-(on|off)$/;

function permissionSurface(permission: AuthorizationPermission | null): ApiSurface {
  if (!permission) return "public";
  if (permission === "device.self") return "device";
  if (permission.startsWith("internal.")) return "internal";
  if (ADMIN_PERMISSIONS.has(permission)) return "admin";
  return "user";
}

function legacyPermission(method: string, pathname: string): AuthorizationPermission | null | undefined {
  if ([
    "/api/v1/health", "/api/v1/affiliate-routing", "/api/v1/extension/release",
    "/api/v1/extension/release/download", "/api/v1/devices/pair"
  ].includes(pathname)) {
    return null;
  }
  if (pathname.startsWith("/api/v1/devices/self/")) return "device.self";
  if (pathname === "/api/v1/hosted/principals") return "internal.principal";
  if (pathname === "/api/v1/observer-recipe-eligibility") return "internal.eligibility";
  if (pathname.startsWith("/api/v1/hosted-delivery/")) return "internal.delivery";

  if (pathname.startsWith("/api/v1/admin/drop-windows")) return method === "GET" ? "admin.read" : "source.manage";
  if (pathname.startsWith("/api/v1/admin/restock-patterns")) return method === "GET" ? "admin.read" : "source.manage";
  if (["/api/v1/admin/notifications", "/api/v1/admin/attribution-receipts"].includes(pathname)) return "admin.read";
  if (pathname === "/api/v1/admin/signals/simulate") return "source.manage";
  if (pathname === "/api/v1/admin/workers/restart") return "worker.manage";
  if (pathname.startsWith("/api/v1/admin/storage")) return method === "GET" ? "admin.read" : "worker.manage";
  if (pathname === "/api/v1/admin/settings/actions") return "admin.users.support";
  if (pathname === "/api/v1/admin/capabilities") return "admin.read";
  if (pathname.startsWith("/api/v1/admin/evidence-capsules")) {
    return method === "GET" ? "admin.read" : "admin.maintainer";
  }
  if (pathname.startsWith("/api/v1/admin/analytics")) return "admin.read";

  if (pathname === "/api/v1/snapshot") return "admin.read";
  if (pathname === "/api/v1/users") return method === "GET" ? "admin.users.read" : "admin.users.manage";
  // A pairing code makes the redeeming browser that user's device (it can
  // lease their jobs and resume their actions), so issuing one for another
  // user needs account management, not read-mostly support (API-13).
  if (/^\/api\/v1\/users\/[A-Za-z0-9_-]{3,120}\/pairing-code$/.test(pathname)) return "admin.users.manage";
  if (/^\/api\/v1\/users\/[A-Za-z0-9_-]{3,120}\/pause-actions$/.test(pathname)) return "admin.users.support";
  if (/^\/api\/v1\/users\/[A-Za-z0-9_-]{3,120}$/.test(pathname)) {
    return method === "GET" ? "admin.users.read" : "admin.users.manage";
  }
  if (pathname === "/api/v1/operations/telemetry") return "admin.read";
  if (pathname === "/api/v1/workers") return "admin.read";
  if (pathname.startsWith("/api/v1/workers/")) return method === "GET" ? "admin.read" : "worker.manage";
  if (/^\/api\/v1\/change-requests\/[A-Za-z0-9_-]{3,120}\/decision$/.test(pathname)) return "change.approve";
  if (pathname.startsWith("/api/v1/change-requests")) return "admin.read";
  if (pathname === "/api/v1/admin/attribution-policies") return "affiliate.manage";
  if (pathname.startsWith("/api/v1/sources")) return method === "GET" ? "admin.read" : "source.manage";
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

  if (pathname === "/api/v1/user/overview" || pathname === "/api/v1/user/authorization"
    || pathname === "/api/v1/user/action-handoff") return "user.read";
  if (pathname.startsWith("/api/v1/user/checkout-reports/")) return method === "GET" ? "user.read" : "user.intent.manage";
  if (pathname.startsWith("/api/v1/user/purchase-intents")) return "user.intent.manage";
  if (method === "POST" && pathname === "/api/v1/user/amazon-approved-test-20261002") return "user.intent.manage";
  if (/^\/api\/v1\/user\/cart-attempts(?:\/[A-Za-z0-9_-]{3,120})?$/.test(pathname)) return "user.intent.manage";
  if (pathname === "/api/v1/user/spend" || pathname === "/api/v1/user/spend-ledger") return "user.read";
  if (pathname === "/api/v1/user/spend-policy") return "user.settings.manage";
  if (pathname === "/api/v1/user/privacy" || pathname === "/api/v1/user/privacy/export") return "user.privacy.export";
  if (pathname.startsWith("/api/v1/user/privacy/")) return "user.settings.manage";
  if (pathname === "/api/v1/user/action-platform" || pathname === "/api/v1/user/readiness"
    || pathname === "/api/v1/user/analytics" || pathname === "/api/v1/user/analytics.csv"
    || pathname === "/api/v1/user/health" || pathname === "/api/v1/user/calls") return "user.read";
  if (pathname === "/api/v1/user/delivery-health") return "user.read";
  if (pathname === "/api/v1/user/delivery-health/test-alert") return "user.settings.manage";
  if (pathname === "/api/v1/user/watch-queue/settings") return "user.settings.manage";
  const storeSwitch = USER_STORE_SWITCH_ROUTE.exec(pathname);
  if (storeSwitch) return storeSwitch[1] === "on" ? "qualification.manage" : "user.settings.manage";
  if (pathname.startsWith("/api/v1/user/drop-windows") || pathname.startsWith("/api/v1/user/watch-queue")) {
    return method === "GET" ? "user.read" : "user.intent.manage";
  }
  if (pathname.startsWith("/api/v1/user/source-feedback")) return "user.intent.manage";
  if (pathname.startsWith("/api/v1/user/purchase-handoffs")) return "user.intent.manage";
  if (pathname.startsWith("/api/v1/user/store-link-clicks")) return "user.intent.manage";
  if (pathname.startsWith("/api/v1/user/connectors")) {
    return method === "GET" ? "user.read" : "user.settings.manage";
  }
  if (["/api/v1/library", "/api/v1/library/products", "/api/v1/missions", "/api/v1/signals", "/api/v1/jobs", "/api/v1/audit", "/api/v1/strategies"].includes(pathname)
    || /^\/api\/v1\/missions\/[A-Za-z0-9_-]{3,120}$/.test(pathname)) {
    return method === "GET" ? "user.read" : "user.intent.manage";
  }
  if (pathname === "/api/v1/devices" && method === "GET") return "user.read";
  if (/^\/api\/v1\/devices\/[A-Za-z0-9_-]{3,120}$/.test(pathname) && method === "PATCH") return "user.device.manage";
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
  if (pathname === "/api/v1/signals"
    || /^\/api\/v1\/jobs\/[A-Za-z0-9_-]{3,120}\/(?:resolve|outcome)$/.test(pathname)) return "user.intent.manage";
  return undefined;
}

function canonicalPath(pathname: string): { pathname: string; requestedSurface: ApiSurface | null } {
  if (pathname === "/api/v1/user/overview" || pathname === "/api/v1/user/authorization"
    || pathname === "/api/v1/user/action-handoff"
    || pathname.startsWith("/api/v1/user/privacy")
    || pathname.startsWith("/api/v1/user/catalog/")
    || pathname.startsWith("/api/v1/user/checkout-reports/")
    || pathname.startsWith("/api/v1/user/purchase-intents")
    || pathname === "/api/v1/user/amazon-approved-test-20261002"
    || pathname.startsWith("/api/v1/user/cart-attempts")
    || pathname.startsWith("/api/v1/user/spend")
    || pathname.startsWith("/api/v1/user/action-platform")
    || pathname.startsWith("/api/v1/user/drop-windows")
    || pathname.startsWith("/api/v1/user/watch-queue")
    || pathname.startsWith("/api/v1/user/source-feedback")
    || pathname.startsWith("/api/v1/user/purchase-handoffs")
    || pathname.startsWith("/api/v1/user/store-link-clicks")
    || pathname.startsWith("/api/v1/user/connectors")
    || pathname.startsWith("/api/v1/user/readiness")
    || pathname.startsWith("/api/v1/user/analytics")
    || pathname.startsWith("/api/v1/user/health")
    || pathname.startsWith("/api/v1/user/delivery-health")
    || pathname.startsWith("/api/v1/user/calls")
    || pathname.startsWith("/api/v1/user/stores/")) {
    return { pathname, requestedSurface: "user" };
  }
  if (pathname.startsWith("/api/v1/user/")) {
    return { pathname: `/api/v1/${pathname.slice("/api/v1/user/".length)}`, requestedSurface: "user" };
  }
  if (pathname.startsWith("/api/v1/admin/authorization") || pathname.startsWith("/api/v1/admin/catalog/")
    || pathname === "/api/v1/admin/attribution-policies"
    || pathname.startsWith("/api/v1/admin/drop-windows")
    || pathname.startsWith("/api/v1/admin/restock-patterns")
    || pathname === "/api/v1/admin/notifications"
    || pathname === "/api/v1/admin/attribution-receipts"
    || pathname === "/api/v1/admin/signals/simulate"
    || pathname === "/api/v1/admin/workers/restart"
    || pathname.startsWith("/api/v1/admin/storage")
    || pathname === "/api/v1/admin/settings/actions"
    || pathname === "/api/v1/admin/capabilities"
    || pathname.startsWith("/api/v1/admin/evidence-capsules")
    || pathname.startsWith("/api/v1/admin/analytics")) {
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
  const surface = classified && USER_STORE_SWITCH_ROUTE.test(canonical.pathname)
    ? "user"
    : permissionSurface(permission ?? null);
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
    "affiliate-routing": "affiliate_routing",
    extension: "extension_release",
    devices: "device_pair"
  }),
  user: Object.freeze({
    overview: "overview",
    "action-handoff": "actions",
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
    privacy: "privacy",
    connectors: "settings",
    readiness: "settings",
    analytics: "actions",
    health: "settings",
    "delivery-health": "settings",
    calls: "signals",
    stores: "settings",
    "drop-windows": "signals",
    "watch-queue": "signals",
    "source-feedback": "signals",
    "purchase-handoffs": "actions",
    "checkout-reports": "actions",
    "store-link-clicks": "actions"
  }),
  admin: Object.freeze({
    snapshot: "snapshot",
    users: "authorization",
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
    workers: "workers",
    signals: "signals",
    notifications: "notifications",
    "attribution-receipts": "attribution",
    "drop-windows": "sources",
    "restock-patterns": "sources",
    analytics: "analytics",
    "evidence-capsules": "alerts"
  }),
  device: Object.freeze({
    heartbeat: "heartbeat",
    "credential-rotation": "credential_rotation",
    "adapter-diagnostics": "adapter_diagnostics",
    "evidence-capsules": "adapter_diagnostics",
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
