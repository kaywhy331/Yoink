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
  id: "yoink-1-30-12-fill-msrps",
  version: "1.30.12",
  publishedAt: "2026-10-08T22:00:00.000Z",
  title: "Fill in MSRPs in one step",
  summary: "Wanted fills in the MSRP for every cart item that needs one, from TrackaLacker or the lowest Best Buy, Target or Walmart price, and now shows those items as ready.",
  highlights: [
    "Cart items whose MSRP you confirmed or filled in no longer say they need one.",
    "Check each MSRP before you save, and untick anything that looks wrong, such as a resale price.",
    "Test call in Setup › Stores sends one call for an item you pick, so you can watch the companion add it to your cart and open checkout."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
