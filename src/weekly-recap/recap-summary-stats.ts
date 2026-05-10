/**
 * §2.2 Prev week / 3-wk avg / Δ: prefer GET /stats/weekly-recap when available; else
 * GET /stats/yearly-weekly + GET /stats/relative-effort. Δ vs 3-wk avg = This week − trailingAvg.
 *
 * When weekly-recap is used, GET /stats/relative-effort still merges threeWeekLow/High for the RE cell.
 */

import { DateTime } from "luxon";

import { isPlainObject, pickFirst } from "../output/human-summary.js";
import type { RecapWeekResolved } from "./resolve-week.js";

const METERS_PER_MILE = 1609.344;

export type YearlyWeeklyBucketParsed = {
  /** Normalized yyyy-MM-dd bucket start from API (often Monday; Tempo may offset within the ISO week). */
  weekStartYmd: string;
  distanceM?: number;
  runs?: number;
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
  weeklyRecapOk: boolean;
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
  /** Populated when GET /stats/weekly-recap supplies easy-run HR history. */
  easyRunHr?: {
    prev?: number;
    threeWkAvg?: number;
    deltaVsThreeWk?: number;
  };
};

export type WeeklyRecapMetricBlockParsed = {
  current?: number;
  previous?: number;
  trailingAvg?: number;
};

export type WeeklyRecapMetricsParsed = {
  runs?: WeeklyRecapMetricBlockParsed;
  distanceM?: WeeklyRecapMetricBlockParsed;
  durationS?: WeeklyRecapMetricBlockParsed;
  elevationGainM?: WeeklyRecapMetricBlockParsed;
  relativeEffortSum?: WeeklyRecapMetricBlockParsed;
  easyRunAvgHeartRateBpm?: WeeklyRecapMetricBlockParsed;
};

function toFiniteNumber(raw: unknown): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t === "") return undefined;
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function parseWeeklyRecapMetricBlock(
  raw: unknown,
): WeeklyRecapMetricBlockParsed | undefined {
  if (!isPlainObject(raw)) return undefined;
  const current = toFiniteNumber(
    pickFirst(raw, ["current", "Current", "CurrentWeek"]),
  );
  const previous = toFiniteNumber(
    pickFirst(raw, ["previous", "Previous", "PreviousWeek"]),
  );
  const trailingAvg = toFiniteNumber(
    pickFirst(raw, [
      "trailingAvg",
      "TrailingAvg",
      "threeWeekAverage",
      "ThreeWeekAverage",
    ]),
  );
  const block: WeeklyRecapMetricBlockParsed = {};
  if (current !== undefined) block.current = current;
  if (previous !== undefined) block.previous = previous;
  if (trailingAvg !== undefined) block.trailingAvg = trailingAvg;
  if (Object.keys(block).length === 0) return undefined;
  return block;
}

/**
 * Locate the metrics bag on common API / serializer shapes (camelCase, PascalCase,
 * or nested under data/result/value wrappers).
 */
function pickWeeklyRecapMetricsObject(
  root: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const direct = pickFirst(root, ["metrics", "Metrics"]);
  if (isPlainObject(direct)) return direct;

  const wrappers = ["data", "Data", "result", "Result", "value", "Value"] as const;
  for (const wk of wrappers) {
    if (!Object.prototype.hasOwnProperty.call(root, wk)) continue;
    const w = root[wk];
    if (!isPlainObject(w)) continue;
    const nested = pickFirst(w, ["metrics", "Metrics"]);
    if (isPlainObject(nested)) return nested;
    if (
      Object.prototype.hasOwnProperty.call(w, "runs") ||
      Object.prototype.hasOwnProperty.call(w, "Runs") ||
      Object.prototype.hasOwnProperty.call(w, "distanceM") ||
      Object.prototype.hasOwnProperty.call(w, "DistanceM") ||
      Object.prototype.hasOwnProperty.call(w, "durationS") ||
      Object.prototype.hasOwnProperty.call(w, "DurationS")
    ) {
      return w;
    }
  }
  return undefined;
}

