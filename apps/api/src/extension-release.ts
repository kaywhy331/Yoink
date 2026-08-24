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

export function resolveExtensionRelease(releaseRoot: string, version: string): ResolvedExtensionRelease {
  const normalizedVersion = String(version || "").trim();
  const safeVersion = RELEASE_VERSION_PATTERN.test(normalizedVersion) ? normalizedVersion : "";
  const filename = safeVersion ? `Yoink-Companion-${safeVersion}.zip` : "";
  const path = filename ? join(releaseRoot, filename) : "";
  let body: Buffer | null = null;
  let sizeBytes = 0;
  try {
    if (path) {
      const stat = statSync(path);
      if (stat.isFile() && stat.size > 0 && stat.size <= 20 * 1024 * 1024) {
        body = readFileSync(path);
        sizeBytes = body.length;
      }
    }
  } catch {
    body = null;
    sizeBytes = 0;
  }
  const packageReady = body !== null;
  return {
    path: packageReady ? path : "",
    descriptor: {
      channel: "local-unpacked",
      version: safeVersion,
      packageReady,
      filename: packageReady ? filename : "",
      downloadUrl: packageReady ? "/api/v1/extension/release/download" : "",
      sha256: body ? createHash("sha256").update(body).digest("hex") : "",
      sizeBytes,
      installMode: "overwrite-and-reload"
    }
  };
}
