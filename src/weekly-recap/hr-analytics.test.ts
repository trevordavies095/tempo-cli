import { describe, expect, it } from "vitest";

import type { RecapHeartRateZone } from "./recap-settings.js";
import {
  buildDenseHrPerSecond,
  computeRecapHrAnalytics,
  driftSeverityLabel,
  extractTimeSeriesSamples,
  isEasyOrLongRunType,
  parseHrZonesSettingsMeta,
  pctFromZoneSeconds,
  quarterAvgHrs,
  resolveConfiguredMaxHr,
  secondsPerZoneFromDense,
  zoneIndexForBpm,
} from "./hr-analytics.js";

const fiveZones: RecapHeartRateZone[] = [
  { zone: 1, minBpm: 100, maxBpm: 120 },
  { zone: 2, minBpm: 121, maxBpm: 140 },
  { zone: 3, minBpm: 141, maxBpm: 160 },
  { zone: 4, minBpm: 161, maxBpm: 175 },
  { zone: 5, minBpm: 176, maxBpm: 195 },
];

describe("parseHrZonesSettingsMeta / resolveConfiguredMaxHr", () => {
  it("parses AgeBased age and resolves 220−age", () => {
    const body = JSON.stringify({
      calculationMethod: "AgeBased",
      age: 40,
      zones: fiveZones,
    });
    const meta = parseHrZonesSettingsMeta(body);
    expect(meta.calculationMethod).toBe("AgeBased");
    expect(meta.age).toBe(40);
    expect(resolveConfiguredMaxHr(meta, fiveZones)).toBe(180);
  });

  it("prefers explicit maxHeartRateBpm when not AgeBased", () => {
    const meta = parseHrZonesSettingsMeta(
      JSON.stringify({
        calculationMethod: "Karvonen",
        maxHeartRateBpm: 192,
      }),
    );
    expect(resolveConfiguredMaxHr(meta, fiveZones)).toBe(192);
  });

  it("falls back to top zone max when meta lacks max and method", () => {
    expect(resolveConfiguredMaxHr({}, fiveZones)).toBe(195);
  });
});

describe("extractTimeSeriesSamples / buildDenseHrPerSecond", () => {
  it("reads camelCase Tempo timeSeries rows", () => {
    const w = {
      timeSeries: [
        { elapsedSeconds: 0, heartRateBpm: 120 },
        { elapsedSeconds: 2, heartRateBpm: 130 },
      ],
    };
    const s = extractTimeSeriesSamples(w);
    expect(s).toHaveLength(2);
    const dense = buildDenseHrPerSecond(s, 3);
    expect(dense).toEqual([120, 120, 130]);
  });

  it("builds forward-filled series capped by durationS", () => {
    const s = extractTimeSeriesSamples({
      timeSeries: [{ elapsedSeconds: 0, heartRateBpm: 110 }],
    });
    const dense = buildDenseHrPerSecond(s, 5);
    expect(dense).toEqual([110, 110, 110, 110, 110]);
  });
});

describe("secondsPerZoneFromDense / zoneIndexForBpm", () => {
  it("buckets BPM into sorted zones", () => {
    const sorted = [...fiveZones].sort((a, b) => a.zone - b.zone);
    expect(zoneIndexForBpm(115, sorted)).toBe(0);
    expect(zoneIndexForBpm(121, sorted)).toBe(1);
    expect(zoneIndexForBpm(99, sorted)).toBe(0);
    expect(zoneIndexForBpm(200, sorted)).toBe(4);
    const dense = [115, 121, 200];
    const sec = secondsPerZoneFromDense(dense, sorted);
    expect(sec).toEqual([1, 1, 0, 0, 1]);
    const pct = pctFromZoneSeconds(sec);
    expect(pct.z1).toBeCloseTo(33.3, 0);
  });
});

describe("quarterAvgHrs / driftSeverityLabel / isEasyOrLongRunType", () => {
  it("splits into four quarters and computes drift", () => {
    const dense = [
      ...Array(25).fill(140),
      ...Array(25).fill(140),
      ...Array(25).fill(140),
      ...Array(25).fill(160),
    ];
    const q = quarterAvgHrs(dense);
    expect(q).toBeDefined();
    expect(q!.drift).toBe(20);
    expect(driftSeverityLabel(q!.drift)).toBe(
      "⚠ above target (target ≤10 bpm)",
    );
  });

  it("flags strong drift above 20 bpm", () => {
    expect(driftSeverityLabel(21)).toBe("⚠⚠ well above target");
    expect(driftSeverityLabel(9)).toBeUndefined();
  });

  it("detects easy/long run types case-insensitively", () => {
    expect(isEasyOrLongRunType("Easy Run")).toBe(true);
    expect(isEasyOrLongRunType("long")).toBe(true);
    expect(isEasyOrLongRunType("Tempo")).toBe(false);
  });
});

