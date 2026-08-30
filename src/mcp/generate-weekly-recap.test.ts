import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import * as authMe from "../commands/auth-me.js";
import * as settingsHr from "../commands/settings-heart-rate-zones.js";
import * as settingsUnit from "../commands/settings-unit-preference.js";
import * as statsBestEfforts from "../commands/stats-best-efforts.js";
import * as statsRelativeEffort from "../commands/stats-relative-effort.js";
import * as statsWeeklyRecap from "../commands/stats-weekly-recap.js";
import * as statsYearlyWeekly from "../commands/stats-yearly-weekly.js";
import * as fetchWorkouts from "../weekly-recap/fetch-workouts.js";
import {
  GENERATE_WEEKLY_RECAP_TOOL_NAME,
  generateWeeklyRecap,
  generateWeeklyRecapToolResult,
} from "./generate-weekly-recap.js";

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

function mockHappyPathProbes(workoutDetails: { id: string; status: number; body: string }[] = []) {
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
    listItemCount: workoutDetails.length,
    workoutIds: workoutDetails.map((d) => d.id),
    workoutDetails,
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

async function tempDirs(): Promise<{
  subjectiveDir: string;
  prescribedDir: string;
  cacheDir: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "tempo-mcp-recap-"));
  const subjectiveDir = join(root, "subjective");
  const prescribedDir = join(root, "prescribed");
  const cacheDir = join(root, "cache");
  await mkdir(subjectiveDir, { recursive: true });
  await mkdir(prescribedDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  return { subjectiveDir, prescribedDir, cacheDir };
}

