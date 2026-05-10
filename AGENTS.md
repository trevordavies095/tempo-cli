# tempo-cli — agent entry point

This repository builds **`tempo`**, a read-only CLI that talks to your self-hosted [Tempo](https://github.com/trevordavies095/tempo/) HTTP API. Point it at your instance with a base URL and an API key issued in Tempo (this CLI does not create keys).

## Environment and auth

| Variable | Purpose |
|----------|---------|
| `TEMPO_BASE_URL` | Tempo API base URL when `--base-url` is omitted (e.g. `https://tempo.example.com` or `http://localhost:5001`). |
| `TEMPO_API_KEY` | Bearer token for commands that require auth (`tmp_…` prefix in current Tempo designs). |

**Precedence** (later wins): built-in defaults, optional `config.toml`, then environment, then explicit flags (`--base-url`, `--api-key`, `--output`). See the [Configuration](README.md#configuration) section in the README.

To persist a key in the config file (Unix-friendly permissions on save): `tempo config set-api-key` — still using a key **issued in Tempo**, not created by the CLI.

## Runnable examples

After `npm install` and `npm run build`, run the CLI as **`npx tempo`** (or `tempo` if linked globally). Replace placeholders with real values.

```bash
export TEMPO_BASE_URL="https://tempo.example.com"
export TEMPO_API_KEY="tmp_..."   # issued in Tempo

# Recent workouts as JSON (first page, newest first — adjust --page-size)
npx tempo --output json workouts list --page-size 10 --sort-by startedAt --sort-order desc

# One workout by UUID
npx tempo --output json workout get 550e8400-e29b-41d4-a716-446655440000

# Server version (GET /version on the Tempo instance — not the local CLI version)
npx tempo server version
npx tempo --output json server version

# Health check (reachability; does not send an API key)
npx tempo health
npx tempo --output json health
```

**Note:** `tempo version` prints the **local** npm package version. Use **`tempo server version`** for the running server’s `/version` response.

## Security

- Do **not** commit API keys or paste them into public logs, tickets, or screenshots.
- The CLI does not log or echo configured keys; treat command lines and CI logs as sensitive if they include `--api-key` or env exports.
- If a key is exposed, **rotate or revoke it in Tempo** and issue a new one.

## Help

- Global options: `tempo --help` (or `tempo -h`) — `--base-url`, `--output` (`human` \| `json`), `--api-key`, `--version`.
- Subcommands: `tempo <command> --help` (e.g. `tempo workouts list --help`, `tempo workout get --help`).

## Exit codes

The process uses a small stable set of exit codes (success **0**, usage/validation **1**, auth **2**, server **5xx** **3**, not found **4**, transport **5`). Full table: [README — Exit codes](README.md#exit-codes).

## Command naming

Use **`tempo workouts list`** (plural **workouts**) for the collection. **`tempo workout list`** is not a valid command. Details and rationale: [README — Command naming](README.md#command-naming).
