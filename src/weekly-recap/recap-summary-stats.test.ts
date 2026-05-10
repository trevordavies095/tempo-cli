import { describe, expect, it } from "vitest";

import {
  buildRecapSummaryFromStats,
  computeWeeklyRollup,
  findYearlyWeeklyBucketIndexForRecapMonday,
  normalizeWeekStartYmd,
  parseRelativeEffortSummary,
  parseWeeklyRecapResponse,
  parseYearlyWeeklyBuckets,
} from "./recap-summary-stats.js";
import type { RecapWeekResolved } from "./resolve-week.js";

const resolvedMay2026: RecapWeekResolved = {
  isoWeekId: "2026-W19",
  localRange: { start: "2026-05-04", end: "2026-05-10" },
  utcStartDate: "2026-05-04T04:00:00.000Z",
  utcEndDate: "2026-05-11T03:59:59.999Z",
  timezoneOffsetMinutes: -240,
};

describe("normalizeWeekStartYmd", () => {
  it("normalizes ISO datetime strings to yyyy-MM-dd", () => {
    expect(normalizeWeekStartYmd("2026-05-04T00:00:00")).toBe("2026-05-04");
    expect(normalizeWeekStartYmd("2026-05-04")).toBe("2026-05-04");
  });
});

describe("parseYearlyWeeklyBuckets", () => {
  it("parses root array and object weeks wrapper", () => {
    const arr = JSON.stringify([
      { weekStart: "2026-04-27", distance: 24000, count: 4 },
      { weekStart: "2026-05-04", distance: 28000, count: 5 },
    ]);
    const b = parseYearlyWeeklyBuckets(arr);
    expect(b).toHaveLength(2);
    expect(b[0]!.weekStartYmd).toBe("2026-04-27");
    expect(b[1]!.weekStartYmd).toBe("2026-05-04");
    expect(b[1]!.distanceM).toBe(28000);
    expect(b[1]!.runs).toBe(5);
  });

  it("parses { weeks: [...] }", () => {
    const body = JSON.stringify({
      weeks: [{ WeekStart: "2026-05-04", Distance: 30000, Workouts: 5 }],
    });
    const b = parseYearlyWeeklyBuckets(body);
    expect(b).toHaveLength(1);
    expect(b[0]!.distanceM).toBe(30000);
  });

  it("omits runs when API does not send count (does not default to 0)", () => {
    const b = parseYearlyWeeklyBuckets(
      JSON.stringify([{ weekStart: "2026-05-04", distance: 30000 }]),
    );
    expect(b).toHaveLength(1);
    expect(b[0]!.distanceM).toBe(30000);
    expect(b[0]!.runs).toBeUndefined();
  });

  it("keeps explicit zero run count from API", () => {
    const b = parseYearlyWeeklyBuckets(
      JSON.stringify([{ weekStart: "2026-05-04", distance: 30000, count: 0 }]),
    );
    expect(b[0]!.runs).toBe(0);
  });
});

describe("findYearlyWeeklyBucketIndexForRecapMonday", () => {
  it("matches exact bucket weekStart", () => {
    const buckets = parseYearlyWeeklyBuckets(
      JSON.stringify([{ weekStart: "2026-05-04", distance: 1, count: 1 }]),
    );
    expect(findYearlyWeeklyBucketIndexForRecapMonday("2026-05-04", buckets)).toBe(
      0,
    );
  });

  it("matches when recap Monday falls in bucket 7-day window but differs from weekStart", () => {
    const buckets = parseYearlyWeeklyBuckets(
      JSON.stringify([{ weekStart: "2026-04-26", distance: 1, count: 1 }]),
    );
    expect(findYearlyWeeklyBucketIndexForRecapMonday("2026-04-27", buckets)).toBe(
      0,
    );
  });
});