/** Extract `metrics` blocks from GET /stats/weekly-recap JSON; undefined if missing or invalid. */
export function parseWeeklyRecapResponse(
  body: string,
): WeeklyRecapMetricsParsed | undefined {
  const trimmed = body.trim();
  if (!trimmed) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
  if (!isPlainObject(parsed)) return undefined;
  const metricsRaw = pickWeeklyRecapMetricsObject(parsed);
  if (!isPlainObject(metricsRaw)) return undefined;

  const out: WeeklyRecapMetricsParsed = {};
  const setIf = (
    key: keyof WeeklyRecapMetricsParsed,
    names: readonly string[],
  ) => {
    const inner = pickFirst(metricsRaw, names);
    const b = parseWeeklyRecapMetricBlock(inner);
    if (b !== undefined) out[key] = b;
  };

  setIf("runs", ["runs", "Runs", "runCount", "RunCount"]);
  setIf("distanceM", ["distanceM", "DistanceM", "totalDistanceM", "TotalDistanceM"]);
  setIf("durationS", [
    "durationS",
    "DurationS",
    "durationSeconds",
    "DurationSeconds",
    "totalDurationS",
    "TotalDurationS",
  ]);
  setIf("elevationGainM", [
    "elevationGainM",
    "ElevationGainM",
    "elevGainM",
    "ElevGainM",
    "totalElevationGainM",
    "TotalElevationGainM",
  ]);
  setIf("relativeEffortSum", [
    "relativeEffortSum",
    "RelativeEffortSum",
    "relativeEffort",
    "RelativeEffort",
  ]);
  setIf("easyRunAvgHeartRateBpm", [
    "easyRunAvgHeartRateBpm",
    "EasyRunAvgHeartRateBpm",
    "easyRunHeartRateBpm",
    "EasyRunHeartRateBpm",
  ]);

  if (Object.keys(out).length === 0) return undefined;
  return out;
}

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
    const durationS = pickBucketDurationS(row);
    const elevGainM = pickBucketElevM(row);
    if (
      distanceM === undefined &&
      runs === undefined &&
      durationS === undefined &&
      elevGainM === undefined
    ) {
      continue;
    }
    const bucket: YearlyWeeklyBucketParsed = { weekStartYmd };
    if (distanceM !== undefined) bucket.distanceM = distanceM;
    if (runs !== undefined) bucket.runs = runs;
    if (durationS !== undefined) bucket.durationS = durationS;
    if (elevGainM !== undefined) bucket.elevGainM = elevGainM;
    out.push(bucket);
  }

  out.sort((a, b) => a.weekStartYmd.localeCompare(b.weekStartYmd));
  return out;
}

export type WeeklyRollup = {
  prev?: {
    distanceM?: number;
    runs?: number;
    durationS?: number;
    elevGainM?: number;
  };
  threeWkAvg?: {
    distanceM?: number;
    runs?: number;
    durationS?: number;
    elevGainM?: number;
  };
};

/**
 * Index of the yearly-weekly bucket whose 7-day civil window contains the recap week's Monday.
 * Tempo's 52 buckets may use week labels that are not identical to ISO Monday even when the
 * activity week matches (e.g. bucket starts Sunday local vs recap Monday).
 */
export function findYearlyWeeklyBucketIndexForRecapMonday(
  recapMondayYmd: string,
  buckets: readonly YearlyWeeklyBucketParsed[],
): number {
  const monday = DateTime.fromISO(recapMondayYmd, { zone: "utc" }).startOf("day");
  if (!monday.isValid) return -1;

  for (let i = 0; i < buckets.length; i++) {
    const start = DateTime.fromISO(buckets[i]!.weekStartYmd, { zone: "utc" }).startOf(
      "day",
    );
    if (!start.isValid) continue;
    const deltaDays = monday.diff(start, "days").days;
    if (deltaDays >= 0 && deltaDays <= 6) return i;
  }
  return -1;
}

/**
 * Find recap week's bucket; prev = prior bucket; 3-wk avg = mean of up to three buckets
 * immediately before the recap week (indices i−3…i−1 when present).
 */
