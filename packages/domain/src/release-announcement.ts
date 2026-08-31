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
  id: "yoink-1-17-1-target-direct-fulfillment",
  version: "1.17.1",
  publishedAt: "2026-08-31T22:35:00.000Z",
  title: "Target shipping-only products qualify correctly",
  summary: "Yoink now recognizes Target's current direct-fulfillment product layout while preserving exact-item, Shipping-first, and no-click qualification safeguards.",
  highlights: [
    "Direct Shipping and same-day Delivery panels bind their exact TCIN-scoped Add control even when Target does not render selectable fulfillment tiles.",
    "Sticky and recommendation controls remain excluded, and visible Target errors or ambiguous fulfillment still stop before any retailer control.",
    "Pickup remains unavailable to Shipping-default plans and is eligible only when the user explicitly selected Pickup and the exact page offers it."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
