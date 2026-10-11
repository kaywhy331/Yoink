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
  id: "yoink-1-30-29-max-price-amazon-offer",
  version: "1.30.29",
  publishedAt: "2026-10-11T18:00:00.000Z",
  title: "Calls add at any price up to your max",
  summary: "Chrome adds an item whenever the store's price is at or under your max, not only at the exact price the call reported. Amazon items whose page features another seller add Amazon's own offer when it's within your price.",
  highlights: [
    "Your max is the limit: a call at $24.99 still adds at $26.99 when your max is $30. Test calls work the same way: type the most you'll pay.",
    "Best Buy Test calls take the SKU shown on the product page (SKU: 1234567), since Best Buy's links no longer include it.",
    "Amazon: when another seller is featured and Amazon.com sells the item too, Chrome opens Amazon's own offer and adds it. Pages with more than one buying option no longer read as \"No Add to cart button\"."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
