/**
 * Client-side HR analytics for weekly recap (P5).
 *
 * Primary HR samples come from paginated **`GET /workouts/{id}/time-series`** (sparse
 * `{ elapsedSeconds, heartRateBpm }` rows). Weekly recap merges all pages client-side
 * and forward-fills to one value per second for zone math and drift.
 *
 * Fallback: embedded `timeSeries` on **`GET /workouts/{id}`** when the dedicated
 * endpoint returned no samples (e.g. empty or 404).
 *
 * Degrades per §3.10 when neither source has usable HR while still using summary
 * `avgHeartRateBpm` for % max when possible.
 */

import {
  isPlainObject,
  pickFirst,
} from "../output/human-summary.js";
import type { RecapHeartRateZone } from "./recap-settings.js";

export type HrZonesSettingsMeta = {
  calculationMethod?: string;
  age?: number;
  maxHeartRateBpm?: number;
};

export type RecapHrRunRow = {
  id: string;
  hasHrSeries: boolean;
  startedAt?: string;
  runType?: string;
  avgHr?: number;
  /** Percent of configured max HR, one decimal; null when unavailable */
  pctMaxHr: number | null;
  zonePct?: Record<string, number>;
  zoneSeconds?: number[];
  q1AvgHr?: number;
  q4AvgHr?: number;
  driftBpm?: number;
  driftNote?: string;
  /** Present only for Easy/Long-style runs when drift exceeds thresholds */
  driftSeverityLabel?: string;
  degradation?: string;
};

export type RecapHrWeekSummary = {
  totalHrSeconds: number;
  zoneSeconds: number[];
  zonePct?: Record<string, number>;
  z1z2Pct?: number;
  z1z2TargetMet?: boolean;
  /** True when no run contributed HR seconds */
  noHrTimeSeriesInWeek: boolean;
  /** Explains empty week / missing API field */
  note?: string;
};

export type RecapHrAnalyticsResult = {
  configuredMaxHr?: number;
  week: RecapHrWeekSummary;
  runs: RecapHrRunRow[];
};

const DRIFT_WARN = "⚠ above target (target ≤10 bpm)";
const DRIFT_STRONG = "⚠⚠ well above target";

export function parseHrZonesSettingsMeta(body: string): HrZonesSettingsMeta {
  const trimmed = body.trim();
  if (!trimmed) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return {};
  }
  if (!isPlainObject(parsed)) return {};
  const calculationMethodRaw = pickFirst(parsed, [
    "calculationMethod",
    "CalculationMethod",
    "method",
    "Method",
  ]);
  const ageRaw = pickFirst(parsed, ["age", "Age"]);
  const maxRaw = pickFirst(parsed, [
    "maxHeartRateBpm",
    "MaxHeartRateBpm",
    "maxHr",
    "MaxHr",
  ]);
  const meta: HrZonesSettingsMeta = {};
  if (typeof calculationMethodRaw === "string" && calculationMethodRaw.trim()) {
    meta.calculationMethod = calculationMethodRaw.trim();
  }
  if (typeof ageRaw === "number" && Number.isFinite(ageRaw)) {
    meta.age = Math.round(ageRaw);
  }
  if (typeof maxRaw === "number" && Number.isFinite(maxRaw)) {
    meta.maxHeartRateBpm = Math.round(maxRaw);
  }
  return meta;
}

function topZoneMaxBpm(zones: readonly RecapHeartRateZone[]): number | undefined {
  if (zones.length === 0) return undefined;
  const sorted = [...zones].sort((a, b) => a.zone - b.zone);
  const last = sorted[sorted.length - 1]!;
  return last.maxBpm > 0 ? last.maxBpm : undefined;
}

/**
 * Resolves configured max HR: AgeBased → 220−age; else explicit maxHeartRateBpm;
 * else highest zone ceiling (Custom / fallback).
 */
