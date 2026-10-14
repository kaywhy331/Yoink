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
  id: "yoink-1-30-44-yoinkbot-checkout",
  version: "1.30.44",
  publishedAt: "2026-10-14T15:35:00.000Z",
  title: "YoinkBot alerts after a final checkout check",
  summary: "Connect Discord or Telegram in Setup → Alerts to receive checkout updates. Yoink checks the store's checkout before announcing success, including Amazon items that become unavailable after Add to cart.",
  highlights: [
    "Opt in to a Discord channel or Telegram private message. YoinkBot starts sending as soon as the checkout result reaches Yoink, with a store cart link, quantity, and verified item price.",
    "Out of stock at checkout means no ready alert. Sign-in, security checks, or an unverified checkout ask for your attention. Checkout remains manual.",
    "Stay logged in to the same store account on your phone and computer for faster checkout. Use Test in Setup → Alerts to check phone notifications."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
