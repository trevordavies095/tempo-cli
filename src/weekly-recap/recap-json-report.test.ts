import { describe, expect, it } from "vitest";

import { computeRecapHrAnalytics } from "./hr-analytics.js";
import { buildWeeklyRecapReportPayload } from "./recap-json-report.js";
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

describe("buildWeeklyRecapReportPayload", () => {
  it("includes week, range, runs array, zones, trends, and subjective", () => {
    const workout = {
      startedAt: "2026-05-09T14:30:00.000Z",
      runType: "Easy Run",
      distanceM: 5000,
      durationS: 1800,
      avgPaceS: 360,
      avgHeartRateBpm: 140,
    };
    const details = [{ id: W1, body: JSON.stringify(workout) }];
    const hrAnalytics = computeRecapHrAnalytics({
      zones: fiveZones,
      heartRateZonesBody: zonesBody(),
      workoutDetails: details,
      timeSeriesByWorkoutId: {},
    });

    const report = buildWeeklyRecapReportPayload({
      resolved: resolvedSample,
      hrAnalytics,
      workoutDetails: details,
      summaryFromStats: undefined,
      trendsJson: { ok: true },
      subjective: { skipped: true },
    });

    expect(report.week).toBe("2026-W19");
    expect(report.range).toEqual({
      start: "2026-05-04",
      end: "2026-05-10",
    });
    expect(Array.isArray(report.runs)).toBe(true);
    expect((report.runs as unknown[]).length).toBe(1);
    expect(report.zones).toEqual(
      expect.objectContaining({
        totalHrSeconds: expect.any(Number),
      }),
    );
    expect(report.trends).toEqual({ ok: true });
    expect(report.subjective).toEqual({ skipped: true });
    expect(report.summary).toBeNull();
  });
});