export function computeWeeklyRollup(
  resolved: RecapWeekResolved,
  buckets: readonly YearlyWeeklyBucketParsed[],
): WeeklyRollup | undefined {
  const idx = findYearlyWeeklyBucketIndexForRecapMonday(
    resolved.localRange.start,
    buckets,
  );
  if (idx < 0) return undefined;

  let prev: WeeklyRollup["prev"];
  if (idx > 0) {
    const p = buckets[idx - 1]!;
    const cand: NonNullable<WeeklyRollup["prev"]> = {};
    if (p.distanceM !== undefined) cand.distanceM = p.distanceM;
    if (p.runs !== undefined) cand.runs = p.runs;
    if (p.durationS !== undefined) cand.durationS = p.durationS;
    if (p.elevGainM !== undefined) cand.elevGainM = p.elevGainM;
    if (Object.keys(cand).length > 0) prev = cand;
  }

  const start = Math.max(0, idx - 3);
  const slice = buckets.slice(start, idx);
  if (slice.length === 0) {
    return prev ? { prev, threeWkAvg: undefined } : undefined;
  }

  const durVals = slice
    .map((b) => b.durationS)
    .filter((x): x is number => x !== undefined && Number.isFinite(x) && x >= 0);
  const elevVals = slice
    .map((b) => b.elevGainM)
    .filter((x): x is number => x !== undefined && Number.isFinite(x) && x >= 0);
  const distVals = slice
    .map((b) => b.distanceM)
    .filter((x): x is number => x !== undefined && Number.isFinite(x) && x >= 0);
  const runVals = slice
    .map((b) => b.runs)
    .filter((x): x is number => x !== undefined && Number.isFinite(x) && x >= 0);

  const threeWkAvg: NonNullable<WeeklyRollup["threeWkAvg"]> = {
    distanceM:
      distVals.length > 0
        ? distVals.reduce((s, x) => s + x, 0) / distVals.length
        : undefined,
    runs:
      runVals.length > 0
        ? runVals.reduce((s, x) => s + x, 0) / runVals.length
        : undefined,
    durationS:
      durVals.length > 0
        ? durVals.reduce((s, x) => s + x, 0) / durVals.length
        : undefined,
    elevGainM:
      elevVals.length > 0
        ? elevVals.reduce((s, x) => s + x, 0) / elevVals.length
        : undefined,
  };

  const hasThreeWkAvg =
    threeWkAvg.distanceM !== undefined ||
    threeWkAvg.runs !== undefined ||
    threeWkAvg.durationS !== undefined ||
    threeWkAvg.elevGainM !== undefined;

  return {
    prev,
    threeWkAvg: hasThreeWkAvg ? threeWkAvg : undefined,
  };
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
  /** When set, summary comparison columns come from GET /stats/weekly-recap. */
  weeklyRecapParsed?: WeeklyRecapMetricsParsed;
  yearlyWeeklyBody?: string;
  yearlyWeeklyOk: boolean;
  relativeEffortBody?: string;
  relativeEffortOk: boolean;
  workoutDistanceM: number;
  workoutDurationS: number;
  workoutElevM: number;
  workoutReSum: number;
  runCount: number;
  /** §2.2 easy cohort avg HR this week (hr-analytics); used for easy-run HR Δ with weekly-recap. */
  easyAvgThisWeek?: number;
};

