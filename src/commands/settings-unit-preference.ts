import { createHttpClient } from "../http/client.js";
import { humanLinesFromApiBody } from "../output/human-api-body.js";
import { redactApiKeyInText } from "./auth-me.js";

export const SETTINGS_UNIT_PREFERENCE_PATH = "/settings/unit-preference";

const BODY_SNIP_LEN = 500;

export type SettingsUnitPreferenceOk = {
  kind: "ok";
  status: number;
  body: string;
};

export type SettingsUnitPreferenceHttpError = {
  kind: "http";
  status: number;
  body: string;
};

export type SettingsUnitPreferenceTransport = {
  kind: "transport";
  error: unknown;
};

export type SettingsUnitPreferenceResult =
  | SettingsUnitPreferenceOk
  | SettingsUnitPreferenceHttpError
  | SettingsUnitPreferenceTransport;

function truncateForMessage(body: string): string {
  const t = body.trim();
  if (t.length <= BODY_SNIP_LEN) return t;
  return `${t.slice(0, BODY_SNIP_LEN)}…`;
}

/**
 * GET /settings/unit-preference with Bearer apiKey (caller must pass non-empty key).
 *
 * Read-only: never invokes `PUT /settings/unit-preference`.
 */
export async function probeSettingsUnitPreference(
  baseUrl: string,
  apiKey: string,
): Promise<SettingsUnitPreferenceResult> {
  const client = createHttpClient({ baseUrl, apiKey });
  try {
    const response = await client.get(SETTINGS_UNIT_PREFERENCE_PATH);
    const body = await response.text();
    if (response.ok) {
      return { kind: "ok", status: response.status, body };
    }
    return { kind: "http", status: response.status, body };
  } catch (error) {
    return { kind: "transport", error };
  }
}

export function settingsUnitPreferenceHttpErrorMessage(
  status: number,
  body: string,
): string {
  const snip = truncateForMessage(body);
  const suffix = snip ? `: ${snip}` : "";
  return `GET ${SETTINGS_UNIT_PREFERENCE_PATH} returned ${status}${suffix}`;
}

export function settingsUnitPreferenceHttpErrorMessageForCli(
  status: number,
  body: string,
  apiKey: string,
): string {
  return settingsUnitPreferenceHttpErrorMessage(
    status,
    redactApiKeyInText(body, apiKey),
  );
}

export function settingsUnitPreferenceHumanSuccessLine(
  status: number,
  body: string,
): string {
  const block = humanLinesFromApiBody(body);
  if (!block) return `OK (HTTP ${status})`;
  return `OK (HTTP ${status})\n${block}`;
}
