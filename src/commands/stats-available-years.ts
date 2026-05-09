import { createHttpClient } from "../http/client.js";
import { humanLinesFromApiBody } from "../output/human-api-body.js";
import { redactApiKeyInText } from "./auth-me.js";

export const STATS_AVAILABLE_YEARS_PATH = "/stats/available-years";

const BODY_SNIP_LEN = 500;

export type StatsAvailableYearsOk = {
  kind: "ok";
  status: number;
  body: string;
};

export type StatsAvailableYearsHttpError = {
  kind: "http";
  status: number;
  body: string;
};

export type StatsAvailableYearsTransport = {
  kind: "transport";
  error: unknown;
};

export type StatsAvailableYearsResult =
  | StatsAvailableYearsOk
  | StatsAvailableYearsHttpError
  | StatsAvailableYearsTransport;

function truncateForMessage(body: string): string {
  const t = body.trim();
  if (t.length <= BODY_SNIP_LEN) return t;
  return `${t.slice(0, BODY_SNIP_LEN)}…`;
}

/** GET /stats/available-years with Bearer apiKey (caller must pass non-empty key). */
export async function probeStatsAvailableYears(
  baseUrl: string,
  apiKey: string,
): Promise<StatsAvailableYearsResult> {
  const client = createHttpClient({ baseUrl, apiKey });
  try {
    const response = await client.get(STATS_AVAILABLE_YEARS_PATH);
    const body = await response.text();
    if (response.ok) {
      return { kind: "ok", status: response.status, body };
    }
    return { kind: "http", status: response.status, body };
  } catch (error) {
    return { kind: "transport", error };
  }
}

export function statsAvailableYearsHttpErrorMessage(
  status: number,
  body: string,
): string {
  const snip = truncateForMessage(body);
  const suffix = snip ? `: ${snip}` : "";
  return `GET ${STATS_AVAILABLE_YEARS_PATH} returned ${status}${suffix}`;
}

export function statsAvailableYearsHttpErrorMessageForCli(
  status: number,
  body: string,
  apiKey: string,
): string {
  return statsAvailableYearsHttpErrorMessage(
    status,
    redactApiKeyInText(body, apiKey),
  );
}

export function statsAvailableYearsHumanSuccessLine(
  status: number,
  body: string,
): string {
  const block = humanLinesFromApiBody(body);
  if (!block) return `OK (HTTP ${status})`;
  return `OK (HTTP ${status})\n${block}`;
}