export function resolveConfiguredMaxHr(
  meta: HrZonesSettingsMeta,
  zones: readonly RecapHeartRateZone[],
): number | undefined {
  const method = meta.calculationMethod?.toLowerCase() ?? "";
  if (method === "agebased") {
    if (typeof meta.age === "number" && meta.age > 0 && meta.age < 120) {
      return Math.round(220 - meta.age);
    }
  }
  if (
    typeof meta.maxHeartRateBpm === "number" &&
    meta.maxHeartRateBpm > 0 &&
    meta.maxHeartRateBpm < 250
  ) {
    return meta.maxHeartRateBpm;
  }
  return topZoneMaxBpm(zones);
}

export type HrSamplePoint = {
  elapsedSeconds: number;
  heartRateBpm: number;
};

export function extractTimeSeriesSamples(
  workout: Record<string, unknown>,
): HrSamplePoint[] {
  const raw = pickFirst(workout, ["timeSeries", "TimeSeries"]);
  if (!Array.isArray(raw)) return [];
  const out: HrSamplePoint[] = [];
  for (const row of raw) {
    if (!isPlainObject(row)) continue;
    const esRaw = pickFirst(row, ["elapsedSeconds", "ElapsedSeconds"]);
    const hrRaw = pickFirst(row, ["heartRateBpm", "HeartRateBpm"]);
    if (typeof esRaw !== "number" || !Number.isFinite(esRaw)) continue;
    if (typeof hrRaw !== "number" || !Number.isFinite(hrRaw)) continue;
    const hr = Math.round(hrRaw);
    if (hr <= 0) continue;
    out.push({
      elapsedSeconds: Math.max(0, Math.floor(esRaw)),
      heartRateBpm: hr,
    });
  }
  return out;
}

function pickDurationSeconds(
  workout: Record<string, unknown>,
): number | undefined {
  const d = pickFirst(workout, ["durationS", "Duration"]);
  if (typeof d === "number" && Number.isFinite(d) && d > 0) {
    return Math.floor(d);
  }
  return undefined;
}

/**
 * One HR value per elapsed second [0 .. len−1], forward-filled from sorted samples.
 */
export function buildDenseHrPerSecond(
  samples: readonly HrSamplePoint[],
  durationS: number | undefined,
): number[] | undefined {
  if (samples.length === 0) return undefined;
  const sorted = [...samples].sort((a, b) => a.elapsedSeconds - b.elapsedSeconds);
  const maxEl = sorted[sorted.length - 1]!.elapsedSeconds;
  let len =
    durationS !== undefined && durationS > 0 ? durationS : maxEl + 1;
  len = Math.max(len, maxEl + 1);
  const out: number[] = [];
  let j = 0;
  let current = sorted[0]!.heartRateBpm;
  for (let sec = 0; sec < len; sec++) {
    while (j < sorted.length && sorted[j]!.elapsedSeconds <= sec) {
      current = sorted[j]!.heartRateBpm;
      j++;
    }
    out.push(current);
  }
  return out;
}

/** Zone index 0..n-1 for sorted zones Z1..Zn */
export function zoneIndexForBpm(
  bpm: number,
  zonesSorted: readonly RecapHeartRateZone[],
): number {
  if (zonesSorted.length === 0) return 0;
  for (let i = 0; i < zonesSorted.length; i++) {
    const z = zonesSorted[i]!;
    if (bpm >= z.minBpm && bpm <= z.maxBpm) return i;
  }
  if (bpm < zonesSorted[0]!.minBpm) return 0;
  return zonesSorted.length - 1;
}

export function secondsPerZoneFromDense(
  dense: readonly number[],
  zonesSorted: readonly RecapHeartRateZone[],
): number[] {
  const counts = new Array(zonesSorted.length).fill(0);
  for (const bpm of dense) {
    const zi = zoneIndexForBpm(bpm, zonesSorted);
    counts[zi] += 1;
  }
  return counts;
}

export function pctFromZoneSeconds(zoneSeconds: readonly number[]): Record<string, number> {
  const total = zoneSeconds.reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  if (total <= 0) return out;
  for (let i = 0; i < zoneSeconds.length; i++) {
    const pct = (1000 * zoneSeconds[i]!) / total;
    out[`z${i + 1}`] = Math.round(pct) / 10;
  }
  return out;
}

