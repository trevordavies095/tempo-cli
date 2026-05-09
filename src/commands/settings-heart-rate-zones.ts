import { createHttpClient } from "../http/client.js";
import { humanLinesFromApiBody } from "../output/human-api-body.js";
import { redactApiKeyInText } from "./auth-me.js";

export const SETTINGS_HEART_RATE_ZONES_PATH = "/settings/heart-rate-zones";

const BODY_SNIP_LEN = 500;

export type SettingsHeartRateZonesOk = {
  kind: "ok";
  status: number;
  body: string;
};

export type SettingsHeartRateZonesHttpError = {
  kind: "http";
  status: number;
  body: string;
};

export type SettingsHeartRateZonesTransport = {
  kind: "transport";
  error: unknown;
};

export type SettingsHeartRateZonesResult =
  | SettingsHeartRateZonesOk
  | SettingsHeartRateZonesHttpError
  | SettingsHeartRateZonesTransport;

function truncateForMessage(body: string): string {
  const t = body.trim();
  if (t.length <= BODY_SNIP_LEN) return t;
  return `${t.slice(0, BODY_SNIP_LEN)}…`;
}

/**
 * GET /settings/heart-rate-zones with Bearer apiKey (caller must pass non-empty key).
 *
 * Read-only: never invokes `PUT /settings/heart-rate-zones` or
 * `POST /settings/heart-rate-zones/update-with-recalc`.
 */
export async function probeSettingsHeartRateZones(
  baseUrl: string,
  apiKey: string,
): Promise<SettingsHeartRateZonesResult> {
  const client = createHttpClient({ baseUrl, apiKey });
  try {
    const response = await client.get(SETTINGS_HEART_RATE_ZONES_PATH);
    const body = await response.text();
    if (response.ok) {
      return { kind: "ok", status: response.status, body };
    }
    return { kind: "http", status: response.status, body };
  } catch (error) {
    return { kind: "transport", error };
  }
}

export function settingsHeartRateZonesHttpErrorMessage(
  status: number,
  body: string,
): string {
  const snip = truncateForMessage(body);
  const suffix = snip ? `: ${snip}` : "";
  return `GET ${SETTINGS_HEART_RATE_ZONES_PATH} returned ${status}${suffix}`;
}

export function settingsHeartRateZonesHttpErrorMessageForCli(
  status: number,
  body: string,
  apiKey: string,
): string {
  return settingsHeartRateZonesHttpErrorMessage(
    status,
    redactApiKeyInText(body, apiKey),
  );
}

export function settingsHeartRateZonesHumanSuccessLine(
  status: number,
  body: string,
): string {
  const block = humanLinesFromApiBody(body);
  if (!block) return `OK (HTTP ${status})`;
  return `OK (HTTP ${status})\n${block}`;
}
