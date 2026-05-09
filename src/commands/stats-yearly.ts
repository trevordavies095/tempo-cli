import { createHttpClient } from "../http/client.js";
import { humanLinesFromApiBody } from "../output/human-api-body.js";
import {
  formatFieldLines,
  isPlainObject,
} from "../output/human-summary.js";
import { redactApiKeyInText } from "./auth-me.js";

export const STATS_YEARLY_PATH = "/stats/yearly";

const BODY_SNIP_LEN = 500;
const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

/** Query params for GET /stats/yearly (OpenAPI names); omit unset fields so the server applies defaults. */
export type StatsYearlyQuery = {
  timezoneOffsetMinutes?: number;
};

export type StatsYearlyOk = {
  kind: "ok";
  status: number;
  body: string;
};

export type StatsYearlyHttpError = {
  kind: "http";
  status: number;
  body: string;
};

export type StatsYearlyTransport = {
  kind: "transport";
  error: unknown;
};

export type StatsYearlyResult =
  | StatsYearlyOk
  | StatsYearlyHttpError
  | StatsYearlyTransport;

function truncateForMessage(body: string): string {
  const t = body.trim();
  if (t.length <= BODY_SNIP_LEN) return t;
  return `${t.slice(0, BODY_SNIP_LEN)}…`;
}

export function buildStatsYearlyPath(params: StatsYearlyQuery = {}): string {
  const q = new URLSearchParams();
  if (params.timezoneOffsetMinutes !== undefined) {
    q.set("timezoneOffsetMinutes", String(params.timezoneOffsetMinutes));
  }
  const qs = q.toString();
  return qs ? `${STATS_YEARLY_PATH}?${qs}` : STATS_YEARLY_PATH;
}

/** GET /stats/yearly with Bearer apiKey (caller must pass non-empty key). */
export async function probeStatsYearly(
  baseUrl: string,
  apiKey: string,
  params: StatsYearlyQuery = {},
): Promise<StatsYearlyResult> {
  const client = createHttpClient({ baseUrl, apiKey });
  const path = buildStatsYearlyPath(params);
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

export function statsYearlyHttpErrorMessage(
  status: number,
  body: string,
  params: StatsYearlyQuery = {},
): string {
  const snip = truncateForMessage(body);
  const suffix = snip ? `: ${snip}` : "";
  return `GET ${buildStatsYearlyPath(params)} returned ${status}${suffix}`;
}

export function statsYearlyHttpErrorMessageForCli(
  status: number,
  body: string,
  apiKey: string,
  params: StatsYearlyQuery = {},
): string {
  return statsYearlyHttpErrorMessage(
    status,
    redactApiKeyInText(body, apiKey),
    params,
  );
}

const YEARLY_FIELD_SPECS = [
  ["currentYear", "currentYear", "CurrentYear"],
  ["previousYear", "previousYear", "PreviousYear"],
  ["currentYearMiles", "currentYearMiles", "CurrentYearMiles"],
  ["previousYearMiles", "previousYearMiles", "PreviousYearMiles"],
  ["totalDistance", "totalDistance", "TotalDistance"],
] as const;

export function statsYearlyHumanSuccessLine(
  status: number,
  body: string,
): string {
  const header = `OK (HTTP ${status})`;
  const trimmed = body.trim();
  if (!trimmed) return header;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isPlainObject(parsed)) {
      const lines = formatFieldLines(parsed, YEARLY_FIELD_SPECS);
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

export type StatsYearlyCliRawOpts = {
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
      error: `tempo stats yearly: ${label} must be an integer (int32)`,
    };
  }
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < INT32_MIN || n > INT32_MAX) {
    return {
      error: `tempo stats yearly: ${label} must be within int32 range`,
    };
  }
  return { value: n };
}

/**
 * Validates CLI flag strings and builds {@link StatsYearlyQuery} for the API.
 */
export function statsYearlyQueryFromCli(
  opts: StatsYearlyCliRawOpts,
): { ok: StatsYearlyQuery } | { error: string } {
  const tz = parseOptionalSignedInt32(
    "timezone-offset-minutes",
    opts.timezoneOffsetMinutes,
  );
  if ("error" in tz) return tz;
  const query: StatsYearlyQuery = {};
  if (tz.value !== undefined) query.timezoneOffsetMinutes = tz.value;
  return { ok: query };
}
