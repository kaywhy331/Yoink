import { InputValidationError } from "./input-validation-error.js";

export interface ZonedPeriodStarts {
  day: string;
  month: string;
  timezone: string;
  resetHour: number;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

export function validTimezone(value: unknown): string {
  const timezone = String(value ?? "UTC").trim().slice(0, 64);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
  } catch {
    throw new InputValidationError("A valid IANA timezone is required.");
  }
  return timezone;
}

function partsAt(timestamp: number, timezone: string): DateParts {
  let formatter = formatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
    formatterCache.set(timezone, formatter);
  }
  const parts = formatter.formatToParts(timestamp);
  const value = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second")
  };
}

function localToUtc(parts: DateParts, timezone: string): number {
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const localOrdinal = (value: DateParts): number => Date.UTC(
    value.year, value.month - 1, value.day, value.hour, value.minute, value.second
  );
  const exact = (value: DateParts): boolean => localOrdinal(value) === desired;
  const probeOffsets = new Set([-36, -12, 0, 12, 36].map((hours) => {
    const probe = desired + hours * 60 * 60_000;
    return localOrdinal(partsAt(probe, timezone)) - probe;
  }));
  const candidates = [...probeOffsets].map((offset) => desired - offset);
  const exactCandidates = candidates.filter((candidate) => exact(partsAt(candidate, timezone)));
  if (exactCandidates.length) {
    // A repeated wall-clock time at fall-back starts at its first occurrence.
    return Math.min(...exactCandidates);
  }

  // A spring-forward reset hour may not exist. Resolve it to the first real
  // instant whose local wall time is after the requested boundary, rather
  // than oscillating between the two sides of the daylight-saving gap.
  const start = Math.min(...candidates) - 2 * 60 * 60_000;
  const end = Math.max(...candidates) + 26 * 60 * 60_000;
  for (let candidate = start; candidate <= end; candidate += 60_000) {
    if (localOrdinal(partsAt(candidate, timezone)) >= desired) return candidate;
  }
  throw new Error("The timezone spending boundary could not be resolved.");
}

export function zonedPeriodStarts(now: number, timezoneValue: unknown, resetHourValue: unknown): ZonedPeriodStarts {
  const timezone = validTimezone(timezoneValue);
  const resetHour = Number(resetHourValue);
  if (!Number.isInteger(resetHour) || resetHour < 0 || resetHour > 23) {
    throw new InputValidationError("The spending-period reset hour must be from 0 through 23.");
  }
  const current = partsAt(now, timezone);
  let localDay = Date.UTC(current.year, current.month - 1, current.day);
  if (current.hour < resetHour) localDay -= 24 * 60 * 60_000;
  const effective = new Date(localDay);
  const dayStart = localToUtc({
    year: effective.getUTCFullYear(),
    month: effective.getUTCMonth() + 1,
    day: effective.getUTCDate(),
    hour: resetHour,
    minute: 0,
    second: 0
  }, timezone);
  const monthStart = localToUtc({
    year: effective.getUTCFullYear(),
    month: effective.getUTCMonth() + 1,
    day: 1,
    hour: resetHour,
    minute: 0,
    second: 0
  }, timezone);
  return {
    day: new Date(dayStart).toISOString(),
    month: new Date(monthStart).toISOString(),
    timezone,
    resetHour
  };
}
