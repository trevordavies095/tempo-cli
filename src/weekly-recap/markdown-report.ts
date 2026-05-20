/**
 * Weekly recap Markdown §2.1–§2.4: header, summary (P7 stats-backed columns when provided),
 * zones, run blocks.
 */

import { DateTime } from "luxon";

import { isPlainObject, pickFirst } from "../output/human-summary.js";
import type { RecapHrAnalyticsResult, RecapHrRunRow } from "./hr-analytics.js";
import type { RecapSummaryFromStats } from "./recap-summary-stats.js";
import type { RecapUnitPreference } from "./recap-settings.js";
import type { RecapWeekResolved } from "./resolve-week.js";
import {
  formatSimilarRouteMarkdownLine,
  type RecapSimilarRoutesEntry,
} from "./similar-route-line.js";
import {
  formatSubjectiveRunLine,
  workoutLocalDate,
  type SubjectiveRunFields,
} from "./subjective-week.js";

const METERS_PER_MILE = 1609.344;
const ZONE_BAR_WIDTH = 35;
const EM_DASH = "—";

export type WeeklyRecapMarkdownInput = {
  resolved: RecapWeekResolved;
  timeZoneId: string;
  unit: RecapUnitPreference;
  hrAnalytics: RecapHrAnalyticsResult;
  workoutDetails: readonly { id: string; body: string }[];
  shoesBody: string;
  /** P7: optional; omit or failed stats → historical columns show — */
  summaryFromStats?: RecapSummaryFromStats;
  /** P8: optional per-workout similar-routes fetch results */
  similarRoutesByWorkoutId?: Readonly<
    Record<string, RecapSimilarRoutesEntry | undefined>
  >;
  /** P11: optional §2.5 quality sessions (after Run-by-run, before Trends). */
  qualitySessionsMarkdown?: string;
  /** P12: optional §2.6 long run (after Quality, before Trends). */
  longRunMarkdown?: string;
  /** P9: optional §2.7 rolling trends (placed after Run-by-run). */
  trendsMarkdown?: string;
  /** P10: optional §2.8 Notable (placed after Trends). */
  notableMarkdown?: string;
  /** P13: optional §2.9 subjective recap (after Notable). */
  subjectiveRecapMarkdown?: string;
  /** P13: optional §2.10 coach questions (after subjective recap). */
  coachPromptMarkdown?: string;
  /** P13: local-date → subjective fields for §2.4 run lines. */
  subjectiveByRunDate?: ReadonlyMap<string, SubjectiveRunFields>;
};

