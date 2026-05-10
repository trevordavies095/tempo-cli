/**
 * §3.9 compact weekly recap: terminal-friendly summary (no splits, drift per run, or trends).
 */

import { DateTime } from "luxon";

import { isPlainObject, pickFirst } from "../output/human-summary.js";
import type { RecapHrAnalyticsResult, RecapHrRunRow } from "./hr-analytics.js";
import type { RecapNotableSnapshot } from "./notable.js";
import type { RecapSummaryFromStats } from "./recap-summary-stats.js";
import type { RecapUnitPreference } from "./recap-settings.js";
import type { RecapWeekResolved } from "./resolve-week.js";
import {
  aggregateSummaryStats,
  avgEasyRunHr,
  buildWeeklyRecapSummaryRows,
  formatDistanceDm,
  formatDuration,
  formatPaceFromSecondsPerKm,
  formatStartedTitle,
  formatWeeklyRecapSummaryPlain,
  formatWeekZoneSection,
  hrRowById,
  sortWorkoutDetailsByStart,
} from "./markdown-report.js";

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

function zoneSectionPlain(hr: RecapHrAnalyticsResult): string[] {
  const raw = formatWeekZoneSection(hr);
  const out: string[] = [];
  for (const line of raw) {
    if (line.startsWith("## ")) {
      out.push(line.slice(3));
    } else {
      out.push(line.replace(/\*\*/g, ""));
    }
  }
  return out;
}

export type WeeklyRecapCompactInput = {
  resolved: RecapWeekResolved;
  timeZoneId: string;
  unit: RecapUnitPreference;
  hrAnalytics: RecapHrAnalyticsResult;
  workoutDetails: readonly { id: string; body: string }[];
  summaryFromStats?: RecapSummaryFromStats;
  notableSnapshot: RecapNotableSnapshot;
};

function formatOneRunCompactLine(
  workout: Record<string, unknown>,
  hr: RecapHrRunRow | undefined,
  unit: RecapUnitPreference,
  timeZoneId: string,
): string {
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

  const bits: string[] = [];
  const avgPace = pickFirst(workout, ["avgPaceS", "AvgPaceS"]);
  if (typeof avgPace === "number" && Number.isFinite(avgPace)) {
    bits.push(formatPaceFromSecondsPerKm(avgPace, unit));
  }
  const avgHr = pickFirst(workout, ["avgHeartRateBpm", "AvgHeartRateBpm"]);
  if (typeof avgHr === "number" && Number.isFinite(avgHr)) {
    let chunk = `HR ${Math.round(avgHr)}`;
    if (hr?.pctMaxHr !== null && hr?.pctMaxHr !== undefined) {
      chunk += ` (${hr.pctMaxHr}% max)`;
    }
    bits.push(chunk);
  }

  const head = `${titleDate}  ·  ${runType}  ·  ${distStr}  ·  ${durStr}`;
  return bits.length > 0 ? `${head}  ·  ${bits.join("  ·  ")}` : head;
}

export function buildWeeklyRecapCompact(input: WeeklyRecapCompactInput): string {
  const {
    resolved,
    timeZoneId,
    unit,
    hrAnalytics,
    workoutDetails,
    summaryFromStats,
    notableSnapshot,
  } = input;

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
    if (notableSnapshot.bullets.length > 0) {
      sections.push("Notable");
      sections.push("");
      for (const b of notableSnapshot.bullets) {
        sections.push(`- ${b}`);
      }
      sections.push("");
    }
    return `${sections.join("\n").trimEnd()}\n`;
  }

  const parsedWorkouts: Record<string, unknown>[] = [];
  for (const d of workoutDetails) {
    const w = parseJsonObject(d.body);
    if (w) parsedWorkouts.push(w);
  }

  const agg = aggregateSummaryStats(parsedWorkouts);
  const runCount = workoutDetails.length;
  const easyAvg = avgEasyRunHr(hrAnalytics);

  sections.push("Summary");
  sections.push("");
  sections.push(
    formatWeeklyRecapSummaryPlain(
      buildWeeklyRecapSummaryRows({
        agg,
        runCount,
        easyAvg,
        unit,
        summaryFromStats,
      }),
    ).trimEnd(),
  );
  sections.push("");

  const zLines = zoneSectionPlain(hrAnalytics);
  if (zLines.length > 0) {
    sections.push(...zLines);
  }

  sections.push("Runs");
  sections.push("");
  const ordered = sortWorkoutDetailsByStart(workoutDetails, timeZoneId);
  for (const d of ordered) {
    const w = parseJsonObject(d.body);
    if (!w) {
      sections.push(`${d.id}: could not parse workout JSON`);
      continue;
    }
    sections.push(
      formatOneRunCompactLine(w, hrRowById(hrAnalytics, d.id), unit, timeZoneId),
    );
  }
  sections.push("");

  if (notableSnapshot.bullets.length > 0) {
    sections.push("Notable");
    sections.push("");
    for (const b of notableSnapshot.bullets) {
      sections.push(`- ${b}`);
    }
    sections.push("");
  }

  return `${sections.join("\n").trimEnd()}\n`;
}
