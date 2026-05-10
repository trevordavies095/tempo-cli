import { describe, expect, it } from "vitest";

import {
  formatSimilarRouteMarkdownLine,
  parseSimilarRoutesBody,
  pickSimilarWorkoutRow,
  type RecapSimilarRoutesEntry,
} from "./similar-route-line.js";

describe("parseSimilarRoutesBody", () => {
  it("parses root array", () => {
    expect(parseSimilarRoutesBody(JSON.stringify([{ id: 1 }]))).toHaveLength(1);
  });

  it("parses wrapped items", () => {
    const rows = parseSimilarRoutesBody(
      JSON.stringify({ items: [{ a: 1 }] }),
    );
    expect(rows).toHaveLength(1);
  });
});

describe("pickSimilarWorkoutRow", () => {
  it("unwraps workout wrapper", () => {
    const inner = { avgPaceS: 400 };
    const row = pickSimilarWorkoutRow({ workout: inner });
    expect(row?.avgPaceS).toBe(400);
  });
});

describe("formatSimilarRouteMarkdownLine", () => {
  const current = {
    startedAt: "2026-05-09T14:00:00.000Z",
    avgPaceS: 390,
    avgHeartRateBpm: 161,
    distanceM: 8200,
  };

  it("returns n/a when entry missing or not ok", () => {
    expect(
      formatSimilarRouteMarkdownLine({
        currentWorkout: current,
        entry: undefined,
        unit: "imperial",
      }),
    ).toBe("n/a");
    const bad: RecapSimilarRoutesEntry = { ok: false, httpStatus: 500 };
    expect(
      formatSimilarRouteMarkdownLine({
        currentWorkout: current,
        entry: bad,
        unit: "imperial",
      }),
    ).toBe("n/a");
  });

  it("formats first similar workout with deltas and optional checkmark", () => {
    const similar = {
      startedAt: "2026-04-11T14:00:00.000Z",
      name: "Loop",
      distanceM: 8200,
      avgPaceS: 432,
      avgHeartRateBpm: 165,
    };
    const entry: RecapSimilarRoutesEntry = {
      ok: true,
      body: JSON.stringify([similar]),
    };
    const line = formatSimilarRouteMarkdownLine({
      currentWorkout: current,
      entry,
      unit: "imperial",
    });
    expect(line).toContain("5.1 mi Loop");
    expect(line).toContain("weeks ago");
    expect(line).toContain("→");
    expect(line).toContain("✓");
  });

  it("uses API pace/HR deltas when present on row", () => {
    const row = {
      workout: {
        startedAt: "2026-04-11T14:00:00.000Z",
        name: "X",
        distanceM: 5000,
        avgPaceS: 400,
        avgHeartRateBpm: 170,
      },
      paceDifferenceSecondsPerKm: 30,
      heartRateDifferenceBpm: -8,
    };
    const entry: RecapSimilarRoutesEntry = {
      ok: true,
      body: JSON.stringify([row]),
    };
    const line = formatSimilarRouteMarkdownLine({
      currentWorkout: current,
      entry,
      unit: "metric",
    });
    expect(line).toContain("→");
    expect(line).toContain("bpm avg HR");
  });
});
