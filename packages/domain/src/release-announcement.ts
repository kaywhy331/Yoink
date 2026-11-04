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
    "Editing a want preserves the choices you leave alone, including pause state, quantity and stores. Saving without changes leaves your plan untouched.",
    "Save your new max with one click and get confirmation right away, with Undo still available while the dashboard refreshes.",
    "On your phone, max, quantity and mode come first, price history opens when you need it, and Save stays visible. Keyboard focus returns to the same item.",
    "Wanted explains whether an item is paused, waiting for stock, set to alert, or ready to add to cart, and shows the next step when something needs attention.",
    "Bulk price review puts changed prices first, marks increases and shows how many changes you will apply.",
    "Connecting Telegram takes you straight to the next step. A failed search offers Retry without losing your search or filters.",
    "Missing timing measurements stay marked as unavailable, and store readiness reflects how fresh its checks are.",
    "Catalog matching handles duplicate products and conflicting details more consistently, keeping uncertain matches separate.",
    "Yoink and its maintenance tools use the same data folder, with clearer guidance when older data needs moving."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
