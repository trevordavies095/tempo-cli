/**
 * P7: derive §2.2 Prev week / 3-wk avg / Δ from GET /stats/yearly-weekly and
 * GET /stats/relative-effort. Δ vs 3-wk avg = This week − three-week average (spec §2.2).
 *
 * Avg easy-run HR history has no stats endpoint here — leave — in Markdown (trends/P9).
 */

import { DateTime } from "luxon";

import { isPlainObject, pickFirst } from "../output/human-summary.js";
import type { RecapWeekResolved } from "./resolve-week.js";

const METERS_PER_MILE = 1609.344;

export type YearlyWeeklyBucketParsed = {
  /** Normalized Monday yyyy-MM-dd */
  weekStartYmd: string;
  distanceM: number;
  runs: number;
  durationS?: number;
  elevGainM?: number;
};

/** Parsed GET /stats/relative-effort scalars; weeks[] used when present to match recap week. */
export type RelativeEffortParsed = {
  currentWeek?: number;
  previousWeek?: number;
  threeWeekAverage?: number;
  threeWeekLow?: number;
  threeWeekHigh?: number;
};

export type RecapSummaryFromStats = {
  yearlyWeeklyOk: boolean;
  relativeEffortOk: boolean;
  mileage: {
    prevDistanceM?: number;
    threeWkAvgDistanceM?: number;
    /** workout distance − 3-wk avg distance (m) */
    deltaVsThreeWkM?: number;
  };
  runs: {
    prev?: number;
    threeWkAvg?: number;
    deltaVsThreeWk?: number;
  };
  time: {
    prevDurationS?: number;
    threeWkAvgDurationS?: number;
    deltaVsThreeWkS?: number;
  };
  elevation: {
    prevElevM?: number;
    threeWkAvgElevM?: number;
    deltaVsThreeWkM?: number;
  };
  relativeEffort: {
    prev?: number;
    threeWkAvg?: number;
    threeWkLow?: number;
    threeWkHigh?: number;
    /** workout RE sum − threeWeekAverage */
    deltaVsThreeWk?: number;
  };
};

/** Normalize API date-like values to yyyy-MM-dd (Monday match for week buckets). */
export function normalizeWeekStartYmd(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  if (!t) return undefined;
  const iso = DateTime.fromISO(t, { setZone: true });
  if (iso.isValid) return iso.toFormat("yyyy-LL-dd");
  const ymd = /^(\d{4}-\d{2}-\d{2})/.exec(t);
  if (ymd) return ymd[1];
  return undefined;
}

function distanceRawToMeters(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return undefined;
  if (raw > 500) return raw;
  return raw * METERS_PER_MILE;
}

function pickBucketDistanceM(row: Record<string, unknown>): number | undefined {
  const raw = pickFirst(row, [
    "distance",
    "Distance",
    "meters",
    "Meters",
    "totalDistanceM",
    "TotalDistanceM",
    "distanceM",
    "DistanceM",
  ]);
  const m = distanceRawToMeters(raw);
  if (m !== undefined) return m;
  const miles = pickFirst(row, ["miles", "Miles", "totalMiles", "TotalMiles"]);
  if (typeof miles === "number" && Number.isFinite(miles) && miles >= 0) {
    return miles * METERS_PER_MILE;
  }
  return undefined;
}

function pickBucketRunCount(row: Record<string, unknown>): number | undefined {
  const raw = pickFirst(row, [
    "count",
    "Count",
    "workouts",
    "Workouts",
    "runCount",
    "RunCount",
  ]);
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return undefined;
  return Math.round(raw);
}

function pickBucketDurationS(row: Record<string, unknown>): number | undefined {
  const raw = pickFirst(row, [
    "durationS",
    "DurationS",
    "durationSeconds",
    "DurationSeconds",
    "seconds",
    "Seconds",
    "totalDurationS",
    "TotalDurationS",
  ]);
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return undefined;
  return raw;
}