export function quarterAvgHrs(
  dense: readonly number[],
): { q1Avg: number; q4Avg: number; drift: number } | undefined {
  const n = dense.length;
  if (n < 4) return undefined;
  const q = Math.floor(n / 4);
  if (q < 1) return undefined;
  const q1Slice = dense.slice(0, q);
  const q4Slice = dense.slice(3 * q, n);
  const avg = (arr: readonly number[]) =>
    arr.reduce((a, b) => a + b, 0) / arr.length;
  const q1Avg = avg(q1Slice);
  const q4Avg = avg(q4Slice);
  return {
    q1Avg: Math.round(q1Avg * 10) / 10,
    q4Avg: Math.round(q4Avg * 10) / 10,
    drift: Math.round((q4Avg - q1Avg) * 10) / 10,
  };
}

export function driftSeverityLabel(driftBpm: number): string | undefined {
  const d = Math.abs(driftBpm);
  if (d <= 10) return undefined;
  if (d <= 20) return DRIFT_WARN;
  return DRIFT_STRONG;
}

export function isEasyOrLongRunType(runType: unknown): boolean {
  if (typeof runType !== "string") return false;
  const t = runType.trim().toLowerCase();
  return (
    t.includes("easy") ||
    t.includes("long") ||
    t === "easy run" ||
    t === "long run"
  );
}

export function pickAvgHrSummary(workout: Record<string, unknown>): number | undefined {
  const v = pickFirst(workout, [
    "avgHeartRateBpm",
    "AvgHeartRateBpm",
    "averageHeartRateBpm",
  ]);
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    return Math.round(v);
  }
  return undefined;
}

export function percentMaxHr(
  avgHr: number | undefined,
  maxHr: number | undefined,
): number | null {
  if (avgHr === undefined || maxHr === undefined || maxHr <= 0) return null;
  return Math.round((1000 * avgHr) / maxHr) / 10;
}

