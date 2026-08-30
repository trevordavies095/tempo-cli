import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseSubjectiveWeek } from "../weekly-recap/subjective-week.js";
import {
  SAVE_SUBJECTIVE_RESPONSES_TOOL_NAME,
  saveSubjectiveResponses,
} from "./save-subjective-responses.js";

async function tempSubjectiveDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "tempo-mcp-subj-"));
  const dir = join(root, "subjective");
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("saveSubjectiveResponses", () => {
  it("writes CLI-compatible YAML and round-trips through parseSubjectiveWeek", async () => {
    const subjectiveDir = await tempSubjectiveDir();
    const outcome = await saveSubjectiveResponses(
      { subjectiveDir, timezone: "America/New_York" },
      {
        week: "2026-W19",
        runs: [
          { date: "2026-05-05", rpe: 5, felt: 7, pain: "none" },
          { date: "2026-05-07", rpe: 4 },
        ],
        weekly: {
          sleep_avg_hrs: 7.2,
          stress_level: "moderate",
          questions_for_coach: ["Keep the Thursday workout?"],
        },
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.week).toBe("2026-W19");
    expect(outcome.path).toBe(join(subjectiveDir, "subjective-2026-W19.yaml"));

    const raw = await readFile(outcome.path, "utf8");
    const parsed = parseSubjectiveWeek(raw, outcome.path);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.week).toBe("2026-W19");
    expect(parsed.value.runs).toHaveLength(2);
    expect(parsed.value.weekly?.stress_level).toBe("moderate");
    expect(parsed.value.weekly?.questions_for_coach).toEqual([
      "Keep the Thursday workout?",
    ]);
  });

  it("overwrites an existing subjective file", async () => {
    const subjectiveDir = await tempSubjectiveDir();
    const path = join(subjectiveDir, "subjective-2026-W19.yaml");
    await writeFile(path, "week: 2026-W19\nruns: []\n", "utf8");
    const outcome = await saveSubjectiveResponses(
      { subjectiveDir, timezone: "America/New_York" },
      {
        week: "2026-W19",
        runs: [{ date: "2026-05-05", rpe: 6 }],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const raw = await readFile(path, "utf8");
    expect(raw).toContain("rpe: 6");
  });

  it("rejects invalid week", async () => {
    const subjectiveDir = await tempSubjectiveDir();
    const outcome = await saveSubjectiveResponses(
      { subjectiveDir },
      { week: "nope", runs: [] },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.text).toMatch(/Invalid week/i);
  });

  it("rejects rpe out of range", async () => {
    const subjectiveDir = await tempSubjectiveDir();
    const outcome = await saveSubjectiveResponses(
      { subjectiveDir, timezone: "America/New_York" },
      {
        week: "2026-W19",
        runs: [{ date: "2026-05-05", rpe: 99 }],
      },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.text).toMatch(/1 to 10/);
  });

  it("rejects dates outside the week", async () => {
    const subjectiveDir = await tempSubjectiveDir();
    const outcome = await saveSubjectiveResponses(
      { subjectiveDir, timezone: "America/New_York" },
      {
        week: "2026-W19",
        runs: [{ date: "2026-01-01", rpe: 5 }],
      },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.text).toMatch(/outside 2026-W19/);
  });

  it("rejects invalid date format", async () => {
    const subjectiveDir = await tempSubjectiveDir();
    const outcome = await saveSubjectiveResponses(
      { subjectiveDir, timezone: "America/New_York" },
      {
        week: "2026-W19",
        runs: [{ date: "05-05-2026", rpe: 5 }],
      },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.text).toMatch(/YYYY-MM-DD/);
  });

  it("allows empty runs array", async () => {
    const subjectiveDir = await tempSubjectiveDir();
    const outcome = await saveSubjectiveResponses(
      { subjectiveDir, timezone: "America/New_York" },
      {
        week: "2026-W19",
        runs: [],
        weekly: { feeling_into_next_week: "ready" },
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const raw = await readFile(outcome.path, "utf8");
    const parsed = parseSubjectiveWeek(raw, outcome.path);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.runs).toEqual([]);
    expect(parsed.value.weekly?.feeling_into_next_week).toBe("ready");
  });

  it("exposes the expected tool name", () => {
    expect(SAVE_SUBJECTIVE_RESPONSES_TOOL_NAME).toBe(
      "save_subjective_responses",
    );
  });
});
