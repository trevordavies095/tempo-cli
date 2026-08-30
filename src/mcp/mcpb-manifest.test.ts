import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CHECK_CONNECTION_TOOL_NAME,
  createTempoMcpServer,
} from "./create-tempo-mcp-server.js";
import { GENERATE_WEEKLY_RECAP_TOOL_NAME } from "./generate-weekly-recap.js";
import { SAVE_PRESCRIBED_WEEK_TOOL_NAME } from "./save-prescribed-week.js";
import { SAVE_SUBJECTIVE_RESPONSES_TOOL_NAME } from "./save-subjective-responses.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifestPath = join(repoRoot, "mcpb", "manifest.json");

type McpbManifest = {
  version: string;
  server: {
    type: string;
    entry_point: string;
    mcp_config: {
      command: string;
      args: string[];
      env: Record<string, string>;
    };
  };
  user_config: {
    base_url: { type: string; required?: boolean; sensitive?: boolean };
    api_key: { type: string; required?: boolean; sensitive?: boolean };
  };
  tools: Array<{ name: string; description?: string }>;
};

const EXPECTED_TOOL_NAMES = [
  CHECK_CONNECTION_TOOL_NAME,
  GENERATE_WEEKLY_RECAP_TOOL_NAME,
  SAVE_SUBJECTIVE_RESPONSES_TOOL_NAME,
  SAVE_PRESCRIBED_WEEK_TOOL_NAME,
] as const;

describe("mcpb/manifest.json", () => {
  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf8"),
  ) as McpbManifest;

  it("declares the same four tools as createTempoMcpServer", () => {
    expect(manifest.tools.map((t) => t.name)).toEqual([...EXPECTED_TOOL_NAMES]);
    // Sanity: factory still registers the same set (guards rename drift).
    createTempoMcpServer({ baseUrl: "http://localhost:5001" });
  });

  it("maps optional user_config to TEMPO_* env and keychain-sensitive api_key", () => {
    expect(manifest.server.mcp_config.env).toEqual({
      TEMPO_BASE_URL: "${user_config.base_url}",
      TEMPO_API_KEY: "${user_config.api_key}",
    });
    expect(manifest.user_config.base_url.required).toBe(false);
    expect(manifest.user_config.api_key.required).toBe(false);
    expect(manifest.user_config.api_key.sensitive).toBe(true);
  });

  it("launches a dedicated MCP entry module (not the CLI subcommand)", () => {
    expect(manifest.server.type).toBe("node");
    expect(manifest.server.entry_point).toBe("dist/mcp/main.js");
    expect(manifest.server.mcp_config.command).toBe("node");
    // Claude Desktop's UtilityProcess nodeHost `import()`s each args entry as a
    // module path. A bare "mcp" subcommand string fails with
    // "Cannot find module '/mcp'". The CLI entry also cannot be used: Desktop
    // appends args on top of entry_point and Commander then exits with
    // "too many arguments".
    expect(manifest.server.mcp_config.args).toEqual([
      "${__dirname}/dist/mcp/main.js",
    ]);
  });
});
