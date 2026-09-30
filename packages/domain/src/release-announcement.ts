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
  id: "yoink-1-28-5-target-add-button",
  version: "1.28.5",
  publishedAt: "2026-09-30T00:00:00.000Z",
  title: "Target cart adds work with Target's new product page",
  summary: "Target moved its Add to cart button; the companion finds it again and chooses Shipping when your store has no stock for pickup.",
  highlights: [
    "Target now shows its Add to cart button below the delivery options. The companion reads it there, so in-stock Target items no longer show as \"Availability: Unknown\".",
    "When Pickup at your store is out of stock, the companion chooses Shipping first and clicks only the product's own Add to cart button.",
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
