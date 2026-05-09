import { createHttpClient } from "../http/client.js";
import { humanLinesFromApiBody } from "../output/human-api-body.js";
import {
  displayCell,
  formatCappedArrayLines,
  isPlainObject,
  pickFirst,
} from "../output/human-summary.js";
import { redactApiKeyInText } from "./auth-me.js";

export const STATS_BEST_EFFORTS_PATH = "/stats/best-efforts";

const BODY_SNIP_LEN = 500;

export type StatsBestEffortsOk = {
  kind: "ok";
  status: number;
  body: string;
};

export type StatsBestEffortsHttpError = {
  kind: "http";
  status: number;
  body: string;
};

export type StatsBestEffortsTransport = {
  kind: "transport";
  error: unknown;
};

export type StatsBestEffortsResult =
  | StatsBestEffortsOk
  | StatsBestEffortsHttpError
  | StatsBestEffortsTransport;

function truncateForMessage(body: string): string {
  const t = body.trim();
  if (t.length <= BODY_SNIP_LEN) return t;
  return `${t.slice(0, BODY_SNIP_LEN)}…`;
}

/**
 * GET /stats/best-efforts with Bearer apiKey (caller must pass non-empty key).
 *
 * This module never invokes `POST /stats/best-efforts/recalculate` or any other
 * mutating route — the read-only contract for `tempo stats best-efforts`.
 */
export async function probeStatsBestEfforts(
  baseUrl: string,
  apiKey: string,
): Promise<StatsBestEffortsResult> {
  const client = createHttpClient({ baseUrl, apiKey });
  try {
    const response = await client.get(STATS_BEST_EFFORTS_PATH);
    const body = await response.text();
    if (response.ok) {
      return { kind: "ok", status: response.status, body };
    }
    return { kind: "http", status: response.status, body };
  } catch (error) {
    return { kind: "transport", error };
  }
}

export function statsBestEffortsHttpErrorMessage(
  status: number,
  body: string,
): string {
  const snip = truncateForMessage(body);
  const suffix = snip ? `: ${snip}` : "";
  return `GET ${STATS_BEST_EFFORTS_PATH} returned ${status}${suffix}`;
}

export function statsBestEffortsHttpErrorMessageForCli(
  status: number,
  body: string,
  apiKey: string,
): string {
  return statsBestEffortsHttpErrorMessage(
    status,
    redactApiKeyInText(body, apiKey),
  );
}

function pickEffortValue(item: Record<string, unknown>): unknown {
  return pickFirst(item, [
    "time",
    "Time",
    "duration",
    "Duration",
    "bestTime",
    "BestTime",
    "value",
    "Value",
  ]);
}

function compactBestEffortRow(item: unknown): string {
  if (!isPlainObject(item)) return displayCell(item);
  const distance = pickFirst(item, [
    "distance",
    "Distance",
    "distanceLabel",
    "DistanceLabel",
    "name",
    "Name",
  ]);
  const time = pickEffortValue(item);
  const bits: string[] = [];
  if (distance !== undefined) bits.push(displayCell(distance));
  if (time !== undefined) bits.push(`time=${displayCell(time)}`);
  return bits.length > 0 ? bits.join(" | ") : JSON.stringify(item);
}

export function statsBestEffortsHumanSuccessLine(
  status: number,
  body: string,
): string {
  const header = `OK (HTTP ${status})`;
  const trimmed = body.trim();
  if (!trimmed) return header;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      const lines = [
        header,
        ...formatCappedArrayLines(parsed, "effort(s)", compactBestEffortRow),
      ];
      return lines.join("\n");
    }
    if (isPlainObject(parsed)) {
      const entries = Object.entries(parsed).sort(([a], [b]) =>
        a.localeCompare(b),
      );
      const valueLines: string[] = [];
      let allEntriesRenderable = entries.length > 0;
      for (const [k, v] of entries) {
        if (isPlainObject(v)) {
          const time = pickEffortValue(v);
          if (time !== undefined) {
            valueLines.push(`${k}: ${displayCell(time)}`);
            continue;
          }
        }
        allEntriesRenderable = false;
        break;
      }
      if (allEntriesRenderable && valueLines.length > 0) {
        return `${header}\n${valueLines.join("\n")}`;
      }
    }
  } catch {
    /* fall through */
  }
  const block = humanLinesFromApiBody(body);
  if (!block) return header;
  return `${header}\n${block}`;
}
