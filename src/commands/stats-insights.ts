import { createHttpClient } from "../http/client.js";
import { humanLinesFromApiBody } from "../output/human-api-body.js";
import { redactApiKeyInText } from "./auth-me.js";

export const STATS_INSIGHTS_PATH = "/stats/insights";

const BODY_SNIP_LEN = 500;

export type StatsInsightsOk = {
  kind: "ok";
  status: number;
  body: string;
};

export type StatsInsightsHttpError = {
  kind: "http";
  status: number;
  body: string;
};

export type StatsInsightsTransport = {
  kind: "transport";
  error: unknown;
};

export type StatsInsightsResult =
  | StatsInsightsOk
  | StatsInsightsHttpError
  | StatsInsightsTransport;

function truncateForMessage(body: string): string {
  const t = body.trim();
  if (t.length <= BODY_SNIP_LEN) return t;
  return `${t.slice(0, BODY_SNIP_LEN)}…`;
}

/** GET /stats/insights with Bearer apiKey (caller must pass non-empty key). */
export async function probeStatsInsights(
  baseUrl: string,
  apiKey: string,
): Promise<StatsInsightsResult> {
  const client = createHttpClient({ baseUrl, apiKey });
  try {
    const response = await client.get(STATS_INSIGHTS_PATH);
    const body = await response.text();
    if (response.ok) {
      return { kind: "ok", status: response.status, body };
    }
    return { kind: "http", status: response.status, body };
  } catch (error) {
    return { kind: "transport", error };
  }
}

export function statsInsightsHttpErrorMessage(
  status: number,
  body: string,
): string {
  const snip = truncateForMessage(body);
  const suffix = snip ? `: ${snip}` : "";
  return `GET ${STATS_INSIGHTS_PATH} returned ${status}${suffix}`;
}

export function statsInsightsHttpErrorMessageForCli(
  status: number,
  body: string,
  apiKey: string,
): string {
  return statsInsightsHttpErrorMessage(
    status,
    redactApiKeyInText(body, apiKey),
  );
}

export function statsInsightsHumanSuccessLine(
  status: number,
  body: string,
): string {
  const block = humanLinesFromApiBody(body);
  if (!block) return `OK (HTTP ${status})`;
  return `OK (HTTP ${status})\n${block}`;
}
