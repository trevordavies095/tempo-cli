/**
 * §2.6 Long run block: eligibility per weekly recap spec (typed Long Run or ≥75% of prescribed
 * long-run distance), half-split negative-split detection (§3.7: ≥5s/mi), and a short last-window line.
 */

import { DateTime } from "luxon";

import { isPlainObject, pickFirst } from "../output/human-summary.js";
import type { RecapHrAnalyticsResult } from "./hr-analytics.js";
import {
  formatDistanceDm,
  formatDuration,
  formatPaceFromSecondsPerKm,
  formatSplitList,
  formatStartedTitle,
  hrRowById,
} from "./markdown-report.js";
import {
  parsePrescribedWeekYaml,
  type PrescribedLongRunSession,
} from "./prescribed-week.js";
import type { RecapUnitPreference } from "./recap-settings.js";
import { isLongRunType } from "./trends.js";

const METERS_PER_MILE = 1609.344;
/** §3.7 negative split when back half avg pace is faster than front by ≥5s/mi. */
const NEG_SPLIT_SEC_PER_MI = 5;
/** Pace pickup vs overall avg on last ~3 mi window (sec/mi, positive = last window faster). */
const MARATHON_PACE_PICKUP_SEC_PER_MI = 10;

export type BuildLongRunSectionArgs = {
  prescribedRaw: string | undefined;
  workoutDetails: readonly { id: string; body: string }[];
  hrAnalytics: RecapHrAnalyticsResult;
  timeZoneId: string;
  unit: RecapUnitPreference;
  resolvedIsoWeekId: string;
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

function workoutLocalDate(
  startedAt: string | undefined,
  timeZoneId: string,
): string | undefined {
  if (!startedAt?.trim()) return undefined;
  const dt = DateTime.fromISO(startedAt.trim(), { setZone: true });
  if (!dt.isValid) return undefined;
  return dt.setZone(timeZoneId).toFormat("yyyy-LL-dd");
}

function paceSecKmToSecMi(paceS: number): number {
  return paceS * (METERS_PER_MILE / 1000);
}

function secMiToSecKm(secPerMi: number): number {
  return secPerMi / (METERS_PER_MILE / 1000);
}

type ParsedDetail = {
  id: string;
  workout: Record<string, unknown>;
  distanceM: number;
};

function collectDetails(
  workoutDetails: readonly { id: string; body: string }[],
): ParsedDetail[] {
  const out: ParsedDetail[] = [];
  for (const d of workoutDetails) {
    const w = parseJsonObject(d.body);
    if (!w) continue;
    const dm = pickFirst(w, ["distanceM", "Distance"]);
    const distanceM =
      typeof dm === "number" && Number.isFinite(dm) && dm > 0 ? dm : 0;
    if (distanceM <= 0) continue;
    out.push({ id: d.id, workout: w, distanceM });
  }
  return out;
}

function pickLongRunWorkout(args: {
  details: ParsedDetail[];
  prescribedRaw: string | undefined;
}):
  | {
      picked: ParsedDetail;
      selectionReason: "explicit_long_run" | "prescribed_threshold_met";
      prescribedThresholdMi?: number;
    }
  | undefined {
  const { details, prescribedRaw } = args;
  if (details.length === 0) return undefined;

  const maxDist = Math.max(...details.map((d) => d.distanceM));
  const typed = details.filter((d) =>
    isLongRunType(pickFirst(d.workout, ["runType", "RunType"])),
  );
  if (typed.length > 0) {
    const tMax = Math.max(...typed.map((d) => d.distanceM));
    const candidates = typed.filter((d) => d.distanceM === tMax);
    candidates.sort((a, b) => a.id.localeCompare(b.id));
    return {
      picked: candidates[0]!,
      selectionReason: "explicit_long_run",
    };
  }

  const trimmed = prescribedRaw?.trim();
  if (!trimmed) return undefined;

  const parsed = parsePrescribedWeekYaml(trimmed);
  if (!parsed.ok) return undefined;

  /* Threshold path uses prescribed long_run rows (week id mismatch does not block §2.6). */

  const longRuns = parsed.value.sessions.filter(
    (s): s is PrescribedLongRunSession => s.kind === "long_run",
  );
  if (longRuns.length === 0) return undefined;

  const T_mi = Math.max(...longRuns.map((l) => l.targetDistanceMi));
  const T_m = T_mi * METERS_PER_MILE;

  if (maxDist < 0.75 * T_m) return undefined;

  const longest = details.filter((d) => d.distanceM === maxDist);
  longest.sort((a, b) => a.id.localeCompare(b.id));
  return {
    picked: longest[0]!,
    selectionReason: "prescribed_threshold_met",
    prescribedThresholdMi: T_mi,
  };
}

function splitRows(workout: Record<string, unknown>): Record<string, unknown>[] {
  const splitsRaw = pickFirst(workout, ["splits", "Splits"]);
  if (!Array.isArray(splitsRaw)) return [];
  return splitsRaw.filter(isPlainObject) as Record<string, unknown>[];
}

function avgSecPerMiFromSplitRows(
  rows: Record<string, unknown>[],
): number | undefined {
  const secs: number[] = [];
  for (const row of rows) {
    const paceS = pickFirst(row, ["paceS", "PaceS"]);
    if (typeof paceS === "number" && Number.isFinite(paceS) && paceS > 0) {
      secs.push(paceSecKmToSecMi(paceS));
    }
  }
  if (secs.length === 0) return undefined;
  return secs.reduce((a, b) => a + b, 0) / secs.length;
}

function computeHalfSplitSecPerMi(workout: Record<string, unknown>): {
  frontHalfSecPerMi: number;
  backHalfSecPerMi: number;
  deltaSecPerMi: number;
  negativeSplit: boolean;
} | undefined {
  const rows = splitRows(workout);
  const n = rows.length;
  if (n < 2) return undefined;
  const frontN = Math.floor(n / 2);
  const frontRows = rows.slice(0, frontN);
  const backRows = rows.slice(frontN);
  const front = avgSecPerMiFromSplitRows(frontRows);
  const back = avgSecPerMiFromSplitRows(backRows);
  if (front === undefined || back === undefined) return undefined;
  const deltaSecPerMi = front - back;
  return {
    frontHalfSecPerMi: front,
    backHalfSecPerMi: back,
    deltaSecPerMi,
    negativeSplit: deltaSecPerMi >= NEG_SPLIT_SEC_PER_MI,
  };
}

const THREE_MI_M = 3 * METERS_PER_MILE;

/** Last splits summing to ≥3 mi by distanceM when possible; else heuristic split count from avg mi/split. */
function lastThreeMiWindowRows(
  workout: Record<string, unknown>,
): Record<string, unknown>[] {
  const rows = splitRows(workout);
  if (rows.length === 0) return [];

  let cum = 0;
  const suffix: Record<string, unknown>[] = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!;
    suffix.unshift(row);
    const dm = pickFirst(row, ["distanceM", "Distance"]);
    if (typeof dm === "number" && Number.isFinite(dm) && dm > 0) {
      cum += dm;
    }
    if (cum >= THREE_MI_M) break;
  }

  if (cum > 0) return suffix;

  const totalDm = pickFirst(workout, ["distanceM", "Distance"]);
  const totalMi =
    typeof totalDm === "number" && Number.isFinite(totalDm) && totalDm > 0
      ? totalDm / METERS_PER_MILE
      : undefined;
  const perSplitMi =
    totalMi !== undefined && rows.length > 0 ? totalMi / rows.length : 0.5;
  const k = Math.max(1, Math.min(rows.length, Math.ceil(3 / perSplitMi)));
  return rows.slice(-k);
}

