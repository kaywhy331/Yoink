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
  id: "yoink-1-30-14-test-any-item",
  version: "1.30.14",
  publishedAt: "2026-10-09T00:00:00.000Z",
  title: "Test call with any in-stock item",
  summary: "Test call in Setup › Stores can now use any item you link with its MSRP, so you can try a store's cart add even when the items you want are sold out.",
  highlights: [
    "Paste a product page link from that store and the item's MSRP. Pick something in stock and sold by the store itself.",
    "Yoink sets the item up just for this test and removes it afterwards. Nothing is ordered.",
    "Wanted can fill in the MSRP for every cart item that needs one, from TrackaLacker or the lowest Best Buy, Target or Walmart price."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
