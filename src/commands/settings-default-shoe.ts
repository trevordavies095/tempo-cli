import { createHttpClient } from "../http/client.js";
import { humanLinesFromApiBody } from "../output/human-api-body.js";
import { redactApiKeyInText } from "./auth-me.js";

export const SETTINGS_DEFAULT_SHOE_PATH = "/settings/default-shoe";

const BODY_SNIP_LEN = 500;

export type SettingsDefaultShoeOk = {
  kind: "ok";
  status: number;
  body: string;
};

export type SettingsDefaultShoeHttpError = {
  kind: "http";
  status: number;
  body: string;
};

export type SettingsDefaultShoeTransport = {
  kind: "transport";
  error: unknown;
};

export type SettingsDefaultShoeResult =
  | SettingsDefaultShoeOk
  | SettingsDefaultShoeHttpError
  | SettingsDefaultShoeTransport;

function truncateForMessage(body: string): string {
  const t = body.trim();
  if (t.length <= BODY_SNIP_LEN) return t;
  return `${t.slice(0, BODY_SNIP_LEN)}…`;
}

/**
 * GET /settings/default-shoe with Bearer apiKey (caller must pass non-empty key).
 *
 * Read-only: never invokes `PUT /settings/default-shoe`.
 */
export async function probeSettingsDefaultShoe(
  baseUrl: string,
  apiKey: string,
): Promise<SettingsDefaultShoeResult> {
  const client = createHttpClient({ baseUrl, apiKey });
  try {
    const response = await client.get(SETTINGS_DEFAULT_SHOE_PATH);
    const body = await response.text();
    if (response.ok) {
      return { kind: "ok", status: response.status, body };
    }
    return { kind: "http", status: response.status, body };
  } catch (error) {
    return { kind: "transport", error };
  }
}

export function settingsDefaultShoeHttpErrorMessage(
  status: number,
  body: string,
): string {
  const snip = truncateForMessage(body);
  const suffix = snip ? `: ${snip}` : "";
  return `GET ${SETTINGS_DEFAULT_SHOE_PATH} returned ${status}${suffix}`;
}

export function settingsDefaultShoeHttpErrorMessageForCli(
  status: number,
  body: string,
  apiKey: string,
): string {
  return settingsDefaultShoeHttpErrorMessage(
    status,
    redactApiKeyInText(body, apiKey),
  );
}

export function settingsDefaultShoeHumanSuccessLine(
  status: number,
  body: string,
): string {
  const block = humanLinesFromApiBody(body);
  if (!block) return `OK (HTTP ${status})`;
  return `OK (HTTP ${status})\n${block}`;
}
