import { createHttpClient } from "../http/client.js";
import { humanLinesFromApiBody } from "../output/human-api-body.js";
import {
  displayCell,
  formatCappedArrayLines,
  HUMAN_GENERIC_ROW_CAP,
  isPlainObject,
  pickFirst,
} from "../output/human-summary.js";
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

function isScalar(v: unknown): v is string | number | boolean {
  return (
    typeof v === "string" || typeof v === "number" || typeof v === "boolean"
  );
}

function compactYearRow(item: unknown): string {
  if (!isPlainObject(item)) return displayCell(item);
  const year = pickFirst(item, ["year", "Year"]);
  const distance = pickFirst(item, ["distance", "Distance", "miles", "Miles"]);
  const count = pickFirst(item, ["count", "Count", "workouts", "Workouts"]);
  const bits: string[] = [];
  if (year !== undefined) bits.push(displayCell(year));
  if (distance !== undefined) bits.push(`distance=${displayCell(distance)}`);
  if (count !== undefined) bits.push(`count=${displayCell(count)}`);
  return bits.length > 0 ? bits.join(" | ") : JSON.stringify(item);
}

export function statsAvailableYearsHumanSuccessLine(
  status: number,
  body: string,
): string {
  const header = `OK (HTTP ${status})`;
  const trimmed = body.trim();
  if (!trimmed) return header;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      if (parsed.length > 0 && parsed.every(isScalar)) {
        const shown = parsed.slice(0, HUMAN_GENERIC_ROW_CAP);
        const rest = parsed.length - shown.length;
        const list = shown.map(displayCell).join(", ");
        const tail = rest > 0 ? ` (… and ${rest} more)` : "";
        return `${header}\nYears: ${list}${tail}`;
      }
      const lines = [
        header,
        ...formatCappedArrayLines(parsed, "year(s)", compactYearRow),
      ];
      return lines.join("\n");
    }
    if (isPlainObject(parsed)) {
      const years = pickFirst(parsed, ["years", "Years", "items", "Items"]);
      if (Array.isArray(years)) {
        if (years.length > 0 && years.every(isScalar)) {
          const shown = years.slice(0, HUMAN_GENERIC_ROW_CAP);
          const rest = years.length - shown.length;
          const list = shown.map(displayCell).join(", ");
          const tail = rest > 0 ? ` (… and ${rest} more)` : "";
          return `${header}\nYears: ${list}${tail}`;
        }
        const lines = [
          header,
          ...formatCappedArrayLines(years, "year(s)", compactYearRow),
        ];
        return lines.join("\n");
      }
    }
  } catch {
    /* fall through */
  }
  const block = humanLinesFromApiBody(body);
  if (!block) return header;
  return `${header}\n${block}`;
}
