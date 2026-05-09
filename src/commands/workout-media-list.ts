import { createHttpClient } from "../http/client.js";
import { humanLinesFromApiBody } from "../output/human-api-body.js";
import { redactApiKeyInText } from "./auth-me.js";
import { trimWorkoutId, WORKOUT_GET_PATH_PREFIX } from "./workout-get.js";

const MEDIA_SUFFIX = "/media";
const BODY_SNIP_LEN = 500;
const HUMAN_ARRAY_ROW_CAP = 20;

export type WorkoutMediaListOk = {
  kind: "ok";
  status: number;
  body: string;
};

export type WorkoutMediaListHttpError = {
  kind: "http";
  status: number;
  body: string;
};

export type WorkoutMediaListTransport = {
  kind: "transport";
  error: unknown;
};

export type WorkoutMediaListResult =
  | WorkoutMediaListOk
  | WorkoutMediaListHttpError
  | WorkoutMediaListTransport;

function truncateForMessage(body: string): string {
  const t = body.trim();
  if (t.length <= BODY_SNIP_LEN) return t;
  return `${t.slice(0, BODY_SNIP_LEN)}…`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function pickFirst(
  obj: Record<string, unknown>,
  keys: readonly string[],
): unknown {
  for (const k of keys) {
    if (
      Object.prototype.hasOwnProperty.call(obj, k) &&
      obj[k] !== undefined &&
      obj[k] !== null &&
      obj[k] !== ""
    ) {
      return obj[k];
    }
  }
  return undefined;
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

function compactMediaRow(obj: Record<string, unknown>): string {
  const bits: string[] = [];
  const id = pickFirst(obj, ["id", "Id", "mediaId", "MediaId"]);
  if (id !== undefined) bits.push(displayCell(id));
  const file = pickFirst(obj, [
    "filename",
    "fileName",
    "Filename",
    "FileName",
    "name",
    "Name",
  ]);
  if (file !== undefined) bits.push(displayCell(file));
  const mime = pickFirst(obj, [
    "mimeType",
    "mime",
    "MimeType",
    "contentType",
    "ContentType",
  ]);
  if (mime !== undefined) bits.push(displayCell(mime));
  const size = pickFirst(obj, ["size", "fileSize", "Size", "FileSize"]);
  if (size !== undefined) bits.push(`size=${displayCell(size)}`);
  const caption = pickFirst(obj, ["caption", "Caption"]);
  if (caption !== undefined) bits.push(`caption=${displayCell(caption)}`);
  const created = pickFirst(obj, [
    "createdAt",
    "created",
    "CreatedAt",
    "Created",
  ]);
  if (created !== undefined) bits.push(`created=${displayCell(created)}`);
  return bits.length > 0 ? bits.join(" | ") : JSON.stringify(obj);
}

export function buildWorkoutMediaListPath(id: string): string {
  const t = trimWorkoutId(id);
  return `${WORKOUT_GET_PATH_PREFIX}/${encodeURIComponent(t)}${MEDIA_SUFFIX}`;
}

export async function probeWorkoutMediaList(
  baseUrl: string,
  apiKey: string,
  id: string,
): Promise<WorkoutMediaListResult> {
  const client = createHttpClient({ baseUrl, apiKey });
  const path = buildWorkoutMediaListPath(id);
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

export function workoutMediaListHttpErrorMessage(
  status: number,
  body: string,
  id: string,
): string {
  const snip = truncateForMessage(body);
  const suffix = snip ? `: ${snip}` : "";
  const path = buildWorkoutMediaListPath(id);
  return `GET ${path} returned ${status}${suffix}`;
}

export function workoutMediaListHttpErrorMessageForCli(
  status: number,
  body: string,
  apiKey: string,
  id: string,
): string {
  return workoutMediaListHttpErrorMessage(
    status,
    redactApiKeyInText(body, apiKey),
    id,
  );
}

export function workoutMediaListHumanSuccessLine(
  status: number,
  body: string,
): string {
  const header = `OK (HTTP ${status})`;
  const trimmed = body.trim();
  if (!trimmed) return header;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      const lines: string[] = [header, `${parsed.length} media file(s)`];
      const shown = parsed.slice(0, HUMAN_ARRAY_ROW_CAP);
      let i = 0;
      for (const item of shown) {
        i += 1;
        if (isPlainObject(item)) {
          lines.push(`${i}. ${compactMediaRow(item)}`);
        } else {
          lines.push(`${i}. ${displayCell(item)}`);
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
