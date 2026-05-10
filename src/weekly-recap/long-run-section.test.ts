import { describe, expect, it } from "vitest";

import { computeRecapHrAnalytics } from "./hr-analytics.js";
import { buildLongRunSectionOutput } from "./long-run-section.js";

const METERS_PER_MILE = 1609.344;

function paceSFromSecPerMi(secPerMi: number): number {
  return secPerMi / (METERS_PER_MILE / 1000);
}

const fiveZones = [
  { zone: 1, minBpm: 100, maxBpm: 120 },
  { zone: 2, minBpm: 121, maxBpm: 140 },
  { zone: 3, minBpm: 141, maxBpm: 160 },
  { zone: 4, minBpm: 161, maxBpm: 175 },
  { zone: 5, minBpm: 176, maxBpm: 195 },
];

function zonesBody(): string {
  return JSON.stringify({
    calculationMethod: "AgeBased",
    age: 40,
    zones: fiveZones,
  });
}

const W_LONG = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const W_EASY = "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee";

function hrFor(details: { id: string; body: string }[]) {
  return computeRecapHrAnalytics({
    zones: fiveZones,
    heartRateZonesBody: zonesBody(),
    workoutDetails: details,
  });
}

describe("buildLongRunSectionOutput", () => {
  const timeZoneId = "America/New_York";
  const resolvedIsoWeekId = "2026-W19";

  it("selects explicit Long Run over a longer Easy run", () => {
    const started = "2026-05-09T14:30:00.000Z";
    const easyBig = {
      startedAt: started,
      runType: "Easy Run",
      distanceM: 28000,
      durationS: 10800,
      avgPaceS: 400,
      avgHeartRateBpm: 140,
    };
    const longSmaller = {
      startedAt: started,
      runType: "Long Run",
      distanceM: 15000,
      durationS: 7200,
      avgPaceS: 410,
      avgHeartRateBpm: 145,
      splits: [{ paceS: 400, distanceM: 7500 }, { paceS: 405, distanceM: 7500 }],
    };
    const details = [
      { id: W_EASY, body: JSON.stringify(easyBig) },
      { id: W_LONG, body: JSON.stringify(longSmaller) },
    ];
    const { markdown, json } = buildLongRunSectionOutput({
      prescribedRaw: undefined,
      workoutDetails: details,
      hrAnalytics: hrFor(details),
      timeZoneId,
      unit: "imperial",
      resolvedIsoWeekId,
    });
    expect(json.included).toBe(true);
    expect(json.selectionReason).toBe("explicit_long_run");
    expect(json.workoutId).toBe(W_LONG);
    expect(markdown).toContain("### Long run —");
  });

  it("qualifies via prescribed threshold (≥75% of target mi) without Long Run type", () => {
    const yaml = `
week: 2026-W19
sessions:
  - date: 2026-05-10
    type: long_run
    target_distance_mi: 12
    target_hr_bpm_max: 165
`;
    const twelveMiM = 12 * METERS_PER_MILE;
    const workout = {
      startedAt: "2026-05-10T15:00:00.000Z",
      runType: "Easy Run",
      distanceM: twelveMiM * 0.76,
      durationS: 7200,
      avgPaceS: 380,
      avgHeartRateBpm: 150,
      splits: Array.from({ length: 8 }, (_, i) => ({
        paceS: 380 + i,
        distanceM: (twelveMiM * 0.76) / 8,
      })),
    };
    const details = [{ id: W_LONG, body: JSON.stringify(workout) }];
    const { markdown, json } = buildLongRunSectionOutput({
      prescribedRaw: yaml,
      workoutDetails: details,
      hrAnalytics: hrFor(details),
      timeZoneId,
      unit: "imperial",
      resolvedIsoWeekId,
    });
    expect(json.included).toBe(true);
    expect(json.selectionReason).toBe("prescribed_threshold_met");
    expect(json.prescribedThresholdMi).toBe(12);
    expect(markdown.length).toBeGreaterThan(20);
  });

  it("omits section when no Long Run type and longest run below 75% of prescribed", () => {
    const yaml = `
week: 2026-W19
sessions:
  - date: 2026-05-10
    type: long_run
    target_distance_mi: 20
    target_hr_bpm_max: 155
`;
    const workout = {
      startedAt: "2026-05-10T15:00:00.000Z",
      runType: "Easy Run",
      distanceM: 10000,
      durationS: 3600,
      avgPaceS: 400,
    };
    const details = [{ id: W_LONG, body: JSON.stringify(workout) }];
    const { markdown, json } = buildLongRunSectionOutput({
      prescribedRaw: yaml,
      workoutDetails: details,
      hrAnalytics: hrFor(details),
      timeZoneId,
      unit: "metric",
      resolvedIsoWeekId,
    });
    expect(markdown).toBe("");
    expect(json.included).toBe(false);
    expect(json.reason).toBe("not_eligible");
  });

  it("detects negative split when back half is ≥5s/mi faster", () => {
    const slow = paceSFromSecPerMi(620);
    const fast = paceSFromSecPerMi(540);
    const workout = {
      startedAt: "2026-05-09T14:30:00.000Z",
      runType: "Long Run",
      distanceM: 20000,
      durationS: 9000,
      avgPaceS: 580,
      avgHeartRateBpm: 155,
      splits: [
        { paceS: slow, distanceM: 5000 },
        { paceS: slow + 5, distanceM: 5000 },
        { paceS: fast, distanceM: 5000 },
        { paceS: fast - 5, distanceM: 5000 },
      ],
    };
    const details = [{ id: W_LONG, body: JSON.stringify(workout) }];
    const { markdown, json } = buildLongRunSectionOutput({
      prescribedRaw: undefined,
      workoutDetails: details,
      hrAnalytics: hrFor(details),
      timeZoneId,
      unit: "imperial",
      resolvedIsoWeekId,
    });
    expect(json.negativeSplit).toBe(true);
    expect(markdown).toContain("negative split");
  });
});
