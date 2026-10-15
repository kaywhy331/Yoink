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
  id: "yoink-1-30-50-one-click-wants",
  version: "1.30.50",
  publishedAt: "2026-10-15T14:16:51.263Z",
  title: "Want it in one click",
  summary: "Want it now saves Yoink's suggested max automatically. Update existing wants together from Wanted.",
  highlights: [
    "Tap Want it to use the suggested price as your max, then tap Yoink whenever you want to edit it.",
    "Use suggested prices on Wanted reviews and applies prices to all eligible items at once.",
    "Suggestions use verified store sellers only. Third-party and unidentified sellers never set your suggested max."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
