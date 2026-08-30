import { afterEach, describe, expect, it, vi } from "vitest";

import * as authMe from "../commands/auth-me.js";
import * as settingsHr from "../commands/settings-heart-rate-zones.js";
import * as settingsUnit from "../commands/settings-unit-preference.js";
import * as statsWeeklyRecap from "../commands/stats-weekly-recap.js";
import * as statsRelativeEffort from "../commands/stats-relative-effort.js";
import * as statsBestEfforts from "../commands/stats-best-efforts.js";
import * as statsYearlyWeekly from "../commands/stats-yearly-weekly.js";
import * as fetchWorkouts from "./fetch-workouts.js";
import { runWeeklyRecap } from "./run-weekly-recap.js";

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

function mockHappyPathProbes() {
  vi.spyOn(authMe, "probeAuthMe").mockResolvedValue({
    kind: "ok",
    status: 200,
    body: JSON.stringify({ id: "u1" }),
  });
  vi.spyOn(settingsHr, "probeSettingsHeartRateZones").mockResolvedValue({
    kind: "ok",
    status: 200,
    body: zonesBody(),
  });
  vi.spyOn(settingsUnit, "probeSettingsUnitPreference").mockResolvedValue({
    kind: "ok",
    status: 200,
    body: JSON.stringify({ unit: "imperial" }),
  });
  vi.spyOn(fetchWorkouts, "fetchRecapWorkoutData").mockResolvedValue({
    ok: true,
    listItemCount: 0,
    workoutIds: [],
    workoutDetails: [],
    timeSeriesByWorkoutId: {},
    shoesStatus: 200,
    shoesBody: "[]",
    similarRoutesByWorkoutId: {},
  });
  vi.spyOn(fetchWorkouts, "fetchTrendWorkoutListItems").mockResolvedValue({
    ok: true,
    items: [],
  });
  vi.spyOn(statsWeeklyRecap, "probeStatsWeeklyRecap").mockResolvedValue({
    kind: "ok",
    status: 200,
    body: JSON.stringify({}),
  });
  vi.spyOn(statsRelativeEffort, "probeStatsRelativeEffort").mockResolvedValue({
    kind: "ok",
    status: 200,
    body: JSON.stringify({}),
  });
  vi.spyOn(statsBestEfforts, "probeStatsBestEfforts").mockResolvedValue({
    kind: "ok",
    status: 200,
    body: JSON.stringify({}),
  });
  vi.spyOn(statsYearlyWeekly, "probeStatsYearlyWeekly").mockResolvedValue({
    kind: "ok",
    status: 200,
    body: JSON.stringify([]),
  });
}

