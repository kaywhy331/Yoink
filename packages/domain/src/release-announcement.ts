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
  id: "yoink-1-30-45-simple-notifications",
  version: "1.30.45",
  publishedAt: "2026-10-14T17:15:00.000Z",
  title: "Simpler checkout notifications",
  summary: "Connect your Discord or Telegram account in Setup → Alerts. Your notification preferences are now together in one focused screen.",
  highlights: [
    "Connect, pause, test or disconnect your alerts anytime. Business setup is handled for you.",
    "Settings show one section at a time, with clearer store status and fewer controls.",
    "Yoink still verifies availability at checkout before sending a ready alert. Stay logged in to the same store account on your phone and computer for faster checkout."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
