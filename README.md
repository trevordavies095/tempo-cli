# tempo-cli

Official-style command-line client for **[Tempo](https://github.com/trevordavies095/tempo/)**, a privacy-first, self-hosted running tracker. The CLI talks to your Tempo HTTP API so you can list workouts, inspect stats, and script against your instance without opening the browser.

**Status:** Design and scaffolding phase—the executable is not published yet.

## Scope

- **Read-only:** The CLI only uses safe `GET` requests. Imports, edits, uploads, login flows, and other writes stay in the Tempo web UI (or other clients).
- **Agent-friendly:** Stable subcommands, `--output json` for machines, documented exit codes, and no mandatory interactive prompts when `TEMPO_API_KEY` is set.
- **Self-hosted:** You point the CLI at your own base URL (for example `https://tempo.example.com` or `http://localhost:5001`).

## Requirements

- A running Tempo server reachable from your machine.
- Machine access via an **admin-issued API key** (`Authorization: Bearer`, key prefix `tmp_` in current Tempo designs). Key creation and rotation happen in Tempo, not in this CLI.

## Command naming (planned)

- **`tempo workouts list`** — list workouts (plural group).
- **`tempo workout get <id>`** — one workout by ID.

Some early examples used `tempo workout list`; the canonical list command above is the one this project will implement (optional alias TBD).

## Configuration

### Config file

Optional **`config.toml`** supplies defaults before environment variables and CLI flags.

| Platform | Path |
|----------|------|
| Unix / macOS | `$XDG_CONFIG_HOME/tempo/config.toml`, or `~/.config/tempo/config.toml` if `XDG_CONFIG_HOME` is unset |
| Windows | `%APPDATA%\tempo\config.toml` (typically `~\AppData\Roaming\tempo\config.toml`) |

Optional keys (all strings except `output`): **`base_url`**, **`output`** (`human` or `json`), **`api_key`**. Keys are **admin-issued in Tempo**; this CLI does not create keys or prompt for them interactively.

**Precedence** (later wins): built-in defaults, then config file, then environment, then explicit CLI flags. So **`TEMPO_*` overrides the file** when a flag is not passed.

Example:

```toml
base_url = "http://localhost:5001"
output = "human"
# api_key = "tmp_..."   # optional; prefer env in CI
```

Invalid TOML or an invalid `output` value causes the CLI to exit with an error on stderr.

### Saving an API key to the config file

Use a key **issued in Tempo** (this CLI does not create keys):

```bash
tempo config set-api-key --api-key 'tmp_...'
```

Key source **precedence** for this command: **`--api-key`** (including the global flag before the subcommand, e.g. `tempo --api-key 'tmp_...' config set-api-key`), then **`TEMPO_API_KEY`**, then the **first non-empty line on stdin** (when stdin is not a TTY), e.g. `printf '%s' "$TEMPO_API_KEY" | tempo config set-api-key`.

The command **merges** `api_key` into existing `config.toml` and **preserves** other keys (such as `base_url`). It prints the config **path only** on success; the key is **never logged** or echoed.

**Permissions:** On **Unix / macOS**, the config file is created or updated with mode **`0600`** (user read/write only), and the containing `tempo` directory is created with **`0700`** when the CLI creates it. On **Windows**, POSIX modes are not enforced the same way; treat permissions as **best-effort** and rely on your account and filesystem ACLs.

### Environment variables

| Variable | Purpose |
|----------|---------|
| `TEMPO_BASE_URL` | Overrides `base_url` from the file when `--base-url` is omitted |
| `TEMPO_API_KEY` | Overrides `api_key` from the file when `--api-key` is omitted |

Global flags mirror these where useful (`--base-url`, `--api-key`, `--output`).

## API contract

A vendored OpenAPI snapshot lives at [`tempo_openapi_spec.json`](tempo_openapi_spec.json) for tests and client generation. When Tempo publishes a canonical spec from its mainline branches, this repo should track that for compatibility notes and codegen.

## Development

- **Prerequisites:** Node.js 20 or newer (see `.nvmrc` for a suggested version).
- **Install:** `npm install`
- **Build:** `npm run build` (emits JavaScript to `dist/`)
- **Watch mode:** `npm run dev` (runs the TypeScript compiler in watch mode)
- **Typecheck:** `npm run typecheck`
- **Tests:** `npm test` (Vitest)
- **Run locally:** After a build, `npx tempo` or `node dist/cli.js`.

### HTTP client (for contributors)

Commands use a shared **`createHttpClient`** helper ([`src/http/client.ts`](src/http/client.ts)) built on Node’s global **`fetch`**.

- **Default timeout:** **`30_000` ms** (`DEFAULT_TIMEOUT_MS`) per request unless overridden when creating the client.
- **TLS:** HTTPS uses Node’s default CA trust store (same as other Node TLS). To add corporate roots, use **`NODE_EXTRA_CA_CERTS`** (see the [Node.js documentation](https://nodejs.org/api/cli.html#node_extra_ca_certsfile)).
- **Proxy / `NO_PROXY`:** There is no custom proxy parser in the CLI. Behavior for **`HTTP_PROXY`**, **`HTTPS_PROXY`**, and **`NO_PROXY` / `no_proxy`** follows your **Node.js version’s `fetch` implementation** (Undici). Newer Node releases improve automatic proxy handling for `fetch`; upgrade Node if your environment requires it, and refer to [Undici](https://github.com/nodejs/undici) / Node release notes for details.

### CLI usage (early)

Run **`tempo --help`** (or **`tempo -h`**) for global flags: **`--base-url`**, **`--output`** (`human` or `json`), **`--api-key`**, and **`--version`**. The help footer lists the **config file path**, precedence (file, then env, then flags), and **`TEMPO_BASE_URL`** / **`TEMPO_API_KEY`**.

Resource commands are not implemented yet. **`tempo config set-api-key`** writes an API key to the config file with restrictive permissions on Unix. **`tempo` with no arguments** prints the same help text to **stdout** and exits **0** (same as `tempo --help`). Invalid flag values (for example **`--output`** not `human` or `json`) exit non-zero with an error on **stderr**.

Toolchain rationale (TypeScript on Node vs other options) is documented in [docs/adr/0001-use-typescript-node-for-cli.md](docs/adr/0001-use-typescript-node-for-cli.md).

## Contributing

Issues and pull requests for this repository should cover CLI behavior, packaging, and documentation. Changes to Tempo’s API, authentication, or OpenAPI publishing belong in the [Tempo](https://github.com/trevordavies095/tempo/) repository; link related work across repos when both sides change.

## License

TBD—align with the chosen license for this repository when you add a `LICENSE` file.
