import { createHttpClient } from "../http/client.js";
import { humanLinesFromApiBody } from "../output/human-api-body.js";
import {
  compactWorkoutSummaryRow,
  displayCellForHuman,
  HUMAN_WORKOUT_TABLE_ROW_CAP,
} from "../output/workout-human-rows.js";
import { redactApiKeyInText } from "./auth-me.js";
import { trimWorkoutId, WORKOUT_GET_PATH_PREFIX } from "./workout-get.js";

const SIMILAR_ROUTES_SUFFIX = "/similar-routes";
const BODY_SNIP_LEN = 500;

export type SimilarRoutesQuery = {
  maxResults?: number;
};

export type SimilarRoutesCliRawOpts = {
  maxResults?: string;
};

export type SimilarRoutesOk = {
  kind: "ok";
  status: number;
  body: string;
};

export type SimilarRoutesHttpError = {
  kind: "http";
  status: number;
  body: string;
};

export type SimilarRoutesTransport = {
  kind: "transport";
  error: unknown;
};

export type SimilarRoutesResult =
  | SimilarRoutesOk
  | SimilarRoutesHttpError
  | SimilarRoutesTransport;

function truncateForMessage(body: string): string {
  const t = body.trim();
  if (t.length <= BODY_SNIP_LEN) return t;
  return `${t.slice(0, BODY_SNIP_LEN)}…`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function buildWorkoutSimilarRoutesPath(
  id: string,
  params?: SimilarRoutesQuery,
): string {
  const t = trimWorkoutId(id);
  const base = `${WORKOUT_GET_PATH_PREFIX}/${encodeURIComponent(t)}${SIMILAR_ROUTES_SUFFIX}`;
  if (params?.maxResults !== undefined) {
    const q = new URLSearchParams();
    q.set("maxResults", String(params.maxResults));
    return `${base}?${q.toString()}`;
  }
  return base;
}

function parseOptionalPositiveInt(
  label: string,
  raw: string | undefined,
): { value: number | undefined } | { error: string } {
  if (raw === undefined || raw.trim() === "") return { value: undefined };
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return {
      error: `tempo workout similar-routes: ${label} must be a positive integer`,
    };
  }
  const n = Number.parseInt(trimmed, 10);
  if (n < 1) {
    return {
      error: `tempo workout similar-routes: ${label} must be a positive integer`,
    };
  }
  return { value: n };
}

export function similarRoutesQueryFromCli(
  opts: SimilarRoutesCliRawOpts,
): { ok: SimilarRoutesQuery } | { error: string } {
  const r = parseOptionalPositiveInt("max-results", opts.maxResults);
  if ("error" in r) return r;
  const query: SimilarRoutesQuery = {};
  if (r.value !== undefined) query.maxResults = r.value;
  return { ok: query };
}

export async function probeWorkoutSimilarRoutes(
  baseUrl: string,
  apiKey: string,
  id: string,
  params?: SimilarRoutesQuery,
): Promise<SimilarRoutesResult> {
  const client = createHttpClient({ baseUrl, apiKey });
  const path = buildWorkoutSimilarRoutesPath(id, params);
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

export function workoutSimilarRoutesHttpErrorMessage(
  status: number,
  body: string,
  id: string,
  params?: SimilarRoutesQuery,
): string {
  const snip = truncateForMessage(body);
  const suffix = snip ? `: ${snip}` : "";
  const path = buildWorkoutSimilarRoutesPath(id, params);
  return `GET ${path} returned ${status}${suffix}`;
}

export function workoutSimilarRoutesHttpErrorMessageForCli(
  status: number,
  body: string,
  apiKey: string,
  id: string,
  params?: SimilarRoutesQuery,
): string {
  return workoutSimilarRoutesHttpErrorMessage(
    status,
    redactApiKeyInText(body, apiKey),
    id,
    params,
  );
}

export function workoutSimilarRoutesHumanSuccessLine(
  status: number,
  body: string,
): string {
  const header = `OK (HTTP ${status})`;
  const trimmed = body.trim();
  if (!trimmed) return header;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      const lines: string[] = [
        header,
        `${parsed.length} similar route(s)`,
      ];
      const shown = parsed.slice(0, HUMAN_WORKOUT_TABLE_ROW_CAP);
      let i = 0;
      for (const item of shown) {
        i += 1;
        if (isPlainObject(item)) {
          lines.push(`${i}. ${compactWorkoutSummaryRow(item)}`);
        } else {
          lines.push(`${i}. ${displayCellForHuman(item)}`);
        }
      }
      const rest = parsed.length - shown.length;
      if (rest > 0) {
        lines.push(`… and ${rest} more`);
      }
      return lines.join("\n");
    }
    if (isPlainObject(parsed)) {
      const block = humanLinesFromApiBody(trimmed);
      if (!block) return header;
      return `${header}\n${block}`;
    }
  } catch {
    /* fall through */
  }
  const block = humanLinesFromApiBody(body);
  if (!block) return header;
  return `${header}\n${block}`;
}
