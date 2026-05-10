/**
 * §2.7 rolling trends: four ISO weeks (W−3…W0) from trend-window list rows plus recap-week detail.
 *
 * Full “easy-pace-at-HR” fidelity would need HR time-series per easy segment; we approximate from
 * list/detail JSON only (avg HR, avg pace, duration) per weekly recap spec §3.7 pragmatic note.
 */

import { DateTime } from "luxon";

import { isPlainObject, pickFirst } from "../output/human-summary.js";
import type {
  RecapHeartRateZone,
  RecapUnitPreference,
} from "./recap-settings.js";
import type { RecapWeekResolved } from "./resolve-week.js";
import { extractWorkoutId } from "./fetch-workouts.js";

const METERS_PER_MILE = 1609.344;
const EM_DASH = "—";
const SPARK_CHARS = ["▁", "▃", "▅", "█"] as const;

export type RecapTrendsSnapshot = {
  included: boolean;
  reason?: string;
  /** ISO week ids Mon-based, oldest → newest (W−3 … W0). */
  weekLabels?: [string, string, string, string];
  /** Seconds per km; lower is faster. Null = no qualifying data that week. */
  easyPaceSecPerKm?: (number | null)[];
  /** Mean HR on easy-like runs; lower often reads as “easier” fitness. */
  avgEasyHr?: (number | null)[];
  /** Long-run distance (m); fallback max run distance in week when no Long-type run. */
  longRunDistanceM?: (number | null)[];
  sparklines?: {
    easyPace: string;
    avgEasyHr: string;
    longRunDistance: string;
  };
  verdicts?: {
    easyPace?: string;
    avgEasyHr?: string;
    longRunDistance?: string;
  };
};

function formatIsoWeekId(mondayInZone: DateTime): string {
  return `${mondayInZone.weekYear}-W${String(mondayInZone.weekNumber).padStart(2, "0")}`;
}

function mondayOfWeekContaining(dt: DateTime): DateTime {
  const d = dt.startOf("day");
  return d.minus({ days: d.weekday - 1 });
}

function weekBucketIndex(args: {
  startedAt: string | undefined;
  recapMonday: DateTime;
  timeZoneId: string;
}): number | undefined {
  const { startedAt, recapMonday, timeZoneId } = args;
  if (!startedAt?.trim()) return undefined;
  const dt = DateTime.fromISO(startedAt.trim(), { setZone: true });
  if (!dt.isValid) return undefined;
  const local = dt.setZone(timeZoneId);
  const workoutMonday = mondayOfWeekContaining(local);
  /** Whole weeks from workout week → recap week (0 = same week as recap, +3 = three weeks earlier). */
  const weeksBeforeRecap = Math.round(
    recapMonday.diff(workoutMonday, "weeks").weeks,
  );
  const idx = 3 - weeksBeforeRecap;
  if (idx < 0 || idx > 3 || !Number.isFinite(idx)) return undefined;
  return idx;
}

function z2MaxBpm(zones: readonly RecapHeartRateZone[]): number | undefined {
  const z2 = [...zones]
    .sort((a, b) => a.zone - b.zone)
    .find((z) => z.zone === 2);
  return z2 !== undefined && z2.maxBpm > 0 ? z2.maxBpm : undefined;
}

/** Easy / recovery / blank run type; excludes explicit long / tempo / etc. */
function isEasyOrUntypedNonLong(runType: unknown): boolean {
  if (runType === undefined || runType === null) return true;
  const s = String(runType).trim();
  if (s === "") return true;
  const t = s.toLowerCase();
  if (t.includes("long")) return false;
  return t.includes("easy") || t.includes("recovery");
}

/** Run type string contains “long” (e.g. Long Run) — §2.6 / trends long-run distance. */
export function isLongRunType(runType: unknown): boolean {
  return typeof runType === "string" && runType.toLowerCase().includes("long");
}

