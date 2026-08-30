import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { atomicWriteFile } from "../commands/workout-media-download.js";
import { getDefaultPrescribedFilePath } from "../config/prescribed-path.js";
import {
  normalizeIsoWeekId,
  parseClockToSeconds,
  parsePrescribedWeekYaml,
} from "../weekly-recap/prescribed-week.js";
import {
  getSystemTimeZone,
  isValidIanaTimeZone,
  resolveRecapWeek,
} from "../weekly-recap/resolve-week.js";
import { textToolResult } from "./tool-result.js";

export const SAVE_PRESCRIBED_WEEK_TOOL_NAME = "save_prescribed_week";

export const SAVE_PRESCRIBED_WEEK_TOOL_DESCRIPTION =
  "Validate and write prescribed-{week}.yaml for a Tempo weekly recap (same schema the CLI reads for quality-vs-prescribed). Call after coaching to persist next week's plan. Requires an explicit ISO week (YYYY-Www); set overwrite: true to replace an existing file. Does not call the Tempo API.";

const paceBoundsShape = z.object({
  min: z.string().describe('Pace min as M:SS (e.g. "8:15")'),
  max: z.string().describe('Pace max as M:SS (e.g. "8:30")'),
});

const hrBoundsShape = z.object({
  min: z.number().describe("HR min bpm"),
  max: z.number().describe("HR max bpm"),
});

const workoutSessionShape = z.object({
  type: z.literal("workout"),
  date: z.string().describe("Local calendar date YYYY-MM-DD (must fall in the week Mon–Sun)"),
  description: z.string().optional(),
  target_pace_per_mi: paceBoundsShape,
  target_hr_bpm: hrBoundsShape,
  reps: z.number().describe("Positive rep count"),
  rep_distance_mi: z.number().describe("Positive distance per rep in miles"),
});

const longRunSessionShape = z.object({
  type: z.literal("long_run"),
  date: z.string().describe("Local calendar date YYYY-MM-DD (must fall in the week Mon–Sun)"),
  description: z.string().optional(),
  target_distance_mi: z.number(),
  target_hr_bpm_max: z.number(),
});

const sessionShape = z.discriminatedUnion("type", [
  workoutSessionShape,
  longRunSessionShape,
]);

/** Zod shape for MCP `registerTool` inputSchema. */
export const savePrescribedWeekInputShape = {
  week: z
    .string()
    .describe('ISO week id for the file, e.g. "2026-W35" (required; no smart default)'),
  overwrite: z
    .boolean()
    .optional()
    .describe(
      "When true, replace an existing prescribed file for this week. Default false — refuse if the file already exists.",
    ),
  timezone: z
    .string()
    .optional()
    .describe(
      "IANA timezone used to validate session dates fall in Mon–Sun (default: config or system)",
    ),
  sessions: z
    .array(sessionShape)
    .describe(
      "Prescribed sessions: type workout (pace/HR/reps) or long_run (distance + HR max)",
    ),
} as const;

export type SavePrescribedWeekSession =
  | {
      type: "workout";
      date: string;
      description?: string;
      target_pace_per_mi: { min: string; max: string };
      target_hr_bpm: { min: number; max: number };
      reps: number;
      rep_distance_mi: number;
    }
  | {
      type: "long_run";
      date: string;
      description?: string;
      target_distance_mi: number;
      target_hr_bpm_max: number;
    };

export type SavePrescribedWeekArgs = {
  week: string;
  overwrite?: boolean;
  timezone?: string;
  sessions: SavePrescribedWeekSession[];
};

export type SavePrescribedWeekConfig = {
  prescribedDir?: string;
  /** Default timezone from config.toml when tool arg omitted. */
  timezone?: string;
  now?: Date;
};

export type SavePrescribedWeekOutcome =
  | { ok: true; path: string; week: string }
  | { ok: false; text: string };

type YamlWorkoutSession = {
  date: string;
  type: "workout";
  description?: string;
  target_pace_per_mi: { min: string; max: string };
  target_hr_bpm: { min: number; max: number };
  reps: number;
  rep_distance_mi: number;
};

type YamlLongRunSession = {
  date: string;
  type: "long_run";
  description?: string;
  target_distance_mi: number;
  target_hr_bpm_max: number;
};

type YamlPrescribedDoc = {
  week: string;
  sessions: (YamlWorkoutSession | YamlLongRunSession)[];
};

/**
 * Validate a coach plan and write CLI-compatible prescribed YAML.
 */
