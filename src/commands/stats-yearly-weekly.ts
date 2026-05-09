import { createHttpClient } from "../http/client.js";
import { humanLinesFromApiBody } from "../output/human-api-body.js";
import { redactApiKeyInText } from "./auth-me.js";

export const STATS_YEARLY_WEEKLY_PATH = "/stats/yearly-weekly";

const BODY_SNIP_LEN = 500;
const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

/** Query params for GET /stats/yearly-weekly (OpenAPI names); omit unset fields so the server applies defaults. */
export type StatsYearlyWeeklyQuery = {
  periodEndDate?: string;
  timezoneOffsetMinutes?: number;
};

export type StatsYearlyWeeklyOk = {
  kind: "ok";
  status: number;
  body: string;
};

export type StatsYearlyWeeklyHttpError = {
  kind: "http";
  status: number;
  body: string;
};

export type StatsYearlyWeeklyTransport = {
  kind: "transport";
  error: unknown;
};

export type StatsYearlyWeeklyResult =
  | StatsYearlyWeeklyOk
  | StatsYearlyWeeklyHttpError
  | StatsYearlyWeeklyTransport;

function truncateForMessage(body: string): string {
  const t = body.trim();
  if (t.length <= BODY_SNIP_LEN) return t;
  return `${t.slice(0, BODY_SNIP_LEN)}…`;
}

export function buildStatsYearlyWeeklyPath(
  params: StatsYearlyWeeklyQuery = {},
): string {
  const q = new URLSearchParams();
  if (params.periodEndDate !== undefined) {
    q.set("periodEndDate", params.periodEndDate);
  }
  if (params.timezoneOffsetMinutes !== undefined) {
    q.set("timezoneOffsetMinutes", String(params.timezoneOffsetMinutes));
  }
  const qs = q.toString();
  return qs
    ? `${STATS_YEARLY_WEEKLY_PATH}?${qs}`
    : STATS_YEARLY_WEEKLY_PATH;
}

/** GET /stats/yearly-weekly with Bearer apiKey (caller must pass non-empty key). */
export async function probeStatsYearlyWeekly(
  baseUrl: string,
  apiKey: string,
  params: StatsYearlyWeeklyQuery = {},
): Promise<StatsYearlyWeeklyResult> {
  const client = createHttpClient({ baseUrl, apiKey });
  const path = buildStatsYearlyWeeklyPath(params);
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

export function statsYearlyWeeklyHttpErrorMessage(
  status: number,
  body: string,
  params: StatsYearlyWeeklyQuery = {},
): string {
  const snip = truncateForMessage(body);
  const suffix = snip ? `: ${snip}` : "";
  return `GET ${buildStatsYearlyWeeklyPath(params)} returned ${status}${suffix}`;
}

export function statsYearlyWeeklyHttpErrorMessageForCli(
  status: number,
  body: string,
  apiKey: string,
  params: StatsYearlyWeeklyQuery = {},
): string {
  return statsYearlyWeeklyHttpErrorMessage(
    status,
    redactApiKeyInText(body, apiKey),
    params,
  );
}

export function statsYearlyWeeklyHumanSuccessLine(
  status: number,
  body: string,
): string {
  const block = humanLinesFromApiBody(body);
  if (!block) return `OK (HTTP ${status})`;
  return `OK (HTTP ${status})\n${block}`;
}

export type StatsYearlyWeeklyCliRawOpts = {
  periodEndDate?: string;
  timezoneOffsetMinutes?: string;
};

function parseOptionalSignedInt32(
  label: string,
  raw: string | undefined,
): { value: number | undefined } | { error: string } {
  if (raw === undefined || raw.trim() === "") return { value: undefined };
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return {
      error: `tempo stats yearly-weekly: ${label} must be an integer (int32)`,
    };
  }
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < INT32_MIN || n > INT32_MAX) {
    return {
      error: `tempo stats yearly-weekly: ${label} must be within int32 range`,
    };
  }
  return { value: n };
}

/**
 * Validates CLI flag strings and builds {@link StatsYearlyWeeklyQuery} for the API.
 */
export function statsYearlyWeeklyQueryFromCli(
  opts: StatsYearlyWeeklyCliRawOpts,
): { ok: StatsYearlyWeeklyQuery } | { error: string } {
  const query: StatsYearlyWeeklyQuery = {};

  if (opts.periodEndDate !== undefined && opts.periodEndDate.trim() !== "") {
    query.periodEndDate = opts.periodEndDate.trim();
  }

  const tz = parseOptionalSignedInt32(
    "timezone-offset-minutes",
    opts.timezoneOffsetMinutes,
  );
  if ("error" in tz) return tz;
  if (tz.value !== undefined) query.timezoneOffsetMinutes = tz.value;

  return { ok: query };
}
