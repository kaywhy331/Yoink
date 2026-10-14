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
  id: "yoink-1-30-41-every-discord-message",
  version: "1.30.41",
  publishedAt: "2026-10-14T00:30:00.000Z",
  title: "Every Discord message comes through",
  summary: "Discord messages that aren't about a product now come through in your call log, so you can read announcements, notices and chat; sold-out product messages are left out.",
  highlights: [
    "Every server message: announcements, notices, chat and news from your Discord servers show in Cart › Calls as Discord messages, with the message under Why. DMs and group chats stay out; set a noisy channel to Ignore in Setup › Discord.",
    "Left out: messages about a product that sold out aren't listed, and Cart › Calls › Discord leaves out the ones whose item Yoink put in your cart, which the call log shows as cart adds.",
    "Diagnostics: your PC now waits longer for each report it sends, so they include your store settings again."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
