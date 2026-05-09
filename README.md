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

## Command naming

- **`tempo workouts list`** — list or filter workouts (plural **`workouts`** for the collection).
- **`tempo workout get <id>`** — fetch one workout by ID (singular **`workout`**).

Some tutorials or older snippets use **`tempo workout list`**. That form is **not** a command in this CLI; use **`tempo workouts list`** instead. There is **no** `workout list` alias in v1—the canonical spelling above is what scripts and docs should standardize on.

For the same wording as **`--help`**, see **`tempo workouts list --help`** and **`tempo workout --help`**.

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

### Human vs JSON (workout commands)

With **`--output human`** (the default), workout read commands print **compact tables**: fixed columns and a row cap so large lists stay readable. That applies to **`tempo workouts list`**, **`tempo workout get`**, **`tempo workout similar-routes`**, and **`tempo workout media list`**. Use **`--output json`** when you need the **full API payload** in the usual JSON success wrapper on stdout. **`tempo workout media download`** still streams raw bytes; see **`--help`** for that command.

## API contract

A vendored OpenAPI snapshot lives at [`tempo_openapi_spec.json`](tempo_openapi_spec.json) for tests and client generation. When Tempo publishes a canonical spec from its mainline branches, this repo should track that for compatibility notes and codegen.

## Development

**Contributor reference:** [CLI runtime](docs/contributing/cli-runtime.md) — environment variables, config path and precedence, streams, exit codes, JSON errors, and a source map (for onboarding without spelunking).

- **Prerequisites:** Node.js 20 or newer (see `.nvmrc` for a suggested version).
- **Install:** `npm install`
- **Build:** `npm run build` (emits JavaScript to `dist/`)
- **Watch mode:** `npm run dev` (runs the TypeScript compiler in watch mode)
- **Typecheck:** `npm run typecheck`
- **Tests:** `npm test` (Vitest)
- **Run locally:** After a build, `npx tempo` or `node dist/cli.js`.

### Stream discipline (stdout vs stderr)

- **stdout:** Successful command **data** — for example [`writeCommandSuccess`](src/output/success.ts), the primary result line from **`tempo config set-api-key`**, and future JSON bodies from API commands.
- **stderr:** **Errors**, **warnings**, **progress**, and **informational hints** (such as the Unix **`0600`** note after saving an API key). Prefer [`src/io/streams.ts`](src/io/streams.ts) (`writeOutLine` / `writeErrLine`) in new code so piping **`stdout`** stays clean.
- **Help text** (`--help`, **`tempo` with no subcommand**) is printed by **Commander** to **stdout** by default (pager-friendly). That is separate from machine-oriented JSON success output.

### Exit codes

The CLI uses a small, stable set of process exit codes (see [`src/exit/exits.ts`](src/exit/exits.ts)). Successful commands exit **0**. When HTTP-backed commands are added, they should map API outcomes with **`exitCodeForHttpStatus`** (for response status) and **`exitCodeForFetchFailure`** (when **`fetch`** throws before a usable response).

| Code | Meaning |
| ---: | --- |
| **0** | Success |
| **1** | Invalid usage, CLI validation, config parse errors, and other **4xx** HTTP responses not mapped below (Commander also uses **1** for bad flags such as invalid **`--output`**, consistent with **`EXIT_USAGE`**) |
| **2** | Auth denied (**401** / **403**) |
| **3** | Server error (**5xx**) |
| **4** | Not found (**404**) |
| **5** | Network / DNS / timeout and other transport failures (no successful HTTP response) |

### JSON errors (stderr)

When **`--output json`** and a command fails in a path the CLI controls (invalid config file, missing key source for **`config set-api-key`**, config write failure, etc.), **stderr** is a **single line** of JSON: an object with an **`error`** field shaped like Tempo’s predictable errors (**`code`**, **`message`**, **`request_id`**). For local failures, **`request_id`** is **`null`**. Success responses stay on **stdout** only; see [`writeCommandError`](src/output/error.ts).

**Commander** may still print **human** text for invalid global flags (for example a bad **`--output`** value), because **`json`** output was never successfully selected.

**Pre-parse config errors:** If the only **`json`** preference is inside **`config.toml`** and that file cannot be parsed, the CLI cannot read **`output`** from it—pass **`--output json`** on the command line to get JSON on **stderr** for that failure.

### HTTP client (for contributors)

Commands use a shared **`createHttpClient`** helper ([`src/http/client.ts`](src/http/client.ts)) built on Node’s global **`fetch`**.

