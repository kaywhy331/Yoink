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
  id: "yoink-1-28-6-target-shipping-only",
  version: "1.28.6",
  publishedAt: "2026-09-30T12:00:00.000Z",
  title: "Target cart adds for shipping-only products",
  summary: "Target products that only ship (no pickup or delivery choice) now read as in stock, alongside the new Add to cart layout from 1.28.5.",
  highlights: [
    "Target now shows its Add to cart button below the delivery options, and some products only offer \"Ship to … Arrives by …\". The companion reads both, so in-stock Target items no longer show as \"Availability: Unknown\".",
    "When Pickup at your store is out of stock, the companion chooses Shipping first. It clicks only the product's own Add to cart button, never Buy now.",
    "Update the Chrome companion, sign in to Target in Chrome, then run Check stores now. Target needs to be turned on again once its checks pass."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
