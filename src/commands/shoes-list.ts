import { createHttpClient } from "../http/client.js";
import { humanLinesFromApiBody } from "../output/human-api-body.js";
import { redactApiKeyInText } from "./auth-me.js";

export const SHOES_LIST_PATH = "/shoes";

const BODY_SNIP_LEN = 500;

export type ShoesListOk = {
  kind: "ok";
  status: number;
  body: string;
};

export type ShoesListHttpError = {
  kind: "http";
  status: number;
  body: string;
};

export type ShoesListTransport = {
  kind: "transport";
  error: unknown;
};

export type ShoesListResult =
  | ShoesListOk
  | ShoesListHttpError
  | ShoesListTransport;

function truncateForMessage(body: string): string {
  const t = body.trim();
  if (t.length <= BODY_SNIP_LEN) return t;
  return `${t.slice(0, BODY_SNIP_LEN)}…`;
}

/**
 * GET /shoes with Bearer apiKey (caller must pass non-empty key).
 *
 * Read-only: never invokes `POST /shoes`, `PATCH /shoes/{id}`, or
 * `DELETE /shoes/{id}`. The spec has no `GET /shoes/{id}`, so the CLI does
 * not provide a shoe-detail command.
 */
export async function probeShoesList(
  baseUrl: string,
  apiKey: string,
): Promise<ShoesListResult> {
  const client = createHttpClient({ baseUrl, apiKey });
  try {
    const response = await client.get(SHOES_LIST_PATH);
    const body = await response.text();
    if (response.ok) {
      return { kind: "ok", status: response.status, body };
    }
    return { kind: "http", status: response.status, body };
  } catch (error) {
    return { kind: "transport", error };
  }
}

export function shoesListHttpErrorMessage(
  status: number,
  body: string,
): string {
  const snip = truncateForMessage(body);
  const suffix = snip ? `: ${snip}` : "";
  return `GET ${SHOES_LIST_PATH} returned ${status}${suffix}`;
}

export function shoesListHttpErrorMessageForCli(
  status: number,
  body: string,
  apiKey: string,
): string {
  return shoesListHttpErrorMessage(status, redactApiKeyInText(body, apiKey));
}

export function shoesListHumanSuccessLine(
  status: number,
  body: string,
): string {
  const block = humanLinesFromApiBody(body);
  if (!block) return `OK (HTTP ${status})`;
  return `OK (HTTP ${status})\n${block}`;
}
