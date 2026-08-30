import {
  authFailedApiKeysSettingsMessage,
  authMeHttpErrorMessageForCli,
  probeAuthMe,
  redactApiKeyInText,
} from "../commands/auth-me.js";
import {
  healthHttpErrorMessage,
  probeHealth,
  transportErrorMessage,
} from "../commands/health.js";
import {
  EXIT_AUTH,
  EXIT_NOT_FOUND,
  EXIT_SERVER_ERROR,
  exitCodeForHttpStatus,
} from "../exit/exits.js";
import { humanLinesFromApiBody } from "../output/human-api-body.js";
import { textToolResult } from "./tool-result.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type CheckConnectionConfig = {
  baseUrl: string;
  apiKey?: string;
};

export type CheckConnectionTaxonomy =
  | "ok"
  | "usage"
  | "auth"
  | "server"
  | "not_found"
  | "transport";

export type CheckConnectionOutcome = {
  taxonomy: CheckConnectionTaxonomy;
  text: string;
  /** When true, MCP tool result should set isError. */
  isError: boolean;
};

function taxonomyForHttpStatus(status: number): CheckConnectionTaxonomy {
  const code = exitCodeForHttpStatus(status);
  if (code === EXIT_AUTH) return "auth";
  if (code === EXIT_NOT_FOUND) return "not_found";
  if (code === EXIT_SERVER_ERROR) return "server";
  return "usage";
}

function identitySummary(body: string): string {
  const lines = humanLinesFromApiBody(body);
  if (!lines) return "OK";
  const preferred = ["email", "name", "username", "id", "userId", "user_id"];
  const map = new Map<string, string>();
  for (const line of lines.split("\n")) {
    const idx = line.indexOf(": ");
    if (idx <= 0) continue;
    map.set(line.slice(0, idx), line.slice(idx + 2));
  }
  for (const key of preferred) {
    const v = map.get(key);
    if (v) return `${key}=${v}`;
  }
  const first = lines.split("\n")[0];
  return first || "OK";
}

/**
 * Probe Tempo reachability and auth. Pure of process streams; safe for MCP tools.
 */
export async function checkConnection(
  config: CheckConnectionConfig,
): Promise<CheckConnectionOutcome> {
  const baseUrl = config.baseUrl.trim();
  const health = await probeHealth(baseUrl);

  if (health.kind === "transport") {
    return {
      taxonomy: "transport",
      isError: true,
      text: `Unreachable at ${baseUrl}: ${transportErrorMessage(health.error)}`,
    };
  }

  if (health.kind === "http") {
    return {
      taxonomy: taxonomyForHttpStatus(health.status),
      isError: true,
      text: `Reachable at ${baseUrl} but health check failed: ${healthHttpErrorMessage(health.status, health.body)}`,
    };
  }

  const key = config.apiKey?.trim();
  if (!key) {
    return {
      taxonomy: "usage",
      isError: false,
      text: [
        `Reachable at ${baseUrl} (GET /health OK), but no API key is configured.`,
        "Set TEMPO_API_KEY, api_key in config.toml, or pass --api-key when starting tempo mcp.",
      ].join(" "),
    };
  }

  const auth = await probeAuthMe(baseUrl, key);

  if (auth.kind === "ok") {
    const summary = identitySummary(auth.body);
    return {
      taxonomy: "ok",
      isError: false,
      text: `Reachable at ${baseUrl}, authenticated (${summary}).`,
    };
  }

  if (auth.kind === "http") {
    if (auth.status === 401 || auth.status === 403) {
      return {
        taxonomy: "auth",
        isError: true,
        text: [
          `Reachable at ${baseUrl}, but the API key was rejected (HTTP ${auth.status}).`,
          authFailedApiKeysSettingsMessage(baseUrl),
        ].join(" "),
      };
    }
    return {
      taxonomy: taxonomyForHttpStatus(auth.status),
      isError: true,
      text: redactApiKeyInText(
        `Reachable at ${baseUrl}, but GET /auth/me failed: ${authMeHttpErrorMessageForCli(auth.status, auth.body, key)}`,
        key,
      ),
    };
  }

  return {
    taxonomy: "transport",
    isError: true,
    text: redactApiKeyInText(
      `Reachable at ${baseUrl}, but auth probe failed: ${transportErrorMessage(auth.error)}`,
      key,
    ),
  };
}

export async function checkConnectionToolResult(
  config: CheckConnectionConfig,
): Promise<CallToolResult> {
  const outcome = await checkConnection(config);
  return textToolResult(outcome.text, { isError: outcome.isError });
}
