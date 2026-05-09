import { createHttpClient } from "../http/client.js";
import { humanLinesFromApiBody } from "../output/human-api-body.js";
import { redactApiKeyInText } from "./auth-me.js";

export const STATS_RELATIVE_EFFORT_PATH = "/stats/relative-effort";

const BODY_SNIP_LEN = 500;
const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

/** Query params for GET /stats/relative-effort (OpenAPI names); omit unset fields so the server applies defaults. */
export type StatsRelativeEffortQuery = {
  timezoneOffsetMinutes?: number;
};

export type StatsRelativeEffortOk = {
  kind: "ok";
  status: number;
  body: string;
};

export type StatsRelativeEffortHttpError = {
  kind: "http";
  status: number;
  body: string;
};

export type StatsRelativeEffortTransport = {
  kind: "transport";
  error: unknown;
};

export type StatsRelativeEffortResult =
  | StatsRelativeEffortOk
  | StatsRelativeEffortHttpError
  | StatsRelativeEffortTransport;

function truncateForMessage(body: string): string {
  const t = body.trim();
  if (t.length <= BODY_SNIP_LEN) return t;
  return `${t.slice(0, BODY_SNIP_LEN)}…`;
}

export function buildStatsRelativeEffortPath(
  params: StatsRelativeEffortQuery = {},
): string {
  const q = new URLSearchParams();
  if (params.timezoneOffsetMinutes !== undefined) {
    q.set("timezoneOffsetMinutes", String(params.timezoneOffsetMinutes));
  }
  const qs = q.toString();
  return qs
    ? `${STATS_RELATIVE_EFFORT_PATH}?${qs}`
    : STATS_RELATIVE_EFFORT_PATH;
}

/** GET /stats/relative-effort with Bearer apiKey (caller must pass non-empty key). */
export async function probeStatsRelativeEffort(
  baseUrl: string,
  apiKey: string,
  params: StatsRelativeEffortQuery = {},
): Promise<StatsRelativeEffortResult> {
  const client = createHttpClient({ baseUrl, apiKey });
  const path = buildStatsRelativeEffortPath(params);
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

export function statsRelativeEffortHttpErrorMessage(
  status: number,
  body: string,
  params: StatsRelativeEffortQuery = {},
): string {
  const snip = truncateForMessage(body);
  const suffix = snip ? `: ${snip}` : "";
  return `GET ${buildStatsRelativeEffortPath(params)} returned ${status}${suffix}`;
}

export function statsRelativeEffortHttpErrorMessageForCli(
  status: number,
  body: string,
  apiKey: string,
  params: StatsRelativeEffortQuery = {},
): string {
  return statsRelativeEffortHttpErrorMessage(
    status,
    redactApiKeyInText(body, apiKey),
    params,
  );
}

export function statsRelativeEffortHumanSuccessLine(
  status: number,
  body: string,
): string {
  const block = humanLinesFromApiBody(body);
  if (!block) return `OK (HTTP ${status})`;
  return `OK (HTTP ${status})\n${block}`;
}

export type StatsRelativeEffortCliRawOpts = {
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
      error: `tempo stats relative-effort: ${label} must be an integer (int32)`,
    };
  }
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < INT32_MIN || n > INT32_MAX) {
    return {
      error: `tempo stats relative-effort: ${label} must be within int32 range`,
    };
  }
  return { value: n };
}

/**
 * Validates CLI flag strings and builds {@link StatsRelativeEffortQuery} for the API.
 */
export function statsRelativeEffortQueryFromCli(
  opts: StatsRelativeEffortCliRawOpts,
): { ok: StatsRelativeEffortQuery } | { error: string } {
  const tz = parseOptionalSignedInt32(
    "timezone-offset-minutes",
    opts.timezoneOffsetMinutes,
  );
  if ("error" in tz) return tz;
  const query: StatsRelativeEffortQuery = {};
  if (tz.value !== undefined) query.timezoneOffsetMinutes = tz.value;
  return { ok: query };
}