function parseJsonObject(body: string): Record<string, unknown> | undefined {
  const t = body.trim();
  if (!t) return undefined;
  try {
    const v = JSON.parse(t) as unknown;
    return isPlainObject(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Shoes list: root array or `{ items | shoes }`. */
function parseShoesArray(body: string): Record<string, unknown>[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return [];
  }
  if (Array.isArray(parsed)) {
    return parsed.filter(isPlainObject) as Record<string, unknown>[];
  }
  if (!isPlainObject(parsed)) return [];
  const inner = pickFirst(parsed, ["items", "Items", "shoes", "Shoes", "data", "Data"]);
  if (!Array.isArray(inner)) return [];
  return inner.filter(isPlainObject) as Record<string, unknown>[];
}

function shoeIdKey(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  return s.length > 0 ? s : undefined;
}

/**
 * Mileage from shoe row: prefer explicit miles-like field; treat large numbers as meters → mi.
 */
function pickShoeMileageMi(item: Record<string, unknown>): number | undefined {
  const mileLike = pickFirst(item, [
    "totalMileageMi",
    "totalMileageMiles",
    "mileageMi",
    "mileageMiles",
  ]);
  if (typeof mileLike === "number" && Number.isFinite(mileLike) && mileLike >= 0) {
    return mileLike;
  }
  const raw = pickFirst(item, [
    "mileage",
    "Mileage",
    "totalMileage",
    "TotalMileage",
    "distance",
    "Distance",
  ]);
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return undefined;
  if (raw > 500) return raw / METERS_PER_MILE;
  return raw;
}

function buildShoeLookup(
  shoesBody: string,
): Map<string, { label: string; mileageMi?: number }> {
  const map = new Map<string, { label: string; mileageMi?: number }>();
  for (const item of parseShoesArray(shoesBody)) {
    const idRaw = pickFirst(item, ["id", "Id", "shoeId", "ShoeId"]);
    const id = shoeIdKey(idRaw);
    if (!id) continue;
    const brand = pickFirst(item, ["brand", "Brand"]);
    const model = pickFirst(item, ["model", "Model"]);
    const name = pickFirst(item, ["name", "Name", "nickname", "Nickname"]);
    const bits: string[] = [];
    if (typeof brand === "string" && brand.trim()) bits.push(brand.trim());
    if (typeof model === "string" && model.trim()) bits.push(model.trim());
    const label =
      bits.length > 0
        ? bits.join(" ")
        : typeof name === "string" && name.trim()
          ? name.trim()
          : id.slice(0, 8);
    const mileageMi = pickShoeMileageMi(item);
    map.set(id.toLowerCase(), { label, mileageMi });
  }
  return map;
}

export function formatDistanceDm(meters: number, unit: RecapUnitPreference): string {
  if (!Number.isFinite(meters) || meters < 0) return "n/a";
  if (unit === "imperial") {
    const mi = meters / METERS_PER_MILE;
    return `${mi.toFixed(2)} mi`;
  }
  const km = meters / 1000;
  return `${km.toFixed(2)} km`;
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "n/a";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** `avgPaceS` from Tempo is seconds per kilometer. */
export function formatPaceFromSecondsPerKm(
  secPerKm: number,
  unit: RecapUnitPreference,
): string {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return "n/a";
  const secPerUnit =
    unit === "imperial" ? secPerKm * (METERS_PER_MILE / 1000) : secPerKm;
  const m = Math.floor(secPerUnit / 60);
  const s = Math.round(secPerUnit % 60);
  const suf = unit === "imperial" ? "/mi" : "/km";
  return `${m}:${String(s).padStart(2, "0")}${suf}`;
}

function formatElevationM(m: number | undefined, unit: RecapUnitPreference): string {
  if (m === undefined || !Number.isFinite(m)) return "n/a";
  if (unit === "imperial") {
    const ft = m * 3.28084;
    return `${Math.round(ft)} ft`;
  }
  return `${Math.round(m)} m`;
}

export function formatStartedTitle(
  startedAt: string | undefined,
  timeZoneId: string,
): { titleDate: string; sortKey: number } {
  if (!startedAt?.trim()) {
    return { titleDate: "Unknown date", sortKey: 0 };
  }
  const dt = DateTime.fromISO(startedAt.trim(), { setZone: true });
  if (!dt.isValid) {
    return { titleDate: startedAt.trim(), sortKey: 0 };
  }
  const local = dt.setZone(timeZoneId);
  const titleDate = `${local.toFormat("ccc")} ${local.toFormat("MMM d")}`;
  return { titleDate, sortKey: local.toMillis() };
}

export function formatSplitList(
  splits: unknown,
  unit: RecapUnitPreference,
): string | undefined {
  if (!Array.isArray(splits) || splits.length === 0) return undefined;
  const parts: string[] = [];
  for (const row of splits) {
    if (!isPlainObject(row)) continue;
    const paceS = pickFirst(row, ["paceS", "PaceS"]);
    if (typeof paceS === "number" && Number.isFinite(paceS) && paceS > 0) {
      parts.push(formatPaceFromSecondsPerKm(paceS, unit));
    }
  }
  return parts.length > 0 ? parts.join(" / ") : undefined;
}

function formatWeatherLine(
  workout: Record<string, unknown>,
  unit: RecapUnitPreference,
): string | undefined {
  const w = pickFirst(workout, ["weather", "Weather"]);
  if (!isPlainObject(w)) return undefined;
  const bits: string[] = [];
  const temp = pickFirst(w, ["temperature", "Temperature", "temp", "Temp"]);
  if (typeof temp === "number" && Number.isFinite(temp)) {
    if (unit === "imperial") {
      const f = (temp * 9) / 5 + 32;
      bits.push(`${Math.round(f)}°F`);
    } else {
      bits.push(`${Math.round(temp)}°C`);
    }
  }
  const hum = pickFirst(w, ["humidity", "Humidity", "relativeHumidity"]);
  if (typeof hum === "number" && Number.isFinite(hum)) {
    bits.push(`${Math.round(hum)}% RH`);
  }
  const wind = pickFirst(w, ["wind", "Wind", "windSpeed"]);
  if (typeof wind === "string" && wind.trim()) bits.push(wind.trim());
  else if (typeof wind === "number" && Number.isFinite(wind)) {
    if (unit === "imperial") {
      bits.push(`${(wind * 2.23694).toFixed(1)} mph`);
    } else {
      bits.push(`${(wind * 3.6).toFixed(1)} km/h`);
    }
  }
  return bits.length > 0 ? bits.join(", ") : undefined;
}

function formatElevGainLoss(workout: Record<string, unknown>, unit: RecapUnitPreference): string | undefined {
  const g = pickFirst(workout, ["elevGainM", "ElevGainM", "elevationGainM"]);
  const l = pickFirst(workout, ["elevLossM", "ElevLossM", "elevationLossM"]);
  const up =
    typeof g === "number" && Number.isFinite(g)
      ? formatElevationM(g, unit)
      : undefined;
  const dn =
    typeof l === "number" && Number.isFinite(l)
      ? formatElevationM(l, unit)
      : undefined;
  if (!up && !dn) return undefined;
  const bits: string[] = [];
  if (up) bits.push(`↑${up}`);
  if (dn) bits.push(`↓${dn}`);
  return bits.join(" ");
}

export function hrRowById(
  analytics: RecapHrAnalyticsResult,
  id: string,
): RecapHrRunRow | undefined {
  return analytics.runs.find((r) => r.id.toLowerCase() === id.toLowerCase());
}

/** Sums from workout detail JSON for §2.2 “This week” columns. */
export function aggregateSummaryStats(
  workouts: readonly Record<string, unknown>[],
): {
  totalDistanceM: number;
  totalDurationS: number;
  totalElevM: number;
  totalRe: number;
} {
  let totalDistanceM = 0;
  let totalDurationS = 0;
  let totalElevM = 0;
  let totalRe = 0;
  for (const w of workouts) {
    const dm = pickFirst(w, ["distanceM", "Distance"]);
    if (typeof dm === "number" && Number.isFinite(dm)) totalDistanceM += dm;
    const ds = pickFirst(w, ["durationS", "Duration"]);
    if (typeof ds === "number" && Number.isFinite(ds)) totalDurationS += ds;
    const el = pickFirst(w, ["elevGainM", "ElevGainM"]);
    if (typeof el === "number" && Number.isFinite(el)) totalElevM += el;
    const re = pickFirst(w, ["relativeEffort", "RelativeEffort"]);
    if (typeof re === "number" && Number.isFinite(re)) totalRe += re;
  }
  return {
    totalDistanceM,
    totalDurationS,
    totalElevM,
    totalRe,
  };
}

/** Parse detail bodies for aggregateSummaryStats (CLI / tests). */
export function aggregateSummaryStatsFromDetails(
  workoutDetails: readonly { id: string; body: string }[],
): ReturnType<typeof aggregateSummaryStats> {
  const parsed: Record<string, unknown>[] = [];
  for (const d of workoutDetails) {
    const w = parseJsonObject(d.body);
    if (w) parsed.push(w);
  }
  return aggregateSummaryStats(parsed);
}

/** Avg easy-run HR (§2.2): easy-typed runs only, not long/tempo/etc. */
export function isEasyRunTypeForSummary(runType: unknown): boolean {
  if (typeof runType !== "string") return false;
  const t = runType.trim().toLowerCase();
  if (t.includes("long")) return false;
  return t.includes("easy") || t.includes("recovery");
}

export function avgEasyRunHr(analytics: RecapHrAnalyticsResult): number | undefined {
  const hrs: number[] = [];
  for (const r of analytics.runs) {
    if (!isEasyRunTypeForSummary(r.runType)) continue;
    if (r.avgHr !== undefined) hrs.push(r.avgHr);
  }
  if (hrs.length === 0) return undefined;
  return Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length);
}

/** §2.2 Δ = This week − 3-wk avg (distance delta in m → display units). */
function formatSignedDistanceDelta(
  deltaM: number | undefined,
  unit: RecapUnitPreference,
): string | undefined {
  if (deltaM === undefined || !Number.isFinite(deltaM)) return undefined;
  const d =
    unit === "imperial" ? deltaM / METERS_PER_MILE : deltaM / 1000;
  const sign = d >= 0 ? "+" : "-";
  return `${sign}${Math.abs(d).toFixed(1)}`;
}

function formatSignedRunsDelta(delta: number | undefined): string | undefined {
  if (delta === undefined || !Number.isFinite(delta)) return undefined;
  const sign = delta >= 0 ? "+" : "-";
  return `${sign}${Math.abs(delta).toFixed(1)}`;
}

function formatRunsAvgOneDecimal(n: number | undefined): string | undefined {
  if (n === undefined || !Number.isFinite(n)) return undefined;
  return n.toFixed(1);
}

function formatSignedDurationDeltaSec(sec: number | undefined): string | undefined {
  if (sec === undefined || !Number.isFinite(sec)) return undefined;
  const sign = sec >= 0 ? "+" : "-";
  const a = Math.abs(Math.round(sec));
  const h = Math.floor(a / 3600);
  const m = Math.floor((a % 3600) / 60);
  const s = a % 60;
  if (h > 0) return `${sign}${h}h ${m}m`;
  if (m > 0) return `${sign}${m}m`;
  return `${sign}${s}s`;
}

function formatSignedElevDeltaM(
  deltaM: number | undefined,
  unit: RecapUnitPreference,
): string | undefined {
  if (deltaM === undefined || !Number.isFinite(deltaM)) return undefined;
  const sign = deltaM >= 0 ? "+" : "-";
  const absVal = Math.abs(deltaM);
  if (unit === "imperial") {
    const ft = absVal * 3.28084;
    return `${sign}${Math.round(ft)} ft`;
  }
  return `${sign}${Math.round(absVal)} m`;
}

function formatReThreeWkCell(
  re: RecapSummaryFromStats["relativeEffort"],
): string | undefined {
  if (re.threeWkAvg === undefined) return undefined;
  const mid = Math.round(re.threeWkAvg);
  if (
    re.threeWkLow !== undefined &&
    re.threeWkHigh !== undefined &&
    Number.isFinite(re.threeWkLow) &&
    Number.isFinite(re.threeWkHigh)
  ) {
    return `${mid} (${Math.round(re.threeWkLow)}–${Math.round(re.threeWkHigh)})`;
  }
  return String(mid);
}

function formatSignedIntDelta(n: number | undefined): string | undefined {
  if (n === undefined || !Number.isFinite(n)) return undefined;
  const sign = n >= 0 ? "+" : "-";
  return `${sign}${Math.round(Math.abs(n))}`;
}

function cellOrDash(v: string | undefined): string {
  return v !== undefined && v !== "" ? v : EM_DASH;
}

function formatZoneDuration(seconds: number): string {
  if (seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function zoneAsciiLine(
  zoneLabel: string,
  pct: number,
  seconds: number,
): string {
  const filled = Math.round((ZONE_BAR_WIDTH * pct) / 100);
  const bar = `${"█".repeat(filled)}${"░".repeat(Math.max(0, ZONE_BAR_WIDTH - filled))}`;
  return `${zoneLabel} ${bar}  ${pct}%   (${formatZoneDuration(seconds)})`;
}

export function formatWeekZoneSection(a: RecapHrAnalyticsResult): string[] {
  const w = a.week;
  if (w.totalHrSeconds <= 0 || !w.zonePct) return [];

  const lines: string[] = [];
  lines.push("## HR zone distribution (week total)");
  lines.push("");

  const zs = w.zoneSeconds;
  const pct = w.zonePct;
  for (let i = 0; i < zs.length; i++) {
    const zi = i + 1;
    const key = `z${zi}`;
    const p = pct[key];
    if (p === undefined) continue;
    lines.push(zoneAsciiLine(`Z${zi}`, p, zs[i] ?? 0));
  }
  lines.push("");
  if (w.z1z2Pct !== undefined) {
    const flag =
      w.z1z2TargetMet === false
        ? " **Below** typical marathon base target (≥80% Z1+Z2)."
        : w.z1z2TargetMet === true
          ? " On target for ≥80% Z1+Z2."
          : "";
    lines.push(
      `Target for marathon base phase: **≥80% in Z1+Z2**. This week: **${w.z1z2Pct}%**.${flag}`,
    );
    lines.push("");
  }
  return lines;
}

/** API avgCadenceRpm is one-foot RPM; recap copy uses steps per minute (both feet). */
function cadenceRpmToSpm(rpm: number): number {
  return Math.round(rpm * 2);
}

function formatRunBlock(args: {
  workout: Record<string, unknown>;
  hr: RecapHrRunRow | undefined;
  unit: RecapUnitPreference;
  shoeLookup: Map<string, { label: string; mileageMi?: number }>;
  timeZoneId: string;
  similarEntry?: RecapSimilarRoutesEntry;
  subjective?: SubjectiveRunFields;
}): string {
  const { workout, hr, unit, shoeLookup, timeZoneId, similarEntry, subjective } =
    args;

  const startedRaw = pickFirst(workout, ["startedAt", "StartedAt"]);
  const startedAt =
    typeof startedRaw === "string" && startedRaw.trim()
      ? startedRaw.trim()
      : undefined;
  const { titleDate } = formatStartedTitle(startedAt, timeZoneId);

  const runTypeRaw = pickFirst(workout, ["runType", "RunType"]);
  const runType =
    typeof runTypeRaw === "string" && runTypeRaw.trim()
      ? runTypeRaw.trim()
      : "Run";

  const dm = pickFirst(workout, ["distanceM", "Distance"]);
  const distanceM =
    typeof dm === "number" && Number.isFinite(dm) ? dm : undefined;

  const ds = pickFirst(workout, ["durationS", "Duration"]);
  const durationS =
    typeof ds === "number" && Number.isFinite(ds) ? ds : undefined;

  const distStr =
    distanceM !== undefined ? formatDistanceDm(distanceM, unit) : "n/a";
  const durStr =
    durationS !== undefined ? formatDuration(durationS) : "n/a";

  const lines: string[] = [];
  lines.push(`### ${titleDate} — ${runType} — ${distStr} / ${durStr}`);
  lines.push("");

  const paceBits: string[] = [];
  const avgPace = pickFirst(workout, ["avgPaceS", "AvgPaceS"]);
  if (typeof avgPace === "number" && Number.isFinite(avgPace)) {
    paceBits.push(`Pace: ${formatPaceFromSecondsPerKm(avgPace, unit)}`);
  }
  const avgHr = pickFirst(workout, ["avgHeartRateBpm", "AvgHeartRateBpm"]);
  if (typeof avgHr === "number" && Number.isFinite(avgHr)) {
    let hrChunk = `Avg HR ${Math.round(avgHr)}`;
    if (hr?.pctMaxHr !== null && hr?.pctMaxHr !== undefined) {
      hrChunk += ` (${hr.pctMaxHr}% max)`;
    }
    paceBits.push(hrChunk);
  }
  const maxHr = pickFirst(workout, ["maxHeartRateBpm", "MaxHeartRateBpm"]);
  if (typeof maxHr === "number" && Number.isFinite(maxHr)) {
    paceBits.push(`Max HR ${Math.round(maxHr)}`);
  }
  const cad = pickFirst(workout, ["avgCadenceRpm", "AvgCadenceRpm"]);
  if (typeof cad === "number" && Number.isFinite(cad)) {
    paceBits.push(`Cad ${cadenceRpmToSpm(cad)} spm`);
  }
  if (paceBits.length > 0) {
    lines.push(`${paceBits.join("  ·  ")}`);
    lines.push("");
  }

  const splitsRaw = pickFirst(workout, ["splits", "Splits"]);
  const splitStr = formatSplitList(splitsRaw, unit);
  lines.push(`Splits: ${splitStr ?? "n/a"}`);
  lines.push("");

  if (hr && hr.q1AvgHr !== undefined && hr.q4AvgHr !== undefined && hr.driftBpm !== undefined) {
    const sign = hr.driftBpm >= 0 ? "+" : "";
    let driftLine = `HR drift: ${hr.q1AvgHr} → ${hr.q4AvgHr} (${sign}${hr.driftBpm} bpm)`;
    if (hr.driftSeverityLabel) driftLine += ` ${hr.driftSeverityLabel}`;
    lines.push(driftLine);
  } else {
    lines.push(`HR drift: n/a`);
  }
  lines.push("");

  const zLine = hr?.zonePct
    ? Object.keys(hr.zonePct)
        .sort()
        .map((k) => `${k.toUpperCase()} ${hr.zonePct![k]}%`)
        .join(" · ")
    : undefined;
  lines.push(`Time in zones: ${zLine ?? "n/a (no HR data)"}`);
  lines.push("");

  const elev = formatElevGainLoss(workout, unit);
  const wx = formatWeatherLine(workout, unit);
  const envBits: string[] = [];
  if (elev) envBits.push(`Elevation: ${elev}`);
  if (wx) envBits.push(`Weather: ${wx}`);
  if (envBits.length > 0) {
    lines.push(`${envBits.join("  ·  ")}`);
    lines.push("");
  }

  const shoeId = pickFirst(workout, ["shoeId", "ShoeId"]);
  if (typeof shoeId === "string" && shoeId.trim()) {
    const lu = shoeLookup.get(shoeId.trim().toLowerCase());
    if (lu) {
      const mi =
        lu.mileageMi !== undefined
          ? ` (${lu.mileageMi.toFixed(0)} mi)`
          : "";
      lines.push(`Shoe: ${lu.label}${mi}`);
    } else {
      lines.push(`Shoe: n/a (id ${shoeId.trim()})`);
    }
    lines.push("");
  }

  const re = pickFirst(workout, ["relativeEffort", "RelativeEffort"]);
  if (typeof re === "number" && Number.isFinite(re)) {
    lines.push(`Relative effort: ${Math.round(re)}`);
    lines.push("");
  }

  const similarLine = formatSimilarRouteMarkdownLine({
    currentWorkout: workout,
    entry: similarEntry,
    unit,
  });
  lines.push(`Similar route: ${similarLine}`);
  lines.push("");

  const notes = pickFirst(workout, ["notes", "Notes"]);
  if (typeof notes === "string" && notes.trim()) {
    lines.push(`Notes (from app): "${notes.trim()}"`);
    lines.push("");
  }

  const subjectiveLine = subjective ? formatSubjectiveRunLine(subjective) : undefined;
  if (subjectiveLine) {
    lines.push(subjectiveLine);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function sortWorkoutDetailsByStart(
  details: readonly { id: string; body: string }[],
  timeZoneId: string,
): { id: string; body: string }[] {
  return [...details].sort((a, b) => {
    const wa = parseJsonObject(a.body);
    const wb = parseJsonObject(b.body);
    const sa =
      wa && typeof pickFirst(wa, ["startedAt", "StartedAt"]) === "string"
        ? DateTime.fromISO(
            (pickFirst(wa, ["startedAt", "StartedAt"]) as string).trim(),
            { setZone: true },
          ).toMillis()
        : 0;
    const sb =
      wb && typeof pickFirst(wb, ["startedAt", "StartedAt"]) === "string"
        ? DateTime.fromISO(
            (pickFirst(wb, ["startedAt", "StartedAt"]) as string).trim(),
            { setZone: true },
          ).toMillis()
        : 0;
    if (sa !== sb) return sa - sb;
    return a.id.localeCompare(b.id);
  });
}

export type RecapSummaryTableRow = {
  metric: string;
  thisWeek: string;
  prevWeek: string;
  threeWkAvg: string;
  delta: string;
};

/** §2.2 summary cells — shared by Markdown and compact plain-text output. */
export function buildWeeklyRecapSummaryRows(args: {
  agg: ReturnType<typeof aggregateSummaryStats>;
  runCount: number;
  easyAvg: number | undefined;
  unit: RecapUnitPreference;
  summaryFromStats?: RecapSummaryFromStats;
}): RecapSummaryTableRow[] {
  const { agg, runCount, easyAvg, unit } = args;
  const sfs = args.summaryFromStats;

  const mileagePrev =
    sfs?.mileage.prevDistanceM !== undefined
      ? formatDistanceDm(sfs.mileage.prevDistanceM, unit)
      : undefined;
  const mileage3 =
    sfs?.mileage.threeWkAvgDistanceM !== undefined
      ? formatDistanceDm(sfs.mileage.threeWkAvgDistanceM, unit)
      : undefined;
  const mileageDelta = formatSignedDistanceDelta(sfs?.mileage.deltaVsThreeWkM, unit);

  const runsPrev =
    sfs?.runs.prev !== undefined ? String(Math.round(sfs.runs.prev)) : undefined;
  const runs3 = formatRunsAvgOneDecimal(sfs?.runs.threeWkAvg);
  const runsDelta = formatSignedRunsDelta(sfs?.runs.deltaVsThreeWk);

  const timePrev =
    sfs?.time.prevDurationS !== undefined
      ? formatDuration(Math.round(sfs.time.prevDurationS))
      : undefined;
  const time3 =
    sfs?.time.threeWkAvgDurationS !== undefined
      ? formatDuration(Math.round(sfs.time.threeWkAvgDurationS))
      : undefined;
  const timeDelta = formatSignedDurationDeltaSec(sfs?.time.deltaVsThreeWkS);

  const elevPrev =
    sfs?.elevation.prevElevM !== undefined
      ? formatElevationM(sfs.elevation.prevElevM, unit)
      : undefined;
  const elev3 =
    sfs?.elevation.threeWkAvgElevM !== undefined
      ? formatElevationM(sfs.elevation.threeWkAvgElevM, unit)
      : undefined;
  const elevDelta = formatSignedElevDeltaM(sfs?.elevation.deltaVsThreeWkM, unit);

  const reThisWeek =
    agg.totalRe > 0 ? String(Math.round(agg.totalRe)) : EM_DASH;
  const rePrev =
    sfs?.relativeEffort.prev !== undefined
      ? String(Math.round(sfs.relativeEffort.prev))
      : undefined;
  const re3 = sfs ? formatReThreeWkCell(sfs.relativeEffort) : undefined;
  const reDelta = formatSignedIntDelta(sfs?.relativeEffort.deltaVsThreeWk);

  return [
    {
      metric: "Mileage",
      thisWeek: formatDistanceDm(agg.totalDistanceM, unit),
      prevWeek: cellOrDash(mileagePrev),
      threeWkAvg: cellOrDash(mileage3),
      delta: cellOrDash(mileageDelta),
    },
    {
      metric: "Runs",
      thisWeek: String(runCount),
      prevWeek: cellOrDash(runsPrev),
      threeWkAvg: cellOrDash(runs3),
      delta: cellOrDash(runsDelta),
    },
    {
      metric: "Total time",
      thisWeek: formatDuration(agg.totalDurationS),
      prevWeek: cellOrDash(timePrev),
      threeWkAvg: cellOrDash(time3),
      delta: cellOrDash(timeDelta),
    },
    {
      metric: "Total elevation",
      thisWeek: formatElevationM(agg.totalElevM, unit),
      prevWeek: cellOrDash(elevPrev),
      threeWkAvg: cellOrDash(elev3),
      delta: cellOrDash(elevDelta),
    },
    {
      metric: "Relative effort",
      thisWeek: reThisWeek,
      prevWeek: cellOrDash(rePrev),
      threeWkAvg: cellOrDash(re3),
      delta: cellOrDash(reDelta),
    },
    {
      metric: "Avg easy-run HR",
      thisWeek:
        easyAvg !== undefined ? String(easyAvg) : EM_DASH,
      prevWeek: sfs?.easyRunHr
        ? cellOrDash(
            sfs.easyRunHr.prev !== undefined
              ? String(Math.round(sfs.easyRunHr.prev))
              : undefined,
          )
        : EM_DASH,
      threeWkAvg: sfs?.easyRunHr
        ? cellOrDash(
            sfs.easyRunHr.threeWkAvg !== undefined
              ? String(Math.round(sfs.easyRunHr.threeWkAvg))
              : undefined,
          )
        : EM_DASH,
      delta: sfs?.easyRunHr
        ? cellOrDash(formatSignedIntDelta(sfs.easyRunHr.deltaVsThreeWk))
        : EM_DASH,
    },
  ];
}

/** §2.2 summary pipe table (Markdown). */
export function buildWeeklyRecapSummarySectionMarkdown(args: {
  agg: ReturnType<typeof aggregateSummaryStats>;
  runCount: number;
  easyAvg: number | undefined;
  unit: RecapUnitPreference;
  summaryFromStats?: RecapSummaryFromStats;
}): string {
  const rows = buildWeeklyRecapSummaryRows(args);
  const sections: string[] = [];
  sections.push("## Summary");
  sections.push("");
  sections.push("| Metric | This week | Prev week | 3-wk avg | Δ |");
  sections.push("| --- | --- | --- | --- | --- |");
  for (const r of rows) {
    sections.push(
      `| ${r.metric} | ${r.thisWeek} | ${r.prevWeek} | ${r.threeWkAvg} | ${r.delta} |`,
    );
  }
  sections.push("");
  return `${sections.join("\n")}\n`;
}

/** §2.2 summary as plain lines (compact terminal format). */
export function formatWeeklyRecapSummaryPlain(rows: readonly RecapSummaryTableRow[]): string {
  const header =
    "Metric".padEnd(18) +
    "This week".padEnd(14) +
    "Prev week".padEnd(14) +
    "3-wk avg".padEnd(14) +
    "Δ";
  const sep = "-".repeat(Math.max(header.length, 72));
  const body = rows
    .map(
      (r) =>
        r.metric.padEnd(18) +
        r.thisWeek.padEnd(14) +
        r.prevWeek.padEnd(14) +
        r.threeWkAvg.padEnd(14) +
        r.delta,
    )
    .join("\n");
  return `${header}\n${sep}\n${body}\n`;
}

/**
 * Builds Markdown for §2.1–§2.4: header, summary table, optional zone block, run blocks.
 */
export function buildWeeklyRecapMarkdownCore(input: WeeklyRecapMarkdownInput): string {
  const {
    resolved,
    timeZoneId,
    unit,
    hrAnalytics,
    workoutDetails,
    shoesBody,
    summaryFromStats: sfs,
    similarRoutesByWorkoutId: similarMap,
    qualitySessionsMarkdown,
    longRunMarkdown,
    trendsMarkdown,
    notableMarkdown,
    subjectiveRecapMarkdown,
    coachPromptMarkdown,
    subjectiveByRunDate,
  } = input;

  const shoeLookup = buildShoeLookup(shoesBody);

  const rangeLabel = (() => {
    const a = DateTime.fromISO(resolved.localRange.start, {
      zone: timeZoneId,
    });
    const b = DateTime.fromISO(resolved.localRange.end, { zone: timeZoneId });
    if (!a.isValid || !b.isValid) {
      return `${resolved.localRange.start} – ${resolved.localRange.end}`;
    }
    const y = b.year;
    return `${a.toFormat("MMM d")} – ${b.toFormat("MMM d")}, ${y}`;
  })();

  const sections: string[] = [];

  sections.push(`# Weekly Recap — Week of ${rangeLabel}`);
  sections.push("");

  if (workoutDetails.length === 0) {
    sections.push("No runs recorded this week.");
    sections.push("");
    if (qualitySessionsMarkdown?.trim()) {
      sections.push(qualitySessionsMarkdown.trim());
      sections.push("");
    }
    if (longRunMarkdown?.trim()) {
      sections.push(longRunMarkdown.trim());
      sections.push("");
    }
    if (trendsMarkdown?.trim()) {
      sections.push(trendsMarkdown.trim());
      sections.push("");
    }
    if (notableMarkdown?.trim()) {
      sections.push(notableMarkdown.trim());
      sections.push("");
    }
    if (subjectiveRecapMarkdown?.trim()) {
      sections.push(subjectiveRecapMarkdown.trim());
      sections.push("");
    }
    if (coachPromptMarkdown?.trim()) {
      sections.push(coachPromptMarkdown.trim());
      sections.push("");
    }
    return sections.join("\n").trimEnd() + "\n";
  }

  const parsedWorkouts: Record<string, unknown>[] = [];
  for (const d of workoutDetails) {
    const w = parseJsonObject(d.body);
    if (w) parsedWorkouts.push(w);
  }

  const agg = aggregateSummaryStats(parsedWorkouts);
  const runCount = workoutDetails.length;
  const easyAvg = avgEasyRunHr(hrAnalytics);

  sections.push(
    buildWeeklyRecapSummarySectionMarkdown({
      agg,
      runCount,
      easyAvg,
      unit,
      summaryFromStats: sfs,
    }).trimEnd(),
  );
  sections.push("");

  sections.push(...formatWeekZoneSection(hrAnalytics));

  sections.push("## Run-by-run");
  sections.push("");

  const ordered = sortWorkoutDetailsByStart(workoutDetails, timeZoneId);
  const blocks: string[] = [];
  for (const d of ordered) {
    const w = parseJsonObject(d.body);
    if (!w) {
      blocks.push(`### Run ${d.id}`);
      blocks.push("");
      blocks.push("Could not parse workout JSON.");
      blocks.push("");
      continue;
    }
    const hr = hrRowById(hrAnalytics, d.id);
    const startedForDate = pickFirst(w, ["startedAt", "StartedAt"]);
    const localDate =
      typeof startedForDate === "string"
        ? workoutLocalDate(startedForDate, timeZoneId)
        : undefined;
    const subjective =
      localDate !== undefined
        ? subjectiveByRunDate?.get(localDate)
        : undefined;
    blocks.push(
      formatRunBlock({
        workout: w,
        hr,
        unit,
        shoeLookup,
        timeZoneId,
        similarEntry: similarMap?.[d.id],
        subjective,
      }),
    );
    blocks.push("");
  }

  sections.push(blocks.join("\n").trimEnd());
  sections.push("");

  if (qualitySessionsMarkdown?.trim()) {
    sections.push(qualitySessionsMarkdown.trim());
    sections.push("");
  }

  if (longRunMarkdown?.trim()) {
    sections.push(longRunMarkdown.trim());
    sections.push("");
  }

  if (trendsMarkdown?.trim()) {
    sections.push(trendsMarkdown.trim());
    sections.push("");
  }

  if (notableMarkdown?.trim()) {
    sections.push(notableMarkdown.trim());
    sections.push("");
  }

  if (subjectiveRecapMarkdown?.trim()) {
    sections.push(subjectiveRecapMarkdown.trim());
    sections.push("");
  }

  if (coachPromptMarkdown?.trim()) {
    sections.push(coachPromptMarkdown.trim());
    sections.push("");
  }

  return sections.join("\n").trimEnd() + "\n";
}
