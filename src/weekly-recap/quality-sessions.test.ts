import { describe, expect, it } from "vitest";

import {
  buildPrescribedQualityOutput,
  isQualitySessionRunType,
} from "./quality-sessions.js";

const METERS_PER_MILE = 1609.344;

/** Tempo split paceS is seconds per km; convert desired sec/mi to paceS. */
function paceSFromSecPerMi(secPerMi: number): number {
  return secPerMi / (METERS_PER_MILE / 1000);
}

const W1 = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("isQualitySessionRunType", () => {
  it("accepts Workout and Race styles", () => {
    expect(isQualitySessionRunType("Workout")).toBe(true);
    expect(isQualitySessionRunType("Race")).toBe(true);
    expect(isQualitySessionRunType("Half Marathon")).toBe(false);
    expect(isQualitySessionRunType("Easy Run")).toBe(false);
  });
});

describe("buildPrescribedQualityOutput", () => {
  const resolvedIsoWeekId = "2026-W19";
  const timeZoneId = "America/New_York";
  /** Local May 9, 2026 morning in NY */
  const startedAt = "2026-05-09T14:30:00.000Z";

  const baseYaml = `
week: 2026-W19
sessions:
  - date: 2026-05-09
    type: workout
    description: 2 × 1 mi @ threshold
    target_pace_per_mi:
      min: "8:00"
      max: "9:00"
    target_hr_bpm:
      min: 170
      max: 185
    reps: 2
    rep_distance_mi: 1
`;

  it("matches workout by local date and emits rep verdicts", () => {
    const paceMid = paceSFromSecPerMi(510); // 8:30/mi
    const workout = {
      startedAt,
      runType: "Workout",
      durationS: 3600,
      splits: [
        { paceS: paceMid, avgHeartRateBpm: 175, durationS: 900 },
        { paceS: paceMid, avgHeartRateBpm: 178, durationS: 900 },
      ],
    };
    const { markdown, json } = buildPrescribedQualityOutput({
      fileContent: baseYaml,
      resolvedPath: "/tmp/p.yaml",
      resolvedIsoWeekId,
      timeZoneId,
      workoutDetails: [{ id: W1, body: JSON.stringify(workout) }],
    });
    expect(markdown).toContain("### Quality session");
    expect(markdown).toContain("Prescribed:");
    expect(markdown).toContain("Actual:");
    expect(markdown).toContain("✓");
    expect(markdown).toContain("Verdict: on target.");
    expect(json.weekMismatch).toBe(false);
    const sessions = json.sessions as Record<string, unknown>[];
    expect(sessions[0]?.matched).toBe(true);
    const reps = sessions[0]?.reps as { verdict: string }[];
    expect(reps?.every((r) => r.verdict === "ok")).toBe(true);
  });

  it("marks partial when pace in range but HR outside", () => {
    const paceOk = paceSFromSecPerMi(500);
    const workout = {
      startedAt,
      runType: "Workout",
      durationS: 1800,
      splits: [
        { paceS: paceOk, avgHeartRateBpm: 160, durationS: 900 },
      ],
    };
    const yaml = `
week: 2026-W19
sessions:
  - date: 2026-05-09
    type: workout
    target_pace_per_mi: { min: "8:00", max: "9:00" }
    target_hr_bpm: { min: 170, max: 185 }
    reps: 1
    rep_distance_mi: 1
`;
    const { markdown, json } = buildPrescribedQualityOutput({
      fileContent: yaml,
      resolvedPath: "/x.yaml",
      resolvedIsoWeekId,
      timeZoneId,
      workoutDetails: [{ id: W1, body: JSON.stringify(workout) }],
    });
    expect(markdown).toContain("⚠");
    expect(markdown).toContain("mostly on target");
    const reps = (json.sessions as { reps: { verdict: string }[] }[])[0]?.reps;
    expect(reps?.[0]?.verdict).toBe("partial");
  });

  it("marks miss when neither pace nor HR in range", () => {
    const tooSlow = paceSFromSecPerMi(700); // ~11:40/mi
    const workout = {
      startedAt,
      runType: "Workout",
      durationS: 1800,
      splits: [{ paceS: tooSlow, avgHeartRateBpm: 140, durationS: 900 }],
    };
    const yaml = `
week: 2026-W19
sessions:
  - date: 2026-05-09
    type: workout
    target_pace_per_mi: { min: "8:00", max: "9:00" }
    target_hr_bpm: { min: 170, max: 185 }
    reps: 1
    rep_distance_mi: 1
`;
    const { markdown } = buildPrescribedQualityOutput({
      fileContent: yaml,
      resolvedPath: "/x.yaml",
      resolvedIsoWeekId,
      timeZoneId,
      workoutDetails: [{ id: W1, body: JSON.stringify(workout) }],
    });
    expect(markdown).toContain("✗");
    expect(markdown).toContain("outside prescribed");
  });

  it("sets weekMismatch and warns when file week differs from recap week", () => {
    const workout = {
      startedAt,
      runType: "Workout",
      durationS: 1800,
      splits: [
        { paceS: paceSFromSecPerMi(500), avgHeartRateBpm: 175, durationS: 900 },
      ],
    };
    const yaml = `
week: 2025-W01
sessions:
  - date: 2026-05-09
    type: workout
    target_pace_per_mi: { min: "8:00", max: "9:00" }
    target_hr_bpm: { min: 170, max: 185 }
    reps: 1
    rep_distance_mi: 1
`;
    const { markdown, json } = buildPrescribedQualityOutput({
      fileContent: yaml,
      resolvedPath: "/x.yaml",
      resolvedIsoWeekId,
      timeZoneId,
      workoutDetails: [{ id: W1, body: JSON.stringify(workout) }],
    });
    expect(markdown).toContain("does not match recap week");
    expect(json.weekMismatch).toBe(true);
  });

  it("records long_run in JSON with deferred skip reason only", () => {
    const yaml = `
week: 2026-W19
sessions:
  - date: 2026-05-11
    type: long_run
    target_distance_mi: 14
    target_hr_bpm_max: 155
`;
    const { markdown, json } = buildPrescribedQualityOutput({
      fileContent: yaml,
      resolvedPath: "/x.yaml",
      resolvedIsoWeekId,
      timeZoneId,
      workoutDetails: [],
    });
    expect(markdown).toBe("");
    const sessions = json.sessions as { skippedReason?: string }[];
    expect(sessions[0]?.skippedReason).toBe("long_run_deferred_to_p12");
  });

  it("returns parseError JSON and empty markdown on invalid YAML content", () => {
    const { markdown, json } = buildPrescribedQualityOutput({
      fileContent: "week: [\n",
      resolvedPath: "/bad.yaml",
      resolvedIsoWeekId,
      timeZoneId,
      workoutDetails: [],
    });
    expect(markdown).toBe("");
    expect(json.parseError).toBeTruthy();
    expect(typeof json.parseError).toBe("string");
  });

  it("returns empty output when file missing", () => {
    const { markdown, json } = buildPrescribedQualityOutput({
      fileContent: undefined,
      resolvedPath: "/none.yaml",
      resolvedIsoWeekId,
      timeZoneId,
      workoutDetails: [],
    });
    expect(markdown).toBe("");
    expect(json.loaded).toBe(false);
  });
});