function pickStartedAt(row: Record<string, unknown>): string | undefined {
  const raw = pickFirst(row, ["startedAt", "StartedAt"]);
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

function pickDistanceM(row: Record<string, unknown>): number | undefined {
  const raw = pickFirst(row, ["distanceM", "Distance"]);
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0
    ? raw
    : undefined;
}

function pickDurationS(row: Record<string, unknown>): number | undefined {
  const raw = pickFirst(row, ["durationS", "Duration"]);
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0
    ? raw
    : undefined;
}

function pickAvgPaceS(row: Record<string, unknown>): number | undefined {
  const raw = pickFirst(row, ["avgPaceS", "AvgPaceS"]);
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0
    ? raw
    : undefined;
}

function pickAvgHr(row: Record<string, unknown>): number | undefined {
  const raw = pickFirst(row, [
    "avgHeartRateBpm",
    "AvgHeartRateBpm",
    "averageHeartRateBpm",
  ]);
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0
    ? Math.round(raw)
    : undefined;
}

function pickRunType(row: Record<string, unknown>): string | undefined {
  const raw = pickFirst(row, ["runType", "RunType"]);
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

function parseDetailBody(body: string): Record<string, unknown> | undefined {
  const t = body.trim();
  if (!t) return undefined;
  try {
    const v = JSON.parse(t) as unknown;
    return isPlainObject(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

function mergeTrendRows(args: {
  trendListItems: readonly Record<string, unknown>[];
  recapWorkoutDetails: readonly { id: string; body: string }[];
}): Record<string, unknown>[] {
  const { trendListItems, recapWorkoutDetails } = args;

  const merged = new Map<string, Record<string, unknown>>();

  for (const item of trendListItems) {
    const id = extractWorkoutId(item);
    const key = id
      ? `id:${id}`
      : `row:${pickStartedAt(item) ?? ""}:${pickDistanceM(item) ?? ""}`;
    merged.set(key, { ...item });
  }

  for (const d of recapWorkoutDetails) {
    const w = parseDetailBody(d.body);
    if (!w) continue;
    const key = d.id.trim() ? `id:${d.id.trim()}` : `row:${pickStartedAt(w) ?? ""}`;
    merged.set(key, w);
  }

  return [...merged.values()];
}

type WeekAgg = {
  paceWeightedSum: number;
  paceWeight: number;
  easyHrSum: number;
  easyHrCount: number;
  longDistances: number[];
  maxDistanceM: number;
};

function emptyAgg(): WeekAgg {
  return {
    paceWeightedSum: 0,
    paceWeight: 0,
    easyHrSum: 0,
    easyHrCount: 0,
    longDistances: [],
    maxDistanceM: 0,
  };
}

function finalizeWeekAgg(a: WeekAgg): {
  paceSecPerKm: number | null;
  avgEasyHr: number | null;
  longRunM: number | null;
} {
  const paceSecPerKm =
    a.paceWeight > 0 && Number.isFinite(a.paceWeightedSum)
      ? a.paceWeightedSum / a.paceWeight
      : null;
  const avgEasyHr =
    a.easyHrCount > 0 ? Math.round(a.easyHrSum / a.easyHrCount) : null;
  let longRunM: number | null = null;
  if (a.longDistances.length > 0) {
    longRunM = Math.max(...a.longDistances);
  } else if (a.maxDistanceM > 0) {
    longRunM = a.maxDistanceM;
  }
  return { paceSecPerKm, avgEasyHr, longRunM };
}

/**
 * Qualifies for “easy cohort” avg HR: typed easy/recovery (non-long), or untyped with HR ≤ Z2 max.
 */
function qualifiesEasyAvgHr(
  runType: string | undefined,
  avgHr: number | undefined,
  z2Max: number | undefined,
): boolean {
  if (avgHr === undefined) return false;
  const blank =
    runType === undefined ||
    (typeof runType === "string" && runType.trim() === "");
  if (blank) {
    return z2Max !== undefined && avgHr <= z2Max;
  }
  if (typeof runType !== "string") return false;
  const t = runType.trim().toLowerCase();
  if (t.includes("long")) return false;
  return t.includes("easy") || t.includes("recovery");
}

function accumulateRow(
  agg: WeekAgg,
  row: Record<string, unknown>,
  z2Max: number | undefined,
): void {
  const runType = pickRunType(row);
  const dist = pickDistanceM(row);
  const dur = pickDurationS(row);
  const pace = pickAvgPaceS(row);
  const hr = pickAvgHr(row);

  if (dist !== undefined && dist > agg.maxDistanceM) agg.maxDistanceM = dist;

  if (isLongRunType(runType) && dist !== undefined && dist > 0) {
    agg.longDistances.push(dist);
  }

  if (!isEasyOrUntypedNonLong(runType)) return;

  if (qualifiesEasyAvgHr(runType, hr, z2Max)) {
    agg.easyHrSum += hr!;
    agg.easyHrCount += 1;
  }

  // Pace line: Z2 ceiling + duration-weighted avg pace; rows without HR excluded (spec fallback).
  if (
    z2Max !== undefined &&
    hr !== undefined &&
    hr <= z2Max &&
    pace !== undefined &&
    dur !== undefined &&
    isEasyOrUntypedNonLong(runType)
  ) {
    agg.paceWeightedSum += pace * dur;
    agg.paceWeight += dur;
  }
}

export function buildWeekLabels(
  resolved: RecapWeekResolved,
  timeZoneId: string,
): [string, string, string, string] {
  const recapMonday = DateTime.fromISO(resolved.localRange.start, {
    zone: timeZoneId,
  }).startOf("day");
  const labels: string[] = [];
  for (let k = 3; k >= 0; k--) {
    const m = recapMonday.minus({ weeks: k });
    labels.push(formatIsoWeekId(m));
  }
  return labels as [string, string, string, string];
}

export function computeRecapTrendsSnapshot(args: {
  resolved: RecapWeekResolved;
  timeZoneId: string;
  zones: readonly RecapHeartRateZone[];
  trendListItems: Record<string, unknown>[];
  recapWorkoutDetails: readonly { id: string; body: string }[];
  /** False when user skipped trends; true when fetch attempted or would run */
  included: boolean;
  fetchFailedReason?: string;
}): RecapTrendsSnapshot {
  if (!args.included) {
    return { included: false, reason: "disabled" };
  }
  if (args.fetchFailedReason) {
    return { included: false, reason: args.fetchFailedReason };
  }

  const z2Max = z2MaxBpm(args.zones);
  const recapMonday = DateTime.fromISO(args.resolved.localRange.start, {
    zone: args.timeZoneId,
  }).startOf("day");

  const rows = mergeTrendRows({
    trendListItems: args.trendListItems,
    recapWorkoutDetails: args.recapWorkoutDetails,
  });

  const aggs: WeekAgg[] = [
    emptyAgg(),
    emptyAgg(),
    emptyAgg(),
    emptyAgg(),
  ];

  for (const row of rows) {
    const idx = weekBucketIndex({
      startedAt: pickStartedAt(row),
      recapMonday,
      timeZoneId: args.timeZoneId,
    });
    if (idx === undefined) continue;
    accumulateRow(aggs[idx]!, row, z2Max);
  }

  const weekLabels = buildWeekLabels(args.resolved, args.timeZoneId);

  const paceSeries: (number | null)[] = [];
  const hrSeries: (number | null)[] = [];
  const longSeries: (number | null)[] = [];

  for (let i = 0; i < 4; i++) {
    const f = finalizeWeekAgg(aggs[i]!);
    paceSeries.push(f.paceSecPerKm);
    hrSeries.push(f.avgEasyHr);
    longSeries.push(f.longRunM);
  }

  const hasAny =
    paceSeries.some((x) => x !== null) ||
    hrSeries.some((x) => x !== null) ||
    longSeries.some((x) => x !== null);

  if (!hasAny) {
    return {
      included: true,
      weekLabels,
      easyPaceSecPerKm: paceSeries,
      avgEasyHr: hrSeries,
      longRunDistanceM: longSeries,
    };
  }

  const sparklines = {
    easyPace: sparklineForSeries(paceSeries, true),
    avgEasyHr: sparklineForSeries(hrSeries, true),
    longRunDistance: sparklineForSeries(longSeries, false),
  };

  const verdicts = {
    easyPace: strictlyMonotonicVerdict(paceSeries, true),
    avgEasyHr: strictlyMonotonicVerdict(hrSeries, true),
    longRunDistance: strictlyMonotonicVerdict(longSeries, false),
  };

  return {
    included: true,
    weekLabels,
    easyPaceSecPerKm: paceSeries,
    avgEasyHr: hrSeries,
    longRunDistanceM: longSeries,
    sparklines,
    verdicts,
  };
}

function finiteValues(series: (number | null)[]): number[] {
  return series.filter((x): x is number => x !== null && Number.isFinite(x));
}

function sparklineForSeries(
  series: (number | null)[],
  lowerIsBetter: boolean,
): string {
  const vals = finiteValues(series);
  if (vals.length === 0) return "";

  const min = Math.min(...vals);
  const max = Math.max(...vals);

  return series
    .map((v) => {
      if (v === null || !Number.isFinite(v)) return SPARK_CHARS[0];
      if (max === min) return SPARK_CHARS[2];
      const desirability = lowerIsBetter
        ? (max - v) / (max - min)
        : (v - min) / (max - min);
      const idx = Math.min(
        3,
        Math.max(0, Math.round(desirability * 3)),
      );
      return SPARK_CHARS[idx]!;
    })
    .join("");
}

function strictlyMonotonicVerdict(
  series: (number | null)[],
  lowerIsBetter: boolean,
): string | undefined {
  const nums = finiteValues(series);
  if (nums.length < 2) return undefined;

  let inc = true;
  let dec = true;
  for (let i = 1; i < nums.length; i++) {
    if (nums[i]! <= nums[i - 1]!) inc = false;
    if (nums[i]! >= nums[i - 1]!) dec = false;
  }

  if (lowerIsBetter && dec) return "improving";
  if (!lowerIsBetter && inc) return "improving";
  if (!lowerIsBetter && dec) return "declining";
  if (lowerIsBetter && inc) return "declining";
  return undefined;
}

function formatPace(secPerKm: number, unit: RecapUnitPreference): string {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return EM_DASH;
  const secPerUnit =
    unit === "imperial" ? secPerKm * (METERS_PER_MILE / 1000) : secPerKm;
  const m = Math.floor(secPerUnit / 60);
  const s = Math.round(secPerUnit % 60);
  const suf = unit === "imperial" ? "/mi" : "/km";
  return `${m}:${String(s).padStart(2, "0")}${suf}`;
}

function formatDistanceTrend(m: number | null, unit: RecapUnitPreference): string {
  if (m === null || !Number.isFinite(m)) return EM_DASH;
  if (unit === "imperial") {
    const mi = m / METERS_PER_MILE;
    return `${mi.toFixed(2)} mi`;
  }
  return `${(m / 1000).toFixed(2)} km`;
}

function arrowChain(
  series: (number | null)[],
  fmt: (n: number | null) => string,
): string {
  return series.map((v) => (v === null ? EM_DASH : fmt(v))).join(" → ");
}

/** Markdown `## Trends` block or empty string. */
export function buildTrendsMarkdownSection(
  snapshot: RecapTrendsSnapshot,
  unit: RecapUnitPreference,
): string {
  if (!snapshot.included) return "";

  const pace = snapshot.easyPaceSecPerKm;
  const hr = snapshot.avgEasyHr;
  const lng = snapshot.longRunDistanceM;

  const hasLine =
    pace?.some((x) => x !== null) ||
    hr?.some((x) => x !== null) ||
    lng?.some((x) => x !== null);

  if (!hasLine) return "";

  const lines: string[] = ["## Trends", ""];

  if (pace?.some((x) => x !== null)) {
    const chain = arrowChain(pace, (v) =>
      v === null ? EM_DASH : formatPace(v, unit),
    );
    const sp = snapshot.sparklines?.easyPace ?? "";
    const vd = snapshot.verdicts?.easyPace;
    const tail =
      [sp && ` ${sp}`, vd && ` (${vd})`].filter(Boolean).join("") || "";
    lines.push(
      `- **Easy pace (≤Z2, list/detail approx.)**: ${chain}${tail}`,
    );
    lines.push("");
  }

  if (hr?.some((x) => x !== null)) {
    const chain = arrowChain(hr, (v) =>
      v === null ? EM_DASH : String(Math.round(v!)),
    );
    const sp = snapshot.sparklines?.avgEasyHr ?? "";
    const vd = snapshot.verdicts?.avgEasyHr;
    const tail =
      [sp && ` ${sp}`, vd && ` (${vd})`].filter(Boolean).join("") || "";
    lines.push(`- **Avg easy HR**: ${chain}${tail}`);
    lines.push("");
  }

  if (lng?.some((x) => x !== null)) {
    const chain = arrowChain(lng, (v) => formatDistanceTrend(v, unit));
    const sp = snapshot.sparklines?.longRunDistance ?? "";
    const vd = snapshot.verdicts?.longRunDistance;
    const tail =
      [sp && ` ${sp}`, vd && ` (${vd})`].filter(Boolean).join("") || "";
    lines.push(
      `- **Long-run distance** (max long-typed, else max run in week): ${chain}${tail}`,
    );
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

export function recapTrendsSnapshotToJson(
  snapshot: RecapTrendsSnapshot,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    included: snapshot.included,
  };
  if (snapshot.reason !== undefined) base.reason = snapshot.reason;
  if (!snapshot.included) return base;

  if (snapshot.weekLabels !== undefined) base.weekLabels = snapshot.weekLabels;
  if (snapshot.easyPaceSecPerKm !== undefined) {
    base.easyPaceSecPerKm = snapshot.easyPaceSecPerKm;
  }
  if (snapshot.avgEasyHr !== undefined) base.avgEasyHr = snapshot.avgEasyHr;
  if (snapshot.longRunDistanceM !== undefined) {
    base.longRunDistanceM = snapshot.longRunDistanceM;
  }
  if (snapshot.sparklines !== undefined) base.sparklines = snapshot.sparklines;
  if (snapshot.verdicts !== undefined) base.verdicts = snapshot.verdicts;
  return base;
}
