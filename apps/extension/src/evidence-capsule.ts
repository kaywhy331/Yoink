import {
  EVIDENCE_CAPSULE_CONTRACT_VERSION,
  EVIDENCE_CAPSULE_MAX_SNAPSHOT_BYTES,
  type AdapterTraceEntry,
  type EvidenceCapsuleEnvelope,
  type EvidenceCapsuleRedactions,
  type EvidenceCapsuleTrigger,
  type RetailerAdapterDiagnosticInput,
  type SupportedRetailerId
} from "../../../packages/contracts/src/index.js";

const PRIVATE_KEY = /(account|session|token|auth|credential|password|secret|email|phone|address|zip|postal|cookie|csrf|payment|card|customer|user|profile|visitor|device|fingerprint|geo|latitude|longitude)/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?<!\d)(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}(?!\d)/g;
const CANDIDATE_SELECTOR = "button, input, select, a[href], meta, [role='button'], [data-test], [data-testid], [data-test-id], [data-automation-id], [itemprop], [aria-label]";
const TEXT_ENCODER = new TextEncoder();

export interface EvidenceSanitizerEnvironment {
  isVisible?: (element: Element) => boolean;
  rect?: (element: Element) => Pick<DOMRect, "x" | "y" | "width" | "height">;
  now?: () => number;
  deadlineAt?: number;
}

export interface SanitizedEvidenceDocument {
  document: Document;
  redactions: EvidenceCapsuleRedactions;
  elementCount: number;
  timedOut: boolean;
}

export interface EvidenceCapsuleCaptureInput {
  document: Document;
  url: string;
  retailerId: SupportedRetailerId;
  retailerSku: string;
  diagnostic: RetailerAdapterDiagnosticInput;
  trigger: EvidenceCapsuleTrigger;
  observerVersion: string;
  addAdapterVersion: string;
  packVersion?: string;
  extensionVersion: string;
  requiredFulfillment?: "shipping" | "pickup";
  trace?: AdapterTraceEntry[];
  capturedAt?: string;
  id?: string;
  viewport?: { width: number; height: number; devicePixelRatio: number };
  environment?: EvidenceSanitizerEnvironment;
  budgetMs?: number;
}

function blankRedactions(): EvidenceCapsuleRedactions {
  return {
    scriptsRemoved: 0,
    jsonBlocksKept: 0,
    keysRedacted: 0,
    inputsCleared: 0,
    iframesReduced: 0,
    mediaStripped: 0,
    textRedactions: 0
  };
}

function redactedJson(value: unknown, redactions: EvidenceCapsuleRedactions): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactedJson(entry, redactions));
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (PRIVATE_KEY.test(key)) {
      result[key] = "[redacted]";
      redactions.keysRedacted += 1;
    } else {
      result[key] = redactedJson(entry, redactions);
    }
  }
  return result;
}

function defaultVisible(element: Element): boolean {
  try {
    const view = element.ownerDocument?.defaultView;
    const style = view?.getComputedStyle?.(element);
    return style?.display !== "none" && style?.visibility !== "hidden" && style?.opacity !== "0"
      && element.getClientRects().length > 0;
  } catch {
    return false;
  }
}

