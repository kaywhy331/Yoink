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
  id: "yoink-1-19-5-self-correcting-store-checks",
  version: "1.19.5",
  publishedAt: "2026-09-04T01:57:17.000Z",
  title: "Store checks correct themselves",
  summary: "Automatic checks now prefer purchasable products, pause cart adds when checks keep failing, and report every run so a stalled store is visible.",
  highlights: [
    "Checks pick products you can buy right now, so a store with sold-out saved products can still pass its store checks after an update.",
    "Repeated failures pause cart adds for that store until a fresh passing check renews it; stalled stores open an incident.",
    "Every automatic check leaves a receipt, backs off instead of retrying blindly, and waits for you when a sign-in or store access is needed."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
