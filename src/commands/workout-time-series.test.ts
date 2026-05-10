import { describe, expect, it } from "vitest";

import {
  buildWorkoutTimeSeriesPath,
  mergeWorkoutTimeSeriesSamplesByElapsedSecond,
  parseWorkoutTimeSeriesPageBody,
} from "./workout-time-series.js";

const W1 = "550e8400-e29b-41d4-a716-446655440001";

describe("buildWorkoutTimeSeriesPath", () => {
  it("encodes workout id and query string", () => {
    const p = buildWorkoutTimeSeriesPath(W1, { page: 2, pageSize: 500 });
    expect(p.startsWith("/workouts/")).toBe(true);
    expect(p).toContain("/time-series?");
    expect(p).toContain("page=2");
    expect(p).toContain("pageSize=500");
  });
});

describe("parseWorkoutTimeSeriesPageBody", () => {
  it("parses root array", () => {
    const r = parseWorkoutTimeSeriesPageBody(
      JSON.stringify([
        { elapsedSeconds: 0, heartRateBpm: 120 },
        { elapsedSeconds: 1, heartRateBpm: 121 },
      ]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toEqual({ elapsedSeconds: 0, heartRateBpm: 120 });
  });

  it("parses object with items", () => {
    const r = parseWorkoutTimeSeriesPageBody(
      JSON.stringify({
        items: [{ elapsedSeconds: 5, heartRateBpm: 130 }],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items).toHaveLength(1);
  });

  it("rejects invalid JSON", () => {
    expect(parseWorkoutTimeSeriesPageBody("x").ok).toBe(false);
  });
});

describe("mergeWorkoutTimeSeriesSamplesByElapsedSecond", () => {
  it("keeps last HR when duplicate elapsedSeconds", () => {
    const merged = mergeWorkoutTimeSeriesSamplesByElapsedSecond([
      { elapsedSeconds: 1, heartRateBpm: 120 },
      { elapsedSeconds: 1, heartRateBpm: 125 },
    ]);
    expect(merged).toEqual([{ elapsedSeconds: 1, heartRateBpm: 125 }]);
  });

  it("sorts by elapsedSeconds", () => {
    const merged = mergeWorkoutTimeSeriesSamplesByElapsedSecond([
      { elapsedSeconds: 10, heartRateBpm: 140 },
      { elapsedSeconds: 0, heartRateBpm: 130 },
    ]);
    expect(merged.map((x) => x.elapsedSeconds)).toEqual([0, 10]);
  });
});
