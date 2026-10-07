/**
 * Product images that a local Yoink keeps on its own disk. Kevin asked (2026-09-07,
 * 2026-10-07) that dashboards stop loading TrackaLacker's image host on every view:
 * Yoink downloads each image once and serves it from its own address, and until a
 * copy exists the dashboard keeps the original link. These rules are pure so the
 * store, the download routine and the tests share them.
 */

/** Longest side, in pixels, of the copy Yoink keeps; the photo keeps its own shape. */
export const PRODUCT_IMAGE_EDGE_PX = 480;
/** Largest download Yoink accepts for one product image. */
export const PRODUCT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
/** Same-origin path that serves saved copies; dashboards load `${prefix}<file>`. */
export const PRODUCT_IMAGE_PATH_PREFIX = "/media/products/";

export type ProductImageType = "webp" | "jpg" | "png" | "avif";

export const PRODUCT_IMAGE_CONTENT_TYPES: Readonly<Record<ProductImageType, string>> = Object.freeze({
  webp: "image/webp",
  jpg: "image/jpeg",
  png: "image/png",
  avif: "image/avif"
});

const TRACKALACKER_IMAGE_HOST = "static.trackalacker.com";
// Cloudflare image resizing on TrackaLacker's host: the product photo itself instead
// of the 1200x630 share banner that og:image returns (the photo, fitted inside 480x480).
const TRACKALACKER_IMAGE_OPTIONS =
  `fit=contain,width=${PRODUCT_IMAGE_EDGE_PX},height=${PRODUCT_IMAGE_EDGE_PX},quality=85,format=webp`;
// An uploaded photo, either the original or any resized copy of it.
const TRACKALACKER_UPLOAD_PATH = /^\/(?:cdn-cgi\/image\/[^/]+\/)?(uploads\/[^?#]+)$/;

/**
 * The address Yoink downloads its copy from, or "" when Yoink does not save this
 * image (another host, not HTTPS, or not an uploaded product photo); those keep
 * their original link. A stored share banner and the original upload of the same
 * photo map to the same download, so the photo is saved once.
 */
export function productImageDownloadUrl(sourceUrl: string): string {
  let url: URL;
  try {
    url = new URL(String(sourceUrl ?? ""));
  } catch {
    return "";
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
  if (url.hostname.toLowerCase() !== TRACKALACKER_IMAGE_HOST) return "";
  const upload = TRACKALACKER_UPLOAD_PATH.exec(url.pathname)?.[1];
  if (!upload || upload.split("/").some((segment) => !segment || segment === "." || segment === "..")) return "";
  return `https://${TRACKALACKER_IMAGE_HOST}/cdn-cgi/image/${TRACKALACKER_IMAGE_OPTIONS}/${upload}`;
}

/**
 * The image format from a file's first bytes, or null for anything else. A
 * browser-check page or an error body must never be saved as a product image.
 */
export function productImageType(bytes: Uint8Array): ProductImageType | null {
  const text = (start: number, end: number): string => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length >= 12 && text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return "webp";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && text(1, 4) === "PNG"
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "png";
  if (bytes.length >= 12 && text(4, 8) === "ftyp" && ["avif", "avis"].includes(text(8, 12))) return "avif";
  return null;
}
