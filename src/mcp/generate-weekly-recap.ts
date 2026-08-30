import { readFile } from "node:fs/promises";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { redactApiKeyInText } from "../commands/auth-me.js";
import { getDefaultSubjectiveFilePath } from "../config/subjective-path.js";
import {
  EXIT_AUTH,
  EXIT_NOT_FOUND,
  EXIT_SERVER_ERROR,
  exitCodeForHttpStatus,
} from "../exit/exits.js";
import { isPlainObject, pickFirst } from "../output/human-summary.js";
import {
  formatDistanceDm,
  formatDuration,
} from "../weekly-recap/markdown-report.js";
import type { RecapUnitPreference } from "../weekly-recap/recap-settings.js";
import {
  getSystemTimeZone,
  isValidIanaTimeZone,
  resolveDefaultRecapWeekSpec,
  resolveRecapWeek,
} from "../weekly-recap/resolve-week.js";
import {
  runWeeklyRecap,
  type SubjectiveSource,
} from "../weekly-recap/run-weekly-recap.js";
import { extractApiRpe } from "../weekly-recap/subjective-interactive.js";
import {
  parseSubjectiveWeek,
  workoutLocalDate,
} from "../weekly-recap/subjective-week.js";
import { textToolResult } from "./tool-result.js";

export const GENERATE_WEEKLY_RECAP_TOOL_NAME = "generate_weekly_recap";

export const GENERATE_WEEKLY_RECAP_TOOL_DESCRIPTION =
  "Generate the Tempo weekly recap markdown report for a Mon–Sun week (same engine as `tempo weekly-recap`). Optional week (last|current|YYYY-Www|YYYY-MM-DD; omit for smart default), timezone, include_trends, skip_subjective, and refresh_subjective. When subjective YAML is missing (or refresh_subjective is true) and skip_subjective is false, returns status needs_subjective with the week's runs and questionnaire instead of a report — interview the user, call save_subjective_responses, then call this tool again. Prefer skip_subjective: true for a quick check-in without the interview.";

/** Zod shape for MCP `registerTool` inputSchema. */
export const generateWeeklyRecapInputShape = {
  week: z
    .string()
    .optional()
    .describe(
      'Which week: omit for smart default (Sat–Sun → current, Mon → last completed, Tue–Fri → current), or "last", "current", YYYY-Www, or YYYY-MM-DD',
    ),
  timezone: z
    .string()
    .optional()
    .describe(
      "IANA timezone for Mon–Sun boundaries (default: config timezone or system)",
    ),
  include_trends: z
    .boolean()
    .optional()
    .describe(
      "Include rolling trends section (extra workouts fetch). Default from config [report].include_trends or true.",
    ),
  skip_subjective: z
    .boolean()
    .optional()
    .describe(
      "Skip subjective YAML and omit subjective sections. Bypasses the needs_subjective gate.",
    ),
  refresh_subjective: z
    .boolean()
    .optional()
    .describe(
      "Re-open the subjective interview even when a subjective file already exists for the week (mirrors CLI --refresh-subjective).",
    ),
} as const;

export type GenerateWeeklyRecapArgs = {
  week?: string;
  timezone?: string;
  include_trends?: boolean;
  skip_subjective?: boolean;
  refresh_subjective?: boolean;
};

export type GenerateWeeklyRecapConfig = {
  baseUrl: string;
  apiKey?: string;
  /** Default timezone from config.toml when tool arg omitted. */
  timezone?: string;
  includeTrendsDefault?: boolean;
  prescribedDir?: string;
  subjectiveDir?: string;
  cacheDir?: string;
  now?: Date;
};

export type GenerateWeeklyRecapEnvelope = {
  status: "report";
  week: string;
  timezone: string;
  subjective: "skipped" | "present" | "missing";
  prescribed: boolean;
  trends: boolean;
  warnings: string[];
  reportMarkdown: string;
};

