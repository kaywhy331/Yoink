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
  id: "yoink-1-30-3-companion-stays-current",
  version: "1.30.3",
  publishedAt: "2026-10-08T00:00:00.000Z",
  title: "Pictures from your PC, and a companion that keeps up",
  summary: "Yoink keeps its own copy of each product picture, and the Yoink app on your PC now updates the Chrome companion in the folder each browser already loads it from, so it stays paired.",
  highlights: [
    "Each picture is downloaded once and then loads from your PC. Until its copy arrives, a product shows TrackaLacker's original picture.",
    "When Yoink updates, it also updates a Yoink Companion that Chrome, Brave or Edge loads from another folder. The companion reloads into the new version by itself within a few minutes and keeps its pairing, store access and TrackaLacker link.",
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
