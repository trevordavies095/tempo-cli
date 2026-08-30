import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { writeErrLine } from "../io/streams.js";
import { createTempoMcpServer } from "./create-tempo-mcp-server.js";

export type RunStdioMcpServerOptions = {
  baseUrl: string;
  apiKey?: string;
  name?: string;
  version?: string;
  timezone?: string;
  includeTrendsDefault?: boolean;
  prescribedDir?: string;
  subjectiveDir?: string;
  cacheDir?: string;
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
    timezone: options.timezone,
    includeTrendsDefault: options.includeTrendsDefault,
    prescribedDir: options.prescribedDir,
    subjectiveDir: options.subjectiveDir,
    cacheDir: options.cacheDir,
  });
  const transport = new StdioServerTransport();
  await new Promise<void>((resolve, reject) => {
    const prevClose = transport.onclose;
    transport.onclose = () => {
      try {
        prevClose?.();
      } finally {
        resolve();
      }
    };
    const prevError = transport.onerror;
    transport.onerror = (err) => {
      prevError?.(err);
      // Keep serving unless the transport also closes; log only.
      writeErrLine(
        `tempo mcp: transport error: ${err instanceof Error ? err.message : String(err)}`,
      );
    };
    server.connect(transport).then(
      () => {
        writeErrLine("tempo mcp: stdio server connected (JSON-RPC on stdout)");
      },
      reject,
    );
  });
}
