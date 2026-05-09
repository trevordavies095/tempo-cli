# CLI runtime (contributor reference)

Single entry point for how the executable handles configuration, streams, exit codes, and JSON errors. User-facing narrative also lives in the [README](../../README.md); this page ties behavior to **source files**.

## Environment variables

| Variable | Role |
|----------|------|
| `TEMPO_BASE_URL` | Overrides `base_url` after the config file is merged into pre-flag defaults (see [computePreFlagDefaults](../../src/config/file.ts)); does not override an explicit `--base-url`. |
| `TEMPO_API_KEY` | API key for Bearer auth; merged via [pickApiKey](../../src/config/runtime.ts) (flag, then env, then file). Never log or echo. |

Global flags mirror these: `--base-url`, `--api-key`, `--output`.

## Config file path

Implemented in [getDefaultConfigPath](../../src/config/path.ts).

| Platform | Path |
|----------|------|
| Unix / macOS | `$XDG_CONFIG_HOME/tempo/config.toml`, or `~/.config/tempo/config.toml` if `XDG_CONFIG_HOME` is unset or empty after trim |
| Windows | `%APPDATA%\tempo\config.toml`; if `APPDATA` is unset or empty, `~/AppData/Roaming/tempo/config.toml` |

Optional TOML keys: `base_url`, `output` (`human` \| `json`), `api_key`. Loading and validation: [loadConfigFile](../../src/config/file.ts).

## Precedence (later wins)

1. Built-in defaults (`base_url` `http://localhost:5001`, `output` `human`).
2. Config file (`base_url`, `output`; `api_key` is not used for Commander defaults—see below).
3. Environment: `TEMPO_BASE_URL` is applied inside [computePreFlagDefaults](../../src/config/file.ts) when building flag defaults.
4. Explicit CLI flags (Commander), after parse.

For **API key** on commands that call [pickApiKey](../../src/config/runtime.ts): **flag → `TEMPO_API_KEY` → file `api_key`**.

## Initial config load and `set-api-key`

Most invocations load `config.toml` **before** Commander runs, so invalid TOML fails fast.

**Exception:** when argv is `config set-api-key` (subcommand name and `set-api-key` in the expected positions), [shouldSkipConfigLoad](../../src/cli.ts) skips the **initial** `loadConfigFile` and uses an empty file layer for Commander defaults on that run. That avoids failing during bootstrap before the subcommand runs. The action still merges into disk via [persistApiKey](../../src/config/write.ts), which parses an **existing** file if present—so corrupt on-disk TOML still errors there until the file is fixed or removed (creating a new file when none exists is fine).

**`tempo version` and broken config:** if `loadConfigFile` throws but argv is a `version` invocation (see [isVersionInvocation](../../src/cli/argv-output-peek.ts), after stripping `--output` / `--base-url` / `--api-key`), the CLI treats the file layer as empty and continues so operators can still read the local CLI version. Valid `config.toml` is unchanged: file defaults still apply. `TEMPO_BASE_URL` in [computePreFlagDefaults](../../src/config/file.ts) still applies when the file layer is empty.

## Streams

| Stream | Use |
|--------|-----|
| **stdout** | Successful command payloads—[writeOutLine](../../src/io/streams.ts), [writeCommandSuccess](../../src/output/success.ts). |
| **stderr** | Errors, warnings, hints—[writeErrLine](../../src/io/streams.ts), [writeCommandError](../../src/output/error.ts) for failures. |

## Exit codes

Defined in [src/exit/exits.ts](../../src/exit/exits.ts). HTTP-backed commands should use `exitCodeForHttpStatus` and `exitCodeForFetchFailure` when a response or transport failure is handled.

| Code | Meaning |
|-----:|---------|
| 0 | Success |
| 1 | Usage / validation / config issues / unmapped 4xx (`EXIT_USAGE`) |
| 2 | Auth `401` / `403` (`EXIT_AUTH`) |
| 3 | Server `5xx` (`EXIT_SERVER_ERROR`) |
| 4 | Not found `404` (`EXIT_NOT_FOUND`) |
| 5 | Network / DNS / timeout / fetch failure (`EXIT_TRANSPORT`) |

