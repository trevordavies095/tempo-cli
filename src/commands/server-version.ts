import { createHttpClient } from "../http/client.js";
import { humanLinesFromApiBody } from "../output/human-api-body.js";

export const VERSION_PATH = "/version";

const BODY_SNIP_LEN = 500;

export type ServerVersionOk = {
  kind: "ok";
  status: number;
  body: string;
};

export type ServerVersionHttpError = {
  kind: "http";
  status: number;
  body: string;
};

export type ServerVersionTransport = {
  kind: "transport";
  error: unknown;
};

export type ServerVersionResult =
  | ServerVersionOk
  | ServerVersionHttpError
  | ServerVersionTransport;

function truncateForMessage(body: string): string {
  const t = body.trim();
  if (t.length <= BODY_SNIP_LEN) return t;
  return `${t.slice(0, BODY_SNIP_LEN)}…`;
}

/** Unauthenticated GET /version (no API key). */
export async function probeServerVersion(
  baseUrl: string,
): Promise<ServerVersionResult> {
  const client = createHttpClient({ baseUrl });
  try {
    const response = await client.get(VERSION_PATH);
    const body = await response.text();
    if (response.ok) {
      return { kind: "ok", status: response.status, body };
    }
    return { kind: "http", status: response.status, body };
  } catch (error) {
    return { kind: "transport", error };
  }
}

export function serverVersionHttpErrorMessage(
  status: number,
  body: string,
): string {
  const snip = truncateForMessage(body);
  const suffix = snip ? `: ${snip}` : "";
  return `GET ${VERSION_PATH} returned ${status}${suffix}`;
}

export function serverVersionHumanSuccessLine(
  status: number,
  body: string,
): string {
  const block = humanLinesFromApiBody(body);
  if (!block) return `OK (HTTP ${status})`;
  return `OK (HTTP ${status})\n${block}`;
}
