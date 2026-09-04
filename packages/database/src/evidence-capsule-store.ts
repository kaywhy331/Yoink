import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  EVIDENCE_CAPSULE_MAX_SNAPSHOT_BYTES,
  EVIDENCE_CAPSULE_TRIGGERS,
  RETAILER_ADAPTER_DIAGNOSTIC_OPERATIONS,
  RETAILER_ADAPTER_DIAGNOSTIC_OUTCOMES,
  RETAILER_ADAPTER_DIAGNOSTIC_STAGES,
  RETAILER_OBSERVER_VERSIONS,
  type EvidenceCapsuleEnvelope,
  type EvidenceCapsuleIndexEntry,
  type SupportedRetailerId
} from "../../contracts/src/index.js";
import { adapterDiagnosticLayoutFingerprint } from "./adapter-diagnostic-repository.js";

const CAPSULE_ID = /^cap_[A-Za-z0-9_-]{8,120}$/;
const SKU = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DUPLICATE_WINDOW_MS = 10 * 60_000;
const AUTOMATIC_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const MANUAL_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const MAX_PER_RETAILER = 50;

interface EvidenceIndex {
  version: 1;
  evidenceCapsulesEnabled: boolean;
  items: EvidenceCapsuleIndexEntry[];
}

export class EvidenceCapsuleStoreError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 413, readonly code: string, message: string) {
    super(message);
  }
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function validDate(value: unknown, name: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new EvidenceCapsuleStoreError(400, "invalid_capsule", `The capsule ${name} is invalid.`);
  }
  return value;
}

function validateCapsule(value: unknown): EvidenceCapsuleEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EvidenceCapsuleStoreError(400, "invalid_capsule", "An evidence capsule object is required.");
  }
  const capsule = value as EvidenceCapsuleEnvelope;
  if (capsule.contractVersion !== 1 || !CAPSULE_ID.test(String(capsule.id || ""))
    || !Object.hasOwn(RETAILER_OBSERVER_VERSIONS, capsule.retailerId)
    || !SKU.test(String(capsule.retailerSku || ""))
    || !RETAILER_ADAPTER_DIAGNOSTIC_OPERATIONS.includes(capsule.operation)
    || !EVIDENCE_CAPSULE_TRIGGERS.includes(capsule.trigger)
    || !RETAILER_ADAPTER_DIAGNOSTIC_OUTCOMES.includes(capsule.outcome)
    || !RETAILER_ADAPTER_DIAGNOSTIC_STAGES.includes(capsule.failureStage)
    || !capsule.snapshot || capsule.snapshot.encoding !== "gzip+base64"
    || !SHA256.test(String(capsule.snapshot.sha256 || ""))) {
    throw new EvidenceCapsuleStoreError(400, "invalid_capsule", "The evidence capsule contract is invalid.");
  }
  validDate(capsule.capturedAt, "capture time");
  let parsedUrl: URL;
  try { parsedUrl = new URL(capsule.url); } catch {
    throw new EvidenceCapsuleStoreError(400, "invalid_capsule", "The capsule URL is invalid.");
  }
  if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
    throw new EvidenceCapsuleStoreError(400, "invalid_capsule", "The capsule URL must contain only an HTTPS origin and pathname.");
  }
  const base64 = String(capsule.snapshot.html || "");
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new EvidenceCapsuleStoreError(400, "invalid_capsule", "The capsule snapshot encoding is invalid.");
  }
  const compressed = Buffer.from(base64, "base64");
  if (compressed.length !== Number(capsule.snapshot.bytes)
    || compressed.length > EVIDENCE_CAPSULE_MAX_SNAPSHOT_BYTES) {
    throw new EvidenceCapsuleStoreError(413, "capsule_too_large", "The evidence capsule snapshot exceeds the 3 MiB limit.");
  }
  if (hash(compressed) !== capsule.snapshot.sha256) {
    throw new EvidenceCapsuleStoreError(400, "invalid_capsule", "The capsule snapshot digest does not match its content.");
  }
  try {
    const uncompressed = gunzipSync(compressed, { maxOutputLength: 32 * 1024 * 1024 });
    if (!uncompressed.length) throw new Error("empty");
  } catch {
    throw new EvidenceCapsuleStoreError(400, "invalid_capsule", "The capsule snapshot is not valid bounded gzip data.");
  }
  if (!capsule.diagnostic || typeof capsule.diagnostic !== "object" || Array.isArray(capsule.diagnostic)
    || capsule.diagnostic.retailerId !== capsule.retailerId
    || capsule.diagnostic.retailerSku !== capsule.retailerSku
    || capsule.diagnostic.operation !== capsule.operation
    || capsule.diagnostic.outcome !== capsule.outcome
    || capsule.diagnostic.failureStage !== capsule.failureStage
    || capsule.diagnostic.reasonCode !== capsule.reasonCode
    || !Array.isArray(capsule.trace) || capsule.trace.length > 301) {
    throw new EvidenceCapsuleStoreError(400, "invalid_capsule", "The capsule diagnostic and envelope do not agree.");
  }
  return capsule;
}

