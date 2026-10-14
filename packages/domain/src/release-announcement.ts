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
  id: "yoink-1-30-43-product-kinds",
  version: "1.30.43",
  publishedAt: "2026-10-14T14:00:00.000Z",
  title: "Discord matches by product kind",
  summary: "A Discord message now matches only a product of its own kind (a Booster Bundle to a Booster Bundle, never to a Booster Display Box) across Pokémon, Lorcana, Riftbound, One Piece, Gundam and Dragon Ball.",
  highlights: [
    "Product kinds: Yoink reads each game's kinds from names (Booster Bundle, Booster Display, Elite Trainer Box and Pokémon Center ETB, Mini Tin and Tin, Illumineer's Trove, Champion and Showdown Decks, Double Pack Sets and more) and never matches one kind to another.",
    "Same item, other words: series words such as “Scarlet & Violet” and counts such as “15 Booster Packs” no longer stop a match. Messages from AI helper bots and Discord's own notices are skipped.",
    "TrackaLacker: a followed product no longer stops updating when one of its store items sits under another product in Yoink. Its prices and stock refresh every hour again, and that item stays where it is."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
