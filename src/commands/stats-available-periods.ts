import { createHttpClient } from "../http/client.js";
import { humanLinesFromApiBody } from "../output/human-api-body.js";
import { redactApiKeyInText } from "./auth-me.js";

export const STATS_AVAILABLE_PERIODS_PATH = "/stats/available-periods";

const BODY_SNIP_LEN = 500;
const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

/** Query params for GET /stats/available-periods (OpenAPI names); omit unset fields so the server applies defaults. */
export type StatsAvailablePeriodsQuery = {
  timezoneOffsetMinutes?: number;
};

export type StatsAvailablePeriodsOk = {
  kind: "ok";
  status: number;
  body: string;
};

export type StatsAvailablePeriodsHttpError = {
  kind: "http";
  status: number;
  body: string;
};

export type StatsAvailablePeriodsTransport = {
  kind: "transport";
  error: unknown;
};

export type StatsAvailablePeriodsResult =
  | StatsAvailablePeriodsOk
  | StatsAvailablePeriodsHttpError
  | StatsAvailablePeriodsTransport;

function truncateForMessage(body: string): string {
  const t = body.trim();
  if (t.length <= BODY_SNIP_LEN) return t;
  return `${t.slice(0, BODY_SNIP_LEN)}…`;
}

export function buildStatsAvailablePeriodsPath(
  params: StatsAvailablePeriodsQuery = {},
): string {
  const q = new URLSearchParams();
  if (params.timezoneOffsetMinutes !== undefined) {
    q.set("timezoneOffsetMinutes", String(params.timezoneOffsetMinutes));
  }
  const qs = q.toString();
  return qs
    ? `${STATS_AVAILABLE_PERIODS_PATH}?${qs}`
    : STATS_AVAILABLE_PERIODS_PATH;
}

/** GET /stats/available-periods with Bearer apiKey (caller must pass non-empty key). */
export async function probeStatsAvailablePeriods(
  baseUrl: string,
  apiKey: string,
  params: StatsAvailablePeriodsQuery = {},
): Promise<StatsAvailablePeriodsResult> {
  const client = createHttpClient({ baseUrl, apiKey });
  const path = buildStatsAvailablePeriodsPath(params);
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

export function statsAvailablePeriodsHttpErrorMessage(
  status: number,
  body: string,
  params: StatsAvailablePeriodsQuery = {},
): string {
  const snip = truncateForMessage(body);
  const suffix = snip ? `: ${snip}` : "";
  return `GET ${buildStatsAvailablePeriodsPath(params)} returned ${status}${suffix}`;
}

export function statsAvailablePeriodsHttpErrorMessageForCli(
  status: number,
  body: string,
  apiKey: string,
  params: StatsAvailablePeriodsQuery = {},
): string {
  return statsAvailablePeriodsHttpErrorMessage(
    status,
    redactApiKeyInText(body, apiKey),
    params,
  );
}

export function statsAvailablePeriodsHumanSuccessLine(
  status: number,
  body: string,
): string {
  const block = humanLinesFromApiBody(body);
  if (!block) return `OK (HTTP ${status})`;
  return `OK (HTTP ${status})\n${block}`;
}

export type StatsAvailablePeriodsCliRawOpts = {
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
      error: `tempo stats available-periods: ${label} must be an integer (int32)`,
    };
  }
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < INT32_MIN || n > INT32_MAX) {
    return {
      error: `tempo stats available-periods: ${label} must be within int32 range`,
    };
  }
  return { value: n };
}

/**
 * Validates CLI flag strings and builds {@link StatsAvailablePeriodsQuery} for the API.
 */
export function statsAvailablePeriodsQueryFromCli(
  opts: StatsAvailablePeriodsCliRawOpts,
): { ok: StatsAvailablePeriodsQuery } | { error: string } {
  const tz = parseOptionalSignedInt32(
    "timezone-offset-minutes",
    opts.timezoneOffsetMinutes,
  );
  if ("error" in tz) return tz;
  const query: StatsAvailablePeriodsQuery = {};
  if (tz.value !== undefined) query.timezoneOffsetMinutes = tz.value;
  return { ok: query };
}
