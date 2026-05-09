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

## Configuration (planned)

Typical environment variables:

| Variable | Purpose |
|----------|---------|
| `TEMPO_BASE_URL` | API root (no trailing slash required; normalize in client) |
| `TEMPO_API_KEY` | Bearer token for authenticated endpoints |

Global flags will mirror these where useful (for example `--base-url`, `--api-key`). Config file precedence will favor environment overrides over on-disk config.

## API contract

A vendored OpenAPI snapshot lives at [`tempo_openapi_spec.json`](tempo_openapi_spec.json) for tests and client generation. When Tempo publishes a canonical spec from its mainline branches, this repo should track that for compatibility notes and codegen.

## Contributing

Issues and pull requests for this repository should cover CLI behavior, packaging, and documentation. Changes to Tempo’s API, authentication, or OpenAPI publishing belong in the [Tempo](https://github.com/trevordavies095/tempo/) repository; link related work across repos when both sides change.

## License

TBD—align with the chosen license for this repository when you add a `LICENSE` file.
