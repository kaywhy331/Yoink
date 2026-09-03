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
  id: "yoink-1-19-1-self-healing-store-checks",
  version: "1.19.1",
  publishedAt: "2026-09-03T04:51:30.000Z",
  title: "Store checks recover with less repetition",
    summary: "Yoink now reuses prior store-check products, retries repairable store layouts, and avoids unsuitable preorder candidates during store checks.",
  highlights: [
    "Optional automatic store checks replay a bounded set of prior evidence and in-stock catalog candidates without clicking Add to cart.",
    "Walmart pages with one primary action and a sticky duplicate now bind the exact selected first-party Shipping offer.",
    "Preorders and unavailable products remain fail-closed; checkout and order submission remain manual."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
