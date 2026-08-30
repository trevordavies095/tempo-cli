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
import { parseSubjectiveWeek } from "../weekly-recap/subjective-week.js";
import { textToolResult } from "./tool-result.js";

export const GENERATE_WEEKLY_RECAP_TOOL_NAME = "generate_weekly_recap";

export const GENERATE_WEEKLY_RECAP_TOOL_DESCRIPTION =
  "Generate the Tempo weekly recap markdown report for a Mon–Sun week (same engine as `tempo weekly-recap`). Optional week (last|current|YYYY-Www|YYYY-MM-DD; omit for smart default), timezone, include_trends, and skip_subjective. When subjective YAML is missing and skip_subjective is false, still returns the report with a warning (interactive gate comes later). Prefer skip_subjective: true for a quick check-in. Result is JSON text with reportMarkdown plus metadata.";

export const MISSING_SUBJECTIVE_WARNING =
  "Subjective data missing for this week; report generated without subjective sections. Pass skip_subjective: true to suppress this notice.";

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
      "Skip subjective YAML and omit subjective sections. Default false; when false and no file exists, report still generates with a warning.",
    ),
} as const;

export type GenerateWeeklyRecapArgs = {
  week?: string;
  timezone?: string;
  include_trends?: boolean;
  skip_subjective?: boolean;
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
  week: string;
  timezone: string;
  subjective: "skipped" | "present" | "missing";
  prescribed: boolean;
  trends: boolean;
  warnings: string[];
  reportMarkdown: string;
};

export type GenerateWeeklyRecapOutcome =
  | { ok: true; envelope: GenerateWeeklyRecapEnvelope }
  | { ok: false; text: string; taxonomy: string };

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

async function resolveSubjectiveSource(args: {
  skipSubjective: boolean;
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
 * Run the weekly recap for MCP. Stream-free; returns envelope or error text.
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
  const subjective = await resolveSubjectiveSource({
    skipSubjective,
    isoWeekId: resolvedEarly.value.isoWeekId,
    subjectiveDir: config.subjectiveDir,
  });

  const result = await runWeeklyRecap({
    baseUrl,
    apiKey: key,
    weekSpec,
    timeZoneId,
    format: "markdown",
    includeTrends,
    prescribedDir: config.prescribedDir,
    cacheDirConfig: config.cacheDir,
    subjective,
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

  const warnings = [...result.warnings];
  if (result.subjectiveState === "missing") {
    const already = warnings.some((w) =>
      w.includes("Subjective data missing for this week"),
    );
    if (!already) {
      warnings.push(MISSING_SUBJECTIVE_WARNING);
    }
  }

  const envelope: GenerateWeeklyRecapEnvelope = {
    week: result.resolved.isoWeekId,
    timezone: result.timeZoneId,
    subjective: result.subjectiveState,
    prescribed: prescribedIncluded(result.jsonBody.prescribed),
    trends: trendsIncluded(result.jsonBody.trends, includeTrends),
    warnings,
    reportMarkdown: result.humanSuccessBody,
  };

  return { ok: true, envelope };
}

export async function generateWeeklyRecapToolResult(
  config: GenerateWeeklyRecapConfig,
  args: GenerateWeeklyRecapArgs = {},
): Promise<CallToolResult> {
  const outcome = await generateWeeklyRecap(config, args);
  if (!outcome.ok) {
    return textToolResult(outcome.text, { isError: true });
  }
  return textToolResult(JSON.stringify(outcome.envelope, null, 2));
}
