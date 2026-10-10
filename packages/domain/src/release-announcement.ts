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
  id: "yoink-1-30-26-all-new",
  version: "1.30.26",
  publishedAt: "2026-10-10T06:00:00.000Z",
  title: "Want every All New item",
  summary: "Want it on an All New entry, such as All New NeeDoh or All New Pokemon, wants each of its items now and every new one as it appears.",
  highlights: [
    "Each item of an All New entry is its own product, and the same item at several stores is one product with each store's price.",
    "Wanting the entry wants every item up to Yoink's suggested price, or its first store price while it's new; Add to cart buys at any price up to that max.",
    "New items join by themselves when a sync or a call finds them. Items you set up yourself stay exactly as you set them."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