describe("computeWeeklyRollup", () => {
  it("finds prev week and 3-wk avg from buckets before target Monday", () => {
    const buckets = parseYearlyWeeklyBuckets(
      JSON.stringify([
        { weekStart: "2026-04-13", distance: 20000, count: 3 },
        { weekStart: "2026-04-20", distance: 22000, count: 4 },
        { weekStart: "2026-04-27", distance: 24000, count: 4 },
        { weekStart: "2026-05-04", distance: 26000, count: 5 },
      ]),
    );
    const roll = computeWeeklyRollup(resolvedMay2026, buckets);
    expect(roll?.prev?.distanceM).toBe(24000);
    expect(roll?.prev?.runs).toBe(4);
    expect(roll?.threeWkAvg?.distanceM).toBeCloseTo((20000 + 22000 + 24000) / 3);
    expect(roll?.threeWkAvg?.runs).toBeCloseTo((3 + 4 + 4) / 3);
  });

  it("resolves rollup when API weekStart is offset from ISO Monday within same week window", () => {
    const buckets = parseYearlyWeeklyBuckets(
      JSON.stringify([
        { weekStart: "2026-04-13", distance: 20000, count: 3 },
        { weekStart: "2026-04-26", distance: 24000, count: 4 },
      ]),
    );
    const resolvedW18: RecapWeekResolved = {
      isoWeekId: "2026-W18",
      localRange: { start: "2026-04-27", end: "2026-05-03" },
      utcStartDate: "",
      utcEndDate: "",
      timezoneOffsetMinutes: -240,
    };
    const roll = computeWeeklyRollup(resolvedW18, buckets);
    expect(roll?.prev?.distanceM).toBe(20000);
    expect(roll?.prev?.runs).toBe(3);
    expect(roll?.threeWkAvg?.distanceM).toBe(20000);
    expect(roll?.threeWkAvg?.runs).toBe(3);
  });

  it("returns undefined when recap Monday is missing from buckets", () => {
    const buckets = parseYearlyWeeklyBuckets(
      JSON.stringify([{ weekStart: "2026-04-27", distance: 1000, count: 1 }]),
    );
    expect(computeWeeklyRollup(resolvedMay2026, buckets)).toBeUndefined();
  });

  it("leaves prev.runs undefined when prior bucket has distance but no count", () => {
    const buckets = parseYearlyWeeklyBuckets(
      JSON.stringify([
        { weekStart: "2026-04-27", distance: 24000 },
        { weekStart: "2026-05-04", distance: 26000, count: 5 },
      ]),
    );
    const roll = computeWeeklyRollup(resolvedMay2026, buckets);
    expect(roll?.prev?.distanceM).toBe(24000);
    expect(roll?.prev?.runs).toBeUndefined();
    expect(roll?.threeWkAvg?.distanceM).toBe(24000);
    expect(roll?.threeWkAvg?.runs).toBeUndefined();
  });

  it("averages distance only over buckets that report distance", () => {
    const buckets = parseYearlyWeeklyBuckets(
      JSON.stringify([
        { weekStart: "2026-04-13", count: 2 },
        { weekStart: "2026-04-20", distance: 20000, count: 2 },
        { weekStart: "2026-04-27", distance: 24000, count: 4 },
        { weekStart: "2026-05-04", distance: 26000, count: 5 },
      ]),
    );
    const roll = computeWeeklyRollup(resolvedMay2026, buckets);
    expect(roll?.threeWkAvg?.distanceM).toBeCloseTo((20000 + 24000) / 2);
    expect(roll?.threeWkAvg?.runs).toBeCloseTo((2 + 2 + 4) / 3);
  });
});

describe("parseRelativeEffortSummary", () => {
  it("reads scalar fields with aliases", () => {
    const p = parseRelativeEffortSummary(
      JSON.stringify({
        previousWeek: 245,
        threeWeekAvg: 230,
        threeWeekLow: 190,
        threeWeekHigh: 270,
      }),
    );
    expect(p?.previousWeek).toBe(245);
    expect(p?.threeWeekAverage).toBe(230);
    expect(p?.threeWeekLow).toBe(190);
    expect(p?.threeWeekHigh).toBe(270);
  });
});

