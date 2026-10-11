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
  id: "yoink-1-30-28-cart-quantity",
  version: "1.30.28",
  publishedAt: "2026-10-11T08:00:00.000Z",
  title: "Calls add to your cart, several at a time",
  summary: "Set a quantity in Want it: at Amazon, Target, Walmart and Best Buy each call adds what you still need, never more than the store allows per order, then opens checkout.",
  highlights: [
    "Quantity in Want it works at all four stores (1 to 10). If a store limits an item, say 2 per order, Yoink adds that many and the call log says so.",
    "Cart adds that ended as \"sold out\" at Walmart, or stopped at Target and Best Buy before reaching the cart, are fixed. Chrome waits for the store page to finish loading before it judges the offer.",
    "Cart items with no MSRP anywhere add at any price up to your max. Confirm an MSRP in Want it when you want that limit too."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
