import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { checkConnectionToolResult } from "./check-connection.js";

export type TempoMcpServerConfig = {
  baseUrl: string;
  apiKey?: string;
  /** Server identity advertised to the MCP client. */
  name?: string;
  version?: string;
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

  return server;
}