export async function savePrescribedWeek(
  config: SavePrescribedWeekConfig,
  args: SavePrescribedWeekArgs,
): Promise<SavePrescribedWeekOutcome> {
  const weekRaw = args.week?.trim() ?? "";
  if (!weekRaw) {
    return {
      ok: false,
      text: 'week is required (ISO week like "2026-W35").',
    };
  }

  const weekMatch = /^(\d{4})-W(\d{1,2})$/i.exec(weekRaw);
  if (!weekMatch) {
    return {
      ok: false,
      text: `Invalid week "${weekRaw}". Use YYYY-Www (e.g. 2026-W35).`,
    };
  }
  const weekNorm = normalizeIsoWeekId(weekRaw);

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

  if (!Array.isArray(args.sessions)) {
    return { ok: false, text: "sessions must be an array." };
  }
  if (args.sessions.length === 0) {
    return {
      ok: false,
      text: "sessions must contain at least one workout or long_run.",
    };
  }

  const { start, end } = resolved.value.localRange;
  const yamlSessions: YamlPrescribedDoc["sessions"] = [];

  for (let i = 0; i < args.sessions.length; i++) {
    const row = args.sessions[i]!;
    const date = typeof row.date === "string" ? row.date.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return {
        ok: false,
        text: `sessions[${i}].date must be YYYY-MM-DD (got ${JSON.stringify(row.date)}).`,
      };
    }
    if (date < start || date > end) {
      return {
        ok: false,
        text: `Session date(s) fall outside ${weekNorm} (${start}–${end}): ${date}.`,
      };
    }

    const description =
      typeof row.description === "string" && row.description.trim()
        ? row.description.trim()
        : undefined;

    if (row.type === "workout") {
      const paceMin = row.target_pace_per_mi?.min?.trim() ?? "";
      const paceMax = row.target_pace_per_mi?.max?.trim() ?? "";
      const minSec = parseClockToSeconds(paceMin);
      const maxSec = parseClockToSeconds(paceMax);
      if (minSec === undefined || maxSec === undefined || minSec > maxSec) {
        return {
          ok: false,
          text: `sessions[${i}].target_pace_per_mi.min/max (M:SS) is invalid`,
        };
      }
      const hrMin = row.target_hr_bpm?.min;
      const hrMax = row.target_hr_bpm?.max;
      if (
        typeof hrMin !== "number" ||
        typeof hrMax !== "number" ||
        !Number.isFinite(hrMin) ||
        !Number.isFinite(hrMax) ||
        hrMin > hrMax
      ) {
        return {
          ok: false,
          text: `sessions[${i}].target_hr_bpm.min/max must be numbers`,
        };
      }
      if (
        typeof row.reps !== "number" ||
        !Number.isFinite(row.reps) ||
        row.reps < 1
      ) {
        return {
          ok: false,
          text: `sessions[${i}].reps must be a positive number`,
        };
      }
      if (
        typeof row.rep_distance_mi !== "number" ||
        !Number.isFinite(row.rep_distance_mi) ||
        row.rep_distance_mi <= 0
      ) {
        return {
          ok: false,
          text: `sessions[${i}].rep_distance_mi must be a positive number`,
        };
      }
      const session: YamlWorkoutSession = {
        date,
        type: "workout",
        target_pace_per_mi: { min: paceMin, max: paceMax },
        target_hr_bpm: { min: Math.round(hrMin), max: Math.round(hrMax) },
        reps: Math.round(row.reps),
        rep_distance_mi: row.rep_distance_mi,
      };
      if (description !== undefined) session.description = description;
      yamlSessions.push(session);
      continue;
    }

    if (row.type === "long_run") {
      if (
        typeof row.target_distance_mi !== "number" ||
        !Number.isFinite(row.target_distance_mi)
      ) {
        return {
          ok: false,
          text: `sessions[${i}].target_distance_mi must be a number`,
        };
      }
      if (
        typeof row.target_hr_bpm_max !== "number" ||
        !Number.isFinite(row.target_hr_bpm_max)
      ) {
        return {
          ok: false,
          text: `sessions[${i}].target_hr_bpm_max must be a number`,
        };
      }
      const session: YamlLongRunSession = {
        date,
        type: "long_run",
        target_distance_mi: row.target_distance_mi,
        target_hr_bpm_max: Math.round(row.target_hr_bpm_max),
      };
      if (description !== undefined) session.description = description;
      yamlSessions.push(session);
      continue;
    }

    return {
      ok: false,
      text: `sessions[${i}].type must be workout or long_run`,
    };
  }

  const doc: YamlPrescribedDoc = {
    week: weekNorm,
    sessions: yamlSessions,
  };

  const yamlText = stringifyYaml(doc);
  const parsed = parsePrescribedWeekYaml(yamlText);
  if (!parsed.ok) {
    return {
      ok: false,
      text: `Internal validation failed after build: ${parsed.message}`,
    };
  }

  const path = getDefaultPrescribedFilePath(weekNorm, config.prescribedDir);
  if (existsSync(path) && args.overwrite !== true) {
    return {
      ok: false,
      text: `Prescribed file already exists for ${weekNorm} at ${path}. Pass overwrite: true to replace it.`,
    };
  }

  try {
    await mkdir(dirname(path), { recursive: true });
    await atomicWriteFile(path, new TextEncoder().encode(yamlText));
  } catch (e) {
    return {
      ok: false,
      text: `Could not write prescribed file ${path}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  return { ok: true, path, week: weekNorm };
}

export async function savePrescribedWeekToolResult(
  config: SavePrescribedWeekConfig,
  args: SavePrescribedWeekArgs,
): Promise<CallToolResult> {
  const outcome = await savePrescribedWeek(config, args);
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
          "Prescribed YAML saved. Call generate_weekly_recap for that week (once it has runs) to grade quality vs prescribed.",
      },
      null,
      2,
    ),
  );
}
