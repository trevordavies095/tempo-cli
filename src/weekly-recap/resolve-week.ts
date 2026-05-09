import { DateTime } from "luxon";

/** Resolved Mon–Sun window in an IANA zone, with UTC bounds for GET /workouts. */
export type RecapWeekResolved = {
  /** ISO week id for the Monday-of-week (e.g. 2026-W19). */
  isoWeekId: string;
  /** Inclusive local civil dates (YYYY-MM-DD) in the recap timezone. */
  localRange: { start: string; end: string };
  /** UTC ISO 8601 date-times for API query params (inclusive week window). */
  utcStartDate: string;
  utcEndDate: string;
  /** Offset east of UTC in minutes at Monday 00:00 local (west-of-UTC is negative). */
  timezoneOffsetMinutes: number;
};

export type ResolveRecapWeekResult =
  | { ok: true; value: RecapWeekResolved }
  | { ok: false; message: string };

/** True if `zone` is accepted by the runtime IANA database (throws otherwise). */
export function isValidIanaTimeZone(zone: string): boolean {
  const z = zone.trim();
  if (!z) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: z });
    return true;
  } catch {
    return false;
  }
}

export function getSystemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

type WeekMode =
  | { kind: "last" }
  | { kind: "current" }
  | { kind: "iso"; iso: string }
  | { kind: "date"; ymd: string };

function parseWeekSpec(raw: string): WeekMode | { error: string } {
  const s = raw.trim();
  if (!s) return { error: "week must not be empty" };
  const low = s.toLowerCase();
  if (low === "last") return { kind: "last" };
  if (low === "current") return { kind: "current" };

  if (/^\d{4}-W\d{1,2}$/i.test(s)) {
    const m = s.match(/^(\d{4})-W(\d{1,2})$/i)!;
    const w = String(Number.parseInt(m[2], 10)).padStart(2, "0");
    return { kind: "iso", iso: `${m[1]}-W${w}` };
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const dt = DateTime.fromISO(s, { zone: "utc" });
    if (!dt.isValid) return { error: `invalid date in --week: ${s}` };
    return { kind: "date", ymd: s };
  }

  return {
    error:
      'week must be "last", "current", YYYY-Www (ISO week), or YYYY-MM-DD (date in week)',
  };
}

function formatIsoWeekId(mondayInZone: DateTime): string {
  return `${mondayInZone.weekYear}-W${String(mondayInZone.weekNumber).padStart(2, "0")}`;
}

function mondaySundayContaining(
  civilDayInZone: DateTime,
): { monday: DateTime; sunday: DateTime } {
  const day = civilDayInZone.startOf("day");
  const monday = day.minus({ days: day.weekday - 1 });
  const sunday = monday.plus({ days: 6 });
  return { monday, sunday };
}

/** Most recently completed Mon–Sun (see weekly recap spec §3.5). */
function lastCompletedWeek(
  timeZone: string,
  now: Date,
): { monday: DateTime; sunday: DateTime } {
  const today = DateTime.fromJSDate(now, { zone: timeZone }).startOf("day");
  let cursor = today.minus({ days: 1 });
  while (cursor.weekday !== 7) {
    cursor = cursor.minus({ days: 1 });
  }
  const anchorSunday = cursor;
  const monday = anchorSunday.minus({ days: 6 });
  return { monday, sunday: anchorSunday };
}

function buildResolved(
  monday: DateTime,
  sunday: DateTime,
): { ok: true; value: RecapWeekResolved } {
  const m = monday.startOf("day");
  const s = sunday.startOf("day");
  const utcStart = m.toUTC();
  const utcEnd = s.endOf("day").toUTC();
  const isoWeekId = formatIsoWeekId(m);

  return {
    ok: true,
    value: {
      isoWeekId,
      localRange: {
        start: m.toFormat("yyyy-LL-dd"),
        end: s.toFormat("yyyy-LL-dd"),
      },
      utcStartDate: utcStart.toISO({ suppressMilliseconds: false }) ?? "",
      utcEndDate: utcEnd.toISO({ suppressMilliseconds: false }) ?? "",
      timezoneOffsetMinutes: m.offset,
    },
  };
}

export type ResolveRecapWeekArgs = {
  /** Raw `--week` value (default applied by CLI: `last`). */
  weekSpec: string;
  /** IANA timezone id (e.g. America/New_York). */
  timeZoneId: string;
  /** Injectable clock (tests). */
  now: Date;
};

/**
 * Resolves Monday 00:00 → Sunday 23:59:59.999 in `timeZoneId`, with UTC instants for API filters.
 * `timezoneOffsetMinutes` is taken at Monday 00:00 local (DST note: a single number may not
 * describe the whole week across a DST transition; stats endpoints take one offset per call).
 */
export function resolveRecapWeek(args: ResolveRecapWeekArgs): ResolveRecapWeekResult {
  const tz = args.timeZoneId.trim();
  if (!isValidIanaTimeZone(tz)) {
    return {
      ok: false,
      message: `invalid IANA timezone: ${args.timeZoneId.trim() || "(empty)"}`,
    };
  }

  const parsed = parseWeekSpec(args.weekSpec);
  if ("error" in parsed) {
    return { ok: false, message: parsed.error };
  }

  let monday: DateTime;
  let sunday: DateTime;

  switch (parsed.kind) {
    case "last": {
      const w = lastCompletedWeek(tz, args.now);
      monday = w.monday;
      sunday = w.sunday;
      break;
    }
    case "current": {
      const today = DateTime.fromJSDate(args.now, { zone: tz }).startOf("day");
      const w = mondaySundayContaining(today);
      monday = w.monday;
      sunday = w.sunday;
      break;
    }
    case "iso": {
      const start = DateTime.fromISO(parsed.iso, { zone: tz });
      if (!start.isValid) {
        return { ok: false, message: `invalid ISO week in --week: ${parsed.iso}` };
      }
      monday = start.startOf("day");
      sunday = monday.plus({ days: 6 }).startOf("day");
      break;
    }
    case "date": {
      const day = DateTime.fromISO(parsed.ymd, { zone: tz }).startOf("day");
      if (!day.isValid) {
        return { ok: false, message: `invalid date in --week: ${parsed.ymd}` };
      }
      const w = mondaySundayContaining(day);
      monday = w.monday;
      sunday = w.sunday;
      break;
    }
  }

  return buildResolved(monday, sunday);
}
