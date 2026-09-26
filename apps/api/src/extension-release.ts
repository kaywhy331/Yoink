import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export interface ExtensionReleaseDescriptor {
  channel: "local-unpacked";
  version: string;
  packageReady: boolean;
  filename: string;
  downloadUrl: string;
  sha256: string;
  sizeBytes: number;
  installMode: "overwrite-and-reload";
}

export interface ResolvedExtensionRelease {
  descriptor: ExtensionReleaseDescriptor;
  path: string;
}

/** ZIP digests keyed by path, reused while mtime and size are unchanged (the companion polls this descriptor; PLAT-21). */
const releaseDigestCache = new Map<string, { mtimeMs: number; size: number; sha256: string }>();

export function resolveExtensionRelease(releaseRoot: string, version: string): ResolvedExtensionRelease {
  const normalizedVersion = String(version || "").trim();
  const safeVersion = RELEASE_VERSION_PATTERN.test(normalizedVersion) ? normalizedVersion : "";
  const filename = safeVersion ? `Yoink-Companion-${safeVersion}.zip` : "";
  const path = filename ? join(releaseRoot, filename) : "";
  let sha256 = "";
  let sizeBytes = 0;
  try {
    if (path) {
      const stat = statSync(path);
      if (stat.isFile() && stat.size > 0 && stat.size <= 20 * 1024 * 1024) {
        const cached = releaseDigestCache.get(path);
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
          sha256 = cached.sha256;
          sizeBytes = cached.size;
        } else {
          const body = readFileSync(path);
          sha256 = createHash("sha256").update(body).digest("hex");
          sizeBytes = body.length;
          releaseDigestCache.set(path, { mtimeMs: stat.mtimeMs, size: body.length, sha256 });
        }
      }
    }
  } catch {
    sha256 = "";
    sizeBytes = 0;
  }
  const packageReady = sha256 !== "";
  return {
    path: packageReady ? path : "",
    descriptor: {
      channel: "local-unpacked",
      version: safeVersion,
      packageReady,
      filename: packageReady ? filename : "",
      downloadUrl: packageReady ? "/api/v1/extension/release/download" : "",
      sha256,
      sizeBytes,
      installMode: "overwrite-and-reload"
    }
  };
}