describe("runWeeklyRecap", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns markdown report without writing to stdout/stderr", async () => {
    mockHappyPathProbes();
    const stdoutSpy = vi.spyOn(process.stdout, "write");
    const stderrSpy = vi.spyOn(process.stderr, "write");
    const progress: string[] = [];

    const result = await runWeeklyRecap({
      baseUrl: "http://localhost:5001",
      apiKey: "tmp_test",
      weekSpec: "2026-W19",
      timeZoneId: "America/New_York",
      format: "markdown",
      includeTrends: false,
      subjective: { kind: "skipped" },
      onProgress: (line) => progress.push(line),
      cacheDirFlag: "/tmp/tempo-recap-test-cache-md",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.humanSuccessBody).toContain("Weekly Recap");
    expect(result.humanSuccessBody).toContain("2026-W19");
    expect(result.jsonBody.reportMarkdown).toBe(result.humanSuccessBody);
    expect(result.subjectiveState).toBe("skipped");
    expect(result.resolved.isoWeekId).toBe("2026-W19");
    expect(progress.length).toBeGreaterThan(0);
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("returns compact and json human bodies for the same week", async () => {
    mockHappyPathProbes();

    const compact = await runWeeklyRecap({
      baseUrl: "http://localhost:5001",
      apiKey: "tmp_test",
      weekSpec: "2026-W19",
      timeZoneId: "America/New_York",
      format: "compact",
      includeTrends: false,
      subjective: { kind: "skipped" },
      cacheDirFlag: "/tmp/tempo-recap-test-cache-c",
    });
    expect(compact.ok).toBe(true);
    if (!compact.ok) return;
    expect(compact.jsonBody.recapFormat).toBe("compact");
    expect(compact.jsonBody.compactText).toBe(compact.humanSuccessBody);
    expect(compact.jsonBody.reportMarkdown).toBeUndefined();

    mockHappyPathProbes();
    const jsonFmt = await runWeeklyRecap({
      baseUrl: "http://localhost:5001",
      apiKey: "tmp_test",
      weekSpec: "2026-W19",
      timeZoneId: "America/New_York",
      format: "json",
      includeTrends: false,
      subjective: { kind: "skipped" },
      cacheDirFlag: "/tmp/tempo-recap-test-cache-j",
    });
    expect(jsonFmt.ok).toBe(true);
    if (!jsonFmt.ok) return;
    expect(jsonFmt.humanSuccessBody).toContain("Week 2026-W19");
    expect(jsonFmt.humanSuccessBody).toContain("UTC startDate:");
    expect(jsonFmt.jsonBody.reportMarkdown).toBeUndefined();
    expect(jsonFmt.jsonBody.recapFormat).toBe("json");
  });

  it("warns on subjective week mismatch when loaded from file", async () => {
    mockHappyPathProbes();
    const result = await runWeeklyRecap({
      baseUrl: "http://localhost:5001",
      apiKey: "tmp_test",
      weekSpec: "2026-W19",
      timeZoneId: "America/New_York",
      format: "markdown",
      includeTrends: false,
      cacheDirFlag: "/tmp/tempo-recap-test-cache-w",
      subjective: {
        kind: "provided",
        path: "/tmp/subjective-wrong-week.yaml",
        loadedFromFile: true,
        interactiveSaved: false,
        source: "file",
        doc: {
          week: "2026-W01",
          runs: [{ date: "2026-01-05", rpe: 5 }],
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.subjectiveState).toBe("present");
    expect(
      result.warnings.some((w) => w.includes("does not match recap week")),
    ).toBe(true);
  });

  it("records absent subjective as missing without stream writes", async () => {
    mockHappyPathProbes();
    const stdoutSpy = vi.spyOn(process.stdout, "write");
    const stderrSpy = vi.spyOn(process.stderr, "write");

    const result = await runWeeklyRecap({
      baseUrl: "http://localhost:5001",
      apiKey: "tmp_test",
      weekSpec: "2026-W19",
      timeZoneId: "America/New_York",
      format: "markdown",
      includeTrends: false,
      cacheDirFlag: "/tmp/tempo-recap-test-cache-a",
      subjective: {
        kind: "absent",
        path: "/tmp/missing-subjective.yaml",
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.subjectiveState).toBe("missing");
    expect(result.jsonBody.subjective).toMatchObject({
      skipped: false,
      reason: "no_subjective_data",
    });
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("supports two sequential calls with different weeks without leakage", async () => {
    mockHappyPathProbes();
    const first = await runWeeklyRecap({
      baseUrl: "http://localhost:5001",
      apiKey: "tmp_test",
      weekSpec: "2026-W19",
      timeZoneId: "America/New_York",
      format: "markdown",
      includeTrends: false,
      subjective: { kind: "skipped" },
      cacheDirFlag: "/tmp/tempo-recap-test-cache-1",
    });
    mockHappyPathProbes();
    const second = await runWeeklyRecap({
      baseUrl: "http://localhost:5001",
      apiKey: "tmp_test",
      weekSpec: "2026-W20",
      timeZoneId: "America/New_York",
      format: "markdown",
      includeTrends: false,
      subjective: { kind: "skipped" },
      cacheDirFlag: "/tmp/tempo-recap-test-cache-2",
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.resolved.isoWeekId).toBe("2026-W19");
    expect(second.resolved.isoWeekId).toBe("2026-W20");
    expect(first.humanSuccessBody).toContain("2026-W19");
    expect(second.humanSuccessBody).toContain("2026-W20");
    expect(first.humanSuccessBody).not.toContain("2026-W20");
  });

  it("maps auth HTTP failure to typed error", async () => {
    vi.spyOn(authMe, "probeAuthMe").mockResolvedValue({
      kind: "http",
      status: 403,
      body: "forbidden",
    });
    const result = await runWeeklyRecap({
      baseUrl: "http://localhost:5001",
      apiKey: "tmp_secret_key",
      weekSpec: "2026-W19",
      timeZoneId: "America/New_York",
      format: "markdown",
      includeTrends: false,
      subjective: { kind: "skipped" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("HTTP_ERROR");
    expect(result.exit).toEqual({ httpStatus: 403 });
    expect(result.message).not.toContain("tmp_secret_key");
  });

  it("invokes deferred subjective collect after fetch", async () => {
    mockHappyPathProbes();
    const collect = vi.fn().mockResolvedValue({
      kind: "absent",
      path: "/tmp/deferred.yaml",
    });
    const result = await runWeeklyRecap({
      baseUrl: "http://localhost:5001",
      apiKey: "tmp_test",
      weekSpec: "2026-W19",
      timeZoneId: "America/New_York",
      format: "markdown",
      includeTrends: false,
      cacheDirFlag: "/tmp/tempo-recap-test-cache-d",
      subjective: {
        kind: "collect",
        path: "/tmp/deferred.yaml",
        collect,
      },
    });
    expect(result.ok).toBe(true);
    expect(collect).toHaveBeenCalledOnce();
    expect(collect.mock.calls[0]![0]).toMatchObject({
      isoWeekId: "2026-W19",
      timeZoneId: "America/New_York",
      unit: "imperial",
    });
    expect(fetchWorkouts.fetchRecapWorkoutData).toHaveBeenCalled();
  });
});
