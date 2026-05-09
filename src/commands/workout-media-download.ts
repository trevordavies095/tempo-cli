import { rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { createHttpClient } from "../http/client.js";
import { redactApiKeyInText } from "./auth-me.js";
import { trimWorkoutId, WORKOUT_GET_PATH_PREFIX } from "./workout-get.js";

const BODY_SNIP_LEN = 500;

export function buildWorkoutMediaDownloadPath(
  workoutId: string,
  mediaId: string,
): string {
  const w = trimWorkoutId(workoutId);
  const m = trimWorkoutId(mediaId);
  return `${WORKOUT_GET_PATH_PREFIX}/${encodeURIComponent(w)}/media/${encodeURIComponent(m)}`;
}

export type WorkoutMediaDownloadOk = {
  kind: "ok";
  status: number;
  body: ArrayBuffer;
  contentType: string | null;
};

export type WorkoutMediaDownloadHttpError = {
  kind: "http";
  status: number;
  bodyText: string;
};

export type WorkoutMediaDownloadTransport = {
  kind: "transport";
  error: unknown;
};

export type WorkoutMediaDownloadResult =
  | WorkoutMediaDownloadOk
  | WorkoutMediaDownloadHttpError
  | WorkoutMediaDownloadTransport;

function truncateForMessage(body: string): string {
  const t = body.trim();
  if (t.length <= BODY_SNIP_LEN) return t;
  return `${t.slice(0, BODY_SNIP_LEN)}…`;
}

export async function probeWorkoutMediaDownload(
  baseUrl: string,
  apiKey: string,
  workoutId: string,
  mediaId: string,
): Promise<WorkoutMediaDownloadResult> {
  const client = createHttpClient({ baseUrl, apiKey });
  const path = buildWorkoutMediaDownloadPath(workoutId, mediaId);
  try {
    const response = await client.get(path);
    if (response.ok) {
      const rawCt = response.headers.get("content-type");
      const contentType =
        rawCt != null && rawCt.trim() !== "" ? rawCt.trim() : null;
      const body = await response.arrayBuffer();
      return {
        kind: "ok",
        status: response.status,
        body,
        contentType,
      };
    }
    const bodyText = await response.text();
    return { kind: "http", status: response.status, bodyText };
  } catch (error) {
    return { kind: "transport", error };
  }
}

export function workoutMediaDownloadHttpErrorMessage(
  status: number,
  bodyText: string,
  workoutId: string,
  mediaId: string,
): string {
  const snip = truncateForMessage(bodyText);
  const suffix = snip ? `: ${snip}` : "";
  const path = buildWorkoutMediaDownloadPath(workoutId, mediaId);
  return `GET ${path} returned ${status}${suffix}`;
}

export function workoutMediaDownloadHttpErrorMessageForCli(
  status: number,
  bodyText: string,
  apiKey: string,
  workoutId: string,
  mediaId: string,
): string {
  return workoutMediaDownloadHttpErrorMessage(
    status,
    redactApiKeyInText(bodyText, apiKey),
    workoutId,
    mediaId,
  );
}

/** Write bytes to `destPath` via a temp file in the same directory, then rename (atomic replace). */
export async function atomicWriteFile(
  destPath: string,
  data: Uint8Array,
): Promise<void> {
  const dir = dirname(destPath);
  const base =
    destPath.includes("/") || destPath.includes("\\")
      ? destPath.replace(/^.*[/\\]/, "")
      : destPath;
  const safeBase = base.length > 0 ? base : "download";
  const tmp = join(dir, `.${safeBase}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tmp, data);
  await rename(tmp, destPath);
}