export type NeedsSubjectiveRun = {
  id: string;
  date: string | null;
  runType: string | null;
  distance: string | null;
  duration: string | null;
  apiRpe: number | null;
};

export type NeedsSubjectivePayload = {
  status: "needs_subjective";
  week: string;
  timezone: string;
  localRange: { start: string; end: string };
  subjectivePath: string;
  /** YAML is date-keyed (last write wins). Prefer one interview answer per calendar date. */
  note: string;
  runs: NeedsSubjectiveRun[];
  questionnaire: {
    order: string[];
    per_run: {
      rpe: string;
      felt: string;
      pain: string;
    };
    weekly: {
      sleep_avg_hrs: string;
      sleep_range_hrs: string;
      strength_sessions: string;
      stress_level: string;
      body_check: string;
      feeling_into_next_week: string;
      questions_for_coach: string;
    };
    all_fields_optional: true;
  };
};

export type GenerateWeeklyRecapOutcome =
  | { ok: true; kind: "report"; envelope: GenerateWeeklyRecapEnvelope }
  | { ok: true; kind: "needs_subjective"; payload: NeedsSubjectivePayload }
  | { ok: false; text: string; taxonomy: string };

export const SUBJECTIVE_QUESTIONNAIRE: NeedsSubjectivePayload["questionnaire"] =
  {
    order: [
      "per_run (RPE, Felt, Pain for each calendar date)",
      "weekly (sleep, strength, stress, body, feeling)",
      "questions_for_coach",
    ],
    per_run: {
      rpe: "Optional integer 1–10. If apiRpe is set on the run, prefer that value and do not re-ask unless the athlete corrects it.",
      felt: "Optional integer 1–10 (how the run felt).",
      pain: "Optional free-text niggles / pain (or omit).",
    },
    weekly: {
      sleep_avg_hrs: "Optional average sleep hours this week.",
      sleep_range_hrs: "Optional [low, high] sleep hours.",
      strength_sessions:
        "Optional { completed, planned, notes } for strength work.",
      stress_level: "Optional free-text stress level.",
      body_check: "Optional free-text body check.",
      feeling_into_next_week: "Optional free-text outlook.",
      questions_for_coach: "Optional string array of questions for the coach.",
    },
    all_fields_optional: true,
  };

function prescribedIncluded(prescribed: unknown): boolean {
  if (prescribed === null || typeof prescribed !== "object") return false;
  const p = prescribed as Record<string, unknown>;
  if (p.loaded !== true) return false;
  if (typeof p.parseError === "string" && p.parseError.length > 0) return false;
  return Array.isArray(p.sessions);
}

function trendsIncluded(trends: unknown, includeTrendsFlag: boolean): boolean {
  if (!includeTrendsFlag) return false;
  if (trends === null || typeof trends !== "object") return includeTrendsFlag;
  return (trends as { included?: boolean }).included === true;
}

