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
  id: "yoink-1-30-34-checkout-alerts",
  version: "1.30.34",
  publishedAt: "2026-10-13T02:30:00.000Z",
  title: "Alerts only when checkout is ready",
  summary: "Windows alerts you when an item is in your cart and its checkout is open, and that page comes to the front. Calls Yoink doesn't add stay in the call log with the reason, without an alert. Best Buy adds now open Best Buy's own listing when its page features another seller.",
  highlights: [
    "Checkout alerts: when Chrome has added an item and opened checkout, that window comes to the front with an alert, ready for you to place the order. Needs you, and Best Buy asking for your SMS code, still alert, since an add can't finish without you.",
    "Quiet calls: a call Yoink doesn't add (not wanted, over your max, already in your cart, sold out, set to Notify only) raises no Windows alert. Cart › Calls lists it as Skipped, Not added or No action with the reason.",
    "Best Buy's own listing: when Best Buy's page features another seller's listing of an item, Chrome opens Best Buy's own listing of that item number before checking it, so a Best Buy item in stock is added and one sold out says so."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
