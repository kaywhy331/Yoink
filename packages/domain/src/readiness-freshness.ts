/** Age of recorded evidence, never a promise that the retailer session is unchanged. */
export function readinessEvidenceAgeMs(value: unknown, now: number): number | null {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const observedAt = Date.parse(value);
  const day = value.slice(0, 10);
  if (!Number.isFinite(observedAt) || !new Date(`${day}T00:00:00.000Z`).toISOString().startsWith(day)) return null;
  const age = now - observedAt;
  return Number.isFinite(age) && age >= 0 ? age : null;
}

export function freshReadinessEvidence(value: unknown, now: number, maxAgeMs: number): boolean {
  const age = readinessEvidenceAgeMs(value, now);
  return age !== null && age <= maxAgeMs;
}

export function readinessAgeLabel(ageMs: number): string {
  return ageMs < 60_000 ? `${Math.floor(ageMs / 1000)}s ago` : `${Math.floor(ageMs / 60_000)}m ago`;
}
