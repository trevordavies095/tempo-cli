/**
 * §3.10 — Empty week is success (minimal report), not CLI failure.
 * Successful recap completion exits 0 implicitly (no process.exit on happy path).
 */

import { describe, expect, it } from "vitest";

import { computeRecapHrAnalytics } from "./hr-analytics.js";
import { buildWeeklyRecapCompact } from "./compact-report.js";
import { buildWeeklyRecapMarkdownCore } from "./markdown-report.js";
import type { RecapNotableSnapshot } from "./notable.js";
import type { RecapWeekResolved } from "./resolve-week.js";

const emptyNotable: RecapNotableSnapshot = {
  bullets: [],
  bestEfforts: { fetchOk: true, hadPriorCache: false, prs: [] },
  shoesOverThreshold: [],
  overload: { flagged: false },
};

const fiveZones = [
  { zone: 1, minBpm: 100, maxBpm: 120 },
  { zone: 2, minBpm: 121, maxBpm: 140 },
  { zone: 3, minBpm: 141, maxBpm: 160 },
  { zone: 4, minBpm: 161, maxBpm: 175 },
  { zone: 5, minBpm: 176, maxBpm: 195 },
];

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

describe("§3.10 empty week success semantics", () => {
  it("Markdown and compact minimal outputs state no runs", () => {
    const hrAnalytics = computeRecapHrAnalytics({
      zones: fiveZones,
      heartRateZonesBody: zonesBody(),
      workoutDetails: [],
    });

    const md = buildWeeklyRecapMarkdownCore({
      resolved: resolvedSample,
      timeZoneId: "America/New_York",
      unit: "metric",
      hrAnalytics,
      workoutDetails: [],
      shoesBody: "[]",
    });

    const compact = buildWeeklyRecapCompact({
      resolved: resolvedSample,
      timeZoneId: "America/New_York",
      unit: "metric",
      hrAnalytics,
      workoutDetails: [],
      notableSnapshot: emptyNotable,
    });

    expect(md).toContain("No runs recorded this week.");
    expect(compact).toContain("No runs recorded this week.");
  });
});