function buildRecapSummaryFromWeeklyRecapApi(
  args: BuildRecapSummaryArgs,
): RecapSummaryFromStats {
  const m = args.weeklyRecapParsed!;
  const {
    resolved,
    relativeEffortBody,
    relativeEffortOk,
    workoutDistanceM,
    workoutDurationS,
    workoutElevM,
    workoutReSum,
    runCount,
    easyAvgThisWeek,
  } = args;

  let reParsed: RelativeEffortParsed | undefined;
  if (relativeEffortOk && relativeEffortBody !== undefined) {
    reParsed = parseRelativeEffortSummary(relativeEffortBody);
    if (reParsed) {
      reParsed = refineRelativeEffortFromWeeks(
        resolved,
        relativeEffortBody,
        reParsed,
      );
    }
  }

  const mileage: RecapSummaryFromStats["mileage"] = {};
  const runs: RecapSummaryFromStats["runs"] = {};
  const time: RecapSummaryFromStats["time"] = {};
  const elevation: RecapSummaryFromStats["elevation"] = {};
  const relativeEffort: RecapSummaryFromStats["relativeEffort"] = {};

  const dist = m.distanceM;
  if (dist?.previous !== undefined) mileage.prevDistanceM = dist.previous;
  if (dist?.trailingAvg !== undefined) {
    mileage.threeWkAvgDistanceM = dist.trailingAvg;
  }
  if (
    mileage.threeWkAvgDistanceM !== undefined &&
    Number.isFinite(workoutDistanceM)
  ) {
    mileage.deltaVsThreeWkM =
      workoutDistanceM - mileage.threeWkAvgDistanceM;
  }

  const runB = m.runs;
  if (runB?.previous !== undefined) runs.prev = runB.previous;
  if (runB?.trailingAvg !== undefined) runs.threeWkAvg = runB.trailingAvg;
  if (runs.threeWkAvg !== undefined) {
    runs.deltaVsThreeWk = runCount - runs.threeWkAvg;
  }

  const dur = m.durationS;
  if (dur?.previous !== undefined) time.prevDurationS = dur.previous;
  if (dur?.trailingAvg !== undefined) {
    time.threeWkAvgDurationS = dur.trailingAvg;
  }
  if (time.threeWkAvgDurationS !== undefined && workoutDurationS >= 0) {
    time.deltaVsThreeWkS = workoutDurationS - time.threeWkAvgDurationS;
  }

  const el = m.elevationGainM;
  if (el?.previous !== undefined) elevation.prevElevM = el.previous;
  if (el?.trailingAvg !== undefined) {
    elevation.threeWkAvgElevM = el.trailingAvg;
  }
  if (elevation.threeWkAvgElevM !== undefined && workoutElevM >= 0) {
    elevation.deltaVsThreeWkM = workoutElevM - elevation.threeWkAvgElevM;
  }

  const reB = m.relativeEffortSum;
  if (reB?.previous !== undefined) relativeEffort.prev = reB.previous;
  if (reB?.trailingAvg !== undefined) {
    relativeEffort.threeWkAvg = reB.trailingAvg;
  }
  if (reB?.trailingAvg !== undefined && workoutReSum >= 0) {
    relativeEffort.deltaVsThreeWk = workoutReSum - reB.trailingAvg;
  }
  if (reParsed) {
    if (reParsed.threeWeekLow !== undefined) {
      relativeEffort.threeWkLow = reParsed.threeWeekLow;
    }
    if (reParsed.threeWeekHigh !== undefined) {
      relativeEffort.threeWkHigh = reParsed.threeWeekHigh;
    }
  }

  let easyRunHr: RecapSummaryFromStats["easyRunHr"] | undefined;
  const ez = m.easyRunAvgHeartRateBpm;
  if (ez) {
    const hasHist =
      ez.previous !== undefined || ez.trailingAvg !== undefined;
    if (hasHist) {
      easyRunHr = {};
      if (ez.previous !== undefined) easyRunHr.prev = ez.previous;
      if (ez.trailingAvg !== undefined) {
        easyRunHr.threeWkAvg = ez.trailingAvg;
      }
      if (
        easyAvgThisWeek !== undefined &&
        ez.trailingAvg !== undefined
      ) {
        easyRunHr.deltaVsThreeWk = easyAvgThisWeek - ez.trailingAvg;
      }
      if (Object.keys(easyRunHr).length === 0) easyRunHr = undefined;
    }
  }

  return {
    weeklyRecapOk: true,
    yearlyWeeklyOk: false,
    relativeEffortOk,
    mileage,
    runs,
    time,
    elevation,
    relativeEffort,
    ...(easyRunHr ? { easyRunHr } : {}),
  };
}

function buildRecapSummaryFromLegacyRollups(
  args: BuildRecapSummaryArgs,
): RecapSummaryFromStats {
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
      reParsed = refineRelativeEffortFromWeeks(
        resolved,
        relativeEffortBody,
        reParsed,
      );
    }
  }

  const mileage: RecapSummaryFromStats["mileage"] = {};
  const runs: RecapSummaryFromStats["runs"] = {};
  const time: RecapSummaryFromStats["time"] = {};
  const elevation: RecapSummaryFromStats["elevation"] = {};
  const relativeEffort: RecapSummaryFromStats["relativeEffort"] = {};

  if (rollup?.prev) {
    if (rollup.prev.distanceM !== undefined) {
      mileage.prevDistanceM = rollup.prev.distanceM;
    }
    if (rollup.prev.runs !== undefined) {
      runs.prev = rollup.prev.runs;
    }
    if (rollup.prev.durationS !== undefined) {
      time.prevDurationS = rollup.prev.durationS;
    }
    if (rollup.prev.elevGainM !== undefined) {
      elevation.prevElevM = rollup.prev.elevGainM;
    }
  }

  if (rollup?.threeWkAvg) {
    if (rollup.threeWkAvg.distanceM !== undefined) {
      mileage.threeWkAvgDistanceM = rollup.threeWkAvg.distanceM;
    }
    if (rollup.threeWkAvg.runs !== undefined) {
      runs.threeWkAvg = rollup.threeWkAvg.runs;
    }
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
    weeklyRecapOk: false,
    yearlyWeeklyOk,
    relativeEffortOk,
    mileage,
    runs,
    time,
    elevation,
    relativeEffort,
  };
}

export function buildRecapSummaryFromStats(
  args: BuildRecapSummaryArgs,
): RecapSummaryFromStats {
  if (args.weeklyRecapParsed !== undefined) {
    return buildRecapSummaryFromWeeklyRecapApi(args);
  }
  return buildRecapSummaryFromLegacyRollups(args);
}
