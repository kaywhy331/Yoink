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
  id: "yoink-1-30-38-discord-notices-and-drops",
  version: "1.30.38",
  publishedAt: "2026-10-13T18:00:00.000Z",
  title: "Discord: notices, drop times and several items",
  summary: "Yoink now tells a Discord notice from a product, reads drop and drawing times, and splits a message that lists several items into a call for each. Howl links no longer need an article site: the product page stands in.",
  highlights: [
    "Notices aren't products: a monitor's status, a teaser, news, or a message whose links land on a store's search, category, drawing or queue page is logged as a notice, and Yoink doesn't act on it.",
    "Drop and drawing times: a time such as “Drawing starts Oct 14, 2:00pm PDT” or “drops tomorrow 9am ET” shows with its call. A drop or queue time for an item Yoink has sets a drop window, so Chrome checks its page from 15 minutes before and your plan decides whether to add it; a drawing is shown only.",
    "Several items, closer matches: a message listing several items becomes a call for each, and a message about another set of the same line, such as a Star Trek Collector Booster Box, no longer matches your Hobbit one."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
