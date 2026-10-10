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
  id: "yoink-1-30-27-all-new-barcodes",
  version: "1.30.27",
  publishedAt: "2026-10-10T08:00:00.000Z",
  title: "Want every All New item",
  summary: "Want it on an All New entry, such as All New NeeDoh or All New Pokemon, wants each of its items now and every new one as it appears.",
  highlights: [
    "Wanting the entry wants every item up to Yoink's suggested price, or its first store price while it's new; new items join by themselves.",
    "Each item is its own product, and the same item at several stores is one product: Yoink matches them by the barcode (UPC) on each store's page.",
    "The Chrome companion reads each new item's barcode in a background tab, a few pages at a time; items you set up yourself stay as you set them."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
