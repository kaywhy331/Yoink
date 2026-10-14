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
  id: "yoink-1-30-47-notification-delivery-status",
  version: "1.30.47",
  publishedAt: "2026-10-14T22:12:00.000Z",
  title: "Check your Telegram delivery",
  summary: "The Test button now shows whether Telegram or Discord accepted your message, is retrying, or needs your attention.",
  highlights: [
    "Existing Telegram connections with alerts on and no message history receive one confirmation after updating.",
    "Setup → Alerts shows the last message result. Service acceptance and phone notifications are reported separately.",
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