function pickBucketElevM(row: Record<string, unknown>): number | undefined {
  const raw = pickFirst(row, [
    "elevGainM",
    "ElevGainM",
    "elevationGainM",
    "ElevationGainM",
    "totalElevGainM",
    "TotalElevGainM",
  ]);
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return undefined;
  return raw;
}

export function parseYearlyWeeklyBuckets(body: string): YearlyWeeklyBucketParsed[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return [];
  }

  let rows: unknown[] = [];
  if (Array.isArray(parsed)) {
    rows = parsed;
  } else if (isPlainObject(parsed)) {
    const inner = pickFirst(parsed, ["weeks", "Weeks", "items", "Items", "data", "Data"]);
    if (Array.isArray(inner)) rows = inner;
  }

  const out: YearlyWeeklyBucketParsed[] = [];
  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    const startRaw = pickFirst(row, [
      "weekStart",
      "WeekStart",
      "startDate",
      "StartDate",
      "date",
      "Date",
      "weekBeginning",
      "WeekBeginning",
    ]);
    const weekStartYmd = normalizeWeekStartYmd(startRaw);
    if (!weekStartYmd) continue;
    const distanceM = pickBucketDistanceM(row);
    const runs = pickBucketRunCount(row);
    if (distanceM === undefined && runs === undefined) continue;
    out.push({
      weekStartYmd,
      distanceM: distanceM ?? 0,
      runs: runs ?? 0,
      durationS: pickBucketDurationS(row),
      elevGainM: pickBucketElevM(row),
    });
  }

  out.sort((a, b) => a.weekStartYmd.localeCompare(b.weekStartYmd));
  return out;
}

export type WeeklyRollup = {
  prev?: {
    distanceM: number;
    runs: number;
    durationS?: number;
    elevGainM?: number;
  };
  threeWkAvg?: {
    distanceM: number;
    runs: number;
    durationS?: number;
    elevGainM?: number;
  };
};

/**
 * Find recap week's bucket by Monday date; prev = prior bucket; 3-wk avg = mean of up to
 * three buckets immediately before the recap week (indices i−3…i−1 when present).
 */
export function computeWeeklyRollup(
  resolved: RecapWeekResolved,
  buckets: readonly YearlyWeeklyBucketParsed[],
): WeeklyRollup | undefined {
  const target = resolved.localRange.start;
  const idx = buckets.findIndex((b) => b.weekStartYmd === target);
  if (idx < 0) return undefined;

  let prev: WeeklyRollup["prev"];
  if (idx > 0) {
    const p = buckets[idx - 1]!;
    prev = {
      distanceM: p.distanceM,
      runs: p.runs,
      durationS: p.durationS,
      elevGainM: p.elevGainM,
    };
  }

  const start = Math.max(0, idx - 3);
  const slice = buckets.slice(start, idx);
  if (slice.length === 0) {
    return prev ? { prev, threeWkAvg: undefined } : undefined;
  }

  const n = slice.length;
  const durVals = slice
    .map((b) => b.durationS)
    .filter((x): x is number => x !== undefined && Number.isFinite(x) && x >= 0);
  const elevVals = slice
    .map((b) => b.elevGainM)
    .filter((x): x is number => x !== undefined && Number.isFinite(x) && x >= 0);
  const threeWkAvg = {
    distanceM: slice.reduce((s, b) => s + b.distanceM, 0) / n,
    runs: slice.reduce((s, b) => s + b.runs, 0) / n,
    durationS:
      durVals.length > 0
        ? durVals.reduce((s, x) => s + x, 0) / durVals.length
        : undefined,
    elevGainM:
      elevVals.length > 0
        ? elevVals.reduce((s, x) => s + x, 0) / elevVals.length
        : undefined,
  };

  return { prev, threeWkAvg };
}