function safeRect(element: Element, environment: EvidenceSanitizerEnvironment) {
  try {
    return environment.rect?.(element) ?? element.getBoundingClientRect();
  } catch {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
}

function reduceFrameSource(value: string): string {
  try {
    const parsed = new URL(value, "https://invalid.local/");
    if (!/^https?:$/.test(parsed.protocol)) return "";
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "";
  }
}

function redactText(value: string, redactions: EvidenceCapsuleRedactions): string {
  let count = 0;
  const replaced = value.replace(EMAIL, () => { count += 1; return "[redacted]"; })
    .replace(PHONE, () => { count += 1; return "[redacted]"; });
  redactions.textRedactions += count;
  return replaced;
}

export function sanitizeEvidenceDocument(
  source: Document,
  environment: EvidenceSanitizerEnvironment = {}
): SanitizedEvidenceDocument {
  if (!source?.documentElement) throw new Error("A page document is required for an evidence capsule.");
  const clone = source.cloneNode(true) as Document;
  const originals = Array.from(source.querySelectorAll("*"));
  const copies = Array.from(clone.querySelectorAll("*"));
  const elementCount = Math.min(originals.length, copies.length, 20_000);
  const visible = environment.isVisible ?? defaultVisible;
  const clock = environment.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
  const deadlineAt = Number.isFinite(environment.deadlineAt) ? Number(environment.deadlineAt) : Number.POSITIVE_INFINITY;
  const expired = () => clock() >= deadlineAt;
  const truncateSafely = () => {
    clone.documentElement.innerHTML = "<head></head><body><main data-yoink-vis=\"1\">Snapshot capture reached its local time limit.</main></body>";
  };
  let timedOut = false;
  for (let index = 0; index < elementCount; index += 1) {
    if (expired()) {
      timedOut = true;
      truncateSafely();
      break;
    }
    const original = originals[index];
    const copy = copies[index];
    if (!original || !copy) continue;
    let isVisible = false;
    try { isVisible = visible(original) === true; } catch { isVisible = false; }
    copy.setAttribute("data-yoink-vis", isVisible ? "1" : "0");
    if (original.matches(CANDIDATE_SELECTOR)) {
      const rect = safeRect(original, environment);
      copy.setAttribute("data-yoink-rect", [rect.x, rect.y, rect.width, rect.height]
        .map((part) => Math.round(Number(part) || 0)).join(","));
    }
  }

  const redactions = blankRedactions();
  if (timedOut) return { document: clone, redactions, elementCount, timedOut };
  for (const script of Array.from(clone.querySelectorAll("script"))) {
    if (expired()) {
      timedOut = true;
      truncateSafely();
      break;
    }
    const type = String(script.getAttribute("type") || "").trim().toLocaleLowerCase("en-US");
    if (type !== "application/json" && type !== "application/ld+json") {
      script.remove();
      redactions.scriptsRemoved += 1;
      continue;
    }
    try {
      script.textContent = JSON.stringify(redactedJson(JSON.parse(script.textContent || ""), redactions));
      redactions.jsonBlocksKept += 1;
    } catch {
      script.remove();
      redactions.scriptsRemoved += 1;
    }
  }

  if (timedOut) return { document: clone, redactions, elementCount, timedOut };

  for (const element of Array.from(clone.querySelectorAll("*"))) {
    if (expired()) {
      timedOut = true;
      truncateSafely();
      break;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLocaleLowerCase("en-US");
      if (name.startsWith("on")) element.removeAttribute(attribute.name);
      if (["href", "src", "action", "formaction"].includes(name)
        && /^(?:javascript|data):/i.test(attribute.value.trim())) element.removeAttribute(attribute.name);
    }
    if (element.tagName === "INPUT") {
      const input = element as HTMLInputElement;
      const hidden = input.type.toLocaleLowerCase("en-US") === "hidden";
      const privateHidden = hidden && PRIVATE_KEY.test(`${input.name} ${input.id}`);
      if (!hidden || privateHidden) {
        if (input.value || input.hasAttribute("value")) redactions.inputsCleared += 1;
        input.value = "";
        input.setAttribute("value", "");
      }
    } else if (element.tagName === "TEXTAREA") {
      const textarea = element as HTMLTextAreaElement;
      if (textarea.value || textarea.textContent) redactions.inputsCleared += 1;
      textarea.value = "";
      textarea.textContent = "";
    }
    if (element.tagName === "IFRAME") {
      const reduced = reduceFrameSource(element.getAttribute("src") || "");
      element.replaceChildren();
      element.removeAttribute("srcdoc");
      if (reduced) element.setAttribute("src", reduced);
      else element.removeAttribute("src");
      redactions.iframesReduced += 1;
    }
    if (["IMG", "SOURCE", "VIDEO", "AUDIO"].includes(element.tagName)) {
      let changed = false;
      for (const name of ["src", "srcset", "poster"]) {
        if (element.hasAttribute(name)) changed = true;
        element.removeAttribute(name);
      }
      if (changed) redactions.mediaStripped += 1;
    }
  }
  if (timedOut) return { document: clone, redactions, elementCount, timedOut };
  for (const link of Array.from(clone.querySelectorAll("link[rel~='stylesheet' i]"))) link.remove();
  const walker = clone.createTreeWalker(clone.documentElement, 4);
  let textNode = walker.nextNode();
  while (textNode) {
    if (expired()) {
      timedOut = true;
      truncateSafely();
      break;
    }
    textNode.nodeValue = redactText(textNode.nodeValue || "", redactions);
    textNode = walker.nextNode();
  }
  return { document: clone, redactions, elementCount, timedOut };
}

export function serializeEvidenceDocument(documentValue: Document): string {
  const doctype = documentValue.doctype
    ? `<!DOCTYPE ${documentValue.doctype.name}>\n`
    : "<!DOCTYPE html>\n";
  return `${doctype}${documentValue.documentElement.outerHTML}`;
}

async function gzip(value: string): Promise<Uint8Array> {
  const stream = new Blob([TEXT_ENCODER.encode(value)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function base64(value: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < value.length; offset += chunk) {
    binary += String.fromCharCode(...value.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

async function sha256(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function newCapsuleId(): string {
  return `cap_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function canonicalEvidenceUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("Evidence capsules require a credential-free HTTPS product URL.");
  }
  return `${parsed.origin}${parsed.pathname}`;
}

export function shouldCaptureEvidenceCapsule(
  diagnostic: Pick<RetailerAdapterDiagnosticInput, "operation" | "outcome" | "failureStage">,
  manual = false
): boolean {
  if (manual) return true;
  if (diagnostic.operation === "observe") return diagnostic.outcome === "failed";
  if (!["rehearse_add", "live_add"].includes(diagnostic.operation)
    || !["failed", "rejected"].includes(diagnostic.outcome)) return false;
  return new Set([
    "availability_binding", "add_control", "sku_binding", "offer_binding", "price_binding",
    "seller_binding", "fulfillment_binding", "quantity_binding", "route_binding"
  ]).has(diagnostic.failureStage);
}

async function snapshotWithinLimit(documentValue: Document, expired: () => boolean) {
  const reductionApplied: EvidenceCapsuleEnvelope["reductionApplied"] = [];
  const truncateForDeadline = async () => {
    documentValue.documentElement.innerHTML = "<head></head><body><main data-yoink-vis=\"1\">Snapshot capture reached its local time limit.</main></body>";
    const html = serializeEvidenceDocument(documentValue);
    return { html, compressed: await gzip(html), reductionApplied, truncated: true, timedOut: true };
  };
  let html = serializeEvidenceDocument(documentValue);
  let compressed = await gzip(html);
  if (expired()) return truncateForDeadline();
  if (compressed.length > EVIDENCE_CAPSULE_MAX_SNAPSHOT_BYTES) {
    for (const svg of Array.from(documentValue.querySelectorAll("svg"))) svg.replaceChildren();
    reductionApplied.push("svg_children");
    html = serializeEvidenceDocument(documentValue);
    compressed = await gzip(html);
    if (expired()) return truncateForDeadline();
  }
  if (compressed.length > EVIDENCE_CAPSULE_MAX_SNAPSHOT_BYTES) {
    for (const style of Array.from(documentValue.querySelectorAll("style"))) style.remove();
    reductionApplied.push("styles");
    html = serializeEvidenceDocument(documentValue);
    compressed = await gzip(html);
    if (expired()) return truncateForDeadline();
  }
  if (compressed.length > EVIDENCE_CAPSULE_MAX_SNAPSHOT_BYTES) {
    for (const element of Array.from(documentValue.querySelectorAll('[data-yoink-vis="0"]'))) {
      if (!element.matches(CANDIDATE_SELECTOR) && !element.querySelector(CANDIDATE_SELECTOR)) element.remove();
    }
    reductionApplied.push("hidden_elements");
    html = serializeEvidenceDocument(documentValue);
    compressed = await gzip(html);
    if (expired()) return truncateForDeadline();
  }
  let truncated = false;
  if (compressed.length > EVIDENCE_CAPSULE_MAX_SNAPSHOT_BYTES) {
    const suffix = "</body></html>";
    let low = 0;
    let high = html.length;
    let bestHtml = suffix;
    let bestGzip = await gzip(bestHtml);
    while (low <= high) {
      if (expired()) return truncateForDeadline();
      const middle = Math.floor((low + high) / 2);
      const candidate = `${html.slice(0, middle)}${suffix}`;
      const candidateGzip = await gzip(candidate);
      if (candidateGzip.length <= EVIDENCE_CAPSULE_MAX_SNAPSHOT_BYTES) {
        bestHtml = candidate;
        bestGzip = candidateGzip;
        low = middle + 1;
      } else high = middle - 1;
    }
    html = bestHtml;
    compressed = bestGzip;
    reductionApplied.push("cut_at_cap");
    truncated = true;
  }
  return { html, compressed, reductionApplied, truncated, timedOut: false };
}

export async function captureEvidenceCapsule(input: EvidenceCapsuleCaptureInput): Promise<EvidenceCapsuleEnvelope> {
  const clock = input.environment?.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
  const startedAt = clock();
  const budgetMs = Number.isFinite(input.budgetMs) && Number(input.budgetMs) > 0
    ? Math.min(1_500, Number(input.budgetMs))
    : Number.POSITIVE_INFINITY;
  const deadlineAt = startedAt + budgetMs;
  const sanitized = sanitizeEvidenceDocument(input.document, {
    ...input.environment,
    now: clock,
    deadlineAt
  });
  const reduced = await snapshotWithinLimit(sanitized.document, () => clock() >= deadlineAt);
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error("A valid capsule capture time is required.");
  const viewport = input.viewport ?? {
    width: Math.max(0, Math.round(globalThis.innerWidth || 0)),
    height: Math.max(0, Math.round(globalThis.innerHeight || 0)),
    devicePixelRatio: Math.max(0, Number(globalThis.devicePixelRatio || 1))
  };
  return {
    contractVersion: EVIDENCE_CAPSULE_CONTRACT_VERSION,
    id: input.id ?? newCapsuleId(),
    capturedAt,
    retailerId: input.retailerId,
    retailerSku: input.retailerSku,
    operation: input.diagnostic.operation,
    trigger: input.trigger,
    outcome: input.diagnostic.outcome,
    failureStage: input.diagnostic.failureStage,
    reasonCode: input.diagnostic.reasonCode,
    observerVersion: input.observerVersion,
    addAdapterVersion: input.addAdapterVersion,
    packVersion: input.packVersion ?? "",
    extensionVersion: input.extensionVersion,
    url: canonicalEvidenceUrl(input.url),
    viewport,
    requiredFulfillment: input.requiredFulfillment === "pickup" ? "pickup" : "shipping",
    diagnostic: input.diagnostic,
    trace: (input.trace ?? []).slice(0, 301),
    snapshot: {
      encoding: "gzip+base64",
      bytes: reduced.compressed.length,
      sha256: await sha256(reduced.compressed),
      html: base64(reduced.compressed)
    },
    redactions: sanitized.redactions,
    reductionApplied: reduced.reductionApplied,
    truncated: sanitized.timedOut || reduced.truncated || reduced.timedOut
  };
}
