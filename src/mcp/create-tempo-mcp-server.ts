import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { checkConnectionToolResult } from "./check-connection.js";
import {
  GENERATE_WEEKLY_RECAP_TOOL_DESCRIPTION,
  GENERATE_WEEKLY_RECAP_TOOL_NAME,
  generateWeeklyRecapInputShape,
  generateWeeklyRecapToolResult,
} from "./generate-weekly-recap.js";

export type TempoMcpServerConfig = {
  baseUrl: string;
  apiKey?: string;
  /** Server identity advertised to the MCP client. */
  name?: string;
  version?: string;
  /** Default IANA timezone from config.toml when tool args omit timezone. */
  timezone?: string;
  /** Default for include_trends when the tool omits it ([report].include_trends). */
  includeTrendsDefault?: boolean;
  prescribedDir?: string;
  subjectiveDir?: string;
  cacheDir?: string;
};

export const CHECK_CONNECTION_TOOL_NAME = "check_connection";

export const CHECK_CONNECTION_TOOL_DESCRIPTION =
  "Probe the configured Tempo instance: GET /health (no auth), then GET /auth/me with the configured API key. Reports whether the instance is reachable and whether the key authenticates. Use this when setup fails or before generating a weekly recap.";

/**
 * Build an MCP server with Tempo tools. Does not connect a transport.
 */
export function createTempoMcpServer(config: TempoMcpServerConfig): McpServer {
  const server = new McpServer({
    name: config.name ?? "tempo-cli",
    version: config.version ?? "0.0.0",
  });

  server.registerTool(
    CHECK_CONNECTION_TOOL_NAME,
    {
      title: "Check Tempo connection",
      description: CHECK_CONNECTION_TOOL_DESCRIPTION,
    },
    async () =>
      checkConnectionToolResult({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
      }),
  );

  server.registerTool(
    GENERATE_WEEKLY_RECAP_TOOL_NAME,
    {
      title: "Generate weekly recap",
      description: GENERATE_WEEKLY_RECAP_TOOL_DESCRIPTION,
      inputSchema: generateWeeklyRecapInputShape,
    },
    async (args) =>
      generateWeeklyRecapToolResult(
        {
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          timezone: config.timezone,
          includeTrendsDefault: config.includeTrendsDefault,
          prescribedDir: config.prescribedDir,
          subjectiveDir: config.subjectiveDir,
          cacheDir: config.cacheDir,
        },
        {
          week: args.week,
          timezone: args.timezone,
          include_trends: args.include_trends,
          skip_subjective: args.skip_subjective,
        },
      ),
  );

  return server;
}
