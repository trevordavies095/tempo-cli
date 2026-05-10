import { createHttpClient } from "../http/client.js";
import { isPlainObject, pickFirst } from "../output/human-summary.js";
import { redactApiKeyInText } from "./auth-me.js";
import {
  WORKOUT_GET_PATH_PREFIX,
  trimWorkoutId,
} from "./workout-get.js";

const BODY_SNIP_LEN = 500;

/** One sparse HR sample from GET /workouts/{id}/time-series */
export type WorkoutTimeSeriesSampleRow = {
  elapsedSeconds: number;
  heartRateBpm: number;
};

export type WorkoutTimeSeriesQuery = {
  page?: number;
  pageSize?: number;
};

export type WorkoutTimeSeriesOk = {
  kind: "ok";
  status: number;
  body: string;
};

export type WorkoutTimeSeriesHttpError = {
  kind: "http";
  status: number;
  body: string;
};

export type WorkoutTimeSeriesTransport = {
  kind: "transport";
  error: unknown;
};

export type WorkoutTimeSeriesResult =
  | WorkoutTimeSeriesOk
  | WorkoutTimeSeriesHttpError
  | WorkoutTimeSeriesTransport;

function truncateForMessage(body: string): string {
  const t = body.trim();
  if (t.length <= BODY_SNIP_LEN) return t;
  return `${t.slice(0, BODY_SNIP_LEN)}…`;
}

/** GET /workouts/{id}/time-series?page=&pageSize= */
export function buildWorkoutTimeSeriesPath(
  id: string,
  query?: WorkoutTimeSeriesQuery,
): string {
  const base = `${WORKOUT_GET_PATH_PREFIX}/${encodeURIComponent(trimWorkoutId(id))}/time-series`;
  const params = new URLSearchParams();
  if (query?.page !== undefined) params.set("page", String(query.page));
  if (query?.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** GET /workouts/{id}/time-series with Bearer apiKey (caller passes UUID-shaped id). */
export async function probeWorkoutTimeSeries(
  baseUrl: string,
  apiKey: string,
  id: string,
  query?: WorkoutTimeSeriesQuery,
): Promise<WorkoutTimeSeriesResult> {
  const client = createHttpClient({ baseUrl, apiKey });
  const path = buildWorkoutTimeSeriesPath(id, query);
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

export function workoutTimeSeriesHttpErrorMessage(
  status: number,
  body: string,
  id: string,
): string {
  const snip = truncateForMessage(body);
  const suffix = snip ? `: ${snip}` : "";
  const path = buildWorkoutTimeSeriesPath(id);
  return `GET ${path} returned ${status}${suffix}`;
}

export function workoutTimeSeriesHttpErrorMessageForCli(
  status: number,
  body: string,
  apiKey: string,
  id: string,
): string {
  return workoutTimeSeriesHttpErrorMessage(
    status,
    redactApiKeyInText(body, apiKey),
    id,
  );
}

/** Parses one paginated response: root array, or `{ items }`, same loose shape as workouts list. */
export function parseWorkoutTimeSeriesPageBody(
  body: string,
): { ok: true; items: WorkoutTimeSeriesSampleRow[] } | { ok: false } {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return { ok: false };
  }

  let rowsRaw: unknown;
  if (Array.isArray(parsed)) {
    rowsRaw = parsed;
  } else if (isPlainObject(parsed)) {
    rowsRaw = parsed.items ?? parsed.Items ?? parsed.data ?? parsed.Data;
  } else {
    return { ok: false };
  }

  if (!Array.isArray(rowsRaw)) return { ok: false };

  const items: WorkoutTimeSeriesSampleRow[] = [];
  for (const row of rowsRaw) {
    if (!isPlainObject(row)) continue;
    const esRaw = pickFirst(row, ["elapsedSeconds", "ElapsedSeconds"]);
    const hrRaw = pickFirst(row, ["heartRateBpm", "HeartRateBpm"]);
    if (typeof esRaw !== "number" || !Number.isFinite(esRaw)) continue;
    if (typeof hrRaw !== "number" || !Number.isFinite(hrRaw)) continue;
    const hr = Math.round(hrRaw);
    if (hr <= 0) continue;
    items.push({
      elapsedSeconds: Math.max(0, Math.floor(esRaw)),
      heartRateBpm: hr,
    });
  }

  return { ok: true, items };
}

/**
 * Collapses duplicate elapsedSeconds (keeps last BPM), sorts ascending.
 * Matches server ordering notes when pages are concatenated.
 */
export function mergeWorkoutTimeSeriesSamplesByElapsedSecond(
  samples: readonly WorkoutTimeSeriesSampleRow[],
): WorkoutTimeSeriesSampleRow[] {
  const map = new Map<number, number>();
  for (const s of samples) {
    map.set(s.elapsedSeconds, s.heartRateBpm);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([elapsedSeconds, heartRateBpm]) => ({ elapsedSeconds, heartRateBpm }));
}
