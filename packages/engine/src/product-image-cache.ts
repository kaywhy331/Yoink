import {
  PRODUCT_IMAGE_MAX_BYTES,
  productImageDownloadUrl,
  productImageType,
  type ProductImageType
} from "../../domain/src/product-image.js";
import { productImageKey, type ProductImageStore } from "../../database/src/product-image-store.js";

const MINUTE_MS = 60_000;
const RETRY_FIRST_MS = 10 * MINUTE_MS;
const RETRY_MAX_MS = 24 * 60 * MINUTE_MS;

export interface ProductImageCacheOptions {
  store: ProductImageStore;
  /** Stored product image links, highest priority first. */
  sources: () => string[];
  fetch?: typeof fetch;
  now?: () => number;
  /** Resolves after the delay, or early when the signal aborts. */
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  log?: (line: string) => void;
  userAgent?: string;
  /** Between scheduled runs. */
  intervalMs?: number;
  /** Before the first run after start(), and after wake(). */
  startDelayMs?: number;
  /** Between two downloads, so the image host sees a trickle, never a burst. */
  spacingMs?: number;
  maxPerRun?: number;
  timeoutMs?: number;
}

export interface ProductImageRunSummary {
  saved: number;
  failed: number;
  /** Images Yoink saves that still have no copy here (they keep the original link). */
  pending: number;
  /** Stored links Yoink does not save (another host); they keep the original link. */
  unsupported: number;
  removed: number;
}

type DownloadResult =
  | { ok: true; bytes: Uint8Array; type: ProductImageType }
  | { ok: false; permanent: boolean; reason: string };

function abortableSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

async function discard(response: Response): Promise<void> {
  try { await response.body?.cancel(); } catch { /* nothing left to read */ }
}

/**
 * The scheduled routine that saves product images on this install. Each run is
 * deterministic: it walks the stored image links newest product first, skips
 * what is already saved or waiting out a retry, and downloads the rest one at a
 * time with a pause between them. A copy is downloaded once; until then the
 * dashboard keeps the original link. Failures retry later (10 minutes, doubling
 * to a day), never on every run.
 */
export class ProductImageCache {
  private readonly store: ProductImageStore;
  private readonly sources: () => string[];
  private readonly fetchImage: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  private readonly log: (line: string) => void;
  private readonly userAgent: string;
  private readonly intervalMs: number;
  private readonly startDelayMs: number;
  private readonly spacingMs: number;
  private readonly maxPerRun: number;
  private readonly timeoutMs: number;
  private readonly failures = new Map<string, { attempts: number; retryAt: number }>();
  private controller = new AbortController();
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextRunAt = 0;
  private current: Promise<ProductImageRunSummary> | null = null;
  private rerun = false;

  constructor(options: ProductImageCacheOptions) {
    this.store = options.store;
    this.sources = options.sources;
    this.fetchImage = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? abortableSleep;
    this.log = options.log ?? (() => {});
    this.userAgent = options.userAgent ?? "Yoink (product images)";
    this.intervalMs = options.intervalMs ?? 10 * MINUTE_MS;
    this.startDelayMs = options.startDelayMs ?? 30_000;
    this.spacingMs = options.spacingMs ?? 2_000;
    this.maxPerRun = options.maxPerRun ?? 200;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.controller = new AbortController();
    this.schedule(this.startDelayMs);
  }

  /** A catalog import may have brought new images: run soon instead of at the next interval. */
  wake(): void {
    if (!this.running) return;
    if (this.current) {
      this.rerun = true;
      return;
    }
    if (this.timer && this.nextRunAt <= this.now() + this.startDelayMs) return;
    this.schedule(this.startDelayMs);
  }

