/**
 * Windows keeps what is in the notification centre in a SQLite database
 * (%LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db). Each toast's
 * payload is the XML its app sent: Discord's desktop app (Electron) writes a
 * ToastGeneric binding with the title then the message as <text> lines; a
 * browser adds the site as <text placement="attribution">discord.com</text>.
 * This reads those lines; it never interprets markup beyond them.
 */

export interface WindowsToastText {
  text: string;
  placement: string;
}

export interface WindowsToast {
  /** Every <text> line, in document order. */
  texts: WindowsToastText[];
  /** A browser notification's site line ("discord.com"), or "". */
  attribution: string;
  launch: string;
}

const MAX_PAYLOAD_CHARACTERS = 64 * 1024;
const MAX_TEXT_LINES = 12;
const MAX_TEXT_CHARACTERS = 4_000;

const NAMED_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'"
});

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,4});/gi, (entity, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
        ? String.fromCodePoint(code)
        : "";
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
  });
}

function attributes(source: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const match of source.matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const name = String(match[1]).toLowerCase();
    if (!(name in values)) values[name] = decodeEntities(match[2] ?? match[3] ?? "");
  }
  return values;
}

/** The payload column is UTF-8 XML (sometimes with a byte-order mark); UTF-16 is read when it says so. */
export function windowsToastPayloadText(payload: Uint8Array | string | null | undefined): string {
  if (payload === null || payload === undefined) return "";
  if (typeof payload === "string") return payload.slice(0, MAX_PAYLOAD_CHARACTERS);
  const bytes = payload.subarray(0, MAX_PAYLOAD_CHARACTERS * 2);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2)).slice(0, MAX_PAYLOAD_CHARACTERS);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2)).slice(0, MAX_PAYLOAD_CHARACTERS);
  const text = new TextDecoder("utf-8").decode(bytes);
  return (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).slice(0, MAX_PAYLOAD_CHARACTERS);
}

export function parseWindowsToast(payload: Uint8Array | string | null | undefined): WindowsToast {
  const xml = windowsToastPayloadText(payload);
  const toast = /<toast\b([^>]*)>/i.exec(xml);
  const texts: WindowsToastText[] = [];
  for (const match of xml.matchAll(/<text\b([^>]*?)(?:\/>|>([\s\S]*?)<\/text\s*>)/gi)) {
    if (texts.length >= MAX_TEXT_LINES) break;
    const inner = String(match[2] ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
    const text = decodeEntities(inner.replace(/<[^>]*>/g, "")).replace(/\r\n?/g, "\n").trim().slice(0, MAX_TEXT_CHARACTERS);
    const placement = (attributes(String(match[1] ?? "")).placement ?? "").toLowerCase();
    texts.push({ text, placement });
  }
  return {
    texts,
    attribution: texts.find((line) => line.placement === "attribution")?.text ?? "",
    launch: toast ? (attributes(String(toast[1] ?? "")).launch ?? "").slice(0, 2_000) : ""
  };
}

/** A toast's FILETIME (100 ns ticks since 1601-01-01 UTC) as epoch milliseconds, or NaN. */
export function windowsFiletimeMs(value: bigint | number | null | undefined): number {
  if (value === null || value === undefined) return Number.NaN;
  if (typeof value !== "bigint" && !Number.isFinite(Number(value))) return Number.NaN;
  const ticks = typeof value === "bigint" ? value : BigInt(Math.trunc(Number(value)));
  if (ticks <= 0n) return Number.NaN;
  return Number(ticks / 10_000n) - 11_644_473_600_000;
}
