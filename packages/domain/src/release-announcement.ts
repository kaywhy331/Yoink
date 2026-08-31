export interface UserReleaseAnnouncement {
  id: string;
  version: string;
  publishedAt: string;
  title: string;
  summary: string;
  highlights: string[];
  docsUrl: string;
}

export const CURRENT_USER_RELEASE_ANNOUNCEMENT: Readonly<UserReleaseAnnouncement> = Object.freeze({
  id: "yoink-1-16-1-action-audit",
  version: "1.16.1",
  publishedAt: "2026-08-30T00:00:00.000Z",
  title: "Complete cart handoffs and drop-watch controls",
  summary: "Yoink now hands off a proven cart immediately, keeps action connectors aligned with every lifecycle path, and makes scheduled drop watches fully controllable and explainable.",
  highlights: [
    "The local Cart ready notification, badge, optional sound, popup state, and cart-tab handoff now happen before control-plane confirmation reporting.",
    "Admin supersession and user Auto-watch armed plans controls now cover open windows, per-item countdown/readiness, and exact replacement semantics.",
    "Carted, Needs you, and Missed connectors now follow the shared action transition path; Insights also exposes spend headroom and p50/p95 action latency."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
