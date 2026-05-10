import { createHttpClient } from "../http/client.js";
import { humanLinesFromApiBody } from "../output/human-api-body.js";
import {
  formatFieldLines,
  isPlainObject,
  pickFirst,
} from "../output/human-summary.js";
import { redactApiKeyInText } from "./auth-me.js";

export const STATS_WEEKLY_RECAP_PATH = "/stats/weekly-recap";

const BODY_SNIP_LEN = 500;
const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

const REFERENCE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Query params for GET /stats/weekly-recap (OpenAPI names); omit unset fields so the server applies defaults. */
export type StatsWeeklyRecapQuery = {
  timezoneOffsetMinutes?: number;
  /** yyyy-MM-dd — selects the Monday–Sunday week treated as current */
  referenceDate?: string;
};

export type StatsWeeklyRecapOk = {
  kind: "ok";
  status: number;
  body: string;
};

export type StatsWeeklyRecapHttpError = {
  kind: "http";
  status: number;
  body: string;
};

export type StatsWeeklyRecapTransport = {
  kind: "transport";
  error: unknown;
};

export type StatsWeeklyRecapResult =
  | StatsWeeklyRecapOk
  | StatsWeeklyRecapHttpError
  | StatsWeeklyRecapTransport;

function truncateForMessage(body: string): string {
  const t = body.trim();
  if (t.length <= BODY_SNIP_LEN) return t;
  return `${t.slice(0, BODY_SNIP_LEN)}…`;
}

export function buildStatsWeeklyRecapPath(
  params: StatsWeeklyRecapQuery = {},
): string {
  const q = new URLSearchParams();
  if (params.timezoneOffsetMinutes !== undefined) {
    q.set("timezoneOffsetMinutes", String(params.timezoneOffsetMinutes));
  }
  if (params.referenceDate !== undefined) {
    q.set("referenceDate", params.referenceDate);
  }
  const qs = q.toString();
  return qs
    ? `${STATS_WEEKLY_RECAP_PATH}?${qs}`
    : STATS_WEEKLY_RECAP_PATH;
}

/** GET /stats/weekly-recap with Bearer apiKey (caller must pass non-empty key). */
export async function probeStatsWeeklyRecap(
  baseUrl: string,
  apiKey: string,
  params: StatsWeeklyRecapQuery = {},
): Promise<StatsWeeklyRecapResult> {
  const client = createHttpClient({ baseUrl, apiKey });
  const path = buildStatsWeeklyRecapPath(params);
  try {
    const response = await client.get(path);
    const body = await response.text();
    if (response.ok) {
      return { kind: "ok", status: response.status, body };
    }
    return { kind: "http", status: response.status, body };
  } catch (error) {
    return { kind: "transport", error };
  }
}

export function statsWeeklyRecapHttpErrorMessage(
  status: number,
  body: string,
  params: StatsWeeklyRecapQuery = {},
): string {
  const snip = truncateForMessage(body);
  const suffix = snip ? `: ${snip}` : "";
  return `GET ${buildStatsWeeklyRecapPath(params)} returned ${status}${suffix}`;
}

export function statsWeeklyRecapHttpErrorMessageForCli(
  status: number,
  body: string,
  apiKey: string,
  params: StatsWeeklyRecapQuery = {},
): string {
  return statsWeeklyRecapHttpErrorMessage(
    status,
    redactApiKeyInText(body, apiKey),
    params,
  );
}

const WEEKLY_RECAP_TOP_FIELDS = [
  ["weekStart", "weekStart", "WeekStart"],
  ["weekEnd", "weekEnd", "WeekEnd"],
  ["referenceDate", "referenceDate", "ReferenceDate"],
  ["currentWeekIsPartial", "currentWeekIsPartial", "CurrentWeekIsPartial"],
  ["generatedAtUtc", "generatedAtUtc", "GeneratedAtUtc"],
] as const;

export function statsWeeklyRecapHumanSuccessLine(
  status: number,
  body: string,
): string {
  const header = `OK (HTTP ${status})`;
  const trimmed = body.trim();
  if (!trimmed) return header;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isPlainObject(parsed)) {
      const lines = formatFieldLines(parsed, WEEKLY_RECAP_TOP_FIELDS);
      const metrics = pickFirst(parsed, ["metrics", "Metrics"]);
      if (isPlainObject(metrics)) {
        lines.push(`metrics: ${Object.keys(metrics).length} blocks`);
      }
      if (lines.length > 0) {
        return `${header}\n${lines.join("\n")}`;
      }
    }
  } catch {
    /* fall through */
  }
  const block = humanLinesFromApiBody(body);
  if (!block) return header;
  return `${header}\n${block}`;
}

export type StatsWeeklyRecapCliRawOpts = {
  timezoneOffsetMinutes?: string;
  referenceDate?: string;
};

function parseOptionalSignedInt32(
  label: string,
  raw: string | undefined,
  prefix: string,
): { value: number | undefined } | { error: string } {
  if (raw === undefined || raw.trim() === "") return { value: undefined };
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return {
      error: `${prefix}: ${label} must be an integer (int32)`,
    };
  }
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < INT32_MIN || n > INT32_MAX) {
    return {
      error: `${prefix}: ${label} must be within int32 range`,
    };
  }
  return { value: n };
}

function parseOptionalReferenceDate(
  raw: string | undefined,
  prefix: string,
): { value: string | undefined } | { error: string } {
  if (raw === undefined || raw.trim() === "") return { value: undefined };
  const t = raw.trim();
  if (!REFERENCE_DATE_RE.test(t)) {
    return {
      error: `${prefix}: reference-date must be YYYY-MM-DD`,
    };
  }
  return { value: t };
}

const STATS_WEEKLY_RECAP_CLI_PREFIX = "tempo stats weekly-recap";

/**
 * Validates CLI flag strings and builds {@link StatsWeeklyRecapQuery} for the API.
 */
export function statsWeeklyRecapQueryFromCli(
  opts: StatsWeeklyRecapCliRawOpts,
): { ok: StatsWeeklyRecapQuery } | { error: string } {
  const tz = parseOptionalSignedInt32(
    "timezone-offset-minutes",
    opts.timezoneOffsetMinutes,
    STATS_WEEKLY_RECAP_CLI_PREFIX,
  );
  if ("error" in tz) return tz;
  const rd = parseOptionalReferenceDate(
    opts.referenceDate,
    STATS_WEEKLY_RECAP_CLI_PREFIX,
  );
  if ("error" in rd) return rd;
  const query: StatsWeeklyRecapQuery = {};
  if (tz.value !== undefined) query.timezoneOffsetMinutes = tz.value;
  if (rd.value !== undefined) query.referenceDate = rd.value;
  return { ok: query };
}