  /** Stops the schedule and any download in flight; resolves once the current run has ended. */
  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.controller.abort();
    try {
      await this.current;
    } catch {
      // A failed run has nothing left to clean up.
    }
  }

  async runOnce(): Promise<ProductImageRunSummary> {
    const signal = this.controller.signal;
    const summary: ProductImageRunSummary = { saved: 0, failed: 0, pending: 0, unsupported: 0, removed: 0 };
    let sources: string[];
    try {
      sources = this.sources();
    } catch {
      return summary;
    }
    // One download per photo, kept in the order the sources gave.
    const wanted = new Map<string, string>();
    for (const source of sources) {
      const download = productImageDownloadUrl(source);
      if (!download) {
        summary.unsupported += 1;
        continue;
      }
      const key = productImageKey(download);
      if (!wanted.has(key)) wanted.set(key, download);
    }
    let attempted = 0;
    for (const [key, download] of wanted) {
      if (signal.aborted || attempted >= this.maxPerRun) break;
      if (this.store.has(key)) continue;
      const failure = this.failures.get(key);
      if (failure && failure.retryAt > this.now()) continue;
      if (attempted > 0) await this.sleep(this.spacingMs, signal);
      if (signal.aborted) break;
      attempted += 1;
      const result = await this.download(download, signal);
      if (signal.aborted) break;
      if (result.ok) {
        try {
          this.store.save(key, result.bytes, result.type);
          this.failures.delete(key);
          summary.saved += 1;
          continue;
        } catch {
          this.recordFailure(key, false);
          summary.failed += 1;
          continue;
        }
      }
      this.recordFailure(key, result.permanent);
      summary.failed += 1;
    }
    // An empty list is never taken as "delete everything"; a catalog read that
    // came back empty by mistake must not wipe the folder.
    if (!signal.aborted && wanted.size) summary.removed = this.store.prune(new Set(wanted.keys()));
    for (const key of wanted.keys()) if (!this.store.has(key)) summary.pending += 1;
    if (summary.saved || summary.failed || summary.removed) {
      const parts = [`saved ${summary.saved}`];
      if (summary.failed) parts.push(`${summary.failed} failed and will retry later`);
      if (summary.removed) parts.push(`removed ${summary.removed} no product uses`);
      this.log(`Yoink product images: ${parts.join(", ")}; ${wanted.size - summary.pending} of ${wanted.size} saved on this PC.`);
    }
    return summary;
  }

  private schedule(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.nextRunAt = this.now() + delayMs;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (!this.running || this.current) return;
    this.current = this.runOnce();
    try {
      await this.current;
    } catch {
      // The next scheduled run tries again.
    } finally {
      this.current = null;
    }
    if (!this.running) return;
    const soon = this.rerun;
    this.rerun = false;
    this.schedule(soon ? this.startDelayMs : this.intervalMs);
  }

  private recordFailure(key: string, permanent: boolean): void {
    const attempts = (this.failures.get(key)?.attempts ?? 0) + 1;
    const delay = permanent ? RETRY_MAX_MS : Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** (attempts - 1));
    this.failures.set(key, { attempts, retryAt: this.now() + delay });
  }

  private async download(url: string, signal: AbortSignal): Promise<DownloadResult> {
    let response: Response;
    try {
      response = await this.fetchImage(url, {
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]),
        headers: { Accept: "image/webp,image/avif,image/png,image/jpeg;q=0.8", "User-Agent": this.userAgent }
      });
    } catch {
      return { ok: false, permanent: false, reason: "unreachable" };
    }
    if (response.status === 404 || response.status === 410) {
      await discard(response);
      return { ok: false, permanent: true, reason: `http_${response.status}` };
    }
    if (response.status !== 200) {
      await discard(response);
      return { ok: false, permanent: false, reason: `http_${response.status}` };
    }
    const declared = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > PRODUCT_IMAGE_MAX_BYTES) {
      await discard(response);
      return { ok: false, permanent: true, reason: "too_large" };
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      const reader = response.body?.getReader();
      if (!reader) return { ok: false, permanent: false, reason: "empty" };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > PRODUCT_IMAGE_MAX_BYTES) {
          await reader.cancel();
          return { ok: false, permanent: true, reason: "too_large" };
        }
        chunks.push(value);
      }
    } catch {
      return { ok: false, permanent: false, reason: "interrupted" };
    }
    const bytes = Buffer.concat(chunks);
    const type = productImageType(bytes);
    // A browser-check page answers 200 too; it is retried later, never saved.
    return type ? { ok: true, bytes, type } : { ok: false, permanent: false, reason: "not_an_image" };
  }
}
