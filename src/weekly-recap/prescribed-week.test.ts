import { describe, expect, it } from "vitest";

import {
  normalizeIsoWeekId,
  parseClockToSeconds,
  parsePrescribedWeekYaml,
} from "./prescribed-week.js";

describe("parsePrescribedWeekYaml", () => {
  const minimalWorkoutSession = `
week: 2026-W19
sessions:
  - date: 2026-05-09
    type: workout
    target_pace_per_mi:
      min: "8:15"
      max: "8:30"
    target_hr_bpm:
      min: 175
      max: 184
    reps: 2
    rep_distance_mi: 1
`;

  it("parses a valid workout session", () => {
    const r = parsePrescribedWeekYaml(minimalWorkoutSession);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.week).toBe("2026-W19");
    expect(r.value.sessions).toHaveLength(1);
    const s = r.value.sessions[0]!;
    expect(s.kind).toBe("workout");
    if (s.kind !== "workout") return;
    expect(s.date).toBe("2026-05-09");
    expect(s.reps).toBe(2);
    expect(s.repDistanceMi).toBe(1);
    expect(s.paceSecPerMi.min).toBe(8 * 60 + 15);
    expect(s.paceSecPerMi.max).toBe(8 * 60 + 30);
    expect(s.hrBpm).toEqual({ min: 175, max: 184 });
  });

  it("rejects invalid week date format", () => {
    const r = parsePrescribedWeekYaml(`
week: 2026-W19
sessions:
  - date: 05/09/2026
    type: workout
    target_pace_per_mi: { min: "8:00", max: "9:00" }
    target_hr_bpm: { min: 140, max: 160 }
    reps: 1
    rep_distance_mi: 1
`);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("YYYY-MM-DD");
  });

  it("rejects malformed pace strings", () => {
    const r = parsePrescribedWeekYaml(`
week: 2026-W19
sessions:
  - date: 2026-05-09
    type: workout
    target_pace_per_mi:
      min: "not-a-pace"
      max: "8:30"
    target_hr_bpm:
      min: 175
      max: 184
    reps: 1
    rep_distance_mi: 1
`);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("target_pace_per_mi");
  });

  it("rejects empty file", () => {
    const r = parsePrescribedWeekYaml("   \n  ");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("empty");
  });

  it("parses long_run with numeric distance and HR max", () => {
    const r = parsePrescribedWeekYaml(`
week: 2026-W19
sessions:
  - date: 2026-05-10
    type: long_run
    target_distance_mi: 14
    target_hr_bpm_max: 155
`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.value.sessions[0]!;
    expect(s.kind).toBe("long_run");
    if (s.kind !== "long_run") return;
    expect(s.targetDistanceMi).toBe(14);
    expect(s.targetHrBpmMax).toBe(155);
  });
});

describe("normalizeIsoWeekId / parseClockToSeconds", () => {
  it("pads ISO week number", () => {
    expect(normalizeIsoWeekId("2026-W9")).toBe("2026-W09");
    expect(normalizeIsoWeekId("2026-W19")).toBe("2026-W19");
  });

  it("parseClockToSeconds handles M:SS", () => {
    expect(parseClockToSeconds("8:15")).toBe(8 * 60 + 15);
  });
});
