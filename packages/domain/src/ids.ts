import { createHash, randomUUID } from "node:crypto";

export function newId(prefix: string): string {
  const safePrefix = prefix.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32) || "id";
  return `${safePrefix}_${randomUUID().replaceAll("-", "")}`;
}

export function stableHash(...parts: Array<string | number | null | undefined>): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    const value = part === null || part === undefined ? "" : String(part);
    hash.update(String(Buffer.byteLength(value)), "utf8");
    hash.update(":", "utf8");
    hash.update(value, "utf8");
    hash.update("|", "utf8");
  }
  return hash.digest("hex");
}

export function nowIso(now: number | Date = Date.now()): string {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw new Error("A valid timestamp is required.");
  return date.toISOString();
}
