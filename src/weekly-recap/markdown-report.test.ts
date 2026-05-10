import { describe, expect, it } from "vitest";

import { computeRecapHrAnalytics } from "./hr-analytics.js";
import { buildWeeklyRecapMarkdownCore } from "./markdown-report.js";
import type { SubjectiveRunFields } from "./subjective-week.js";
import type { RecapSummaryFromStats } from "./recap-summary-stats.js";
import type { RecapWeekResolved } from "./resolve-week.js";
import type { RecapSimilarRoutesEntry } from "./similar-route-line.js";

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

  it("fills §2.2 stats columns when summaryFromStats is provided (Δ vs 3-wk avg)", () => {
    const workout = {
      startedAt: "2026-05-09T14:30:00.000Z",
      runType: "Easy Run",
      distanceM: 45600,
      durationS: 3600,
      avgPaceS: 400,
      relativeEffort: 287,
    };
    const details = [{ id: W1, body: JSON.stringify(workout) }];
    const hrAnalytics = computeRecapHrAnalytics({
      zones: fiveZones,
      heartRateZonesBody: zonesBody(),
      workoutDetails: details,
    });

    const summaryFromStats: RecapSummaryFromStats = {
      yearlyWeeklyOk: true,
      relativeEffortOk: true,
      mileage: {
        prevDistanceM: 24000,
        threeWkAvgDistanceM: 22800,
        deltaVsThreeWkM: 45600 - 22800,
      },
      runs: {
        prev: 4,
        threeWkAvg: 4.3,
        deltaVsThreeWk: 1 - 4.3,
      },
      time: {},
      elevation: {},
      relativeEffort: {
        prev: 245,
        threeWkAvg: 230,
        threeWkLow: 190,
        threeWkHigh: 270,
        deltaVsThreeWk: 287 - 230,
      },
    };

    const md = buildWeeklyRecapMarkdownCore({
      resolved: resolvedSample,
      timeZoneId: "America/New_York",
      unit: "metric",
      hrAnalytics,
      workoutDetails: details,
      shoesBody: "[]",
      summaryFromStats,
    });

    expect(md).toContain("| Relative effort | 287 | 245 | 230 (190–270) | +57 |");
    expect(md).toContain("| Mileage |");
    expect(md).toContain("| +22.8 |");
  });

  it("renders Similar route narrative when similarRoutesByWorkoutId has OK body", () => {
    const workout = {
      startedAt: "2026-05-09T14:30:00.000Z",
      runType: "Easy Run",
      distanceM: 8046.72,
      durationS: 3480,
      avgPaceS: 390,
      avgHeartRateBpm: 161,
    };
    const similarPast = {
      startedAt: "2026-04-11T14:30:00.000Z",
      name: "River loop",
      distanceM: 8000,
      avgPaceS: 430,
      avgHeartRateBpm: 168,
    };
    const details = [{ id: W1, body: JSON.stringify(workout) }];
    const hrAnalytics = computeRecapHrAnalytics({
      zones: fiveZones,
      heartRateZonesBody: zonesBody(),
      workoutDetails: details,
    });
    const entry: RecapSimilarRoutesEntry = {
      ok: true,
      body: JSON.stringify([similarPast]),
    };
    const md = buildWeeklyRecapMarkdownCore({
      resolved: resolvedSample,
      timeZoneId: "America/New_York",
      unit: "imperial",
      hrAnalytics,
      workoutDetails: details,
      shoesBody: "[]",
      similarRoutesByWorkoutId: { [W1]: entry },
    });
    expect(md).toContain("Similar route:");
    expect(md).not.toContain("Similar route: n/a");
    expect(md).toContain("River loop");
  });

  it("places §2.8 Notable after §2.7 Trends when both provided", () => {
    const workout = {
      startedAt: "2026-05-09T14:30:00.000Z",
      runType: "Easy Run",
      distanceM: 5000,
      durationS: 1800,
      avgPaceS: 400,
      avgHeartRateBpm: 140,
    };
    const details = [{ id: W1, body: JSON.stringify(workout) }];
    const hrAnalytics = computeRecapHrAnalytics({
      zones: fiveZones,
      heartRateZonesBody: zonesBody(),
      workoutDetails: details,
    });
    const trendsSection = "## Trends\n\n- **Easy pace**: test\n";
    const notableSection = "## Notable\n\n- No PRs\n";
    const md = buildWeeklyRecapMarkdownCore({
      resolved: resolvedSample,
      timeZoneId: "America/New_York",
      unit: "metric",
      hrAnalytics,
      workoutDetails: details,
      shoesBody: "[]",
      trendsMarkdown: trendsSection,
      notableMarkdown: notableSection,
    });
    expect(md.indexOf("## Trends")).toBeLessThan(md.indexOf("## Notable"));
    expect(md).toContain("## Notable");
  });

  it("places §2.6 Long run after Quality and before Trends when all blocks supplied", () => {
    const workout = {
      startedAt: "2026-05-09T14:30:00.000Z",
      runType: "Easy Run",
      distanceM: 5000,
      durationS: 1800,
      avgPaceS: 400,
      avgHeartRateBpm: 140,
    };
    const details = [{ id: W1, body: JSON.stringify(workout) }];
    const hrAnalytics = computeRecapHrAnalytics({
      zones: fiveZones,
      heartRateZonesBody: zonesBody(),
      workoutDetails: details,
    });
    const qualitySection = "### Quality session — placeholder\n\nPrescribed: test\n";
    const longRunSection = "### Long run — Sat May 9 — placeholder\n";
    const trendsSection = "## Trends\n\n- **Avg easy HR**: 140 → 138\n";
    const notableSection = "## Notable\n\n- No PRs\n";
    const md = buildWeeklyRecapMarkdownCore({
      resolved: resolvedSample,
      timeZoneId: "America/New_York",
      unit: "metric",
      hrAnalytics,
      workoutDetails: details,
      shoesBody: "[]",
      qualitySessionsMarkdown: qualitySection,
      longRunMarkdown: longRunSection,
      trendsMarkdown: trendsSection,
      notableMarkdown: notableSection,
    });
    const iRun = md.indexOf("## Run-by-run");
    const iQuality = md.indexOf("### Quality session");
    const iLong = md.indexOf("### Long run");
    const iTrends = md.indexOf("## Trends");
    const iNotable = md.indexOf("## Notable");
    expect(iRun).toBeGreaterThan(-1);
    expect(iQuality).toBeGreaterThan(-1);
    expect(iLong).toBeGreaterThan(-1);
    expect(iTrends).toBeGreaterThan(-1);
    expect(iNotable).toBeGreaterThan(-1);
    expect(iRun).toBeLessThan(iQuality);
    expect(iQuality).toBeLessThan(iLong);
    expect(iLong).toBeLessThan(iTrends);
    expect(iTrends).toBeLessThan(iNotable);
  });

  it("adds subjective RPE/Felt/Pain line to run block when map matches local date", () => {
    const workout = {
      startedAt: "2026-05-09T14:30:00.000Z",
      runType: "Easy Run",
      distanceM: 5000,
      durationS: 1800,
      avgPaceS: 400,
      avgHeartRateBpm: 140,
    };
    const details = [{ id: W1, body: JSON.stringify(workout) }];
    const hrAnalytics = computeRecapHrAnalytics({
      zones: fiveZones,
      heartRateZonesBody: zonesBody(),
      workoutDetails: details,
    });
    const subMap = new Map<string, SubjectiveRunFields>();
    subMap.set("2026-05-09", { rpe: 4, felt: 7, pain: "minor tweak" });
    const md = buildWeeklyRecapMarkdownCore({
      resolved: resolvedSample,
      timeZoneId: "America/New_York",
      unit: "metric",
      hrAnalytics,
      workoutDetails: details,
      shoesBody: "[]",
      subjectiveByRunDate: subMap,
    });
    expect(md).toContain("RPE: 4/10");
    expect(md).toContain("Felt: 7/10");
    expect(md).toContain("Pain: minor tweak");
  });

  it("places §2.9 Subjective recap and §2.10 Questions after Notable", () => {
    const workout = {
      startedAt: "2026-05-09T14:30:00.000Z",
      runType: "Easy Run",
      distanceM: 5000,
      durationS: 1800,
      avgPaceS: 400,
      avgHeartRateBpm: 140,
    };
    const details = [{ id: W1, body: JSON.stringify(workout) }];
    const hrAnalytics = computeRecapHrAnalytics({
      zones: fiveZones,
      heartRateZonesBody: zonesBody(),
      workoutDetails: details,
    });
    const notableSection = "## Notable\n\n- x\n";
    const subRecap = "## Subjective recap\n\nSleep avg this week: 7 hrs\n";
    const coach = "## Questions for coach\n\n1. Test?\n";
    const md = buildWeeklyRecapMarkdownCore({
      resolved: resolvedSample,
      timeZoneId: "America/New_York",
      unit: "metric",
      hrAnalytics,
      workoutDetails: details,
      shoesBody: "[]",
      notableMarkdown: notableSection,
      subjectiveRecapMarkdown: subRecap,
      coachPromptMarkdown: coach,
    });
    expect(md.indexOf("## Notable")).toBeLessThan(md.indexOf("## Subjective recap"));
    expect(md.indexOf("## Subjective recap")).toBeLessThan(
      md.indexOf("## Questions for coach"),
    );
  });

  it("places §2.7 trends after Run-by-run when workouts exist", () => {
    const workout = {
      startedAt: "2026-05-09T14:30:00.000Z",
      runType: "Easy Run",
      distanceM: 5000,
      durationS: 1800,
      avgPaceS: 400,
      avgHeartRateBpm: 140,
    };
    const details = [{ id: W1, body: JSON.stringify(workout) }];
    const hrAnalytics = computeRecapHrAnalytics({
      zones: fiveZones,
      heartRateZonesBody: zonesBody(),
      workoutDetails: details,
    });
    const trendsSection = "## Trends\n\n- **Avg easy HR**: 140 → 138\n";
    const md = buildWeeklyRecapMarkdownCore({
      resolved: resolvedSample,
      timeZoneId: "America/New_York",
      unit: "metric",
      hrAnalytics,
      workoutDetails: details,
      shoesBody: "[]",
      trendsMarkdown: trendsSection,
    });
    expect(md.indexOf("## Run-by-run")).toBeLessThan(md.indexOf("## Trends"));
    expect(md).toContain("## Trends");
  });
});
