/**
 * When a message says an item drops (Kevin, 2026-10-13: Discord alerts may
 * "drop ETA"): "Drawing starts Oct 14, 2:00pm PDT", "Queue opens 10/15 at
 * 7am ET", "drops tomorrow 9AM EST", "live at 12pm ET". Only a time that
 * follows a drop word counts, so an unrelated date in chat is never a drop.
 */

export type DropTimeKind = "drawing" | "queue" | "drop";

export interface DropTime {
  /** The drop, drawing or queue time (epoch ms). */
  at: number;
  kind: DropTimeKind;
  /** The words that said it, as written ("Drawing starts Oct 14, 2:00pm PDT"). */
  phrase: string;
  /** The message named no time zone, so the shopper's own was assumed. */
  zoneAssumed: boolean;
  /** The time zone the time was read in (IANA). */
  zone: string;
}

const PAST_GRACE_MS = 15 * 60_000;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const ZONES: Readonly<Record<string, string>> = Object.freeze({
  pt: "America/Los_Angeles", pst: "America/Los_Angeles", pdt: "America/Los_Angeles", pacific: "America/Los_Angeles",
  mt: "America/Denver", mst: "America/Denver", mdt: "America/Denver", mountain: "America/Denver",
  ct: "America/Chicago", cst: "America/Chicago", cdt: "America/Chicago", central: "America/Chicago",
  et: "America/New_York", est: "America/New_York", edt: "America/New_York", eastern: "America/New_York",
  utc: "UTC", gmt: "UTC", z: "UTC"
});

// "Went live at 2:05pm" is a restock that happened; only "goes live" looks ahead.
const KIND_WORDS = "(drawings?|draws?|raffles?|queues?|waiting\\s+room|drops?|dropping|releases?|releasing|launch(?:es|ing)?|restock(?:s|ing)?|eta|goes\\s+live|going\\s+live|go\\s+live)";
const LINK_WORDS = "(?:\\s+(?:starts?|starting|opens?|opening|begins?|beginning|is|are|will\\s+be|at|on|@|time|date|day|expected|scheduled|set|for|from|up))*";
const MONTH_DATE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?";
const SLASH_DATE = "(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2,4}))?";
// "Mon" in "Monitor" is no Monday.
const DAY_WORD = "(today|tonight|tomorrow|(?:this\\s+)?(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)(?:day)?)\\b";
const TIME = "(\\d{1,2})(?::(\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)?|(noon|midnight)";
const ZONE = "(p[sd]?t|m[sd]?t|c[sd]?t|e[sd]?t|pacific|mountain|central|eastern|utc|gmt)\\b";
const DATE = `(?:${MONTH_DATE}|${SLASH_DATE}|${DAY_WORD})`;
// "<drop word> [starts/at/on …] [date] [, at] [time] [zone]"; a date or a time must be there.
const PHRASE = new RegExp(
  `\\b${KIND_WORDS}${LINK_WORDS}\\s*[:\\-–]?\\s*(?:${DATE})?(?:\\s*,?\\s*(?:at|@)?\\s*(?:${TIME}))?(?:\\s*\\(?\\s*${ZONE}\\)?)?`,
  "gi"
);

interface ZonedParts { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

function zonedParts(epoch: number, zone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short"
  }).formatToParts(new Date(epoch));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(get("year")), month: Number(get("month")), day: Number(get("day")),
    hour: Number(get("hour")) % 24, minute: Number(get("minute")),
    weekday: WEEKDAYS.indexOf(get("weekday").slice(0, 3).toLowerCase())
  };
}

/** The moment a wall-clock time in a zone happens (DST-aware). */
function zonedEpoch(year: number, month: number, day: number, hour: number, minute: number, zone: string): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wall;
  for (let step = 0; step < 3; step += 1) {
    const seen = zonedParts(guess, zone);
    const seenWall = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    guess += wall - seenWall;
  }
  return guess;
}