export function computeRecapHrAnalytics(args: {
  zones: readonly RecapHeartRateZone[];
  heartRateZonesBody: string;
  workoutDetails: readonly { id: string; body: string }[];
  /** From GET /workouts/{id}/time-series (merged pages); preferred over embedded JSON */
  timeSeriesByWorkoutId?: Readonly<Record<string, readonly HrSamplePoint[]>>;
}): RecapHrAnalyticsResult {
  const meta = parseHrZonesSettingsMeta(args.heartRateZonesBody);
  const maxHr = resolveConfiguredMaxHr(meta, args.zones);
  const zonesSorted = [...args.zones].sort((a, b) => a.zone - b.zone);

  const runs: RecapHrRunRow[] = [];
  const weekSeconds = new Array(zonesSorted.length).fill(0);

  if (args.workoutDetails.length === 0) {
    return {
      configuredMaxHr: maxHr,
      week: {
        totalHrSeconds: 0,
        zoneSeconds: weekSeconds,
        noHrTimeSeriesInWeek: true,
        note: "No workouts in recap window.",
      },
      runs: [],
    };
  }

  for (const d of args.workoutDetails) {
    let workout: Record<string, unknown> | undefined;
    try {
      const j = JSON.parse(d.body.trim()) as unknown;
      if (isPlainObject(j)) workout = j;
    } catch {
      runs.push({
        id: d.id,
        hasHrSeries: false,
        pctMaxHr: null,
        degradation: "could not parse workout JSON",
      });
      continue;
    }
    if (!workout) {
      runs.push({
        id: d.id,
        hasHrSeries: false,
        pctMaxHr: null,
        degradation: "workout body was not a JSON object",
      });
      continue;
    }

    const startedRaw = pickFirst(workout, ["startedAt", "StartedAt"]);
    const startedAt =
      typeof startedRaw === "string" && startedRaw.trim()
        ? startedRaw.trim()
        : undefined;
    const runTypeRaw = pickFirst(workout, ["runType", "RunType"]);
    const runType =
      typeof runTypeRaw === "string" && runTypeRaw.trim()
        ? runTypeRaw.trim()
        : undefined;

    const apiSamples = args.timeSeriesByWorkoutId?.[d.id];
    const embeddedSamples = extractTimeSeriesSamples(workout);
    const samples =
      apiSamples && apiSamples.length > 0
        ? [...apiSamples]
        : embeddedSamples;
    const durationS = pickDurationSeconds(workout);
    const dense =
      samples.length > 0 ? buildDenseHrPerSecond(samples, durationS) : undefined;

    const summaryAvg = pickAvgHrSummary(workout);

    let avgHr: number | undefined;
    if (dense && dense.length > 0) {
      avgHr = Math.round(
        dense.reduce((a, b) => a + b, 0) / dense.length,
      );
    } else if (summaryAvg !== undefined) {
      avgHr = summaryAvg;
    }

    const hasHrSeries = !!(dense && dense.length > 0);

    let zonePct: Record<string, number> | undefined;
    let zoneSec: number[] | undefined;
    let q1AvgHr: number | undefined;
    let q4AvgHr: number | undefined;
    let driftBpm: number | undefined;
    let driftSeverity: string | undefined;
    let degradation: string | undefined;

    if (!dense || dense.length === 0) {
      degradation = "zones/drift: n/a (no HR data)";
    } else {
      zoneSec = secondsPerZoneFromDense(dense, zonesSorted);
      for (let i = 0; i < zonesSorted.length; i++) {
        weekSeconds[i] += zoneSec[i]!;
      }
      zonePct = pctFromZoneSeconds(zoneSec);
      if (dense.length >= 4) {
        const q = quarterAvgHrs(dense);
        if (q) {
          q1AvgHr = q.q1Avg;
          q4AvgHr = q.q4Avg;
          driftBpm = q.drift;
          if (isEasyOrLongRunType(runType)) {
            driftSeverity = driftSeverityLabel(q.drift);
          }
        }
      } else {
        degradation = "drift: n/a (need ≥4s of HR data)";
      }
    }

    const pct = percentMaxHr(avgHr, maxHr);

    runs.push({
      id: d.id,
      hasHrSeries,
      startedAt,
      runType,
      avgHr,
      pctMaxHr: pct,
      zonePct,
      zoneSeconds: zoneSec,
      q1AvgHr,
      q4AvgHr,
      driftBpm,
      driftSeverityLabel: driftSeverity,
      degradation,
    });
  }

  const totalHrSeconds = weekSeconds.reduce((a, b) => a + b, 0);
  const weekZonePct =
    totalHrSeconds > 0 ? pctFromZoneSeconds(weekSeconds) : undefined;
  const z1 = weekSeconds[0] ?? 0;
  const z2 = weekSeconds[1] ?? 0;
  const z1z2Pct =
    totalHrSeconds > 0
      ? Math.round((10000 * (z1 + z2)) / totalHrSeconds) / 100
      : undefined;

  let note: string | undefined;
  if (totalHrSeconds === 0 && args.workoutDetails.length > 0) {
    note =
      "No usable HR samples for workouts this week (GET /workouts/{id}/time-series empty or absent HR; embedded `timeSeries` on GET /workouts/{id} also missing). Zone totals and drift need HR samples.";
  }

  return {
    configuredMaxHr: maxHr,
    week: {
      totalHrSeconds,
      zoneSeconds: weekSeconds,
      zonePct: weekZonePct,
      z1z2Pct,
      z1z2TargetMet: z1z2Pct !== undefined ? z1z2Pct >= 80 : undefined,
      noHrTimeSeriesInWeek: totalHrSeconds === 0,
      note,
    },
    runs,
  };
}

function formatZonePctLine(zonePct: Record<string, number> | undefined): string {
  if (!zonePct || Object.keys(zonePct).length === 0) return "";
  const keys = Object.keys(zonePct).sort();
  return keys.map((k) => `${k.toUpperCase()} ${zonePct[k]}%`).join(" · ");
}

