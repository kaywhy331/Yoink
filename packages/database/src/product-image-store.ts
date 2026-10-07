import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  PRODUCT_IMAGE_CONTENT_TYPES,
  PRODUCT_IMAGE_PATH_PREFIX,
  productImageDownloadUrl,
  type ProductImageType
} from "../../domain/src/product-image.js";
import type { YoinkDatabase } from "./database.js";

const SAVED_FILE = /^([a-f0-9]{64})\.(webp|jpg|png|avif)$/;
const PARTIAL_FILE = /^[a-f0-9]{64}\.partial-[a-f0-9]{16}$/;

/** Name of the saved copy for a download address: the same image is never saved twice. */
export function productImageKey(downloadUrl: string): string {
  return createHash("sha256").update(downloadUrl).digest("hex");
}

/**
 * Product images saved on this install, under <data>/media/products. The folder is
 * the whole state: a file named after the digest of its download address means the
 * copy exists. There is no table, so the PostgreSQL cutover seal is untouched, and
 * a data import without the folder simply downloads the images again.
 */
export class ProductImageStore {
  readonly directory: string;
  private readonly saved = new Map<string, string>();

  constructor(dataDirectory: string) {
    this.directory = join(dataDirectory, "media", "products");
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    for (const name of readdirSync(this.directory)) {
      const match = SAVED_FILE.exec(name);
      if (match?.[1]) this.saved.set(match[1], name);
      else if (PARTIAL_FILE.test(name)) {
        // Left by a save that was cut off; the next run downloads it again.
        try { unlinkSync(join(this.directory, name)); } catch { /* already gone */ }
      }
    }
  }

  get savedCount(): number {
    return this.saved.size;
  }

  has(key: string): boolean {
    return this.saved.has(key);
  }

  /** What a dashboard should load: the saved copy when there is one, otherwise the original link. */
  localUrl(sourceUrl: string): string {
    const download = productImageDownloadUrl(sourceUrl);
    const name = download ? this.saved.get(productImageKey(download)) : undefined;
    return name ? `${PRODUCT_IMAGE_PATH_PREFIX}${name}` : sourceUrl;
  }

  /** Writes beside the final name, then renames, so a reader never sees half a file. */
  save(key: string, bytes: Uint8Array, type: ProductImageType): string {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new RangeError("A product image key is a SHA-256 hex digest.");
    const name = `${key}.${type}`;
    const partial = join(this.directory, `${key}.partial-${randomBytes(8).toString("hex")}`);
    try {
      writeFileSync(partial, bytes, { mode: 0o600, flag: "wx" });
      renameSync(partial, join(this.directory, name));
    } catch (error) {
      try { unlinkSync(partial); } catch { /* never written */ }
      throw error;
    }
    const previous = this.saved.get(key);
    this.saved.set(key, name);
    if (previous && previous !== name) {
      try { unlinkSync(join(this.directory, previous)); } catch { /* already gone */ }
    }
    return name;
  }

  /** The saved file behind `/media/products/<name>`, or null when there is none. */
  read(name: string): { body: Buffer; contentType: string } | null {
    const match = SAVED_FILE.exec(name);
    if (!match?.[1] || this.saved.get(match[1]) !== name) return null;
    try {
      return {
        body: readFileSync(join(this.directory, name)),
        contentType: PRODUCT_IMAGE_CONTENT_TYPES[match[2] as ProductImageType]
      };
    } catch {
      this.saved.delete(match[1]);
      return null;
    }
  }

  /** Deletes saved copies that no product links to any more; returns how many went. */
  prune(keep: ReadonlySet<string>): number {
    let removed = 0;
    for (const [key, name] of [...this.saved]) {
      if (keep.has(key)) continue;
      try {
        unlinkSync(join(this.directory, name));
      } catch {
        // Already gone; forget it either way.
      }
      this.saved.delete(key);
      removed += 1;
    }
    return removed;
  }
}

/** Every distinct stored product image link, newest product first (the order Find shows). */
export function productImageSources(db: YoinkDatabase): string[] {
  return db.all<{ imageUrl: string }>(
    `SELECT image_url AS imageUrl FROM variants
     WHERE image_url <> ''
     GROUP BY image_url
     ORDER BY MAX(created_at) DESC, image_url`
  ).map((row) => row.imageUrl);
}
