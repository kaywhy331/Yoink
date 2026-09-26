// Guards shared by the store add runners, so a fix lands in every lane.

/**
 * Shopify-style product URLs: the page must be the same product path on the
 * same host as the job's canonical URL, and any `variant` the page carries
 * must be the job's variant. (The binding re-checks the variant against the
 * form; this pins the product handle too.)
 */
export function sameShopifyListingUrl(canonicalUrl: string, currentUrl: string, variantId: string): boolean {
  try {
    const canonical = new URL(canonicalUrl);
    const current = new URL(currentUrl);
    const path = (url: URL) => url.pathname.replace(/\/+$/, "").toLocaleLowerCase("en-US");
    return current.protocol === "https:" && current.hostname === canonical.hostname
      && path(current) === path(canonical)
      && current.searchParams.getAll("variant").length <= 1
      && (!current.searchParams.has("variant") || current.searchParams.get("variant") === variantId);
  } catch {
    return false;
  }
}