describe("generateWeeklyRecap", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns skipped subjective when skip_subjective is true", async () => {
    mockHappyPathProbes();
    const dirs = await tempDirs();
    const outcome = await generateWeeklyRecap(
      {
        baseUrl: "http://localhost:5001",
        apiKey: "tmp_test",
        subjectiveDir: dirs.subjectiveDir,
        prescribedDir: dirs.prescribedDir,
        cacheDir: dirs.cacheDir,
        includeTrendsDefault: false,
      },
      {
        week: "2026-W19",
        timezone: "America/New_York",
        skip_subjective: true,
        include_trends: false,
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.kind).toBe("report");
    if (outcome.kind !== "report") return;
    expect(outcome.envelope.status).toBe("report");
    expect(outcome.envelope.week).toBe("2026-W19");
    expect(outcome.envelope.timezone).toBe("America/New_York");
    expect(outcome.envelope.subjective).toBe("skipped");
    expect(outcome.envelope.reportMarkdown).toContain("Weekly Recap");
    expect(outcome.envelope.reportMarkdown).toContain(
      "No runs recorded this week.",
    );
  });

  it("returns present when subjective YAML exists", async () => {
    mockHappyPathProbes();
    const dirs = await tempDirs();
    await writeFile(
      join(dirs.subjectiveDir, "subjective-2026-W19.yaml"),
      [
        "week: 2026-W19",
        "runs:",
        "  - date: 2026-05-05",
        "    rpe: 5",
        "weekly:",
        "  stress_level: low",
      ].join("\n"),
      "utf8",
    );
    const outcome = await generateWeeklyRecap(
      {
        baseUrl: "http://localhost:5001",
        apiKey: "tmp_test",
        subjectiveDir: dirs.subjectiveDir,
        cacheDir: dirs.cacheDir,
      },
      {
        week: "2026-W19",
        timezone: "America/New_York",
        include_trends: false,
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.kind).toBe("report");
    if (outcome.kind !== "report") return;
    expect(outcome.envelope.subjective).toBe("present");
    expect(outcome.envelope.reportMarkdown).toContain("Weekly Recap");
  });

  it("returns needs_subjective when subjective file is absent", async () => {
    mockHappyPathProbes([
      {
        id: "w1",
        status: 200,
        body: JSON.stringify({
          startedAt: "2026-05-05T12:00:00-04:00",
          runType: "Easy",
          distanceM: 5000,
          durationS: 1800,
          rpe: 4,
        }),
      },
    ]);
    const dirs = await tempDirs();
    const outcome = await generateWeeklyRecap(
      {
        baseUrl: "http://localhost:5001",
        apiKey: "tmp_test",
        subjectiveDir: dirs.subjectiveDir,
        cacheDir: dirs.cacheDir,
      },
      {
        week: "2026-W19",
        timezone: "America/New_York",
        include_trends: false,
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.kind).toBe("needs_subjective");
    if (outcome.kind !== "needs_subjective") return;
    expect(outcome.payload.status).toBe("needs_subjective");
    expect(outcome.payload.week).toBe("2026-W19");
    expect(outcome.payload.runs).toHaveLength(1);
    expect(outcome.payload.runs[0]!.apiRpe).toBe(4);
    expect(outcome.payload.runs[0]!.date).toBe("2026-05-05");
    expect(outcome.payload.questionnaire.all_fields_optional).toBe(true);
    expect(
      Object.prototype.hasOwnProperty.call(outcome.payload, "reportMarkdown"),
    ).toBe(false);
  });

  it("refresh_subjective re-gates when a file already exists", async () => {
    mockHappyPathProbes([
      {
        id: "w1",
        status: 200,
        body: JSON.stringify({
          startedAt: "2026-05-05T12:00:00-04:00",
          runType: "Easy",
          distanceM: 5000,
          durationS: 1800,
        }),
      },
    ]);
    const dirs = await tempDirs();
    await writeFile(
      join(dirs.subjectiveDir, "subjective-2026-W19.yaml"),
      "week: 2026-W19\nruns: []\n",
      "utf8",
    );
    const outcome = await generateWeeklyRecap(
      {
        baseUrl: "http://localhost:5001",
        apiKey: "tmp_test",
        subjectiveDir: dirs.subjectiveDir,
        cacheDir: dirs.cacheDir,
      },
      {
        week: "2026-W19",
        timezone: "America/New_York",
        refresh_subjective: true,
        include_trends: false,
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.kind).toBe("needs_subjective");
  });

  it("errors on missing API key", async () => {
    const outcome = await generateWeeklyRecap({
      baseUrl: "http://localhost:5001",
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.taxonomy).toBe("usage");
    expect(outcome.text).toMatch(/No API key/i);
  });

  it("errors on invalid timezone", async () => {
    const outcome = await generateWeeklyRecap(
      { baseUrl: "http://localhost:5001", apiKey: "tmp_test" },
      { timezone: "Not/A/Zone", week: "2026-W19" },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.taxonomy).toBe("usage");
    expect(outcome.text).toMatch(/Invalid IANA timezone/i);
  });

  it("errors on invalid week spec", async () => {
    const outcome = await generateWeeklyRecap(
      { baseUrl: "http://localhost:5001", apiKey: "tmp_test" },
      { week: "not-a-week", timezone: "America/New_York" },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.taxonomy).toBe("usage");
  });

  it("maps auth failure with key redaction", async () => {
    const secret = "tmp_protocol_secret_key";
    vi.spyOn(authMe, "probeAuthMe").mockResolvedValue({
      kind: "http",
      status: 401,
      body: `denied ${secret}`,
    });
    const outcome = await generateWeeklyRecap(
      { baseUrl: "http://localhost:5001", apiKey: secret },
      {
        week: "2026-W19",
        timezone: "America/New_York",
        skip_subjective: true,
        include_trends: false,
      },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.taxonomy).toBe("auth");
    expect(outcome.text).not.toContain(secret);
  });

  it("empty week with skip_subjective is success with empty-week markdown", async () => {
    mockHappyPathProbes();
    const dirs = await tempDirs();
    const outcome = await generateWeeklyRecap(
      {
        baseUrl: "http://localhost:5001",
        apiKey: "tmp_test",
        subjectiveDir: dirs.subjectiveDir,
        cacheDir: dirs.cacheDir,
      },
      {
        week: "2026-W19",
        timezone: "America/New_York",
        skip_subjective: true,
        include_trends: false,
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.kind !== "report") return;
    expect(outcome.envelope.reportMarkdown).toContain(
      "No runs recorded this week.",
    );
  });

  it("empty week without skip still gates with empty runs", async () => {
    mockHappyPathProbes();
    const dirs = await tempDirs();
    const outcome = await generateWeeklyRecap(
      {
        baseUrl: "http://localhost:5001",
        apiKey: "tmp_test",
        subjectiveDir: dirs.subjectiveDir,
        cacheDir: dirs.cacheDir,
      },
      {
        week: "2026-W19",
        timezone: "America/New_York",
        include_trends: false,
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.kind).toBe("needs_subjective");
    if (outcome.kind !== "needs_subjective") return;
    expect(outcome.payload.runs).toEqual([]);
  });

  it("sets prescribed true when prescribed YAML loads with sessions", async () => {
    mockHappyPathProbes([
      {
        id: "w1",
        status: 200,
        body: JSON.stringify({
          id: "w1",
          startedAt: "2026-05-09T12:00:00.000Z",
          runType: "Workout",
          avgHeartRateBpm: 180,
        }),
      },
    ]);
    const dirs = await tempDirs();
    await writeFile(
      join(dirs.prescribedDir, "prescribed-2026-W19.yaml"),
      [
        "week: 2026-W19",
        "sessions:",
        "  - date: 2026-05-09",
        "    type: workout",
        "    target_pace_per_mi:",
        '      min: "8:15"',
        '      max: "8:30"',
        "    target_hr_bpm:",
        "      min: 175",
        "      max: 184",
        "    reps: 2",
        "    rep_distance_mi: 1",
      ].join("\n"),
      "utf8",
    );
    const outcome = await generateWeeklyRecap(
      {
        baseUrl: "http://localhost:5001",
        apiKey: "tmp_test",
        prescribedDir: dirs.prescribedDir,
        subjectiveDir: dirs.subjectiveDir,
        cacheDir: dirs.cacheDir,
      },
      {
        week: "2026-W19",
        timezone: "America/New_York",
        skip_subjective: true,
        include_trends: false,
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.kind !== "report") return;
    expect(outcome.envelope.prescribed).toBe(true);
    expect(outcome.envelope.reportMarkdown).toMatch(/Quality session/i);
  });

  it("tool result wraps envelope as JSON text", async () => {
    mockHappyPathProbes();
    const dirs = await tempDirs();
    const result = await generateWeeklyRecapToolResult(
      {
        baseUrl: "http://localhost:5001",
        apiKey: "tmp_test",
        subjectiveDir: dirs.subjectiveDir,
        cacheDir: dirs.cacheDir,
      },
      {
        week: "2026-W19",
        timezone: "America/New_York",
        skip_subjective: true,
        include_trends: false,
      },
    );
    expect(result.isError).toBeFalsy();
    const text = (result.content as { type: string; text: string }[])
      .map((c) => c.text)
      .join("\n");
    const parsed = JSON.parse(text) as {
      status: string;
      week: string;
      reportMarkdown: string;
    };
    expect(parsed.status).toBe("report");
    expect(parsed.week).toBe("2026-W19");
    expect(parsed.reportMarkdown).toContain("Weekly Recap");
    expect(GENERATE_WEEKLY_RECAP_TOOL_NAME).toBe("generate_weekly_recap");
  });
});
