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
  id: "yoink-1-30-22-faster-trackalacker-sync",
  version: "1.30.22",
  publishedAt: "2026-10-10T00:00:00.000Z",
  title: "Your TrackaLacker products stay current",
  summary: "Yoink now refreshes your followed TrackaLacker products by itself, every hour, and a full pass takes minutes instead of almost two hours.",
  highlights: [
    "Prices and stock refresh every hour; History MSRPs older than a week are read again overnight. Sync products runs a full pass now.",
    "Updates no longer cut a sync off, and a sync that stops picks up where it left off.",
    "Retry when sold out in Setup › Stores tries a sold-out item again in the same tab."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
