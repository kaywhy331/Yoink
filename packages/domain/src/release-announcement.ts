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
  id: "yoink-1-30-36-discord-calls-to-cart",
  version: "1.30.36",
  publishedAt: "2026-10-13T15:00:00.000Z",
  title: "Discord calls go to your cart",
  summary: "A Discord call now goes the way a TrackaLacker call does: Yoink reads more kinds of store links, adds an item it doesn't have yet, and Chrome checks the store's page before adding what you want to your cart.",
  highlights: [
    "More kinds of messages: add-to-cart links, store links inside affiliate links, and short links such as amzn.to, a.co, bit.ly and howl.me now match the store item they lead to; Yoink asks only the short-link service where a link leads. Channel and server names from Discord in a browser now read correctly, and every channel of a store-alert server such as Retail Monitors counts as a store alert, except its chat and notices.",
    "No price in the message: for an item you want in your cart, Chrome checks the store's own price on its page and adds it only at or under your max, which is never above the MSRP.",
    "New items: a store link for an item Yoink doesn't have yet becomes that store's listing of the product the message names, or a new product, so you can tap Want it. A name match never adds an item to your cart on its own."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