function parseJsonObject(body: string): Record<string, unknown> | undefined {
  const t = body.trim();
  if (!t) return undefined;
  try {
    const v = JSON.parse(t) as unknown;
    return isPlainObject(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

function sortDetailsByStart(
  details: readonly { id: string; body: string }[],
  timeZoneId: string,
): { id: string; body: string }[] {
  return [...details].sort((a, b) => {
    const wa = parseJsonObject(a.body);
    const wb = parseJsonObject(b.body);
    const sa =
      wa && typeof pickFirst(wa, ["startedAt", "StartedAt"]) === "string"
        ? Date.parse(
            (pickFirst(wa, ["startedAt", "StartedAt"]) as string).trim(),
          )
        : 0;
    const sb =
      wb && typeof pickFirst(wb, ["startedAt", "StartedAt"]) === "string"
        ? Date.parse(
            (pickFirst(wb, ["startedAt", "StartedAt"]) as string).trim(),
          )
        : 0;
    const aMs = Number.isFinite(sa) ? sa : 0;
    const bMs = Number.isFinite(sb) ? sb : 0;
    if (aMs !== bMs) return aMs - bMs;
    return a.id.localeCompare(b.id);
  });
}

export function buildNeedsSubjectiveRuns(
  workoutDetails: readonly { id: string; body: string }[],
  timeZoneId: string,
  unit: RecapUnitPreference,
): NeedsSubjectiveRun[] {
  const ordered = sortDetailsByStart(workoutDetails, timeZoneId);
  const runs: NeedsSubjectiveRun[] = [];
  for (const d of ordered) {
    const w = parseJsonObject(d.body);
    if (!w) {
      runs.push({
        id: d.id,
        date: null,
        runType: null,
        distance: null,
        duration: null,
        apiRpe: null,
      });
      continue;
    }
    const startedRaw = pickFirst(w, ["startedAt", "StartedAt"]);
    const startedAt =
      typeof startedRaw === "string" && startedRaw.trim()
        ? startedRaw.trim()
        : undefined;
    const date = startedAt
      ? (workoutLocalDate(startedAt, timeZoneId) ?? null)
      : null;
    const runTypeRaw = pickFirst(w, ["runType", "RunType"]);
    const runType =
      typeof runTypeRaw === "string" && runTypeRaw.trim()
        ? runTypeRaw.trim()
        : null;
    const dm = pickFirst(w, ["distanceM", "Distance"]);
    const distanceM =
      typeof dm === "number" && Number.isFinite(dm) ? dm : undefined;
    const ds = pickFirst(w, ["durationS", "Duration"]);
    const durationS =
      typeof ds === "number" && Number.isFinite(ds) ? ds : undefined;
    const apiRpe = extractApiRpe(w) ?? null;
    runs.push({
      id: d.id,
      date,
      runType,
      distance:
        distanceM !== undefined ? formatDistanceDm(distanceM, unit) : null,
      duration: durationS !== undefined ? formatDuration(durationS) : null,
      apiRpe,
    });
  }
  return runs;
}

async function resolveSubjectiveSource(args: {
  skipSubjective: boolean;
  refreshSubjective: boolean;
  isoWeekId: string;
  subjectiveDir?: string;
}): Promise<SubjectiveSource> {
  if (args.skipSubjective) {
    return { kind: "skipped" };
  }

  const path = getDefaultSubjectiveFilePath(
    args.isoWeekId,
    args.subjectiveDir,
  );

  if (args.refreshSubjective) {
    return { kind: "absent", path };
  }

  let raw: string | undefined;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return { kind: "absent", path };
  }

  if (!raw.trim()) {
    return { kind: "absent", path };
  }

  const parsed = parseSubjectiveWeek(raw, path);
  if (!parsed.ok) {
    return { kind: "absent", path, parseError: parsed.message };
  }

  return {
    kind: "provided",
    path,
    doc: parsed.value,
    loadedFromFile: true,
    interactiveSaved: false,
    source: "file",
  };
}

/**
 * Run the weekly recap for MCP. Stream-free; returns report, needs_subjective, or error.
 */
export async function generateWeeklyRecap(
  config: GenerateWeeklyRecapConfig,
  args: GenerateWeeklyRecapArgs = {},
): Promise<GenerateWeeklyRecapOutcome> {
  const baseUrl = config.baseUrl.trim();
  const key = config.apiKey?.trim();
  if (!key) {
    return {
      ok: false,
      taxonomy: "usage",
      text: [
        "No API key is configured.",
        "Set TEMPO_API_KEY, api_key in config.toml, or pass --api-key when starting tempo mcp.",
      ].join(" "),
    };
  }

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
      taxonomy: "usage",
      text: `Invalid IANA timezone: ${tzCandidate || timeZoneId}`,
    };
  }

  const now = config.now ?? new Date();
  const weekFromArg = args.week?.trim() ?? "";
  const weekSpec =
    weekFromArg.length > 0
      ? weekFromArg
      : resolveDefaultRecapWeekSpec(now, timeZoneId);

  const resolvedEarly = resolveRecapWeek({
    weekSpec,
    timeZoneId,
    now,
  });
  if (!resolvedEarly.ok) {
    return {
      ok: false,
      taxonomy: "usage",
      text: resolvedEarly.message,
    };
  }

  const includeTrends =
    args.include_trends !== undefined
      ? args.include_trends
      : (config.includeTrendsDefault ?? true);

  const skipSubjective = args.skip_subjective === true;
  const refreshSubjective = args.refresh_subjective === true;
  const subjective = await resolveSubjectiveSource({
    skipSubjective,
    refreshSubjective,
    isoWeekId: resolvedEarly.value.isoWeekId,
    subjectiveDir: config.subjectiveDir,
  });

  const shouldGate =
    !skipSubjective &&
    (refreshSubjective || subjective.kind === "absent");

  const result = await runWeeklyRecap({
    baseUrl,
    apiKey: key,
    weekSpec,
    timeZoneId,
    format: "markdown",
    includeTrends: shouldGate ? false : includeTrends,
    prescribedDir: config.prescribedDir,
    cacheDirConfig: config.cacheDir,
    subjective: shouldGate
      ? {
          kind: "absent",
          path:
            subjective.kind === "skipped"
              ? getDefaultSubjectiveFilePath(
                  resolvedEarly.value.isoWeekId,
                  config.subjectiveDir,
                )
              : subjective.path,
          parseError:
            subjective.kind === "absent" ? subjective.parseError : undefined,
        }
      : subjective,
    subjectiveGate: shouldGate,
    now,
  });

  if (!result.ok) {
    let taxonomy = "usage";
    if (result.exit !== "usage") {
      if ("httpStatus" in result.exit) {
        const code = exitCodeForHttpStatus(result.exit.httpStatus);
        if (code === EXIT_AUTH) taxonomy = "auth";
        else if (code === EXIT_NOT_FOUND) taxonomy = "not_found";
        else if (code === EXIT_SERVER_ERROR) taxonomy = "server";
        else taxonomy = "usage";
      } else {
        taxonomy = "transport";
      }
    }
    return {
      ok: false,
      taxonomy,
      text: redactApiKeyInText(result.message, key),
    };
  }

  if (result.status === "needs_subjective") {
    const payload: NeedsSubjectivePayload = {
      status: "needs_subjective",
      week: result.resolved.isoWeekId,
      timezone: result.timeZoneId,
      localRange: result.resolved.localRange,
      subjectivePath: result.subjectivePath,
      note: "Subjective YAML is date-keyed (one row per YYYY-MM-DD; last write wins for same-day doubles). Interview once per calendar date, then call save_subjective_responses.",
      runs: buildNeedsSubjectiveRuns(
        result.workoutDetails,
        result.timeZoneId,
        result.unit,
      ),
      questionnaire: SUBJECTIVE_QUESTIONNAIRE,
    };
    return { ok: true, kind: "needs_subjective", payload };
  }

  const envelope: GenerateWeeklyRecapEnvelope = {
    status: "report",
    week: result.resolved.isoWeekId,
    timezone: result.timeZoneId,
    subjective: result.subjectiveState,
    prescribed: prescribedIncluded(result.jsonBody.prescribed),
    trends: trendsIncluded(result.jsonBody.trends, includeTrends),
    warnings: [...result.warnings],
    reportMarkdown: result.humanSuccessBody,
  };

  return { ok: true, kind: "report", envelope };
}

export async function generateWeeklyRecapToolResult(
  config: GenerateWeeklyRecapConfig,
  args: GenerateWeeklyRecapArgs = {},
): Promise<CallToolResult> {
  const outcome = await generateWeeklyRecap(config, args);
  if (!outcome.ok) {
    return textToolResult(outcome.text, { isError: true });
  }
  if (outcome.kind === "needs_subjective") {
    return textToolResult(JSON.stringify(outcome.payload, null, 2));
  }
  return textToolResult(JSON.stringify(outcome.envelope, null, 2));
}