export function parseRelativeEffortSummary(body: string): RelativeEffortParsed | undefined {
  const trimmed = body.trim();
  if (!trimmed) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
  if (!isPlainObject(parsed)) return undefined;

  const pickNum = (keys: readonly string[]): number | undefined => {
    const v = pickFirst(parsed!, keys);
    if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
    return v;
  };

  let currentWeek = pickNum(["currentWeek", "CurrentWeek"]);
  let previousWeek = pickNum(["previousWeek", "PreviousWeek"]);
  let threeWeekAverage = pickNum([
    "threeWeekAverage",
    "ThreeWeekAverage",
    "threeWeekAvg",
    "ThreeWeekAvg",
  ]);
  const threeWeekLow = pickNum([
    "threeWeekLow",
    "ThreeWeekLow",
    "threeWeekMin",
    "ThreeWeekMin",
    "rangeLow",
    "RangeLow",
  ]);
  const threeWeekHigh = pickNum([
    "threeWeekHigh",
    "ThreeWeekHigh",
    "threeWeekMax",
    "ThreeWeekMax",
    "rangeHigh",
    "RangeHigh",
  ]);

  return {
    currentWeek,
    previousWeek,
    threeWeekAverage,
    threeWeekLow,
    threeWeekHigh,
  };
}

/**
 * Prefer RE row from `weeks[]` when an entry matches recap Monday (`isoWeekId` / local range).
 */
export function refineRelativeEffortFromWeeks(
  resolved: RecapWeekResolved,
  body: string,
  base: RelativeEffortParsed,
): RelativeEffortParsed {
  const trimmed = body.trim();
  if (!trimmed) return base;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return base;
  }
  if (!isPlainObject(parsed)) return base;
  const weeks = pickFirst(parsed, ["weeks", "Weeks"]);
  if (!Array.isArray(weeks)) return base;

  const monday = resolved.localRange.start;

  for (const w of weeks) {
    if (!isPlainObject(w)) continue;
    const ws = normalizeWeekStartYmd(
      pickFirst(w, ["weekStart", "WeekStart", "startDate", "StartDate", "monday", "Monday"]),
    );
    const iso = pickFirst(w, ["isoWeekId", "IsoWeekId", "weekId", "WeekId"]);
    const isoStr = typeof iso === "string" ? iso.trim() : "";
    const matchMonday = ws === monday;
    const matchIso =
      isoStr.length > 0 &&
      isoStr.replace(/w/gi, "W").toUpperCase() === resolved.isoWeekId.toUpperCase();

    if (!matchMonday && !matchIso) continue;

    const cum = pickFirst(w, [
      "relativeEffort",
      "RelativeEffort",
      "totalRelativeEffort",
      "TotalRelativeEffort",
      "currentWeek",
      "CurrentWeek",
      "total",
      "Total",
    ]);
    const cur =
      typeof cum === "number" && Number.isFinite(cum) ? cum : undefined;

    const prev = pickFirst(w, ["previousWeek", "PreviousWeek"]);
    const p =
      typeof prev === "number" && Number.isFinite(prev) ? prev : undefined;

    const twa = pickFirst(w, [
      "threeWeekAverage",
      "ThreeWeekAverage",
      "threeWeekAvg",
      "ThreeWeekAvg",
    ]);
    const avg =
      typeof twa === "number" && Number.isFinite(twa) ? twa : undefined;

    const low = pickFirst(w, ["threeWeekLow", "ThreeWeekLow", "rangeLow"]);
    const high = pickFirst(w, ["threeWeekHigh", "ThreeWeekHigh", "rangeHigh"]);
    const lo = typeof low === "number" && Number.isFinite(low) ? low : undefined;
    const hi = typeof high === "number" && Number.isFinite(high) ? high : undefined;

    return {
      ...base,
      currentWeek: cur ?? base.currentWeek,
      previousWeek: p ?? base.previousWeek,
      threeWeekAverage: avg ?? base.threeWeekAverage,
      threeWeekLow: lo ?? base.threeWeekLow,
      threeWeekHigh: hi ?? base.threeWeekHigh,
    };
  }

  return base;
}

export type BuildRecapSummaryArgs = {
  resolved: RecapWeekResolved;
  yearlyWeeklyBody?: string;
  yearlyWeeklyOk: boolean;
  relativeEffortBody?: string;
  relativeEffortOk: boolean;
  workoutDistanceM: number;
  workoutDurationS: number;
  workoutElevM: number;
  workoutReSum: number;
  runCount: number;
};

