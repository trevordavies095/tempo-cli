import { createHttpClient } from "../http/client.js";

export const HEALTH_PATH = "/health";

const BODY_SNIP_LEN = 500;

export type HealthProbeOk = {
  kind: "ok";
  status: number;
  body: string;
};

export type HealthProbeHttpError = {
  kind: "http";
  status: number;
  body: string;
};

export type HealthProbeTransport = {
  kind: "transport";
  error: unknown;
};

export type HealthProbeResult =
  | HealthProbeOk
  | HealthProbeHttpError
  | HealthProbeTransport;

function truncateForMessage(body: string): string {
  const t = body.trim();
  if (t.length <= BODY_SNIP_LEN) return t;
  return `${t.slice(0, BODY_SNIP_LEN)}…`;
}

/** Unauthenticated GET /health (no API key), for reachability checks. */
export async function probeHealth(baseUrl: string): Promise<HealthProbeResult> {
  const client = createHttpClient({ baseUrl });
  try {
    const response = await client.get(HEALTH_PATH);
    const body = await response.text();
    if (response.ok) {
      return { kind: "ok", status: response.status, body };
    }
    return { kind: "http", status: response.status, body };
  } catch (error) {
    return { kind: "transport", error };
  }
}

export function healthHttpErrorMessage(status: number, body: string): string {
  const snip = truncateForMessage(body);
  const suffix = snip ? `: ${snip}` : "";
  return `GET ${HEALTH_PATH} returned ${status}${suffix}`;
}

export function healthHumanSuccessLine(status: number, body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return `OK (HTTP ${status})`;
  return `OK (HTTP ${status})\n${trimmed}`;
}

export function transportErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
