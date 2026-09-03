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
  id: "yoink-1-19-2-preorder-adds",
  version: "1.19.2",
  publishedAt: "2026-09-03T17:41:37.000Z",
  title: "Preorders use the cart path",
  summary: "An actionable first-party preorder now qualifies and runs through the same add-to-cart checks as an in-stock offer.",
  highlights: [
    "Best Buy add v11 removes the preorder-only rejection while retaining exact SKU, seller, price, fulfillment, and control checks.",
    "Optional automatic store checks can reuse actionable preorder evidence and preorder catalog candidates without clicking the store control.",
    "Unavailable products, marketplace sellers, ambiguous controls, checkout, and order submission remain blocked."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
