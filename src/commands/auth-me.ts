import { createHttpClient } from "../http/client.js";

export const AUTH_ME_PATH = "/auth/me";

const BODY_SNIP_LEN = 500;

export type AuthMeOk = {
  kind: "ok";
  status: number;
  body: string;
};

export type AuthMeHttpError = {
  kind: "http";
  status: number;
  body: string;
};

export type AuthMeTransport = {
  kind: "transport";
  error: unknown;
};

export type AuthMeResult = AuthMeOk | AuthMeHttpError | AuthMeTransport;

function truncateForMessage(body: string): string {
  const t = body.trim();
  if (t.length <= BODY_SNIP_LEN) return t;
  return `${t.slice(0, BODY_SNIP_LEN)}…`;
}

/** GET /auth/me with Bearer apiKey (caller must pass non-empty key). */
export async function probeAuthMe(
  baseUrl: string,
  apiKey: string,
): Promise<AuthMeResult> {
  const client = createHttpClient({ baseUrl, apiKey });
  try {
    const response = await client.get(AUTH_ME_PATH);
    const body = await response.text();
    if (response.ok) {
      return { kind: "ok", status: response.status, body };
    }
    return { kind: "http", status: response.status, body };
  } catch (error) {
    return { kind: "transport", error };
  }
}

export function authMeHttpErrorMessage(status: number, body: string): string {
  const snip = truncateForMessage(body);
  const suffix = snip ? `: ${snip}` : "";
  return `GET ${AUTH_ME_PATH} returned ${status}${suffix}`;
}

export function authMeHumanSuccessLine(status: number, body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return `OK (HTTP ${status})`;
  return `OK (HTTP ${status})\n${trimmed}`;
}
