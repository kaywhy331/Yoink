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
  id: "yoink-1-30-48-readable-checkout-alerts",
  version: "1.30.48",
  publishedAt: "2026-10-14T22:30:00.000Z",
  title: "Clearer checkout alerts",
  summary: "YoinkBot messages in Telegram and Discord now use bold headings, spaced sections, and indented item details so you can find the next step quickly.",
  highlights: [
    "Checkout alerts clearly show the store, item, quantity, price when available, and a direct cart link.",
    "Test messages confirm your connection and make it clear that no checkout action is needed.",
    "Every message keeps the reminder to stay logged in to the same store account on your phone and computer for faster checkout."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