describe("parseWeeklyRecapResponse", () => {
  it("extracts metric blocks with camelCase keys", () => {
    const body = JSON.stringify({
      metrics: {
        runs: { current: 4, previous: 3, trailingAvg: 3.5 },
        distanceM: { previous: 20000, trailingAvg: 22000 },
        easyRunAvgHeartRateBpm: { previous: 150, trailingAvg: 152 },
      },
    });
    const p = parseWeeklyRecapResponse(body);
    expect(p?.runs?.previous).toBe(3);
    expect(p?.distanceM?.trailingAvg).toBe(22000);
    expect(p?.easyRunAvgHeartRateBpm?.previous).toBe(150);
  });

  it("reads metrics nested under Data.Metrics (PascalCase wrappers)", () => {
    const body = JSON.stringify({
      Data: {
        Metrics: {
          Runs: { Previous: 3, TrailingAvg: 3.5, Current: 4 },
          DistanceM: { Previous: 20000, TrailingAvg: 22000 },
          DurationS: { Previous: 3600, TrailingAvg: 4000 },
          ElevationGainM: { Previous: 50, TrailingAvg: 60 },
          RelativeEffortSum: { Previous: 100, TrailingAvg: 110 },
        },
      },
    });
    const p = parseWeeklyRecapResponse(body);
    expect(p?.runs?.previous).toBe(3);
    expect(p?.durationS?.trailingAvg).toBe(4000);
    expect(p?.relativeEffortSum?.previous).toBe(100);
  });

  it("reads metrics when the API nests the bag under data without a metrics key", () => {
    const body = JSON.stringify({
      data: {
        runs: { previous: 2, trailingAvg: 2.5 },
        distanceM: { previous: 10000, trailingAvg: 12000 },
      },
    });
    const p = parseWeeklyRecapResponse(body);
    expect(p?.runs?.previous).toBe(2);
    expect(p?.distanceM?.trailingAvg).toBe(12000);
  });

  it("coerces numeric strings inside blocks", () => {
    const body = JSON.stringify({
      metrics: {
        runs: { previous: "3", trailingAvg: "3.5", current: "4" },
      },
    });
    const p = parseWeeklyRecapResponse(body);
    expect(p?.runs?.previous).toBe(3);
    expect(p?.runs?.trailingAvg).toBe(3.5);
  });

  it("accepts relativeEffort as block name alias for relativeEffortSum", () => {
    const body = JSON.stringify({
      metrics: {
        relativeEffort: { previous: 90, trailingAvg: 95 },
      },
    });
    const p = parseWeeklyRecapResponse(body);
    expect(p?.relativeEffortSum?.previous).toBe(90);
    expect(p?.relativeEffortSum?.trailingAvg).toBe(95);
  });

  it("maps threeWeekAverage inside a block to trailingAvg when trailingAvg absent", () => {
    const body = JSON.stringify({
      metrics: {
        runs: { current: 4, previous: 3, threeWeekAverage: 3.4 },
      },
    });
    const p = parseWeeklyRecapResponse(body);
    expect(p?.runs?.trailingAvg).toBe(3.4);
  });

  it("returns undefined when metrics missing", () => {
    expect(parseWeeklyRecapResponse(JSON.stringify({ weekStart: "2026-05-04" }))).toBeUndefined();
    expect(parseWeeklyRecapResponse("not json")).toBeUndefined();
  });
});

