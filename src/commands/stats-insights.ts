import { createHttpClient } from "../http/client.js";
import { humanLinesFromApiBody } from "../output/human-api-body.js";
import { displayCell, isPlainObject } from "../output/human-summary.js";
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

function isScalar(v: unknown): v is string | number | boolean | null {
  return (
    v === null ||
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean"
  );
}

export function statsInsightsHumanSuccessLine(
  status: number,
  body: string,
): string {
  const header = `OK (HTTP ${status})`;
  const trimmed = body.trim();
  if (!trimmed) return header;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isPlainObject(parsed)) {
      const keys = Object.keys(parsed).sort();
      const lines: string[] = [];
      for (const k of keys) {
        const v = parsed[k];
        if (isScalar(v)) {
          lines.push(`${k}: ${displayCell(v)}`);
        } else if (Array.isArray(v)) {
          lines.push(`${k}: ${v.length} item(s)`);
        } else if (isPlainObject(v)) {
          lines.push(`${k}: ${JSON.stringify(v)}`);
        }
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
