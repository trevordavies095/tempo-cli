import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { writeErrLine } from "../io/streams.js";
import { createTempoMcpServer } from "./create-tempo-mcp-server.js";

export type RunStdioMcpServerOptions = {
  baseUrl: string;
  apiKey?: string;
  name?: string;
  version?: string;
};

/**
 * Start the Tempo MCP server on stdio. Owns the process until the transport closes.
 * Diagnostics go to stderr only — stdout is reserved for JSON-RPC.
 */
export async function runStdioMcpServer(
  options: RunStdioMcpServerOptions,
): Promise<void> {
  const server = createTempoMcpServer({
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    name: options.name,
    version: options.version,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  writeErrLine("tempo mcp: stdio server connected (JSON-RPC on stdout)");
}
