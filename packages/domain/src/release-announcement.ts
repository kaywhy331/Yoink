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
  id: "yoink-1-30-33-stock-checks",
  version: "1.30.33",
  publishedAt: "2026-10-12T17:30:00.000Z",
  title: "Stock follows the store page, and test items stay saved",
  summary: "While a store's product page is the tab in front, Chrome checks its stock and price and Yoink records them for that item, so a sell-out or a restock you see shows in Yoink too. Cart adds record what they see, and the items you link for a Test call are kept to test again.",
  highlights: [
    "Stock as you browse: at Amazon, Target, Walmart and Best Buy, Chrome reads a product page's stock when it loads, when you come back to it, and every two minutes while it stays in front, without clicking anything. Product cards say Checked … · Chrome companion, and a page that only offers another seller's listing says Only another seller has it.",
    "Saved test items: every link you test in Setup › Stores › Test call is kept with its max price and quantity, named from its page and shown with the stock Chrome last saw. Test again sends it once more; Remove forgets it.",
    "Waiting on you: an add that still needs you to check the cart no longer turns away later calls for that same item, since Chrome reads the cart first and adds only what's missing. Calls for the item at your other stores wait until you mark that add Got it or Missed it, and the call log says Waiting on you."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