export class EvidenceCapsuleStore {
  readonly root: string;
  readonly indexPath: string;

  constructor(dataDirectory = join(process.cwd(), "data")) {
    this.root = resolve(dataDirectory, "evidence");
    this.indexPath = join(this.root, "index.json");
  }

  private readIndex(): EvidenceIndex {
    if (!existsSync(this.indexPath)) return { version: 1, evidenceCapsulesEnabled: true, items: [] };
    try {
      const value = JSON.parse(readFileSync(this.indexPath, "utf8")) as Partial<EvidenceIndex> | EvidenceCapsuleIndexEntry[];
      if (Array.isArray(value)) return { version: 1, evidenceCapsulesEnabled: true, items: value };
      return {
        version: 1,
        evidenceCapsulesEnabled: value.evidenceCapsulesEnabled !== false,
        items: Array.isArray(value.items) ? value.items : []
      };
    } catch {
      throw new Error("The evidence capsule index is unreadable.");
    }
  }

  private writeIndex(index: EvidenceIndex): void {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const temporary = `${this.indexPath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, this.indexPath);
  }

  private absolutePath(relativePath: string): string {
    const path = resolve(this.root, relativePath);
    if (path !== this.root && !path.startsWith(`${this.root}${sep}`)) throw new Error("Unsafe evidence capsule path.");
    return path;
  }

  enabled(): boolean {
    return this.readIndex().evidenceCapsulesEnabled;
  }

  setEnabled(enabled: boolean): { evidenceCapsulesEnabled: boolean } {
    const index = this.readIndex();
    index.evidenceCapsulesEnabled = enabled === true;
    this.writeIndex(index);
    return { evidenceCapsulesEnabled: index.evidenceCapsulesEnabled };
  }

  accept(value: unknown, receivedAt = new Date().toISOString()): { accepted: true; entry: EvidenceCapsuleIndexEntry } {
    const capsule = validateCapsule(value);
    const now = Date.parse(validDate(receivedAt, "receive time"));
    const index = this.readIndex();
    if (!index.evidenceCapsulesEnabled) {
      throw new EvidenceCapsuleStoreError(403, "evidence_capsules_disabled", "Page snapshots for store repairs are disabled on this device.");
    }
    const duplicate = index.items.find((entry) => entry.retailerId === capsule.retailerId
      && entry.retailerSku === capsule.retailerSku
      && entry.sha256 === capsule.snapshot.sha256
      && Math.abs(now - Date.parse(entry.receivedAt)) <= DUPLICATE_WINDOW_MS);
    if (duplicate) {
      throw new EvidenceCapsuleStoreError(409, "duplicate_capsule", "This page snapshot was already saved.");
    }
    const layoutFingerprint = adapterDiagnosticLayoutFingerprint(capsule.retailerId, capsule.diagnostic.layout);
    const path = join(capsule.retailerId, `${capsule.id}.json.gz`);
    const expiresAt = new Date(now + (capsule.trigger === "manual" ? MANUAL_RETENTION_MS : AUTOMATIC_RETENTION_MS)).toISOString();
    const entry: EvidenceCapsuleIndexEntry = {
      id: capsule.id,
      retailerId: capsule.retailerId,
      retailerSku: capsule.retailerSku,
      operation: capsule.operation,
      trigger: capsule.trigger,
      outcome: capsule.outcome,
      failureStage: capsule.failureStage,
      reasonCode: capsule.reasonCode,
      observerVersion: capsule.observerVersion,
      addAdapterVersion: capsule.addAdapterVersion,
      packVersion: capsule.packVersion,
      extensionVersion: capsule.extensionVersion,
      layoutFingerprint,
      sha256: capsule.snapshot.sha256,
      bytes: capsule.snapshot.bytes,
      capturedAt: capsule.capturedAt,
      receivedAt,
      expiresAt,
      incidentKeyHash: hash([capsule.retailerId, capsule.operation, capsule.failureStage, capsule.reasonCode, layoutFingerprint].join(":")),
      path
    };
    const absolute = this.absolutePath(path);
    mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
    writeFileSync(absolute, gzipSync(Buffer.from(JSON.stringify(capsule), "utf8")), { mode: 0o600, flag: "wx" });
    index.items.push(entry);
    this.pruneIndex(index, now);
    this.writeIndex(index);
    return { accepted: true, entry };
  }

  private pruneIndex(index: EvidenceIndex, now: number): number {
    const retained = index.items.filter((entry) => Date.parse(entry.expiresAt) > now && existsSync(this.absolutePath(entry.path)));
    const keep = new Set<string>();
    for (const retailerId of Object.keys(RETAILER_OBSERVER_VERSIONS) as SupportedRetailerId[]) {
      retained.filter((entry) => entry.retailerId === retailerId)
        .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt))
        .slice(0, MAX_PER_RETAILER)
        .forEach((entry) => keep.add(entry.id));
    }
    let removed = 0;
    for (const entry of index.items) {
      if (keep.has(entry.id)) continue;
      try { unlinkSync(this.absolutePath(entry.path)); } catch { /* already absent */ }
      removed += 1;
    }
    index.items = retained.filter((entry) => keep.has(entry.id))
      .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt));
    return removed;
  }

  prune(now = Date.now()): { removed: number; retained: number } {
    const index = this.readIndex();
    const removed = this.pruneIndex(index, now);
    this.writeIndex(index);
    return { removed, retained: index.items.length };
  }

  list(filter: { retailerId?: string; fingerprint?: string; limit?: number } = {}): EvidenceCapsuleIndexEntry[] {
    const limit = Math.min(200, Math.max(1, Number.isInteger(filter.limit) ? Number(filter.limit) : 50));
    return this.readIndex().items.filter((entry) => (!filter.retailerId || entry.retailerId === filter.retailerId)
      && (!filter.fingerprint || entry.layoutFingerprint === filter.fingerprint || entry.incidentKeyHash === filter.fingerprint))
      .slice(0, limit);
  }

  detail(id: string): EvidenceCapsuleEnvelope | null {
    if (!CAPSULE_ID.test(id)) return null;
    const entry = this.readIndex().items.find((candidate) => candidate.id === id);
    if (!entry) return null;
    try {
      return JSON.parse(gunzipSync(readFileSync(this.absolutePath(entry.path)), { maxOutputLength: 40 * 1024 * 1024 }).toString("utf8")) as EvidenceCapsuleEnvelope;
    } catch {
      return null;
    }
  }

  delete(id: string): boolean {
    if (!CAPSULE_ID.test(id)) return false;
    const index = this.readIndex();
    const entry = index.items.find((candidate) => candidate.id === id);
    if (!entry) return false;
    try { unlinkSync(this.absolutePath(entry.path)); } catch { /* index remains authoritative */ }
    index.items = index.items.filter((candidate) => candidate.id !== id);
    this.writeIndex(index);
    return true;
  }

  summaries(): Record<string, { count: number; latestCapturedAt: string; latestId: string }> {
    const result: Record<string, { count: number; latestCapturedAt: string; latestId: string }> = {};
    for (const entry of this.readIndex().items) {
      const keys = [entry.incidentKeyHash, entry.layoutFingerprint, `${entry.retailerId}:${entry.layoutFingerprint}`];
      for (const key of keys) {
        const current = result[key];
        if (!current) result[key] = { count: 1, latestCapturedAt: entry.capturedAt, latestId: entry.id };
        else {
          current.count += 1;
          if (Date.parse(entry.capturedAt) > Date.parse(current.latestCapturedAt)) {
            current.latestCapturedAt = entry.capturedAt;
            current.latestId = entry.id;
          }
        }
      }
    }
    return result;
  }
}