function kindOf(word: string): DropTimeKind {
  const lower = word.toLowerCase();
  if (/^(?:drawings?|draws?|raffles?)$/.test(lower)) return "drawing";
  if (/^(?:queues?|waiting\s+room)$/.test(lower)) return "queue";
  return "drop";
}

/** The local zone of this install, used when a message names none. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * The first drop, drawing or queue time a message states, read relative to
 * when it arrived. A date without a year is the next one (or one up to a
 * month back); a time without a date is today, or tomorrow once it has passed.
 */
export function readDropTime(text: string, arrivedAt: number, defaultZone = localTimeZone()): DropTime | null {
  const value = String(text ?? "").slice(0, 2_000);
  for (const match of value.matchAll(PHRASE)) {
    const [, kindWord = "", monthName, monthDay, monthYear, slashMonth, slashDay, slashYear, dayWord,
      hourText, minuteText, meridiem, namedTime, zoneText] = match;
    const hasDate = Boolean(monthName || slashMonth || dayWord);
    const hasTime = Boolean(hourText || namedTime);
    // "drops 10/14" or "drawing at 2pm"; a bare number ("restock 3") is no time.
    if (!hasDate && !(hasTime && (meridiem || minuteText || namedTime || zoneText))) continue;
    if (hasTime && hourText && !meridiem && !minuteText && !zoneText && !hasDate) continue;
    const zone = zoneText ? ZONES[zoneText.toLowerCase()] ?? defaultZone : defaultZone;
    const now = zonedParts(arrivedAt, zone);
    let hour = 0;
    let minute = 0;
    if (namedTime) hour = namedTime.toLowerCase() === "noon" ? 12 : 0;
    else if (hourText) {
      hour = Number(hourText);
      minute = Number(minuteText ?? 0);
      const pm = /^p/i.test(meridiem ?? "");
      const am = /^a/i.test(meridiem ?? "");
      if (hour > 23 || minute > 59 || ((pm || am) && (hour < 1 || hour > 12))) continue;
      if (pm && hour < 12) hour += 12;
      if (am && hour === 12) hour = 0;
    }
    let year = now.year;
    let month = now.month;
    let day = now.day;
    let yearGiven = false;
    if (monthName) {
      month = MONTHS.indexOf(monthName.slice(0, 3).toLowerCase()) + 1;
      day = Number(monthDay);
      if (monthYear) { year = Number(monthYear); yearGiven = true; }
    } else if (slashMonth) {
      month = Number(slashMonth);
      day = Number(slashDay);
      if (slashYear) { year = Number(slashYear.length === 2 ? `20${slashYear}` : slashYear); yearGiven = true; }
    } else if (dayWord) {
      const word = dayWord.toLowerCase().replace(/^this\s+/, "");
      let ahead = 0;
      if (word === "tomorrow") ahead = 1;
      else if (!["today", "tonight"].includes(word)) {
        const target = WEEKDAYS.indexOf(word.slice(0, 3));
        ahead = target < 0 ? 0 : (target - now.weekday + 7) % 7;
      }
      const shifted = new Date(Date.UTC(now.year, now.month - 1, now.day + ahead));
      year = shifted.getUTCFullYear();
      month = shifted.getUTCMonth() + 1;
      day = shifted.getUTCDate();
      if (word === "tonight" && hasTime && hour < 12) hour += 12;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    let at = zonedEpoch(year, month, day, hour, minute, zone);
    if (!yearGiven && (monthName || slashMonth) && at < arrivedAt - 31 * 24 * 60 * 60_000) {
      at = zonedEpoch(year + 1, month, day, hour, minute, zone);
    }
    // A time alone that has already passed is tomorrow's.
    if (!hasDate && at < arrivedAt - 60 * 60_000) at = zonedEpoch(year, month, day + 1, hour, minute, zone);
    // A drop is ahead (or just starting); a time already well past says when something happened.
    if (!Number.isFinite(at) || at < arrivedAt - PAST_GRACE_MS) continue;
    return { at, kind: kindOf(kindWord.replace(/\s+/g, " ")), phrase: match[0].trim(), zoneAssumed: !zoneText, zone };
  }
  return null;
}
