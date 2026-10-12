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
  id: "yoink-1-30-32-cart-top-up",
  version: "1.30.32",
  publishedAt: "2026-10-12T07:40:00.000Z",
  title: "A call fills your cart to your quantity, never past it",
  summary: "Your quantity for an item is how many your cart should hold. When a call comes in for something already in your cart, Chrome adds only what's missing, and when the cart already has them all it adds nothing and opens checkout.",
  highlights: [
    "Already in your cart: a second call for an item you haven't checked out yet no longer adds another on top. Chrome opens checkout in the same tab and the call log says \"Already in cart\".",
    "Partly there: with 1 of your 3 in the cart, Chrome adds 2. A store's per-order limit counts what's already in your cart too, so Chrome never asks for more than the store allows.",
    "When a cart doesn't match what Chrome added, Yoink now keeps a snapshot of the cart page for diagnostics. Your last Amazon call ended on \"Check your Amazon cart\" without one."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
