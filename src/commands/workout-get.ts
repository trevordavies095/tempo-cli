import { createHttpClient } from "../http/client.js";
import { humanLinesFromApiBody } from "../output/human-api-body.js";
import { redactApiKeyInText } from "./auth-me.js";

export const WORKOUT_GET_PATH_PREFIX = "/workouts";

const BODY_SNIP_LEN = 500;

/** RFC 4122 UUID (case-insensitive), matches OpenAPI `format: uuid` for `/workouts/{id}`. */
const UUID_RE =
  /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

export function isValidWorkoutId(id: string): boolean {
  return UUID_RE.test(id.trim());
}

export function trimWorkoutId(id: string): string {
  return id.trim();
}

export function buildWorkoutGetPath(id: string): string {
  const t = trimWorkoutId(id);
  return `${WORKOUT_GET_PATH_PREFIX}/${encodeURIComponent(t)}`;
}

export type WorkoutGetOk = {
  kind: "ok";
  status: number;
  body: string;
};

export type WorkoutGetHttpError = {
  kind: "http";
  status: number;
  body: string;
};

export type WorkoutGetTransport = {
  kind: "transport";
  error: unknown;
};

export type WorkoutGetResult =
  | WorkoutGetOk
  | WorkoutGetHttpError
  | WorkoutGetTransport;

function truncateForMessage(body: string): string {
  const t = body.trim();
  if (t.length <= BODY_SNIP_LEN) return t;
  return `${t.slice(0, BODY_SNIP_LEN)}…`;
}

function displayCell(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

/** Human summary field order; each entry is [label, jsonKeys...] (camelCase and PascalCase). */
const HUMAN_SUMMARY_FIELDS: readonly (readonly string[])[] = [
  ["id", "id", "Id"],
  ["name", "name", "Name"],
  ["startedAt", "startedAt", "StartedAt"],
  ["duration", "duration", "Duration"],
  ["distance", "distance", "Distance"],
  ["runType", "runType", "RunType"],
  ["notes", "notes", "Notes"],
];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** GET /workouts/{id} with Bearer apiKey (caller must pass UUID-shaped id). */
export async function probeWorkoutGet(
  baseUrl: string,
  apiKey: string,
  id: string,
): Promise<WorkoutGetResult> {
  const client = createHttpClient({ baseUrl, apiKey });
  const path = buildWorkoutGetPath(id);
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

export function workoutGetHttpErrorMessage(
  status: number,
  body: string,
  id: string,
): string {
  const snip = truncateForMessage(body);
  const suffix = snip ? `: ${snip}` : "";
  const path = buildWorkoutGetPath(id);
  return `GET ${path} returned ${status}${suffix}`;
}

export function workoutGetHttpErrorMessageForCli(
  status: number,
  body: string,
  apiKey: string,
  id: string,
): string {
  return workoutGetHttpErrorMessage(
    status,
    redactApiKeyInText(body, apiKey),
    id,
  );
}

export function workoutGetHumanSuccessLine(
  status: number,
  body: string,
): string {
  const header = `OK (HTTP ${status})`;
  const trimmed = body.trim();
  if (trimmed) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isPlainObject(parsed)) {
        const lines: string[] = [];
        for (const spec of HUMAN_SUMMARY_FIELDS) {
          const [label, ...keys] = spec;
          for (const k of keys) {
            if (
              Object.prototype.hasOwnProperty.call(parsed, k) &&
              parsed[k] !== undefined &&
              parsed[k] !== null &&
              parsed[k] !== ""
            ) {
              lines.push(`${label}: ${displayCell(parsed[k])}`);
              break;
            }
          }
        }
        if (lines.length > 0) {
          return `${header}\n${lines.join("\n")}`;
        }
      }
    } catch {
      /* fall through */
    }
  }
  const block = humanLinesFromApiBody(body);
  if (!block) return header;
  return `${header}\n${block}`;
}
