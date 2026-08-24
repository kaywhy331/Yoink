import type { AuthorizationPermission } from "../../../packages/database/src/authorization-repository.js";

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
  "identity.review",
  "affiliate.manage",
  "retailer.manage",
  "recipe.manage",
  "qualification.manage",
  "source.manage",
  "security.manage",
  "user.lifecycle.manage",
  "alert.manage"
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
  if (pathname.startsWith("/api/v1/hosted-delivery/")) return "internal.delivery";

  if (pathname === "/api/v1/snapshot") return "admin.read";
  if (pathname.startsWith("/api/v1/admin/authorization")) return "security.manage";
  if (/^\/api\/v1\/identity\/claims\/[A-Za-z0-9_-]{3,120}\/review$/.test(pathname)) return "identity.review";
  if (pathname.startsWith("/api/v1/observer-recipes")) return "recipe.manage";
  if (pathname.startsWith("/api/v1/qualifications/")) return "qualification.manage";
  if (pathname.startsWith("/api/v1/admin/catalog/")) return "catalog.review";

  if (pathname === "/api/v1/user/overview" || pathname === "/api/v1/user/authorization") return "user.read";
  if (pathname.startsWith("/api/v1/user/purchase-intents")) return "user.intent.manage";
  if (pathname === "/api/v1/user/spend" || pathname === "/api/v1/user/spend-ledger") return "user.read";
  if (pathname === "/api/v1/user/spend-policy") return "user.settings.manage";
  if (["/api/v1/library", "/api/v1/missions", "/api/v1/signals", "/api/v1/jobs", "/api/v1/audit", "/api/v1/strategies"].includes(pathname)
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
  if (pathname === "/api/v1/signals" || /^\/api\/v1\/jobs\/[A-Za-z0-9_-]{3,120}\/resolve$/.test(pathname)) return "user.intent.manage";
  return undefined;
}

function canonicalPath(pathname: string): { pathname: string; requestedSurface: ApiSurface | null } {
  if (pathname === "/api/v1/user/overview" || pathname === "/api/v1/user/authorization"
    || pathname.startsWith("/api/v1/user/catalog/")
    || pathname.startsWith("/api/v1/user/purchase-intents")
    || pathname.startsWith("/api/v1/user/spend")) {
    return { pathname, requestedSurface: "user" };
  }
  if (pathname.startsWith("/api/v1/user/")) {
    return { pathname: `/api/v1/${pathname.slice("/api/v1/user/".length)}`, requestedSurface: "user" };
  }
  if (pathname.startsWith("/api/v1/admin/authorization") || pathname.startsWith("/api/v1/admin/catalog/")) {
    return { pathname, requestedSurface: "admin" };
  }
  if (pathname.startsWith("/api/v1/admin/")) {
    return { pathname: `/api/v1/${pathname.slice("/api/v1/admin/".length)}`, requestedSurface: "admin" };
  }
  if (pathname === "/api/v1/internal/hosted/principals") {
    return { pathname: "/api/v1/hosted/principals", requestedSurface: "internal" };
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
