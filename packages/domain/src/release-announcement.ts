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
  id: "yoink-1-30-46-telegram-confirmation",
  version: "1.30.46",
  publishedAt: "2026-10-14T18:12:00.000Z",
  title: "Telegram connection confirmation",
  summary: "YoinkBot now replies when your Telegram account connects, so you can confirm the chat is ready.",
  highlights: [
    "Use the Open Telegram link in Setup → Alerts and tap Start. YoinkBot automatically queues a confirmation after connecting.",
    "Temporary delivery failures are retried. Already connected? Use Test to check your Telegram messages.",
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
