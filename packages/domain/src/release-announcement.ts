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
  id: "yoink-1-28-0-more-store-cart-support",
  version: "1.28.0",
  publishedAt: "2026-09-06T14:00:00.000Z",
  title: "Three more stores support cart adds",
  summary: "Audio Advice, Banana Republic, and Banana Republic Factory now support cart adds. Complete each store’s checks and activation before using cart automation.",
  highlights: [
    "Selected Audio Advice offers and One Size Banana Republic products, with US shipping and current price checks.",
    "Security checks and queues pause the action for you to complete in Chrome.",
    "Cart verification checks the exact quantity change. Checkout stays manual."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
