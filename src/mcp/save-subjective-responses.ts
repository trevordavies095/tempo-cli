import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { atomicWriteFile } from "../commands/workout-media-download.js";
import { getDefaultSubjectiveFilePath } from "../config/subjective-path.js";
import { normalizeIsoWeekId } from "../weekly-recap/prescribed-week.js";
import {
  getSystemTimeZone,
  isValidIanaTimeZone,
  resolveRecapWeek,
} from "../weekly-recap/resolve-week.js";
import {
  clampOptionalRating,
  filterRunsInRecapRange,
  parseSubjectiveWeek,
  type SubjectiveRunRow,
  type SubjectiveWeekDoc,
  type SubjectiveWeeklyMeta,
} from "../weekly-recap/subjective-week.js";
import { textToolResult } from "./tool-result.js";

export const SAVE_SUBJECTIVE_RESPONSES_TOOL_NAME = "save_subjective_responses";

export const SAVE_SUBJECTIVE_RESPONSES_TOOL_DESCRIPTION =
  "Validate and write subjective-{week}.yaml for a Tempo weekly recap (same schema as the interactive CLI). Call after interviewing the athlete when generate_weekly_recap returned needs_subjective. Then call generate_weekly_recap again for the complete report. Does not call the Tempo API.";

const runRowShape = z.object({
  date: z
    .string()
    .describe("Local calendar date YYYY-MM-DD (must fall in the week Mon–Sun)"),
  rpe: z.number().optional().describe("Optional RPE 1–10"),
  felt: z.number().optional().describe("Optional felt rating 1–10"),
  pain: z.string().optional().describe("Optional pain / niggles text"),
});

const weeklyShape = z
  .object({
    sleep_avg_hrs: z.number().optional(),
    sleep_range_hrs: z
      .tuple([z.number(), z.number()])
      .optional()
      .describe("Optional [low, high] sleep hours"),
    strength_sessions: z
      .object({
        completed: z.number().optional(),
        planned: z.number().optional(),
        notes: z.string().optional(),
      })
      .optional(),
    stress_level: z.string().optional(),
    body_check: z.string().optional(),
    feeling_into_next_week: z.string().optional(),
    questions_for_coach: z.array(z.string()).optional(),
  })
  .optional();

/** Zod shape for MCP `registerTool` inputSchema. */
export const saveSubjectiveResponsesInputShape = {
  week: z
    .string()
    .describe('ISO week id for the file, e.g. "2026-W35" (required)'),
  timezone: z
    .string()
    .optional()
    .describe(
      "IANA timezone used to validate run dates fall in Mon–Sun (default: config or system)",
    ),
  runs: z
    .array(runRowShape)
    .describe(
      "Per-run subjective rows (date-keyed; omit a row if nothing answered for that date)",
    ),
  weekly: weeklyShape.describe(
    "Optional weekly subjective fields (omit entirely if none answered)",
  ),
} as const;

export type SaveSubjectiveResponsesArgs = {
  week: string;
  timezone?: string;
  runs: {
    date: string;
    rpe?: number;
    felt?: number;
    pain?: string;
  }[];
  weekly?: {
    sleep_avg_hrs?: number;
    sleep_range_hrs?: [number, number];
    strength_sessions?: {
      completed?: number;
      planned?: number;
      notes?: string;
    };
    stress_level?: string;
    body_check?: string;
    feeling_into_next_week?: string;
    questions_for_coach?: string[];
  };
};

export type SaveSubjectiveResponsesConfig = {
  subjectiveDir?: string;
  /** Default timezone from config.toml when tool arg omitted. */
  timezone?: string;
  now?: Date;
};

export type SaveSubjectiveResponsesOutcome =
  | { ok: true; path: string; week: string }
  | { ok: false; text: string };

function validateRating(
  label: string,
  n: number | undefined,
): { ok: true; value?: number } | { ok: false; message: string } {
  if (n === undefined) return { ok: true };
  if (!Number.isFinite(n)) {
    return { ok: false, message: `${label} must be a finite number` };
  }
  const clamped = clampOptionalRating(n);
  if (clamped === undefined) {
    return {
      ok: false,
      message: `${label} must be an integer from 1 to 10 (got ${n})`,
    };
  }
  return { ok: true, value: clamped };
}

/**
 * Validate interview answers and write CLI-compatible subjective YAML.
 */
