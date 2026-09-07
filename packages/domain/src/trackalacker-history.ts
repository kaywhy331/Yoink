import type { TrackalackerMsrpReference } from "../../contracts/src/index.js";

export interface TrackalackerHistoryRow { time: string; price: string; status: string }

// Only the same listing's public History pages are allowed, including pagination.
export function trackalackerHistoryUrl(value: string, listingUrl: string, listingId?: string): string {
  try {
    const url = new URL(value, listingUrl);
    const expected = new URL(listingUrl);
    for (const item of [url, expected]) {
      if (item.protocol !== "https:" || item.username || item.password || item.port
        || !["trackalacker.com", "www.trackalacker.com"].includes(item.hostname)) return "";
    }
    const path = expected.pathname.replace(/\/$/, "");
    const id = path.match(/\/listings\/(\d{1,20})(?:\/[^/]+)?$/)?.[1];
    if (!id || (listingId !== undefined && id !== listingId) || url.pathname.replace(/\/$/, "") !== path) return "";
    if ([...url.searchParams.keys()].some(key => key !== "page") || url.searchParams.getAll("page").length > 1) return "";
    const page = url.searchParams.get("page");
    if (page !== null && !/^[1-9]\d{0,4}$/.test(page)) return "";
    url.hostname = "www.trackalacker.com";
    url.hash = "";
    return url.href;
  } catch { return ""; }
}

export function validateHistoryReference(
  value: unknown, listingUrl: string, listingId: string, now = Date.now()
): TrackalackerMsrpReference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as TrackalackerMsrpReference;
  if (!["reported_msrp", "approximate_msrp"].includes(row.kind)
    || typeof row.label !== "string" || historyMsrpKind(row.label) !== row.kind
    || row.currency !== "USD" || !Number.isSafeInteger(row.priceCents) || row.priceCents < 1 || row.priceCents > 100_000_000
    || typeof row.reportedAt !== "string" || row.reportedAt.length > 80 || historyTimeOrder(row.reportedAt) === null
    || typeof row.timeZone !== "string" || !/^[A-Za-z0-9_+:/ -]{0,60}$/.test(row.timeZone)
    || !Number.isInteger(row.sampleCount) || row.sampleCount < 1 || row.sampleCount > 2_000
    || typeof row.observedAt !== "string" || row.observedAt.length > 40
    || !Number.isFinite(Date.parse(row.observedAt)) || Date.parse(row.observedAt) > now + 5 * 60_000
    || typeof row.sourceUrl !== "string" || row.sourceUrl.length > 2_048) return null;
  const sourceUrl = trackalackerHistoryUrl(row.sourceUrl, listingUrl, listingId);
  if (!sourceUrl) return null;
  return { kind: row.kind, priceCents: row.priceCents, currency: "USD",
    label: row.kind === "reported_msrp" ? "In Stock (MSRP)" : "In Stock (~ MSRP)",
    sourceUrl, reportedAt: row.reportedAt.trim(), timeZone: row.timeZone,
    sampleCount: row.sampleCount, observedAt: new Date(row.observedAt).toISOString() };
}

export function historyTimeOrder(value: string): number | null {
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) {
    const time = Date.parse(text);
    return Number.isFinite(time) ? time : null;
  }
  // Preserve the source's local clock separately. This value orders rows in the
  // same table; it is not presented as a UTC timestamp or used for signal age.
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  const [, month, day, year, hour, minute, second, meridian] = match;
  if (Number(hour) < 1 || Number(hour) > 12 || Number(minute) > 59 || Number(second) > 59) return null;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day),
    Number(hour) % 12 + (meridian!.toUpperCase() === "PM" ? 12 : 0), Number(minute), Number(second)));
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1
    && date.getUTCDate() === Number(day) ? date.getTime() : null;
}

export function historyMsrpKind(value: string): TrackalackerMsrpReference["kind"] | null {
  const text = value.replace(/\s+/g, " ").trim();
  if (/^in\s+stock\s*\(\s*msrp\s*\)$/i.test(text)) return "reported_msrp";
  return /^in\s+stock\s*\(\s*[~≈]\s*msrp\s*\)$/i.test(text) ? "approximate_msrp" : null;
}

function priceCents(value: string): number | null {
  const match = value.trim().match(/^\$\s*((?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?)$/);
  if (!match) return null;
  const cents = Math.round(Number(match[1]!.replaceAll(",", "")) * 100);
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 100_000_000 ? cents : null;
}

export function referenceFromHistoryRows(
  rows: TrackalackerHistoryRow[], sourceUrl: string, timeZone: string, observedAt: string
): TrackalackerMsrpReference | null {
  const seen = new Set<string>();
  const candidates = rows.slice(0, 2_000).flatMap(row => {
    const price = priceCents(row.price);
    const order = historyTimeOrder(row.time);
    const kind = historyMsrpKind(row.status);
    const key = `${kind}:${price}:${order}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return kind && price !== null && order !== null
      ? [{ kind, price, order, time: row.time.trim() }] : [];
  }).sort((a, b) => Number(a.kind !== "reported_msrp") - Number(b.kind !== "reported_msrp") || b.order - a.order);
  const latest = candidates[0];
  if (!latest || candidates.some(row => row.kind === latest.kind && row.order === latest.order && row.price !== latest.price)) return null;
  return {
    kind: latest.kind, priceCents: latest.price, currency: "USD",
    label: latest.kind === "reported_msrp" ? "In Stock (MSRP)" : "In Stock (~ MSRP)",
    sourceUrl, reportedAt: latest.time, timeZone,
    sampleCount: candidates.filter(row => row.kind === latest.kind && row.price === latest.price).length, observedAt
  };
}

export function historyRowsFromText(value: string): TrackalackerHistoryRow[] {
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const rows: TrackalackerHistoryRow[] = [];
  for (let index = 0; index < lines.length && rows.length < 2_000; index++) {
    // Copy/paste from the History table puts the price beside or after its time.
    const match = lines[index]!.match(/^(\d{1,2}\/\d{1,2}\/\d{4},?\s+\d{1,2}:\d{2}:\d{2}\s*[AP]M)(?:\s+(\$[\d,.]+|-))?$/i);
    if (!match) continue;
    const time = match[1]!;
    const price = match[2] ?? lines[++index] ?? "";
    const status = lines[++index] ?? "";
    const category = /^\(.*\)$/.test(lines[index + 1] ?? "") ? ` ${lines[++index]}` : "";
    rows.push({ time, price, status: status + category });
  }
  return rows;
}
