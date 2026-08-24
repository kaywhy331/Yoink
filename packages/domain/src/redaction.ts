const SENSITIVE_KEY = /(?:^|_)(?:endpoint|p256dh|auth|authorization|cookie|csrf|cloudflare|session|device_token|offer_id|offerid|offerlistingid|password|secret|access_token|refresh_token)(?:$|_)/i;

function safeText(value: unknown, maximum = 500): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\bBearer\s+[A-Za-z0-9._~-]{20,}/gi, "Bearer [REDACTED]")
    .replace(/\bhttps:\/\/(?:fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com)\/[^\s"']+/gi, "[REDACTED_PUSH_ENDPOINT]")
    .replace(/([?&](?:notification_id|device_token|offerListingID|auth|authorization|csrf|csrf_token|cf_clearance|session|access_token|refresh_token)=)[^&\s"']+/gi, "$1[REDACTED]")
    .slice(0, maximum);
}

export function sanitizeDiagnosticData(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[TRUNCATED]";
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return safeText(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => sanitizeDiagnosticData(entry, depth + 1));
  if (typeof value !== "object") return safeText(value);
  const output: Record<string, unknown> = {};
  for (const [rawKey, entry] of Object.entries(value).slice(0, 100)) {
    const key = safeText(rawKey, 100);
    if (!key) continue;
    output[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeDiagnosticData(entry, depth + 1);
  }
  return output;
}