- **Bearer auth:** Pass **`apiKey`** (for example from resolved CLI config, `TEMPO_API_KEY`, `--api-key`, or config file via [`getEffectiveGlobalConfig`](src/config/runtime.ts)). When the trimmed key is non-empty, every **`get()`** sends **`Authorization: Bearer …`**. If the key is missing or blank, that header is omitted. The HTTP client does **not** log or echo keys. Requests use **`credentials: "omit"`** so cookies are not sent (API key only).
- **Default timeout:** **`30_000` ms** (`DEFAULT_TIMEOUT_MS`) per request unless overridden when creating the client.
- **TLS:** HTTPS uses Node’s default CA trust store (same as other Node TLS). To add corporate roots, use **`NODE_EXTRA_CA_CERTS`** (see the [Node.js documentation](https://nodejs.org/api/cli.html#node_extra_ca_certsfile)).
- **Proxy / `NO_PROXY`:** There is no custom proxy parser in the CLI. Behavior for **`HTTP_PROXY`**, **`HTTPS_PROXY`**, and **`NO_PROXY` / `no_proxy`** follows your **Node.js version’s `fetch` implementation** (Undici). Newer Node releases improve automatic proxy handling for `fetch`; upgrade Node if your environment requires it, and refer to [Undici](https://github.com/nodejs/undici) / Node release notes for details.

### CLI usage (early)

Run **`tempo --help`** (or **`tempo -h`**) for global flags: **`--base-url`**, **`--output`** (`human` or `json`), **`--api-key`**, and **`--version`**. The help footer lists the **config file path**, precedence (file, then env, then flags), and **`TEMPO_BASE_URL`** / **`TEMPO_API_KEY`**.

Subcommands such as **`tempo health`**, **`tempo server version`**, **`tempo auth me`**, and **`tempo version`** also support **`--help`** with copy-paste examples and a reminder to use **`tempo --help`** for globals (subcommand help does not repeat every global flag).

**`tempo health`** calls **`GET /health`** on your configured base URL (**`--base-url`**, **`TEMPO_BASE_URL`**, or `base_url` in the config file). It does **not** send **`Authorization`** or use **`TEMPO_API_KEY`** / **`--api-key`**, so you can check that the instance is reachable before debugging auth.

- **Human (default):** prints `OK (HTTP <status>)`, and if the response has a body, that text on the following line(s).
- **JSON:** one object on **stdout**, for example `{"ok":true,"status":200,"path":"/health","body":""}`.
- **Failures:** HTTP error responses use the [exit codes](#exit-codes) table (`401`/`403` → **2**, `404` → **4**, `5xx` → **3**, other `4xx` → **1**). Network/timeouts/DNS failures exit **5**. With **`--output json`**, a single JSON error object is written to **stderr** (`error.code` **`HTTP_ERROR`** or **`TRANSPORT`**).

**`tempo server version`** calls **`GET /version`** on your configured base URL. Like **`tempo health`**, it does **not** send an API key, so it works when that route is public on your instance.

- **Human (default):** after `OK (HTTP <status>)`, if the body is a JSON **object**, each field is one line as **`key: value`** (keys sorted alphabetically); nested values are shown as compact JSON. Non-object or non-JSON bodies print as plain text, like **`tempo health`**.
- **JSON / failures:** Same conventions as **`tempo health`**, but with **`path`**: **`"/version"`** in the success JSON (for example `{"ok":true,"status":200,"path":"/version","body":""}`).

**`tempo auth me`** calls **`GET /auth/me`** with **`Authorization: Bearer`** using your merged API key (**`--api-key`**, **`TEMPO_API_KEY`**, or **`api_key`** in the config file). It only performs this GET (no cookies, no **`POST /auth/login`**).

- **Human (default):** same JSON-object **key: value** summary rules as **`tempo server version`**; **`--output json`** still returns the full **`body`** string in the success object.
- **JSON:** Same envelope as **`tempo health`**, with **`path`**: **`"/auth/me"`** in the success JSON.
- **Missing API key:** exits **1** with **`MISSING_API_KEY`** on **stderr** (and JSON error shape when **`--output json`**).
- **Failures:** Same [exit codes](#exit-codes) and stderr JSON conventions as **`tempo health`** for HTTP and transport errors.

**Automation (`tempo auth me`):** for scripting, use **`--output json`** on **stderr** for failures. Exit **1** = missing API key (**`MISSING_API_KEY`**); **2** = **401** / **403**; **5** = network/transport (no HTTP response). Other HTTP statuses follow the global [exit codes](#exit-codes) table. CLI-built error messages **redact** your configured key if a rare server error body repeats it, so **`error.message`** is safer to log than raw response text.

**`tempo version`** prints the **local** CLI version from the npm package. With **`--output human`** (default) it prints one line (`<name> <version>`). With **`--output json`** it prints a single JSON object on **stdout**, for example:

```json
{"ok":true,"cliVersion":"0.0.0","cli":{"name":"tempo-cli","version":"0.0.0"}}
```

**`tempo config set-api-key`** writes an API key to the config file with restrictive permissions on Unix. **`tempo` with no arguments** prints the same help text to **stdout** and exits **0** (same as `tempo --help`). Invalid **`--output`** values (not `human` or `json`) exit **1** with an error on **stderr** (enforced by the CLI parser).

Toolchain rationale (TypeScript on Node vs other options) is documented in [docs/adr/0001-use-typescript-node-for-cli.md](docs/adr/0001-use-typescript-node-for-cli.md).

## Contributing

See [CLI runtime (contributor reference)](docs/contributing/cli-runtime.md) for env vars, config resolution, exit codes, JSON error shape, and links to implementing modules.

Issues and pull requests for this repository should cover CLI behavior, packaging, and documentation. Changes to Tempo’s API, authentication, or OpenAPI publishing belong in the [Tempo](https://github.com/trevordavies095/tempo/) repository; link related work across repos when both sides change.

## License

TBD—align with the chosen license for this repository when you add a `LICENSE` file.