/** Compact multi-line block for `tempo weekly-recap` human output */
export function formatRecapHrAnalyticsHuman(a: RecapHrAnalyticsResult): string {
  const lines: string[] = [];
  lines.push("HR analytics:");
  if (a.configuredMaxHr !== undefined) {
    lines.push(`  Configured max HR: ${a.configuredMaxHr} bpm`);
  } else {
    lines.push(`  Configured max HR: n/a`);
  }

  const w = a.week;
  if (w.note) {
    lines.push(`  Week: ${w.note}`);
  }
  if (w.totalHrSeconds > 0 && w.zonePct) {
    lines.push(`  Week zone mix: ${formatZonePctLine(w.zonePct)}`);
    if (w.z1z2Pct !== undefined) {
      const ok = w.z1z2TargetMet === true ? " ✓" : w.z1z2TargetMet === false ? " (target ≥80% Z1+Z2)" : "";
      lines.push(`  Z1+Z2: ${w.z1z2Pct}%${ok}`);
    }
  } else if (!w.note && a.runs.length > 0) {
    lines.push(
      `  Week zone mix: n/a (no per-second HR in workout JSON; ${a.runs.length} run(s) in window)`,
    );
  }

  for (const r of a.runs) {
    const bits: string[] = [`  Run ${r.id}`];
    if (r.startedAt) bits.push(`@ ${r.startedAt}`);
    if (r.runType) bits.push(`(${r.runType})`);
    if (r.avgHr !== undefined) {
      bits.push(`avg ${r.avgHr} bpm`);
    }
    if (r.pctMaxHr !== null) {
      bits.push(`${r.pctMaxHr}% max`);
    } else {
      bits.push("% max n/a");
    }
    if (r.zonePct) {
      bits.push(`zones ${formatZonePctLine(r.zonePct)}`);
    }
    if (
      r.hasHrSeries &&
      r.q1AvgHr !== undefined &&
      r.q4AvgHr !== undefined &&
      r.driftBpm !== undefined
    ) {
      const sign = r.driftBpm >= 0 ? "+" : "";
      let driftBit = `drift ${r.q1AvgHr} → ${r.q4AvgHr} (${sign}${r.driftBpm} bpm)`;
      if (r.driftSeverityLabel) driftBit += ` ${r.driftSeverityLabel}`;
      bits.push(driftBit);
    } else if (r.degradation) {
      bits.push(r.degradation);
    }
    lines.push(bits.join(" "));
  }

  return lines.join("\n");
}

/** JSON-serializable mirror of analytics (no duplicate workout bodies) */
export function recapHrAnalyticsToJson(a: RecapHrAnalyticsResult): Record<string, unknown> {
  return {
    configuredMaxHr: a.configuredMaxHr ?? null,
    week: {
      totalHrSeconds: a.week.totalHrSeconds,
      zoneSeconds: a.week.zoneSeconds,
      zonePct: a.week.zonePct ?? null,
      z1z2Pct: a.week.z1z2Pct ?? null,
      z1z2TargetMet: a.week.z1z2TargetMet ?? null,
      noHrTimeSeriesInWeek: a.week.noHrTimeSeriesInWeek,
      note: a.week.note ?? null,
    },
    runs: a.runs.map((r) => ({
      id: r.id,
      hasHrSeries: r.hasHrSeries,
      startedAt: r.startedAt ?? null,
      runType: r.runType ?? null,
      avgHr: r.avgHr ?? null,
      pctMaxHr: r.pctMaxHr,
      zonePct: r.zonePct ?? null,
      zoneSeconds: r.zoneSeconds ?? null,
      q1AvgHr: r.q1AvgHr ?? null,
      q4AvgHr: r.q4AvgHr ?? null,
      driftBpm: r.driftBpm ?? null,
      driftSeverityLabel: r.driftSeverityLabel ?? null,
      degradation: r.degradation ?? null,
    })),
  };
}
