/**
 * §3.9 additive `report` object for weekly recap JSON CLI output.
 */

import { isPlainObject, pickFirst } from "../output/human-summary.js";
import type { RecapHrAnalyticsResult } from "./hr-analytics.js";
import { recapHrAnalyticsToJson } from "./hr-analytics.js";
import type { RecapSummaryFromStats } from "./recap-summary-stats.js";
import type { RecapWeekResolved } from "./resolve-week.js";

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

export function buildWeeklyRecapReportPayload(input: {
  resolved: RecapWeekResolved;
  hrAnalytics: RecapHrAnalyticsResult;
  workoutDetails: readonly { id: string; body: string }[];
  summaryFromStats?: RecapSummaryFromStats;
  trendsJson: unknown;
  subjective: unknown;
}): Record<string, unknown> {
  const {
    resolved,
    hrAnalytics,
    workoutDetails,
    summaryFromStats,
    trendsJson,
    subjective,
  } = input;

  const ha = recapHrAnalyticsToJson(hrAnalytics);

  const runs = workoutDetails.map((d) => {
    const w = parseJsonObject(d.body);
    if (!w) {
      return { id: d.id, parseError: true as const };
    }
    const startedRaw = pickFirst(w, ["startedAt", "StartedAt"]);
    const startedAt =
      typeof startedRaw === "string" && startedRaw.trim()
        ? startedRaw.trim()
        : null;
    const runTypeRaw = pickFirst(w, ["runType", "RunType"]);
    const runType =
      typeof runTypeRaw === "string" && runTypeRaw.trim()
        ? runTypeRaw.trim()
        : null;
    const dm = pickFirst(w, ["distanceM", "Distance"]);
    const distanceM =
      typeof dm === "number" && Number.isFinite(dm) ? dm : null;
    const ds = pickFirst(w, ["durationS", "Duration"]);
    const durationS =
      typeof ds === "number" && Number.isFinite(ds) ? ds : null;
    const ap = pickFirst(w, ["avgPaceS", "AvgPaceS"]);
    const avgPaceS =
      typeof ap === "number" && Number.isFinite(ap) ? ap : null;
    const hr = pickFirst(w, ["avgHeartRateBpm", "AvgHeartRateBpm"]);
    const avgHeartRateBpm =
      typeof hr === "number" && Number.isFinite(hr) ? hr : null;

    return {
      id: d.id,
      startedAt,
      runType,
      distanceM,
      durationS,
      avgPaceS,
      avgHeartRateBpm,
    };
  });

  return {
    week: resolved.isoWeekId,
    range: {
      start: resolved.localRange.start,
      end: resolved.localRange.end,
    },
    summary: summaryFromStats ?? null,
    zones: ha.week,
    runs,
    trends: trendsJson,
    subjective,
  };
}
