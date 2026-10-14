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
  id: "yoink-1-30-42-product-kinds",
  version: "1.30.42",
  publishedAt: "2026-10-14T05:00:00.000Z",
  title: "Discord matches by product kind",
  summary: "A Discord message now matches only a product of its own kind (a Booster Bundle to a Booster Bundle, never to a Booster Display Box) across Pokémon, Lorcana, Riftbound, One Piece, Gundam and Dragon Ball.",
  highlights: [
    "Product kinds: Yoink reads each game's kinds from names (Booster Bundle, Booster Display, Elite Trainer Box and Pokémon Center ETB, Mini Tin and Tin, Illumineer's Trove, Champion and Showdown Decks, Double Pack Sets and more) and never matches one kind to another.",
    "Same item, other words: series words such as “Scarlet & Violet” and counts such as “15 Booster Packs” no longer stop a match, so a Super-Premium Collection message with them matches your Super Premium Collection.",
    "Quieter: messages from AI helper bots and Discord's own notices, such as a thread started or a message pinned, are skipped."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