Commander still exits `1` on invalid flags (e.g. bad `--output`), consistent with `EXIT_USAGE`.

## JSON errors (`--output json`)

On controlled failure paths, [writeCommandError](../../src/output/error.ts) prints **one line** of JSON on **stderr** in `json` mode:

```json
{"error":{"code":"CONFIG_INVALID","message":"…","request_id":null}}
```

Shape matches the product doc: `error.code`, `error.message`, `error.request_id`. Local CLI errors use `request_id: null`.

**CLI-local `error.code` values** (see [error.ts](../../src/output/error.ts)):

| Code | Typical cause |
|------|----------------|
| `CONFIG_INVALID` | Invalid or unreadable config during initial load |
| `MISSING_API_KEY` | No key from flag, env, or stdin for `config set-api-key`; or no key for `tempo auth me` |
| `CONFIG_WRITE_FAILED` | Persisting the key to disk failed |
| `HTTP_ERROR` | HTTP response with a non-success status (e.g. `tempo health` `GET /health` or `tempo server version` `GET /version` returned 4xx/5xx) |
| `TRANSPORT` | `fetch` failed before a usable response (timeout, DNS, connection refused, etc.) |

**`tempo health`** and **`tempo server version`** use [`createHttpClient`](../../src/http/client.ts) with **only** `baseUrl` (no `api_key`), so **`Authorization`** is never sent for those commands. Implementations: [`health.ts`](../../src/commands/health.ts), [`server-version.ts`](../../src/commands/server-version.ts).

For **`tempo auth me`**, non-success HTTP responses build stderr messages from the response body after [`redactApiKeyInText`](../../src/commands/auth-me.ts) so the configured API key is not repeated in **`error.message`** if the server echoes it.

**Caveats:**

- Commander may still print **human** text for invalid global options because `json` mode was never applied.
- Before Commander parses, only [peekOutputModeFromArgv](../../src/cli/argv-output-peek.ts) can detect `--output json`. If `output = "json"` is **only** in a broken `config.toml`, pre-parse failures cannot use that preference—pass `--output json` on the command line for JSON on stderr.

## HTTP client (summary)

Shared helper: [createHttpClient](../../src/http/client.ts). Default timeout `DEFAULT_TIMEOUT_MS` (30_000 ms). Bearer header when `apiKey` is non-empty after trim; keys are never logged. All GETs use **`credentials: "omit"`** so cookies are not sent. Some commands (**`tempo health`**, **`tempo server version`**) intentionally omit `apiKey` so requests stay unauthenticated; **`tempo auth me`** passes the merged key. TLS and proxy behavior follow Node’s `fetch` (Undici); details and env hints are in the README **Development** section.

## Source map

| Concern | Primary modules |
|---------|-----------------|
| Config path | [path.ts](../../src/config/path.ts) |
| TOML load, pre-flag defaults | [file.ts](../../src/config/file.ts) |
| Effective config / API key merge | [runtime.ts](../../src/config/runtime.ts) |
| Persist API key | [write.ts](../../src/config/write.ts) |
| Entry, Commander, config load skip | [cli.ts](../../src/cli.ts) |
| Argv output peek, `version` detection | [argv-output-peek.ts](../../src/cli/argv-output-peek.ts) (`peekOutputModeFromArgv`, `isVersionInvocation`, `stripGlobalOptionsFromArgv`) |
| Stdout / stderr | [streams.ts](../../src/io/streams.ts) |
| Success JSON / human | [success.ts](../../src/output/success.ts) |
| Error JSON / human | [error.ts](../../src/output/error.ts) |
| Exit codes / HTTP mapping | [exits.ts](../../src/exit/exits.ts) |
| HTTP GET client | [client.ts](../../src/http/client.ts) |
| Health probe (`GET /health`) | [health.ts](../../src/commands/health.ts) |
| Server version (`GET /version`) | [server-version.ts](../../src/commands/server-version.ts) |
| Current user (`GET /auth/me`) | [auth-me.ts](../../src/commands/auth-me.ts) |