describe("buildRecapSummaryFromStats", () => {
  it("merges yearly-weekly rollup and RE for deltas", () => {
    const yw = JSON.stringify([
      { weekStart: "2026-04-27", distance: 24000, count: 4 },
      { weekStart: "2026-05-04", distance: 45600, count: 5 },
    ]);
    const re = JSON.stringify({
      previousWeek: 245,
      threeWeekAverage: 230,
      threeWeekLow: 190,
      threeWeekHigh: 270,
    });

    const s = buildRecapSummaryFromStats({
      resolved: resolvedMay2026,
      yearlyWeeklyBody: yw,
      yearlyWeeklyOk: true,
      relativeEffortBody: re,
      relativeEffortOk: true,
      workoutDistanceM: 45600,
      workoutDurationS: 10_000,
      workoutElevM: 100,
      workoutReSum: 287,
      runCount: 5,
    });

    expect(s.weeklyRecapOk).toBe(false);
    expect(s.yearlyWeeklyOk).toBe(true);
    expect(s.mileage.prevDistanceM).toBe(24000);
    expect(s.mileage.threeWkAvgDistanceM).toBeCloseTo(24000);
    expect(s.mileage.deltaVsThreeWkM).toBeCloseTo(45600 - 24000);
    expect(s.runs.deltaVsThreeWk).toBeCloseTo(5 - 4);
    expect(s.relativeEffort.prev).toBe(245);
    expect(s.relativeEffort.threeWkAvg).toBe(230);
    expect(s.relativeEffort.deltaVsThreeWk).toBe(287 - 230);
  });

  it("prefers GET /stats/weekly-recap when weeklyRecapParsed is set and merges RE low/high", () => {
    const wrBody = JSON.stringify({
      metrics: {
        distanceM: { previous: 20000, trailingAvg: 22000, current: 25000 },
        runs: { previous: 3, trailingAvg: 3.5, current: 4 },
        durationS: { previous: 3600, trailingAvg: 4000, current: 4200 },
        elevationGainM: { previous: 50, trailingAvg: 60, current: 70 },
        relativeEffortSum: { previous: 100, trailingAvg: 110, current: 120 },
        easyRunAvgHeartRateBpm: { previous: 150, trailingAvg: 152 },
      },
    });
    const parsed = parseWeeklyRecapResponse(wrBody);
    expect(parsed).toBeDefined();

    const s = buildRecapSummaryFromStats({
      resolved: resolvedMay2026,
      weeklyRecapParsed: parsed,
      yearlyWeeklyOk: false,
      relativeEffortOk: true,
      relativeEffortBody: JSON.stringify({
        threeWeekLow: 90,
        threeWeekHigh: 130,
      }),
      workoutDistanceM: 25000,
      workoutDurationS: 4200,
      workoutElevM: 70,
      workoutReSum: 120,
      runCount: 4,
      easyAvgThisWeek: 155,
    });

    expect(s.weeklyRecapOk).toBe(true);
    expect(s.yearlyWeeklyOk).toBe(false);
    expect(s.mileage.prevDistanceM).toBe(20000);
    expect(s.mileage.threeWkAvgDistanceM).toBe(22000);
    expect(s.mileage.deltaVsThreeWkM).toBe(3000);
    expect(s.relativeEffort.threeWkAvg).toBe(110);
    expect(s.relativeEffort.threeWkLow).toBe(90);
    expect(s.relativeEffort.threeWkHigh).toBe(130);
    expect(s.easyRunHr?.prev).toBe(150);
    expect(s.easyRunHr?.threeWkAvg).toBe(152);
    expect(s.easyRunHr?.deltaVsThreeWk).toBe(3);
  });

  it("does not set runs prev or run deltas when yearly-weekly omits counts", () => {
    const yw = JSON.stringify([
      { weekStart: "2026-04-27", distance: 24000 },
      { weekStart: "2026-05-04", distance: 45600, count: 5 },
    ]);
    const s = buildRecapSummaryFromStats({
      resolved: resolvedMay2026,
      yearlyWeeklyBody: yw,
      yearlyWeeklyOk: true,
      relativeEffortOk: false,
      workoutDistanceM: 45600,
      workoutDurationS: 10_000,
      workoutElevM: 100,
      workoutReSum: 250,
      runCount: 5,
    });
    expect(s.mileage.prevDistanceM).toBe(24000);
    expect(s.mileage.threeWkAvgDistanceM).toBe(24000);
    expect(s.mileage.deltaVsThreeWkM).toBeCloseTo(45600 - 24000);
    expect(s.runs.prev).toBeUndefined();
    expect(s.runs.threeWkAvg).toBeUndefined();
    expect(s.runs.deltaVsThreeWk).toBeUndefined();
    expect(s.weeklyRecapOk).toBe(false);
  });

  it("degrades when yearly-weekly fails", () => {
    const s = buildRecapSummaryFromStats({
      resolved: resolvedMay2026,
      yearlyWeeklyOk: false,
      relativeEffortOk: true,
      relativeEffortBody: JSON.stringify({ threeWeekAverage: 100 }),
      workoutDistanceM: 5000,
      workoutDurationS: 0,
      workoutElevM: 0,
      workoutReSum: 50,
      runCount: 1,
    });
    expect(s.weeklyRecapOk).toBe(false);
    expect(s.mileage.prevDistanceM).toBeUndefined();
    expect(s.relativeEffort.threeWkAvg).toBe(100);
  });
});
