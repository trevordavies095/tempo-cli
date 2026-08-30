import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Map a connection-check outcome to an MCP tool result. */
export function textToolResult(
  text: string,
  options?: { isError?: boolean },
): CallToolResult {
  return {
    content: [{ type: "text", text }],
    ...(options?.isError ? { isError: true } : {}),
  };
}
