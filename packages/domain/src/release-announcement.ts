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
  id: "yoink-1-30-1-product-pictures",
  version: "1.30.1",
  publishedAt: "2026-10-07T21:00:00.000Z",
  title: "Product pictures load from your PC",
  summary: "Yoink now keeps its own copy of each product picture, so Find and Cart load pictures from your PC instead of from TrackaLacker every time.",
  highlights: [
    "Each picture is downloaded once, a few seconds apart, and then loads from your PC. Until its copy arrives, a product shows TrackaLacker's original picture.",
    "Saved pictures are the product photo itself rather than TrackaLacker's wide share banner, so products fill their cards.",
    "Products TrackaLacker sends no picture for still show Image unavailable."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
