import { createHttpClient } from "../http/client.js";
import { humanLinesFromApiBody } from "../output/human-api-body.js";

export const AUTH_ME_PATH = "/auth/me";

const BODY_SNIP_LEN = 500;
export const API_KEY_REDACTED = "[REDACTED]";

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

/** Removes literal API key substrings from text (e.g. server error bodies) before stderr. */
export function redactApiKeyInText(text: string, apiKey: string): string {
  const k = apiKey.trim();
  if (!k || !text.includes(k)) return text;
  return text.split(k).join(API_KEY_REDACTED);
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

/** Like {@link authMeHttpErrorMessage} but redacts `apiKey` in `body` before truncating (CLI stderr). */
export function authMeHttpErrorMessageForCli(
  status: number,
  body: string,
  apiKey: string,
): string {
  return authMeHttpErrorMessage(status, redactApiKeyInText(body, apiKey));
}

export function authMeHumanSuccessLine(status: number, body: string): string {
  const block = humanLinesFromApiBody(body);
  if (!block) return `OK (HTTP ${status})`;
  return `OK (HTTP ${status})\n${block}`;
}

/**
 * Weekly recap §3.4: actionable copy when GET /auth/me returns 401.
 * Uses the configured API base URL origin so self-hosted http/https hosts resolve correctly.
 */
export function authFailedApiKeysSettingsMessage(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  let origin: string;
  try {
    origin = new URL(trimmed).origin;
  } catch {
    try {
      const withScheme = /^https?:\/\//i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`;
      origin = new URL(withScheme).origin;
    } catch {
      const base = trimmed.replace(/\/+$/, "");
      return `Auth failed. Check your API key (tmp_...) at ${base}/settings/api-keys`;
    }
  }
  return `Auth failed. Check your API key (tmp_...) at ${origin}/settings/api-keys`;
}