describe("computeRecapHrAnalytics", () => {
  const zonesBody = JSON.stringify({
    calculationMethod: "AgeBased",
    age: 40,
    zones: fiveZones,
  });

  it("returns empty runs note for empty week", () => {
    const a = computeRecapHrAnalytics({
      zones: fiveZones,
      heartRateZonesBody: zonesBody,
      workoutDetails: [],
    });
    expect(a.week.note).toContain("No workouts");
    expect(a.runs).toHaveLength(0);
  });

  it("aggregates week zones from multiple workouts", () => {
    const mkSeries = (offset: number, hrLow: number, hrHigh: number) => {
      const ts = [];
      for (let i = 0; i < 80; i++) {
        const sec = offset + i;
        ts.push({
          elapsedSeconds: sec,
          heartRateBpm: i < 40 ? hrLow : hrHigh,
        });
      }
      return ts;
    };
    const w1 = {
      durationS: 80,
      runType: "easy run",
      timeSeries: mkSeries(0, 115, 170),
    };
    const w2 = {
      durationS: 80,
      runType: "Workout",
      timeSeries: mkSeries(0, 115, 115),
    };
    const a = computeRecapHrAnalytics({
      zones: fiveZones,
      heartRateZonesBody: zonesBody,
      workoutDetails: [
        { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", body: JSON.stringify(w1) },
        { id: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff", body: JSON.stringify(w2) },
      ],
    });
    expect(a.week.totalHrSeconds).toBe(160);
    expect(a.week.zonePct).toBeDefined();
    expect(a.runs).toHaveLength(2);
    const easy = a.runs.find(
      (r) => r.id === "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
    expect(easy?.driftSeverityLabel).toBeDefined();
    const quality = a.runs.find(
      (r) => r.id === "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
    );
    expect(quality?.driftSeverityLabel).toBeUndefined();
  });

  it("uses summary avg HR for % max when timeSeries absent", () => {
    const a = computeRecapHrAnalytics({
      zones: fiveZones,
      heartRateZonesBody: zonesBody,
      workoutDetails: [
        {
          id: "cccccccc-dddd-eeee-ffff-000000000001",
          body: JSON.stringify({ avgHeartRateBpm: 160 }),
        },
      ],
    });
    expect(a.runs[0]?.pctMaxHr).toBeCloseTo(88.9, 0);
    expect(a.runs[0]?.degradation).toContain("no HR data");
  });

  it("surfaces note when no workout has timeSeries HR", () => {
    const a = computeRecapHrAnalytics({
      zones: fiveZones,
      heartRateZonesBody: zonesBody,
      workoutDetails: [
        {
          id: "cccccccc-dddd-eeee-ffff-000000000002",
          body: JSON.stringify({ avgHeartRateBpm: 150 }),
        },
      ],
    });
    expect(a.week.note).toContain("No usable HR samples");
  });

  it("prefers GET /workouts/{id}/time-series samples over embedded timeSeries", () => {
    const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const apiSamples = Array.from({ length: 40 }, (_, i) => ({
      elapsedSeconds: i,
      heartRateBpm: i < 20 ? 115 : 180,
    }));
    const bodyObj = {
      durationS: 40,
      runType: "Easy Run",
      timeSeries: Array.from({ length: 40 }, (_, i) => ({
        elapsedSeconds: i,
        heartRateBpm: 120,
      })),
    };
    const a = computeRecapHrAnalytics({
      zones: fiveZones,
      heartRateZonesBody: zonesBody,
      workoutDetails: [{ id, body: JSON.stringify(bodyObj) }],
      timeSeriesByWorkoutId: { [id]: apiSamples },
    });
    const run = a.runs[0];
    expect(run?.driftBpm).toBeDefined();
    expect(run?.driftBpm).not.toBe(0);
    expect(run?.zonePct?.z5).toBeGreaterThan(0);
  });
});
