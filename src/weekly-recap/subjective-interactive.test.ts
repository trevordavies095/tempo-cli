import { PassThrough } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as readlinePromises from "node:readline/promises";

vi.mock("node:readline/promises", () => ({
  createInterface: vi.fn(),
}));

import {
  collectSubjectiveInteractive,
  extractApiRpe,
} from "./subjective-interactive.js";

const mockedCreateInterface = vi.mocked(readlinePromises.createInterface);

describe("extractApiRpe", () => {
  it("returns clamped value for camelCase rpe", () => {
    expect(extractApiRpe({ rpe: 6 })).toBe(6);
  });

  it("returns clamped value for PascalCase Rpe", () => {
    expect(extractApiRpe({ Rpe: 4 })).toBe(4);
  });

  it("rounds and clamps to 1–10", () => {
    expect(extractApiRpe({ rpe: 4.4 })).toBe(4);
    expect(extractApiRpe({ rpe: 0 })).toBeUndefined();
    expect(extractApiRpe({ rpe: 11 })).toBeUndefined();
  });

  it("returns undefined when absent or non-number", () => {
    expect(extractApiRpe({})).toBeUndefined();
    expect(extractApiRpe({ rpe: null as unknown as number })).toBeUndefined();
    expect(extractApiRpe({ rpe: "7" as unknown as number })).toBeUndefined();
  });
});

const baseWorkout = {
  startedAt: "2026-05-09T16:00:00.000Z",
  runType: "Easy Run",
  distanceM: 10_000,
  durationS: 3600,
};

function fakeStreams(): { stdin: NodeJS.ReadStream; stdout: NodeJS.WriteStream } {
  const stdin = new PassThrough();
  (stdin as unknown as NodeJS.ReadStream).isTTY = false;
  const stdout = new PassThrough();
  stdout.on("data", () => {});
  return {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
  };
}

describe("collectSubjectiveInteractive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses API RPE and does not ask the RPE prompt", async () => {
    const prompts: string[] = [];
    mockedCreateInterface.mockReturnValue({
      question: vi.fn(async (prompt: string) => {
        prompts.push(prompt);
        if (prompt.includes("RPE (1-10)")) {
          throw new Error("RPE prompt should be skipped when API has RPE");
        }
        return "";
      }),
      close: vi.fn(),
    } as unknown as readlinePromises.Interface);

    const { stdin, stdout } = fakeStreams();
    const doc = await collectSubjectiveInteractive({
      isoWeekId: "2026-W19",
      workoutDetails: [
        {
          id: "550e8400-e29b-41d4-a716-446655440001",
          body: JSON.stringify({ ...baseWorkout, rpe: 8 }),
        },
      ],
      timeZoneId: "America/New_York",
      unit: "metric",
      stdin,
      stdout,
    });

    expect(doc.runs).toEqual([{ date: "2026-05-09", rpe: 8 }]);
    expect(prompts.some((p) => p.includes("RPE (1-10)"))).toBe(false);
    expect(prompts.length).toBeGreaterThan(0);
  });

  it("asks for RPE when API value is absent", async () => {
    const prompts: string[] = [];
    let rpePromptCount = 0;
    mockedCreateInterface.mockReturnValue({
      question: vi.fn(async (prompt: string) => {
        prompts.push(prompt);
        if (prompt.includes("RPE (1-10)")) {
          rpePromptCount += 1;
          return "5";
        }
        return "";
      }),
      close: vi.fn(),
    } as unknown as readlinePromises.Interface);

    const { stdin, stdout } = fakeStreams();
    const doc = await collectSubjectiveInteractive({
      isoWeekId: "2026-W19",
      workoutDetails: [
        {
          id: "550e8400-e29b-41d4-a716-446655440002",
          body: JSON.stringify({ ...baseWorkout }),
        },
      ],
      timeZoneId: "America/New_York",
      unit: "metric",
      stdin,
      stdout,
    });

    expect(rpePromptCount).toBe(1);
    expect(doc.runs[0]?.rpe).toBe(5);
  });

  it("asks for RPE when API value is out of range", async () => {
    let rpePromptCount = 0;
    mockedCreateInterface.mockReturnValue({
      question: vi.fn(async (prompt: string) => {
        if (prompt.includes("RPE (1-10)")) {
          rpePromptCount += 1;
          return "6";
        }
        return "";
      }),
      close: vi.fn(),
    } as unknown as readlinePromises.Interface);

    const { stdin, stdout } = fakeStreams();
    const doc = await collectSubjectiveInteractive({
      isoWeekId: "2026-W19",
      workoutDetails: [
        {
          id: "550e8400-e29b-41d4-a716-446655440003",
          body: JSON.stringify({ ...baseWorkout, rpe: 11 }),
        },
      ],
      timeZoneId: "America/New_York",
      unit: "metric",
      stdin,
      stdout,
    });

    expect(rpePromptCount).toBe(1);
    expect(doc.runs[0]?.rpe).toBe(6);
  });
});
