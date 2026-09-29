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
  id: "yoink-1-28-4-calls-reach-chrome",
  version: "1.28.4",
  publishedAt: "2026-09-28T00:00:00.000Z",
  title: "Calls reach Chrome again, with proof on Home",
  summary: "The Chrome companion can pick up calls again, and Home now shows when each step of a call last happened.",
  highlights: [
    "Chrome can ask Yoink for calls again; before this update those requests were refused and notifications expired unseen. Calls too late for a cart add, or sent while cart adds are paused, now arrive as notifications.",
    "Home shows when a call last arrived, when Chrome last asked for calls, and when a notification was last delivered. Send a test alert from Settings › Notifications to prove the path.",
    "When product tracking goes quiet, Yoink and the companion popup say for how long instead of showing it as connected."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
