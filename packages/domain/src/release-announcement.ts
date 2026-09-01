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
  id: "yoink-1-18-0-trusted-signal-cart-trigger",
  version: "1.18.0",
  publishedAt: "2026-09-01T01:30:00.000Z",
  title: "Exact signals now start guarded cart checks",
  summary: "Trusted exact signals can now trigger the reviewed cart plan across all four supported stores even when the provider omits live-offer fields.",
  highlights: [
    "Target, Walmart, Amazon, and Best Buy signals enter the same immediate guarded job handoff.",
    "Missing source price, seller, or fulfillment remains unknown until Chrome verifies the live exact offer.",
    "First-party, price-cap, Shipping-default or explicit-Pickup, quantity-one, exact-cart-proof, and manual-checkout limits are unchanged."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
