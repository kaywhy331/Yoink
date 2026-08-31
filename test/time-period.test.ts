import assert from "node:assert/strict";
import test from "node:test";
import { validTimezone, zonedPeriodStarts } from "../packages/domain/src/time-period.js";

test("timezone spending periods honor the local reset hour", () => {
  assert.deepEqual(zonedPeriodStarts(
    new Date("2026-08-30T08:59:00.000Z").getTime(),
    "America/Los_Angeles",
    2
  ), {
    day: "2026-08-29T09:00:00.000Z",
    month: "2026-08-01T09:00:00.000Z",
    timezone: "America/Los_Angeles",
    resetHour: 2
  });
  assert.equal(zonedPeriodStarts(
    new Date("2026-08-30T09:00:00.000Z").getTime(),
    "America/Los_Angeles",
    2
  ).day, "2026-08-30T09:00:00.000Z");
});

test("nonexistent and repeated daylight-saving reset hours resolve deterministically", () => {
  const spring = zonedPeriodStarts(
    new Date("2026-03-08T12:00:00.000Z").getTime(),
    "America/Los_Angeles",
    2
  );
  assert.equal(spring.day, "2026-03-08T10:00:00.000Z");
  assert.equal(spring.month, "2026-03-01T10:00:00.000Z");

  const beforeSpringReset = zonedPeriodStarts(
    new Date("2026-03-08T09:30:00.000Z").getTime(),
    "America/Los_Angeles",
    2
  );
  assert.equal(beforeSpringReset.day, "2026-03-07T10:00:00.000Z");

  const fall = zonedPeriodStarts(
    new Date("2026-11-01T10:00:00.000Z").getTime(),
    "America/Los_Angeles",
    1
  );
  assert.equal(fall.day, "2026-11-01T08:00:00.000Z");
});

test("timezone validation rejects non-IANA values", () => {
  assert.equal(validTimezone("UTC"), "UTC");
  assert.throws(() => validTimezone("Mars/Olympus_Mons"), /valid IANA timezone/);
});
