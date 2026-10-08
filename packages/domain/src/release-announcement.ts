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
  id: "yoink-1-30-6-browser-names",
  version: "1.30.6",
  publishedAt: "2026-10-08T15:00:00.000Z",
  title: "Your companion is named after its browser",
  summary: "The companion now tells Yoink which browser it runs in, so Setup lists a Brave companion as Brave instead of Chrome.",
  highlights: [
    "Setup › Chrome shows names such as Desktop - Windows - Brave or Desktop - Windows - Edge. A name you chose with Rename stays as it is.",
    "After a Yoink update, the companion reconnects to TrackaLacker by itself, so calls keep arriving.",
    "Calls, carts ready to check out and drop-watch alerts appear as desktop notifications from the companion."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
