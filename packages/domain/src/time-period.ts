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

export function validTimezone(value: unknown): string {
  const timezone = String(value ?? "UTC").trim().slice(0, 64);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
  } catch {
    throw new Error("A valid IANA timezone is required.");
  }
  return timezone;
}

function partsAt(timestamp: number, timezone: string): DateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(timestamp);
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
  let guess = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = partsAt(guess, timezone);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second
    );
    const correction = desired - observedAsUtc;
    guess += correction;
    if (correction === 0) break;
  }
  return guess;
}

export function zonedPeriodStarts(now: number, timezoneValue: unknown, resetHourValue: unknown): ZonedPeriodStarts {
  const timezone = validTimezone(timezoneValue);
  const resetHour = Number(resetHourValue);
  if (!Number.isInteger(resetHour) || resetHour < 0 || resetHour > 23) {
    throw new Error("The spending-period reset hour must be from 0 through 23.");
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
