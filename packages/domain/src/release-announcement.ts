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
  id: "yoink-1-30-49-shorter-checkout-alerts",
  version: "1.30.49",
  publishedAt: "2026-10-14T22:44:00.000Z",
  title: "Shorter checkout alerts",
  summary: "YoinkBot messages now put the item and cart link up front with less text to read.",
  highlights: [
    "Ready alerts show the store, item, quantity, price when available, and an Open cart link.",
    "Test and connection messages are shorter, too.",
    "Stay signed in to the same store account on phone and computer for faster checkout."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
