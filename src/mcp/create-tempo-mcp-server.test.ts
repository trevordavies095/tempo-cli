import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHECK_CONNECTION_TOOL_DESCRIPTION,
  CHECK_CONNECTION_TOOL_NAME,
  createTempoMcpServer,
} from "./create-tempo-mcp-server.js";

const originalFetch = globalThis.fetch;
const SECRET_KEY = "tmp_protocol_secret_key";
const BASE = "http://localhost:5001";

function connRefused(): TypeError {
  const err = new TypeError("fetch failed");
  (err as Error & { cause: { code: string } }).cause = {
    code: "ECONNREFUSED",
  };
  return err;
}

async function connectPair(config: {
  baseUrl: string;
  apiKey?: string;
}): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = createTempoMcpServer({
    ...config,
    name: "tempo-cli-test",
    version: "0.0.0-test",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe("createTempoMcpServer (protocol)", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("tools/list returns exactly check_connection with stable schema snapshot", async () => {
    const { client, close } = await connectPair({
      baseUrl: BASE,
      apiKey: SECRET_KEY,
    });
    try {
      const listed = await client.listTools();
      expect(listed.tools).toHaveLength(1);
      expect(listed.tools[0]?.name).toBe(CHECK_CONNECTION_TOOL_NAME);
      expect(listed.tools[0]?.description).toBe(
        CHECK_CONNECTION_TOOL_DESCRIPTION,
      );
      expect({
        name: listed.tools[0]?.name,
        description: listed.tools[0]?.description,
        inputSchema: listed.tools[0]?.inputSchema,
      }).toMatchSnapshot();
    } finally {
      await close();
    }
  });

  it("check_connection: healthy + authenticated", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ name: "Ada" }), { status: 200 }),
      ) as typeof fetch;

    const { client, close } = await connectPair({
      baseUrl: BASE,
      apiKey: SECRET_KEY,
    });
    try {
      const result = await client.callTool({
        name: CHECK_CONNECTION_TOOL_NAME,
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      const text = (result.content as { type: string; text: string }[])
        .map((c) => c.text)
        .join("\n");
      expect(text).toMatch(/authenticated/);
      expect(text).toContain("name=Ada");
      expect(text).not.toContain(SECRET_KEY);
    } finally {
      await close();
    }
  });

  it("check_connection: reachable but key rejected", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(`nope ${SECRET_KEY}`, { status: 401 }),
      ) as typeof fetch;

    const { client, close } = await connectPair({
      baseUrl: BASE,
      apiKey: SECRET_KEY,
    });
    try {
      const result = await client.callTool({
        name: CHECK_CONNECTION_TOOL_NAME,
        arguments: {},
      });
      expect(result.isError).toBe(true);
      const text = (result.content as { type: string; text: string }[])
        .map((c) => c.text)
        .join("\n");
      expect(text).toMatch(/rejected|Auth failed/i);
      expect(text).not.toContain(SECRET_KEY);
    } finally {
      await close();
    }
  });

  it("check_connection: unreachable", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(connRefused()) as typeof fetch;

    const { client, close } = await connectPair({
      baseUrl: BASE,
      apiKey: SECRET_KEY,
    });
    try {
      const result = await client.callTool({
        name: CHECK_CONNECTION_TOOL_NAME,
        arguments: {},
      });
      expect(result.isError).toBe(true);
      const text = (result.content as { type: string; text: string }[])
        .map((c) => c.text)
        .join("\n");
      expect(text).toMatch(/Unreachable/);
      expect(text).not.toContain(SECRET_KEY);
    } finally {
      await close();
    }
  });
});
