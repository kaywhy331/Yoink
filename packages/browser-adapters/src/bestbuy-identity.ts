import { selectorsFor } from "./selector-packs.js";

// Best Buy product codes identify a page, not the numeric SKU authorized by
// an add job. Only page evidence may bridge those two identities.
export function bestBuyProductCode(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port
      || !(url.hostname === "bestbuy.com" || url.hostname.endsWith(".bestbuy.com"))) return "";
    const code = url.pathname.match(/^\/product\/[^/]+\/([a-z0-9]{10})(?:\/sku\/\d{5,20})?\/?$/i)?.[1] || "";
    return /[a-z]/i.test(code) ? code.toUpperCase() : "";
  } catch {
    return "";
  }
}

export function bestBuyPageSku(document: Document, urlValue: string): string {
  const code = bestBuyProductCode(urlValue);
  if (!code) return "";
  const skus = new Set<string>();
  const add = (value: unknown) => {
    const sku = String(value ?? "").trim();
    if (/^\d{5,20}$/.test(sku)) skus.add(sku);
  };
  const fromUrl = (value: string): void => {
    try {
      const url = new URL(value, urlValue);
      if (bestBuyProductCode(url.href) !== code) return;
      add(url.pathname.match(/\/sku\/(\d{5,20})\/?$/i)?.[1]);
      for (const sku of url.searchParams.getAll("skuId")) add(sku);
    } catch { /* An invalid page link cannot supply identity. */ }
  };
  for (const element of document.querySelectorAll("link[rel='canonical'], meta[property='og:url']")) {
    fromUrl(element.getAttribute("href") || element.getAttribute("content") || "");
  }
  // Read Product entities only when their URL names this exact product code;
  // recommendation products and arbitrary application JSON are not evidence.
  let visited = 0;
  const visit = (value: unknown, depth = 0): void => {
    if (++visited > 2_000 || depth > 12 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const entry of value) visit(entry, depth + 1); return; }
    const item = value as Record<string, unknown>;
    const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
    if (types.includes("Product") && [item.url, item["@id"]].some((url) =>
      typeof url === "string" && bestBuyProductCode(url) === code)) add(item.sku);
    if (item["@graph"]) visit(item["@graph"], depth + 1);
    if (item.mainEntity) visit(item.mainEntity, depth + 1);
  };
  for (const script of document.querySelectorAll("script[type='application/ld+json']")) {
    if ((script.textContent || "").length > 512_000) continue;
    try { visit(JSON.parse(script.textContent || "")); } catch { /* Ignore malformed structured data. */ }
  }
  // A visible, explicitly labelled SKU in the main product region also works
  // on pages whose canonical metadata deliberately omits the numeric SKU.
  for (const element of document.querySelectorAll(
    ":is(main, [role='main'], #shop-main) :is([itemprop='sku'], .sku, .sku-value, .sku-label, [data-testid='sku'])"
  )) {
    if (element.closest(["aside", ...selectorsFor("bestbuy", "merchandisingScope")].join(", "))) continue;
    let hidden = false;
    for (let current: Element | null = element; current; current = current.parentElement) {
      const style = document.defaultView?.getComputedStyle(current);
      if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden") === "true"
        || style?.display === "none" || style?.visibility === "hidden" || style?.opacity === "0") hidden = true;
    }
    if (hidden) continue;
    const text = String(element.textContent || "").trim();
    add(text.match(/^(?:SKU\s*:?\s*)?(\d{5,20})\s*$/i)?.[1]);
  }
  return skus.size === 1 ? [...skus][0]! : "";
}
