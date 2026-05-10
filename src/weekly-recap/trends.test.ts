import { describe, expect, it } from "vitest";

import type { RecapWeekResolved } from "./resolve-week.js";
import {
  buildTrendsMarkdownSection,
  buildWeekLabels,
  computeRecapTrendsSnapshot,
  recapTrendsSnapshotToJson,
} from "./trends.js";

const fiveZones = [
  { zone: 1, minBpm: 100, maxBpm: 120 },
  { zone: 2, minBpm: 121, maxBpm: 140 },
  { zone: 3, minBpm: 141, maxBpm: 160 },
  { zone: 4, minBpm: 161, maxBpm: 175 },
  { zone: 5, minBpm: 176, maxBpm: 195 },
];

const resolvedNy: RecapWeekResolved = {
  isoWeekId: "2026-W19",
  localRange: { start: "2026-05-04", end: "2026-05-10" },
  utcStartDate: "2026-05-04T04:00:00.000Z",
  utcEndDate: "2026-05-11T03:59:59.999Z",
  timezoneOffsetMinutes: -240,
};

let rowId = 0;
function easyRow(args: {
  startedAt: string;
  paceS: number;
  hr: number;
  distM: number;
  durS: number;
  runType?: string;
}): Record<string, unknown> {
  rowId += 1;
  return {
    workoutId: `00000000-0000-4000-8000-${String(rowId).padStart(12, "0")}`,
    startedAt: args.startedAt,
    runType: args.runType ?? "Easy Run",
    avgPaceS: args.paceS,
    avgHeartRateBpm: args.hr,
    distanceM: args.distM,
    durationS: args.durS,
  };
}

describe("computeRecapTrendsSnapshot", () => {
  it("partitions list rows across W−3…W−1 and merges recap-week detail for W0", () => {
    const trendList = [
      easyRow({
        startedAt: "2026-04-14T16:00:00.000Z",
        paceS: 400,
        hr: 130,
        distM: 10000,
        durS: 4000,
      }),
      easyRow({
        startedAt: "2026-04-21T16:00:00.000Z",
        paceS: 395,
        hr: 128,
        distM: 10000,
        durS: 4000,
      }),
      easyRow({
        startedAt: "2026-04-28T16:00:00.000Z",
        paceS: 390,
        hr: 127,
        distM: 10000,
        durS: 4000,
      }),
    ];

    const wid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const recapDetail = {
      id: wid,
      body: JSON.stringify(
        easyRow({
          startedAt: "2026-05-06T16:00:00.000Z",
          paceS: 385,
          hr: 126,
          distM: 10000,
          durS: 4000,
        }),
      ),
    };

    const snap = computeRecapTrendsSnapshot({
      resolved: resolvedNy,
      timeZoneId: "America/New_York",
      zones: fiveZones,
      trendListItems: trendList,
      recapWorkoutDetails: [recapDetail],
      included: true,
    });

    expect(snap.included).toBe(true);
    expect(snap.weekLabels).toEqual(buildWeekLabels(resolvedNy, "America/New_York"));
    expect(snap.easyPaceSecPerKm?.map((x) => (x === null ? null : Math.round(x!)))).toEqual([
      400, 395, 390, 385,
    ]);
    expect(snap.sparklines?.easyPace).toMatch(/[▁▃▅█]{4}/);
  });

  it("returns disabled snapshot when trends not included", () => {
    const snap = computeRecapTrendsSnapshot({
      resolved: resolvedNy,
      timeZoneId: "America/New_York",
      zones: fiveZones,
      trendListItems: [],
      recapWorkoutDetails: [],
      included: false,
    });
    expect(snap).toEqual({ included: false, reason: "disabled" });
    expect(recapTrendsSnapshotToJson(snap)).toEqual({
      included: false,
      reason: "disabled",
    });
  });

  it("returns included false with reason when fetch failed", () => {
    const snap = computeRecapTrendsSnapshot({
      resolved: resolvedNy,
      timeZoneId: "America/New_York",
      zones: fiveZones,
      trendListItems: [],
      recapWorkoutDetails: [],
      included: true,
      fetchFailedReason: "transport down",
    });
    expect(snap.included).toBe(false);
    expect(snap.reason).toBe("transport down");
  });

  it("uses max long-typed distance when present", () => {
    const longRow = {
      workoutId: "10000000-0000-4000-8000-000000000099",
      startedAt: "2026-05-06T16:00:00.000Z",
      runType: "Long Run",
      distanceM: 21_000,
      durationS: 7200,
      avgPaceS: 410,
      avgHeartRateBpm: 135,
    };
    const snap = computeRecapTrendsSnapshot({
      resolved: resolvedNy,
      timeZoneId: "America/New_York",
      zones: fiveZones,
      trendListItems: [],
      recapWorkoutDetails: [{ id: "x", body: JSON.stringify(longRow) }],
      included: true,
    });
    expect(snap.longRunDistanceM?.[3]).toBe(21_000);
  });

  it("sparkline uses mid bar when all pace values in the series are equal", () => {
    const mk = (startedAt: string) =>
      easyRow({
        startedAt,
        paceS: 400,
        hr: 130,
        distM: 5000,
        durS: 2000,
      });
    const trendList = [
      mk("2026-04-14T16:00:00.000Z"),
      mk("2026-04-21T16:00:00.000Z"),
      mk("2026-04-28T16:00:00.000Z"),
    ];
    const snap = computeRecapTrendsSnapshot({
      resolved: resolvedNy,
      timeZoneId: "America/New_York",
      zones: fiveZones,
      trendListItems: trendList,
      recapWorkoutDetails: [
        {
          id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          body: JSON.stringify(mk("2026-05-06T16:00:00.000Z")),
        },
      ],
      included: true,
    });
    expect(snap.sparklines?.easyPace).toBe("▅▅▅▅");
  });
});

describe("buildTrendsMarkdownSection", () => {
  it("returns empty string when not included", () => {
    expect(
      buildTrendsMarkdownSection({ included: false, reason: "x" }, "metric"),
    ).toBe("");
  });

  it("emits ## Trends when snapshot has series data", () => {
    const md = buildTrendsMarkdownSection(
      {
        included: true,
        weekLabels: ["2026-W16", "2026-W17", "2026-W18", "2026-W19"],
        easyPaceSecPerKm: [400, 395, null, 385],
        avgEasyHr: [130, 129, null, 126],
        longRunDistanceM: [null, null, null, 21_000],
        sparklines: {
          easyPace: "▁▃▅█",
          avgEasyHr: "▁▃▅█",
          longRunDistance: "▁▃▅█",
        },
        verdicts: {
          easyPace: "improving",
        },
      },
      "metric",
    );
    expect(md).toContain("## Trends");
    expect(md).toContain("Easy pace");
    expect(md).toContain("(improving)");
  });
});
