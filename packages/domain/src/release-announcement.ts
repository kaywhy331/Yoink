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
  id: "yoink-1-30-51-clearer-saves-and-next-steps",
  version: "1.30.51",
  publishedAt: "2026-11-04T15:29:29.000Z",
  title: "Clearer saves and next steps",
  summary: "Keep your saved choices, edit wants more easily on your phone, and see what each item needs next. Save confirmations and price reviews make changes easier to follow.",
  highlights: [
    "Save a new max with one click and get confirmation right away, with Undo available during refresh. Choices you leave alone, including pause state, quantity and stores, stay saved; unchanged saves leave your plan untouched. Bulk price review puts changes first, marks increases and counts the changes you will apply.",
    "Phone editing puts max, quantity and mode first, keeps Save visible and opens price history when you need it. Keyboard focus returns to the same item. Wanted explains why an item is waiting and what to do next, and connecting Telegram takes you straight to the next step.",
    "Retry a failed search without losing your search or filters. Missing timings stay marked as unavailable, and store readiness reflects how fresh its checks are. Catalog matching handles duplicates and conflicting details while keeping uncertain matches separate. Yoink and its maintenance tools use the same data folder, with guidance for older data."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
