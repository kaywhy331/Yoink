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
  id: "yoink-1-30-21-retry-when-sold-out",
  version: "1.30.21",
  publishedAt: "2026-10-09T22:00:00.000Z",
  title: "Retry when sold out",
  summary: "Sold-out items often come back as other shoppers' carts expire. Yoink can now try again in the same tab, and closes tabs that didn't add anything.",
  highlights: [
    "Turn on Retry when sold out in Setup › Stores and choose how many tries over how many minutes. Each try checks the price, seller and stock again.",
    "A cart add that didn't add anything closes its tab. Tabs that need you, like a sign-in, stay open.",
    "Want it shows the 90-day low and high and Yoink's suggested price under its chart."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
