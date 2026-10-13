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
  id: "yoink-1-30-40-howl-first",
  version: "1.30.40",
  publishedAt: "2026-10-13T23:00:00.000Z",
  title: "Howl links first, and drops “tonight”",
  summary: "Cart adds and store links at every store Howl covers now open through your Howl ClickMate link, and a Discord drop time given only as a day is watched all through it.",
  highlights: [
    "Howl first: at Target, Walmart, Fanatics, Kohl's, Macy's and the other stores Howl covers, Yoink opens the store through Howl ClickMate with the product page the call landed on; Amazon, Best Buy and the rest open the store directly. Admin › Settings › Affiliate routing switches a store's Howl link off or on, and holds your Amazon Associates tag once you have one.",
    "Drops “tonight”: a Discord message such as “stock loaded, should drop tonight” sets a drop window for that time of day (tonight is 6 PM to 3 AM, “tomorrow” the whole day), and Chrome checks a wanted item's page every few minutes through it. An exact time still watches from 15 minutes before, at the faster pace.",
    "Watching: with Setup › Limits › Scheduled drops set to Watch drops for wanted items, Yoink watches every window for items you want in your cart; once Chrome sees one in stock, your plan adds it."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
