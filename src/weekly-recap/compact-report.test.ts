import { describe, expect, it } from "vitest";

import { buildWeeklyRecapCompact } from "./compact-report.js";
import { computeRecapHrAnalytics } from "./hr-analytics.js";
import type { RecapSummaryFromStats } from "./recap-summary-stats.js";
import type { RecapWeekResolved } from "./resolve-week.js";

const fiveZones = [
  { zone: 1, minBpm: 100, maxBpm: 120 },
  { zone: 2, minBpm: 121, maxBpm: 140 },
  { zone: 3, minBpm: 141, maxBpm: 160 },
  { zone: 4, minBpm: 161, maxBpm: 175 },
  { zone: 5, minBpm: 176, maxBpm: 195 },
];

const W1 = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const resolvedSample: RecapWeekResolved = {
  isoWeekId: "2026-W19",
  localRange: { start: "2026-05-04", end: "2026-05-10" },
  utcStartDate: "2026-05-04T04:00:00.000Z",
  utcEndDate: "2026-05-11T03:59:59.999Z",
  timezoneOffsetMinutes: -240,
};

function zonesBody(): string {
  return JSON.stringify({
    calculationMethod: "AgeBased",
    age: 40,
    zones: fiveZones,
  });
}

describe("buildWeeklyRecapCompact", () => {
  it("emits header and empty-week message without splits or drift labels", () => {
    const text = buildWeeklyRecapCompact({
      resolved: resolvedSample,
      timeZoneId: "America/New_York",
      unit: "imperial",
      hrAnalytics: computeRecapHrAnalytics({
        zones: fiveZones,
        heartRateZonesBody: zonesBody(),
        workoutDetails: [],
      }),
      workoutDetails: [],
      notableSnapshot: { bullets: [] },
    });
    expect(text).toContain("# Weekly Recap");
    expect(text).toContain("No runs recorded this week.");
    expect(text).not.toContain("Splits:");
    expect(text).not.toContain("HR drift");
  });

  it("includes summary, zone lines, one-line run, and notable bullets", () => {
    const startedAt = "2026-05-09T14:30:00.000Z";
    const workout = {
      startedAt,
      runType: "Easy Run",
      distanceM: 8046.72,
      durationS: 3480,
      avgPaceS: 432,
      avgHeartRateBpm: 161,
      splits: [{ paceS: 408 }],
    };

    const samples = Array.from({ length: 120 }, (_, i) => ({
      elapsedSeconds: i,
      heartRateBpm: i < 60 ? 145 : 165,
    }));

    const details = [{ id: W1, body: JSON.stringify(workout) }];
    const hrAnalytics = computeRecapHrAnalytics({
      zones: fiveZones,
      heartRateZonesBody: zonesBody(),
      workoutDetails: details,
      timeSeriesByWorkoutId: { [W1]: samples },
    });

    const summaryFromStats: RecapSummaryFromStats = {
      yearlyWeeklyOk: true,
      relativeEffortOk: true,
      mileage: {
        prevDistanceM: 7000,
        threeWkAvgDistanceM: 7500,
        deltaVsThreeWkM: 500,
      },
      runs: { prev: 4, threeWkAvg: 4.2, deltaVsThreeWk: 0 },
      time: {
        prevDurationS: 3000,
        threeWkAvgDurationS: 3200,
        deltaVsThreeWkS: 280,
      },
      elevation: {
        prevElevM: 40,
        threeWkAvgElevM: 45,
        deltaVsThreeWkM: -5,
      },
      relativeEffort: {
        prev: 60,
        threeWkAvg: 58,
        threeWkLow: 55,
        threeWkHigh: 62,
        deltaVsThreeWk: 4,
      },
    };

    const text = buildWeeklyRecapCompact({
      resolved: resolvedSample,
      timeZoneId: "America/New_York",
      unit: "imperial",
      hrAnalytics,
      workoutDetails: details,
      summaryFromStats,
      notableSnapshot: {
        bullets: ["Test notable bullet"],
      },
    });

    expect(text).toContain("# Weekly Recap — Week of");
    expect(text).toContain("Summary");
    expect(text).toContain("Mileage");
    expect(text).toMatch(/Z[1-5].*[█░]/);
    expect(text).toContain("Runs");
    expect(text).toContain("Easy Run");
    expect(text).toContain("Notable");
    expect(text).toContain("- Test notable bullet");
    expect(text).not.toContain("Splits:");
    expect(text).not.toContain("HR drift");
  });
});