export async function saveSubjectiveResponses(
  config: SaveSubjectiveResponsesConfig,
  args: SaveSubjectiveResponsesArgs,
): Promise<SaveSubjectiveResponsesOutcome> {
  const weekRaw = args.week?.trim() ?? "";
  if (!weekRaw) {
    return {
      ok: false,
      text: 'week is required (ISO week like "2026-W35").',
    };
  }

  let weekNorm: string;
  const weekMatch = /^(\d{4})-W(\d{1,2})$/i.exec(weekRaw);
  if (!weekMatch) {
    return {
      ok: false,
      text: `Invalid week "${weekRaw}". Use YYYY-Www (e.g. 2026-W35).`,
    };
  }
  weekNorm = normalizeIsoWeekId(weekRaw);

  const tzFromArg = args.timezone?.trim();
  const tzFromConfig = config.timezone?.trim();
  const tzCandidate =
    tzFromArg && tzFromArg.length > 0
      ? tzFromArg
      : tzFromConfig && tzFromConfig.length > 0
        ? tzFromConfig
        : "";
  const timeZoneId =
    tzCandidate.length > 0 ? tzCandidate : getSystemTimeZone();
  if (!isValidIanaTimeZone(timeZoneId)) {
    return {
      ok: false,
      text: `Invalid IANA timezone: ${tzCandidate || timeZoneId}`,
    };
  }

  const resolved = resolveRecapWeek({
    weekSpec: weekNorm,
    timeZoneId,
    now: config.now ?? new Date(),
  });
  if (!resolved.ok) {
    return { ok: false, text: resolved.message };
  }

  if (!Array.isArray(args.runs)) {
    return { ok: false, text: "runs must be an array (use [] if none)." };
  }

  const runs: SubjectiveRunRow[] = [];
  for (let i = 0; i < args.runs.length; i++) {
    const row = args.runs[i]!;
    const date = typeof row.date === "string" ? row.date.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return {
        ok: false,
        text: `runs[${i}].date must be YYYY-MM-DD (got ${JSON.stringify(row.date)}).`,
      };
    }

    const rpeV = validateRating(`runs[${i}].rpe`, row.rpe);
    if (!rpeV.ok) return { ok: false, text: rpeV.message };
    const feltV = validateRating(`runs[${i}].felt`, row.felt);
    if (!feltV.ok) return { ok: false, text: feltV.message };

    const pain =
      typeof row.pain === "string" && row.pain.trim()
        ? row.pain.trim()
        : undefined;

    if (
      rpeV.value === undefined &&
      feltV.value === undefined &&
      pain === undefined
    ) {
      // Skip empty rows (same as interactive CLI).
      continue;
    }

    runs.push({
      date,
      rpe: rpeV.value,
      felt: feltV.value,
      pain,
    });
  }

  const inRange = filterRunsInRecapRange(runs, resolved.value);
  if (inRange.length !== runs.length) {
    const { start, end } = resolved.value.localRange;
    const outside = runs
      .filter((r) => r.date < start || r.date > end)
      .map((r) => r.date);
    return {
      ok: false,
      text: `Run date(s) fall outside ${weekNorm} (${start}–${end}): ${outside.join(", ")}.`,
    };
  }

  let weekly: SubjectiveWeeklyMeta | undefined;
  if (args.weekly !== undefined && args.weekly !== null) {
    const w = args.weekly;
    weekly = {};
    if (w.sleep_avg_hrs !== undefined) {
      if (!Number.isFinite(w.sleep_avg_hrs)) {
        return { ok: false, text: "weekly.sleep_avg_hrs must be a finite number" };
      }
      weekly.sleep_avg_hrs = w.sleep_avg_hrs;
    }
    if (w.sleep_range_hrs !== undefined) {
      const [lo, hi] = w.sleep_range_hrs;
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
        return {
          ok: false,
          text: "weekly.sleep_range_hrs must be [low, high] finite numbers",
        };
      }
      weekly.sleep_range_hrs = [lo, hi];
    }
    if (w.strength_sessions !== undefined) {
      const ss = w.strength_sessions;
      weekly.strength_sessions = {};
      if (ss.completed !== undefined) {
        if (!Number.isFinite(ss.completed)) {
          return {
            ok: false,
            text: "weekly.strength_sessions.completed must be a number",
          };
        }
        weekly.strength_sessions.completed = Math.round(ss.completed);
      }
      if (ss.planned !== undefined) {
        if (!Number.isFinite(ss.planned)) {
          return {
            ok: false,
            text: "weekly.strength_sessions.planned must be a number",
          };
        }
        weekly.strength_sessions.planned = Math.round(ss.planned);
      }
      if (typeof ss.notes === "string" && ss.notes.trim()) {
        weekly.strength_sessions.notes = ss.notes.trim();
      }
      if (Object.keys(weekly.strength_sessions).length === 0) {
        delete weekly.strength_sessions;
      }
    }
    if (typeof w.stress_level === "string" && w.stress_level.trim()) {
      weekly.stress_level = w.stress_level.trim();
    }
    if (typeof w.body_check === "string" && w.body_check.trim()) {
      weekly.body_check = w.body_check.trim();
    }
    if (
      typeof w.feeling_into_next_week === "string" &&
      w.feeling_into_next_week.trim()
    ) {
      weekly.feeling_into_next_week = w.feeling_into_next_week.trim();
    }
    if (Array.isArray(w.questions_for_coach)) {
      const qs = w.questions_for_coach
        .filter((q) => typeof q === "string" && q.trim())
        .map((q) => q.trim());
      if (qs.length > 0) weekly.questions_for_coach = qs;
    }
    if (Object.keys(weekly).length === 0) weekly = undefined;
  }

  const doc: SubjectiveWeekDoc = {
    week: weekNorm,
    runs: inRange,
    weekly,
  };

  const yamlText = stringifyYaml(doc);
  const parsed = parseSubjectiveWeek(yamlText, "save_subjective_responses");
  if (!parsed.ok) {
    return {
      ok: false,
      text: `Internal validation failed after build: ${parsed.message}`,
    };
  }

  const path = getDefaultSubjectiveFilePath(weekNorm, config.subjectiveDir);
  try {
    await mkdir(dirname(path), { recursive: true });
    await atomicWriteFile(path, new TextEncoder().encode(yamlText));
  } catch (e) {
    return {
      ok: false,
      text: `Could not write subjective file ${path}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  return { ok: true, path, week: weekNorm };
}

export async function saveSubjectiveResponsesToolResult(
  config: SaveSubjectiveResponsesConfig,
  args: SaveSubjectiveResponsesArgs,
): Promise<CallToolResult> {
  const outcome = await saveSubjectiveResponses(config, args);
  if (!outcome.ok) {
    return textToolResult(outcome.text, { isError: true });
  }
  return textToolResult(
    JSON.stringify(
      {
        ok: true,
        week: outcome.week,
        path: outcome.path,
        message:
          "Subjective YAML saved. Call generate_weekly_recap again for the complete report.",
      },
      null,
      2,
    ),
  );
}
