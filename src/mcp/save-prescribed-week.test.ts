import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parsePrescribedWeekYaml } from "../weekly-recap/prescribed-week.js";
import {
  SAVE_PRESCRIBED_WEEK_TOOL_NAME,
  savePrescribedWeek,
} from "./save-prescribed-week.js";

async function tempPrescribedDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "tempo-mcp-presc-"));
  const dir = join(root, "prescribed");
  await mkdir(dir, { recursive: true });
  return dir;
}

const workoutSession = {
  type: "workout" as const,
  date: "2026-05-09",
  description: "2x1mi",
  target_pace_per_mi: { min: "8:15", max: "8:30" },
  target_hr_bpm: { min: 175, max: 184 },
  reps: 2,
  rep_distance_mi: 1,
};

const longRunSession = {
  type: "long_run" as const,
  date: "2026-05-10",
  target_distance_mi: 14,
  target_hr_bpm_max: 155,
};

describe("savePrescribedWeek", () => {
  it("writes CLI-compatible YAML and round-trips through parsePrescribedWeekYaml", async () => {
    const prescribedDir = await tempPrescribedDir();
    const outcome = await savePrescribedWeek(
      { prescribedDir, timezone: "America/New_York" },
      {
        week: "2026-W19",
        sessions: [workoutSession, longRunSession],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.week).toBe("2026-W19");
    expect(outcome.path).toBe(join(prescribedDir, "prescribed-2026-W19.yaml"));

    const raw = await readFile(outcome.path, "utf8");
    const parsed = parsePrescribedWeekYaml(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.week).toBe("2026-W19");
    expect(parsed.value.sessions).toHaveLength(2);
    expect(parsed.value.sessions[0]!.kind).toBe("workout");
    expect(parsed.value.sessions[1]!.kind).toBe("long_run");
  });

  it("refuses overwrite when file exists and overwrite is not set", async () => {
    const prescribedDir = await tempPrescribedDir();
    const path = join(prescribedDir, "prescribed-2026-W19.yaml");
    await writeFile(path, "week: 2026-W19\nsessions: []\n", "utf8");
    const outcome = await savePrescribedWeek(
      { prescribedDir, timezone: "America/New_York" },
      {
        week: "2026-W19",
        sessions: [workoutSession],
      },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.text).toMatch(/already exists/i);
    expect(outcome.text).toContain("2026-W19");
    expect(outcome.text).toMatch(/overwrite/i);
    const raw = await readFile(path, "utf8");
    expect(raw).toContain("sessions: []");
  });

  it("replaces existing file when overwrite is true", async () => {
    const prescribedDir = await tempPrescribedDir();
    const path = join(prescribedDir, "prescribed-2026-W19.yaml");
    await writeFile(path, "week: 2026-W19\nsessions: []\n", "utf8");
    const outcome = await savePrescribedWeek(
      { prescribedDir, timezone: "America/New_York" },
      {
        week: "2026-W19",
        overwrite: true,
        sessions: [workoutSession],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const raw = await readFile(path, "utf8");
    expect(raw).toContain("type: workout");
    expect(raw).toContain("reps: 2");
    const parsed = parsePrescribedWeekYaml(raw);
    expect(parsed.ok).toBe(true);
  });

  it("rejects invalid week", async () => {
    const prescribedDir = await tempPrescribedDir();
    const outcome = await savePrescribedWeek(
      { prescribedDir },
      { week: "nope", sessions: [workoutSession] },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.text).toMatch(/Invalid week/i);
  });

  it("rejects empty sessions", async () => {
    const prescribedDir = await tempPrescribedDir();
    const outcome = await savePrescribedWeek(
      { prescribedDir, timezone: "America/New_York" },
      { week: "2026-W19", sessions: [] },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.text).toMatch(/at least one/i);
  });

  it("rejects dates outside the week", async () => {
    const prescribedDir = await tempPrescribedDir();
    const outcome = await savePrescribedWeek(
      { prescribedDir, timezone: "America/New_York" },
      {
        week: "2026-W19",
        sessions: [{ ...workoutSession, date: "2026-05-01" }],
      },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.text).toMatch(/outside/i);
    expect(outcome.text).toContain("2026-05-01");
  });

  it("rejects invalid pace strings", async () => {
    const prescribedDir = await tempPrescribedDir();
    const outcome = await savePrescribedWeek(
      { prescribedDir, timezone: "America/New_York" },
      {
        week: "2026-W19",
        sessions: [
          {
            ...workoutSession,
            target_pace_per_mi: { min: "not-a-pace", max: "8:30" },
          },
        ],
      },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.text).toMatch(/target_pace_per_mi/i);
  });

  it("exports a stable tool name", () => {
    expect(SAVE_PRESCRIBED_WEEK_TOOL_NAME).toBe("save_prescribed_week");
  });
});
