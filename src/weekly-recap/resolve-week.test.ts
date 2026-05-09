import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import {
  getSystemTimeZone,
  isValidIanaTimeZone,
  resolveRecapWeek,
} from "./resolve-week.js";

const NY = "America/New_York";

function dtNy(
  year: number,
  month: number,
  day: number,
  hour = 12,
): Date {
  return DateTime.fromObject(
    { year, month, day, hour },
    { zone: NY },
  ).toJSDate();
}

describe("isValidIanaTimeZone", () => {
  it("accepts common zones", () => {
    expect(isValidIanaTimeZone("America/New_York")).toBe(true);
    expect(isValidIanaTimeZone("UTC")).toBe(true);
  });

  it("rejects invalid ids", () => {
    expect(isValidIanaTimeZone("")).toBe(false);
    expect(isValidIanaTimeZone("Not/A/Zone")).toBe(false);
  });
});

describe("getSystemTimeZone", () => {
  it("returns a non-empty id", () => {
    expect(getSystemTimeZone().length).toBeGreaterThan(0);
  });
});

describe("resolveRecapWeek", () => {
  it('default-style last: Sat May 9 2026 → prior Mon–Sun Apr 27 – May 3', () => {
    const r = resolveRecapWeek({
      weekSpec: "last",
      timeZoneId: NY,
      now: dtNy(2026, 5, 9),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.localRange).toEqual({
      start: "2026-04-27",
      end: "2026-05-03",
    });
    expect(r.value.isoWeekId).toBe("2026-W18");
    expect(r.value.utcStartDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.value.utcEndDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Number.isFinite(r.value.timezoneOffsetMinutes)).toBe(true);
  });

  it('last on Sun May 10 2026 → still prior completed week (Apr 27 – May 3)', () => {
    const r = resolveRecapWeek({
      weekSpec: "last",
      timeZoneId: NY,
      now: dtNy(2026, 5, 10),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.localRange).toEqual({
      start: "2026-04-27",
      end: "2026-05-03",
    });
  });

  it('last on Tue May 5 2026 → prior week Apr 27 – May 3', () => {
    const r = resolveRecapWeek({
      weekSpec: "last",
      timeZoneId: NY,
      now: dtNy(2026, 5, 5),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.localRange).toEqual({
      start: "2026-04-27",
      end: "2026-05-03",
    });
  });

  it("current: Sun May 10 2026 → Mon May 4 – Sun May 10", () => {
    const r = resolveRecapWeek({
      weekSpec: "current",
      timeZoneId: NY,
      now: dtNy(2026, 5, 10),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.localRange).toEqual({
      start: "2026-05-04",
      end: "2026-05-10",
    });
    expect(r.value.isoWeekId).toBe("2026-W19");
  });

  it("ISO week 2026-W19 in NY → Mon May 4 – Sun May 10", () => {
    const r = resolveRecapWeek({
      weekSpec: "2026-W19",
      timeZoneId: NY,
      now: dtNy(2026, 1, 1),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.localRange).toEqual({
      start: "2026-05-04",
      end: "2026-05-10",
    });
    expect(r.value.isoWeekId).toBe("2026-W19");
  });

  it("normalizes W9 → W09", () => {
    const r = resolveRecapWeek({
      weekSpec: "2026-W9",
      timeZoneId: NY,
      now: dtNy(2026, 1, 1),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.isoWeekId).toMatch(/^2026-W09$/);
  });

  it("date-in-week 2026-05-07 NY → same week as ISO W19", () => {
    const r = resolveRecapWeek({
      weekSpec: "2026-05-07",
      timeZoneId: NY,
      now: dtNy(2026, 1, 1),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.localRange).toEqual({
      start: "2026-05-04",
      end: "2026-05-10",
    });
  });

  it("returns error for invalid timezone", () => {
    const r = resolveRecapWeek({
      weekSpec: "last",
      timeZoneId: "Moon/Crater_1",
      now: new Date(),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("invalid IANA timezone");
  });

  it("returns error for garbage week", () => {
    const r = resolveRecapWeek({
      weekSpec: "next",
      timeZoneId: NY,
      now: new Date(),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("week must be");
  });
});
