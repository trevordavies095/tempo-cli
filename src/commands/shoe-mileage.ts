import { createHttpClient } from "../http/client.js";
import { humanLinesFromApiBody } from "../output/human-api-body.js";
import { redactApiKeyInText } from "./auth-me.js";
import { trimWorkoutId } from "./workout-get.js";

export const SHOE_MILEAGE_PATH_PREFIX = "/shoes";
export const SHOE_MILEAGE_PATH_SUFFIX = "/mileage";

const BODY_SNIP_LEN = 500;

export function buildShoeMileagePath(id: string): string {
  const t = trimWorkoutId(id);
  return `${SHOE_MILEAGE_PATH_PREFIX}/${encodeURIComponent(t)}${SHOE_MILEAGE_PATH_SUFFIX}`;
}

export type ShoeMileageOk = {
  kind: "ok";
  status: number;
  body: string;
};

export type ShoeMileageHttpError = {
  kind: "http";
  status: number;
  body: string;
};

export type ShoeMileageTransport = {
  kind: "transport";
  error: unknown;
};

export type ShoeMileageResult =
  | ShoeMileageOk
  | ShoeMileageHttpError
  | ShoeMileageTransport;

function truncateForMessage(body: string): string {
  const t = body.trim();
  if (t.length <= BODY_SNIP_LEN) return t;
  return `${t.slice(0, BODY_SNIP_LEN)}…`;
}

/**
 * GET /shoes/{id}/mileage with Bearer apiKey (caller must pass a UUID-shaped id).
 *
 * Read-only: never invokes `PATCH /shoes/{id}` or `DELETE /shoes/{id}`. The
 * spec exposes no `GET /shoes/{id}` resource, so the CLI does not provide a
 * shoe-detail command.
 */
export async function probeShoeMileage(
  baseUrl: string,
  apiKey: string,
  id: string,
): Promise<ShoeMileageResult> {
  const client = createHttpClient({ baseUrl, apiKey });
  const path = buildShoeMileagePath(id);
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

export function shoeMileageHttpErrorMessage(
  status: number,
  body: string,
  id: string,
): string {
  const snip = truncateForMessage(body);
  const suffix = snip ? `: ${snip}` : "";
  const path = buildShoeMileagePath(id);
  return `GET ${path} returned ${status}${suffix}`;
}

export function shoeMileageHttpErrorMessageForCli(
  status: number,
  body: string,
  apiKey: string,
  id: string,
): string {
  return shoeMileageHttpErrorMessage(
    status,
    redactApiKeyInText(body, apiKey),
    id,
  );
}

export function shoeMileageHumanSuccessLine(
  status: number,
  body: string,
): string {
  const block = humanLinesFromApiBody(body);
  if (!block) return `OK (HTTP ${status})`;
  return `OK (HTTP ${status})\n${block}`;
}
