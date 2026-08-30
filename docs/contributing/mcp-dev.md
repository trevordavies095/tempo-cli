# MCP server (contributor reference)

`tempo mcp` starts a **stdio** [Model Context Protocol](https://modelcontextprotocol.io/) server so Claude Desktop (and other MCP hosts) can call Tempo tools on the user’s machine. End-user packaging (`.mcpb` bundles) is out of scope here; this page is for local development.

## Prerequisites

1. `npm install` and `npm run build` (emits `dist/cli.js`).
2. A Tempo base URL and (for authenticated tools) an API key via the same resolution chain as the rest of the CLI: `config.toml` → `TEMPO_BASE_URL` / `TEMPO_API_KEY` → `--base-url` / `--api-key`.

## Run locally

```bash
# Uses config.toml / env; stdout is JSON-RPC only
tempo mcp

# Explicit globals (same as other commands)
TEMPO_BASE_URL=http://localhost:5001 TEMPO_API_KEY=tmp_... tempo mcp
tempo --base-url http://localhost:5001 --api-key tmp_... mcp
```

Startup may print a one-line status on **stderr**. Do not write CLI success envelopes or help text to **stdout** from MCP code — the host treats stdout as the JSON-RPC transport.

## Claude Desktop (manual config)

After a local build, add a server entry to Claude Desktop’s MCP config (path varies by OS; typically `claude_desktop_config.json`). Replace the path with your checkout’s absolute `dist/cli.js`:

```json
{
  "mcpServers": {
    "tempo": {
      "command": "node",
      "args": ["/absolute/path/to/tempo-cli/dist/cli.js", "mcp"],
      "env": {
        "TEMPO_BASE_URL": "http://localhost:5001",
        "TEMPO_API_KEY": "tmp_..."
      }
    }
  }
}
```

If `base_url` / `api_key` already live in `~/.config/tempo/config.toml` (or the Windows equivalent), you can omit the `env` block. Prefer env or the OS keychain for keys; do not commit real keys into the JSON file.

Restart Claude Desktop after editing the config. In a chat, ask “check my Tempo connection” — the host should call `check_connection`.

## Tools (current)

| Tool | Behavior |
|------|----------|
| `check_connection` | `GET /health` (no auth), then `GET /auth/me` with the configured key. Reports reachable + authenticated, reachable but key rejected, unreachable/transport failure, or missing key after a healthy probe. |

New tools should live under [`src/mcp/`](../../src/mcp/), register in [`create-tempo-mcp-server.ts`](../../src/mcp/create-tempo-mcp-server.ts), and extend the protocol tests in [`create-tempo-mcp-server.test.ts`](../../src/mcp/create-tempo-mcp-server.test.ts) (in-memory MCP client + mocked `fetch`). Keep API-key redaction consistent with [`auth-me.ts`](../../src/commands/auth-me.ts).

## Stream discipline

| Stream | Role under `tempo mcp` |
|--------|-------------------------|
| **stdout** | JSON-RPC frames only |
| **stderr** | Diagnostics, connection notices, errors |

Protocol and purity coverage: in-memory client tests plus [`mcp-stdio-purity.test.ts`](../../src/mcp/mcp-stdio-purity.test.ts) (subprocess round-trip).

## Related

- Runtime / config precedence: [cli-runtime.md](./cli-runtime.md)
- Health and auth probes: [`health.ts`](../../src/commands/health.ts), [`auth-me.ts`](../../src/commands/auth-me.ts)