export function buildRecapSummaryFromStats(args: BuildRecapSummaryArgs): RecapSummaryFromStats {
  const {
    resolved,
    yearlyWeeklyBody,
    yearlyWeeklyOk,
    relativeEffortBody,
    relativeEffortOk,
    workoutDistanceM,
    workoutDurationS,
    workoutElevM,
    workoutReSum,
    runCount,
  } = args;

  let rollup: WeeklyRollup | undefined;
  if (yearlyWeeklyOk && yearlyWeeklyBody !== undefined) {
    const buckets = parseYearlyWeeklyBuckets(yearlyWeeklyBody);
    rollup = computeWeeklyRollup(resolved, buckets);
  }

  let reParsed: RelativeEffortParsed | undefined;
  if (relativeEffortOk && relativeEffortBody !== undefined) {
    reParsed = parseRelativeEffortSummary(relativeEffortBody);
    if (reParsed) {
      reParsed = refineRelativeEffortFromWeeks(resolved, relativeEffortBody, reParsed);
    }
  }

  const mileage: RecapSummaryFromStats["mileage"] = {};
  const runs: RecapSummaryFromStats["runs"] = {};
  const time: RecapSummaryFromStats["time"] = {};
  const elevation: RecapSummaryFromStats["elevation"] = {};
  const relativeEffort: RecapSummaryFromStats["relativeEffort"] = {};

  if (rollup?.prev) {
    mileage.prevDistanceM = rollup.prev.distanceM;
    runs.prev = rollup.prev.runs;
    if (rollup.prev.durationS !== undefined) {
      time.prevDurationS = rollup.prev.durationS;
    }
    if (rollup.prev.elevGainM !== undefined) {
      elevation.prevElevM = rollup.prev.elevGainM;
    }
  }

  if (rollup?.threeWkAvg) {
    mileage.threeWkAvgDistanceM = rollup.threeWkAvg.distanceM;
    runs.threeWkAvg = rollup.threeWkAvg.runs;
    if (rollup.threeWkAvg.durationS !== undefined) {
      time.threeWkAvgDurationS = rollup.threeWkAvg.durationS;
    }
    if (rollup.threeWkAvg.elevGainM !== undefined) {
      elevation.threeWkAvgElevM = rollup.threeWkAvg.elevGainM;
    }
  }

  if (
    mileage.threeWkAvgDistanceM !== undefined &&
    Number.isFinite(workoutDistanceM)
  ) {
    mileage.deltaVsThreeWkM = workoutDistanceM - mileage.threeWkAvgDistanceM;
  }
  if (runs.threeWkAvg !== undefined) {
    runs.deltaVsThreeWk = runCount - runs.threeWkAvg;
  }
  if (time.threeWkAvgDurationS !== undefined && workoutDurationS >= 0) {
    time.deltaVsThreeWkS = workoutDurationS - time.threeWkAvgDurationS;
  }
  if (elevation.threeWkAvgElevM !== undefined && workoutElevM >= 0) {
    elevation.deltaVsThreeWkM = workoutElevM - elevation.threeWkAvgElevM;
  }

  if (reParsed) {
    if (reParsed.previousWeek !== undefined) {
      relativeEffort.prev = reParsed.previousWeek;
    }
    if (reParsed.threeWeekAverage !== undefined) {
      relativeEffort.threeWkAvg = reParsed.threeWeekAverage;
    }
    if (reParsed.threeWeekLow !== undefined) {
      relativeEffort.threeWkLow = reParsed.threeWeekLow;
    }
    if (reParsed.threeWeekHigh !== undefined) {
      relativeEffort.threeWkHigh = reParsed.threeWeekHigh;
    }
    if (reParsed.threeWeekAverage !== undefined && workoutReSum >= 0) {
      relativeEffort.deltaVsThreeWk = workoutReSum - reParsed.threeWeekAverage;
    }
  }

  return {
    yearlyWeeklyOk,
    relativeEffortOk,
    mileage,
    runs,
    time,
    elevation,
    relativeEffort,
  };
}