function avgHrFromSplitRows(rows: Record<string, unknown>[]): number | undefined {
  const hrs: number[] = [];
  for (const row of rows) {
    const h = pickFirst(row, [
      "avgHeartRateBpm",
      "AvgHeartRateBpm",
      "averageHeartRateBpm",
    ]);
    if (typeof h === "number" && Number.isFinite(h) && h > 0) {
      hrs.push(Math.round(h));
    }
  }
  if (hrs.length === 0) return undefined;
  return Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length);
}

function pickPrescribedLongRunForDate(
  prescribedRaw: string | undefined,
  dateYmd: string,
): PrescribedLongRunSession | undefined {
  const t = prescribedRaw?.trim();
  if (!t) return undefined;
  const parsed = parsePrescribedWeekYaml(t);
  if (!parsed.ok) return undefined;
  for (const s of parsed.value.sessions) {
    if (s.kind === "long_run" && s.date === dateYmd) return s;
  }
  return undefined;
}

function assignedEasyLongRun(
  prescribed: PrescribedLongRunSession | undefined,
  runTypeRaw: unknown,
): boolean {
  const desc = prescribed?.description?.toLowerCase() ?? "";
  if (/tempo|marathon\s*pace|mp\b/i.test(desc)) return false;
  if (/easy|recovery|z2/i.test(desc)) return true;
  if (prescribed && desc === "") return true;
  if (typeof runTypeRaw === "string") {
    const t = runTypeRaw.toLowerCase();
    if (t.includes("easy") || t.includes("recovery")) return true;
  }
  return prescribed !== undefined;
}

