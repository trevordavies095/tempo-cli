import { createHttpClient } from "../http/client.js";
import { humanLinesFromApiBody } from "../output/human-api-body.js";
import { redactApiKeyInText } from "./auth-me.js";

export const STATS_WEEKLY_PATH = "/stats/weekly";

const BODY_SNIP_LEN = 500;
const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

/** Query params for GET /stats/weekly (OpenAPI names); omit unset fields so the server applies defaults. */
export type StatsWeeklyQuery = {
  timezoneOffsetMinutes?: number;
};

export type StatsWeeklyOk = {
  kind: "ok";
  status: number;
  body: string;
};

export type StatsWeeklyHttpError = {
  kind: "http";
  status: number;
  body: string;
};

export type StatsWeeklyTransport = {
  kind: "transport";
  error: unknown;
};

export type StatsWeeklyResult =
  | StatsWeeklyOk
  | StatsWeeklyHttpError
  | StatsWeeklyTransport;

function truncateForMessage(body: string): string {
  const t = body.trim();
  if (t.length <= BODY_SNIP_LEN) return t;
  return `${t.slice(0, BODY_SNIP_LEN)}…`;
}

export function buildStatsWeeklyPath(params: StatsWeeklyQuery = {}): string {
  const q = new URLSearchParams();
  if (params.timezoneOffsetMinutes !== undefined) {
    q.set("timezoneOffsetMinutes", String(params.timezoneOffsetMinutes));
  }
  const qs = q.toString();
  return qs ? `${STATS_WEEKLY_PATH}?${qs}` : STATS_WEEKLY_PATH;
}

/** GET /stats/weekly with Bearer apiKey (caller must pass non-empty key). */
export async function probeStatsWeekly(
  baseUrl: string,
  apiKey: string,
  params: StatsWeeklyQuery = {},
): Promise<StatsWeeklyResult> {
  const client = createHttpClient({ baseUrl, apiKey });
  const path = buildStatsWeeklyPath(params);
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

export function statsWeeklyHttpErrorMessage(
  status: number,
  body: string,
  params: StatsWeeklyQuery = {},
): string {
  const snip = truncateForMessage(body);
  const suffix = snip ? `: ${snip}` : "";
  return `GET ${buildStatsWeeklyPath(params)} returned ${status}${suffix}`;
}

export function statsWeeklyHttpErrorMessageForCli(
  status: number,
  body: string,
  apiKey: string,
  params: StatsWeeklyQuery = {},
): string {
  return statsWeeklyHttpErrorMessage(
    status,
    redactApiKeyInText(body, apiKey),
    params,
  );
}

export function statsWeeklyHumanSuccessLine(
  status: number,
  body: string,
): string {
  const block = humanLinesFromApiBody(body);
  if (!block) return `OK (HTTP ${status})`;
  return `OK (HTTP ${status})\n${block}`;
}

export type StatsWeeklyCliRawOpts = {
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
      error: `tempo stats weekly: ${label} must be an integer (int32)`,
    };
  }
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < INT32_MIN || n > INT32_MAX) {
    return {
      error: `tempo stats weekly: ${label} must be within int32 range`,
    };
  }
  return { value: n };
}

/**
 * Validates CLI flag strings and builds {@link StatsWeeklyQuery} for the API.
 */
export function statsWeeklyQueryFromCli(
  opts: StatsWeeklyCliRawOpts,
): { ok: StatsWeeklyQuery } | { error: string } {
  const tz = parseOptionalSignedInt32(
    "timezone-offset-minutes",
    opts.timezoneOffsetMinutes,
  );
  if ("error" in tz) return tz;
  const query: StatsWeeklyQuery = {};
  if (tz.value !== undefined) query.timezoneOffsetMinutes = tz.value;
  return { ok: query };
}
