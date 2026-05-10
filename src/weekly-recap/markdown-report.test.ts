import { describe, expect, it } from "vitest";

import { computeRecapHrAnalytics } from "./hr-analytics.js";
import { buildWeeklyRecapMarkdownCore } from "./markdown-report.js";
import type { RecapWeekResolved } from "./resolve-week.js";

const fiveZones = [
  { zone: 1, minBpm: 100, maxBpm: 120 },
  { zone: 2, minBpm: 121, maxBpm: 140 },
  { zone: 3, minBpm: 141, maxBpm: 160 },
  { zone: 4, minBpm: 161, maxBpm: 175 },
  { zone: 5, minBpm: 176, maxBpm: 195 },
];

const W1 = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const SHOE_1 = "11111111-2222-3333-4444-555555555555";

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

describe("buildWeeklyRecapMarkdownCore", () => {
  it("emits minimal Markdown for an empty week", () => {
    const md = buildWeeklyRecapMarkdownCore({
      resolved: resolvedSample,
      timeZoneId: "America/New_York",
      unit: "imperial",
      hrAnalytics: computeRecapHrAnalytics({
        zones: fiveZones,
        heartRateZonesBody: zonesBody(),
        workoutDetails: [],
      }),
      workoutDetails: [],
      shoesBody: "[]",
    });
    expect(md).toContain("# Weekly Recap");
    expect(md).toContain("No runs recorded this week.");
    expect(md).not.toContain("## Summary");
  });

  it("includes summary table and run block with splits when present", () => {
    const startedAt = "2026-05-09T14:30:00.000Z";
    const workout = {
      startedAt,
      runType: "Easy Run",
      distanceM: 8046.72,
      durationS: 3480,
      avgPaceS: 432,
      avgHeartRateBpm: 161,
      maxHeartRateBpm: 170,
      avgCadenceRpm: 160,
      elevGainM: 14,
      elevLossM: 11,
      relativeEffort: 64,
      splits: [
        { paceS: 408 },
        { paceS: 411 },
        { paceS: 432 },
      ],
      notes: "Easy effort.",
      shoeId: SHOE_1,
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

    const md = buildWeeklyRecapMarkdownCore({
      resolved: resolvedSample,
      timeZoneId: "America/New_York",
      unit: "imperial",
      hrAnalytics,
      workoutDetails: details,
      shoesBody: JSON.stringify([
        {
          id: SHOE_1,
          brand: "Saucony",
          model: "Shift 3",
          mileage: 663000,
        },
      ]),
    });

    expect(md).toContain("## Summary");
    expect(md).toContain("| Mileage |");
    expect(md).toContain("| Runs | 1 |");
    expect(md).toContain("## HR zone distribution");
    expect(md).toContain("Z1 ");
    expect(md).toContain("## Run-by-run");
    expect(md).toContain("Easy Run");
    expect(md).toContain("Splits:");
    expect(md).toContain("Similar route: n/a");
    expect(md).toContain("Notes (from app):");
    expect(md).toContain("Shoe: Saucony Shift 3");
  });

  it("shows splits n/a when splits missing", () => {
    const workout = {
      startedAt: "2026-05-09T14:30:00.000Z",
      runType: "Easy Run",
      distanceM: 5000,
      durationS: 1800,
      avgPaceS: 400,
    };
    const details = [{ id: W1, body: JSON.stringify(workout) }];
    const hrAnalytics = computeRecapHrAnalytics({
      zones: fiveZones,
      heartRateZonesBody: zonesBody(),
      workoutDetails: details,
    });
    const md = buildWeeklyRecapMarkdownCore({
      resolved: resolvedSample,
      timeZoneId: "UTC",
      unit: "metric",
      hrAnalytics,
      workoutDetails: details,
      shoesBody: "[]",
    });
    expect(md).toContain("Splits: n/a");
  });
});
