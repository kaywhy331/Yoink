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
  id: "yoink-1-17-2-bestbuy-account-readiness",
  version: "1.17.2",
  publishedAt: "2026-08-31T23:25:00.000Z",
  title: "Best Buy account gates report the right next step",
  summary: "Yoink now distinguishes Best Buy's visible account requirement from an actual rendered security challenge on current high-demand product pages.",
  highlights: [
    "CSS-hidden CAPTCHA scaffolding no longer masquerades as a visible Best Buy security check.",
    "A visible Account Required gate now asks the user to sign in and confirm location before retrying qualification.",
    "Passive high-demand messaging may qualify after sign-in, while real reservation gates, queues, and rendered security challenges remain fail-closed."
  ],
  docsUrl: "/docs"
});

export function currentUserReleaseAnnouncement(): UserReleaseAnnouncement {
  return {
    ...CURRENT_USER_RELEASE_ANNOUNCEMENT,
    highlights: [...CURRENT_USER_RELEASE_ANNOUNCEMENT.highlights]
  };
}