function formatHalfComparisonLine(
  unit: RecapUnitPreference,
  half: ReturnType<typeof computeHalfSplitSecPerMi>,
): string {
  if (!half) return "";
  const frontKm = secMiToSecKm(half.frontHalfSecPerMi);
  const backKm = secMiToSecKm(half.backHalfSecPerMi);
  const frontStr = formatPaceFromSecondsPerKm(frontKm, unit);
  const backStr = formatPaceFromSecondsPerKm(backKm, unit);
  const fasterBy = Math.round(half.deltaSecPerMi);
  const cmp =
    half.deltaSecPerMi >= NEG_SPLIT_SEC_PER_MI
      ? `(faster than front half by ${fasterBy}s/mi) ✓ negative split`
      : `(vs front half; Δ ${fasterBy >= 0 ? "+" : ""}${fasterBy}s/mi)`;
  return `Back half avg pace: ${backStr} vs front ${frontStr} ${cmp}`;
}

export function buildLongRunSectionOutput(
  args: BuildLongRunSectionArgs,
): { markdown: string; json: Record<string, unknown> } {
  const base: Record<string, unknown> = {
    included: false,
  };

  const details = collectDetails(args.workoutDetails);
  const selected = pickLongRunWorkout({
    details,
    prescribedRaw: args.prescribedRaw,
  });

  if (!selected) {
    return {
      markdown: "",
      json: {
        ...base,
        reason: "not_eligible",
      },
    };
  }

  const { picked, selectionReason, prescribedThresholdMi } = selected;
  const w = picked.workout;
  const startedRaw = pickFirst(w, ["startedAt", "StartedAt"]);
  const startedAt =
    typeof startedRaw === "string" && startedRaw.trim()
      ? startedRaw.trim()
      : undefined;
  const { titleDate } = formatStartedTitle(startedAt, args.timeZoneId);
  const localDate = workoutLocalDate(startedAt, args.timeZoneId);

  const ds = pickFirst(w, ["durationS", "Duration"]);
  const durationS =
    typeof ds === "number" && Number.isFinite(ds) ? Math.floor(ds) : undefined;

  const distStr = formatDistanceDm(picked.distanceM, args.unit);
  const durStr =
    durationS !== undefined ? formatDuration(durationS) : "n/a";

  const avgPace = pickFirst(w, ["avgPaceS", "AvgPaceS"]);
  const avgHr = pickFirst(w, ["avgHeartRateBpm", "AvgHeartRateBpm"]);
  const paceStr =
    typeof avgPace === "number" && Number.isFinite(avgPace) && avgPace > 0
      ? formatPaceFromSecondsPerKm(avgPace, args.unit)
      : "n/a";
  const avgHrStr =
    typeof avgHr === "number" && Number.isFinite(avgHr)
      ? String(Math.round(avgHr))
      : "n/a";

  const hr = hrRowById(args.hrAnalytics, picked.id);
  const summaryBits: string[] = [];
  summaryBits.push(`Avg pace: ${paceStr}`);
  summaryBits.push(`Avg HR ${avgHrStr}`);
  if (
    hr?.q1AvgHr !== undefined &&
    hr.q4AvgHr !== undefined &&
    hr.driftBpm !== undefined
  ) {
    const sign = hr.driftBpm >= 0 ? "+" : "";
    summaryBits.push(
      `Drift: ${hr.q1AvgHr} → ${hr.q4AvgHr} (${sign}${hr.driftBpm} bpm)`,
    );
  } else {
    summaryBits.push("Drift: n/a");
  }

  const splitsRaw = pickFirst(w, ["splits", "Splits"]);
  const splitStr = formatSplitList(splitsRaw, args.unit);
  const half = computeHalfSplitSecPerMi(w);

  const prescribedLr =
    localDate !== undefined
      ? pickPrescribedLongRunForDate(args.prescribedRaw, localDate)
      : undefined;

  const windowRows = lastThreeMiWindowRows(w);
  const lastWinAvgSecMi = avgSecPerMiFromSplitRows(windowRows);
  const overallSecMi =
    typeof avgPace === "number" && avgPace > 0
      ? paceSecKmToSecMi(avgPace)
      : undefined;
  const lastWinHr = avgHrFromSplitRows(windowRows);
  const pacePickup =
    overallSecMi !== undefined &&
    lastWinAvgSecMi !== undefined &&
    overallSecMi - lastWinAvgSecMi >= MARATHON_PACE_PICKUP_SEC_PER_MI;
  const hrOverCap =
    prescribedLr !== undefined &&
    lastWinHr !== undefined &&
    lastWinHr > prescribedLr.targetHrBpmMax;
  const marathonLikely = pacePickup || hrOverCap;
  const assignedEasy = assignedEasyLongRun(
    prescribedLr,
    pickFirst(w, ["runType", "RunType"]),
  );

  let lastWindowLine: string;
  const windowLabel =
    args.unit === "imperial" ? "Last 3 mi" : "Last ~5 km window";
  if (lastWinAvgSecMi === undefined || overallSecMi === undefined) {
    lastWindowLine = `${windowLabel} at marathon-pace effort? n/a (pace data incomplete)`;
  } else if (marathonLikely) {
    lastWindowLine = `${windowLabel} at marathon-pace effort? Yes (paced up or HR above easy cap)`;
  } else if (assignedEasy) {
    lastWindowLine = `${windowLabel} at marathon-pace effort? No (assigned: easy)`;
  } else {
    lastWindowLine = `${windowLabel} at marathon-pace effort? No`;
  }

  const lines: string[] = [
    `### Long run — ${titleDate} — ${distStr} / ${durStr}`,
    "",
    summaryBits.join("  ·  "),
    "",
    `Splits: ${splitStr ?? "n/a"}`,
    "",
  ];

  if (half) {
    lines.push(formatHalfComparisonLine(args.unit, half));
    lines.push("");
  }

  lines.push(lastWindowLine);
  lines.push("");

  const markdown = lines.join("\n");

  const overallSecKm =
    typeof avgPace === "number" && avgPace > 0 ? avgPace : undefined;

  return {
    markdown,
    json: {
      included: true,
      selectionReason,
      prescribedThresholdMi,
      workoutId: picked.id,
      resolvedIsoWeekId: args.resolvedIsoWeekId,
      negativeSplit: half?.negativeSplit ?? false,
      frontHalfSecPerMi: half?.frontHalfSecPerMi,
      backHalfSecPerMi: half?.backHalfSecPerMi,
      halfDeltaSecPerMi: half?.deltaSecPerMi,
      lastThreeMi: {
        windowLabel,
        avgSecPerMi: lastWinAvgSecMi,
        overallSecPerMi: overallSecMi,
        overallSecPerKm: overallSecKm,
        avgHr: lastWinHr,
        marathonPaceEffortLikely: marathonLikely,
        assignedEasy,
        prescribedHrCap:
          prescribedLr !== undefined ? prescribedLr.targetHrBpmMax : undefined,
      },
    },
  };
}
