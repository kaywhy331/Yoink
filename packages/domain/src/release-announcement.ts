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
  id: "yoink-1-30-39-discord-stores-and-names",
  version: "1.30.39",
  publishedAt: "2026-10-13T20:00:00.000Z",
  title: "Discord: every store you want, and better names",
  summary: "A Discord alert that names no store is checked at each store you want the item from, and items a message adds get the name from their store page.",
  highlights: [
    "No store named: TrackaLacker Bot's Discord alerts tag a category such as @riftbound, not a store. An item you want is now checked at each store you want it from; one you don't want reads “No store named” instead of “Not matched to a product”.",
    "Better names: an item a Discord message adds is named from its store page's address when the message names no product, so “@Topps Everyone Enter” no longer becomes a product name, and a later message that names a placeholder item renames it.",
    "Notices, drop times and several items, from 1.30.38: a notice is logged and nothing more, a drop or queue time sets a drop window, a drawing time is shown, and a message listing several items becomes a call for each."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
