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
  id: "yoink-1-30-35-discord-calls",
  version: "1.30.35",
  publishedAt: "2026-10-13T06:00:00.000Z",
  title: "Discord calls, traced to your products",
  summary: "Discord messages that reach your Windows notifications become calls, each matched to the Yoink product it is about, and your plan decides what to do. Windows alerts you only when an item is in your cart and its checkout is open. Test call items and Best Buy adds are fixed.",
  highlights: [
    "Discord calls: when a Discord message about a store item reaches your Windows notifications (the Discord app, or Discord in Brave), Yoink matches it to a product by its store link, item number or name, and your plan acts on it as with TrackaLacker. Cart › Calls › Discord shows each message and the product it matched; Link product teaches Yoink a name it missed. Setup › Discord sets each channel to Add to cart, Log only or Ignore.",
    "Checkout alerts: Windows alerts you only when Chrome has added an item and opened checkout, and that window comes to the front. A call Yoink doesn't add stays in Cart › Calls with the reason, without an alert; Needs you and Best Buy asking for your SMS code still alert.",
    "Test calls and Best Buy: a newly linked Test call item no longer stops at the Add step, and when Best Buy's page features another seller's listing, Chrome opens Best Buy's own listing of that item number before checking it."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
