#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, Option } from "commander";
import { computePreFlagDefaults, loadConfigFile } from "./config/file.js";
import { getDefaultConfigPath } from "./config/path.js";
import {
  pickApiKey,
  setEffectiveGlobalConfig,
} from "./config/runtime.js";
import { readKeyFromStdinIfAvailable } from "./config/stdin-key.js";
import { persistApiKey } from "./config/write.js";
import {
  isVersionInvocation,
  peekOutputModeFromArgv,
} from "./cli/argv-output-peek.js";
import {
  healthHumanSuccessLine,
  healthHttpErrorMessage,
  HEALTH_PATH,
  probeHealth,
  transportErrorMessage,
} from "./commands/health.js";
import {
  probeAuthMe,
  authMeHumanSuccessLine,
  authMeHttpErrorMessageForCli,
  AUTH_ME_PATH,
} from "./commands/auth-me.js";
import {
  probeServerVersion,
  serverVersionHumanSuccessLine,
  serverVersionHttpErrorMessage,
  VERSION_PATH,
} from "./commands/server-version.js";
import {
  buildWorkoutGetPath,
  isValidWorkoutId,
  probeWorkoutGet,
  trimWorkoutId,
  workoutGetHumanSuccessLine,
  workoutGetHttpErrorMessageForCli,
} from "./commands/workout-get.js";
import {
  buildWorkoutMediaListPath,
  probeWorkoutMediaList,
  workoutMediaListHumanSuccessLine,
  workoutMediaListHttpErrorMessageForCli,
} from "./commands/workout-media-list.js";
import {
  buildWorkoutSimilarRoutesPath,
  probeWorkoutSimilarRoutes,
  similarRoutesQueryFromCli,
  workoutSimilarRoutesHumanSuccessLine,
  workoutSimilarRoutesHttpErrorMessageForCli,
} from "./commands/workout-similar-routes.js";
import {
  buildWorkoutsListPath,
  probeWorkoutsList,
  workoutsListHumanSuccessLine,
  workoutsListHttpErrorMessageForCli,
  workoutsListQueryFromCli,
} from "./commands/workouts-list.js";
import {
  exitCodeForFetchFailure,
  exitCodeForHttpStatus,
  EXIT_USAGE,
} from "./exit/exits.js";
import { writeOutLine, writeErrLine } from "./io/streams.js";
import {
  CLI_ERROR_CONFIG_INVALID,
  CLI_ERROR_CONFIG_WRITE_FAILED,
  CLI_ERROR_HTTP,
  CLI_ERROR_INVALID_ARGUMENTS,
  CLI_ERROR_MISSING_API_KEY,
  CLI_ERROR_TRANSPORT,
  writeCommandError,
} from "./output/error.js";
import { writeCommandSuccess } from "./output/success.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf8"),
) as { name?: string; version: string; description?: string };

function shouldSkipConfigLoad(argv: string[]): boolean {
  const i = argv.indexOf("config");
  return i !== -1 && argv[i + 1] === "set-api-key";
}

const configPath = getDefaultConfigPath();
const argvSlice = process.argv.slice(2);
const fileLayer = shouldSkipConfigLoad(argvSlice)
  ? {}
  : (() => {
      try {
        return loadConfigFile(configPath);
      } catch (e) {
        if (isVersionInvocation(argvSlice)) {
          return {};
        }
        const output = peekOutputModeFromArgv(argvSlice);
        const message = e instanceof Error ? e.message : String(e);
        writeCommandError(output, {
          code: CLI_ERROR_CONFIG_INVALID,
          message,
        });
        process.exit(EXIT_USAGE);
      }
    })();

const preFlag = computePreFlagDefaults(fileLayer);

const platformHint = process.platform === "win32" ? "Windows" : "Unix";

const HELP_GLOBALS_HINT =
  "Global options (--base-url, --output, --api-key) and env (TEMPO_BASE_URL, TEMPO_API_KEY) are listed under: tempo --help";

const program = new Command();

program
  .name("tempo")
  .description(pkg.description ?? "Command-line client for Tempo")
  .version(pkg.version)
  .option(
    "--base-url <url>",
    "Tempo API base URL (no trailing slash required)",
    preFlag.baseUrl,
  )
  .addOption(
    new Option("--output <mode>", "Output format for successful command data")
      .choices(["human", "json"])
      .default(preFlag.output),
  )
  .option(
    "--api-key <key>",
    "API key (Bearer token). The CLI never logs or echoes this value.",
  )
  .addHelpText(
    "after",
    `
Config file (${platformHint}):
  ${configPath}

  Optional TOML: base_url, output ("human" | "json"), api_key.
  Keys are issued in Tempo; this CLI does not create keys interactively.

  Use: tempo config set-api-key  (stores api_key with restrictive permissions on Unix)

  Precedence: built-in defaults, then config file, then environment, then CLI flags.
  Environment overrides the file (e.g. TEMPO_BASE_URL over base_url).

Environment:
  TEMPO_BASE_URL    Overrides config file base_url when --base-url is omitted.
  TEMPO_API_KEY     Overrides config file api_key when --api-key is omitted; never logged or echoed.
`,
  );

const configCmd = program
  .command("config")
  .description("Manage local CLI configuration on disk (no Tempo API calls).");

configCmd
  .command("set-api-key")
  .description(
    "Store an admin-issued API key in the config file. The key is never printed or logged. On Unix/macOS the file is chmod 0600.",
  )
  .option(
    "--api-key <key>",
    "API key (optional if TEMPO_API_KEY or stdin provides it; never logged or echoed).",
  )
  .action(function (this: Command) {
    const merged = this.optsWithGlobals() as {
      apiKey?: string;
      output: "human" | "json";
    };
    let key = merged.apiKey?.trim();
    if (!key) key = process.env.TEMPO_API_KEY?.trim();
    if (!key) key = readKeyFromStdinIfAvailable();
    if (!key) {
      writeCommandError(merged.output, {
        code: CLI_ERROR_MISSING_API_KEY,
        message:
          "tempo config set-api-key: provide --api-key, set TEMPO_API_KEY, or pipe the key on stdin (non-interactive).",
      });
      process.exit(EXIT_USAGE);
    }
    const path = getDefaultConfigPath();
    try {
      persistApiKey(path, key);
    } catch (e) {
      writeCommandError(merged.output, {
        code: CLI_ERROR_CONFIG_WRITE_FAILED,
        message: e instanceof Error ? e.message : String(e),
      });
      process.exit(EXIT_USAGE);
    }
    writeOutLine(`Wrote API key to ${path}`);
    if (process.platform !== "win32") {
      writeErrLine("Set config file mode to 0600 (user read/write only).");
    }
  });

program
  .command("health")
  .description(
    "GET /health on the configured base URL without sending an API key (reachability check).",
  )
  .addHelpText(
    "after",
    `
Examples:
  TEMPO_BASE_URL=http://localhost:5001 tempo health
  tempo health --base-url http://localhost:5001
  tempo --output json health

This command does not send an API key.

${HELP_GLOBALS_HINT}
`,
  )
  .action(async function (this: Command) {
    const merged = this.optsWithGlobals() as {
      output: "human" | "json";
      baseUrl: string;
      apiKey?: string;
    };
    setEffectiveGlobalConfig({
      baseUrl: merged.baseUrl,
      output: merged.output,
    });
    const result = await probeHealth(merged.baseUrl);
    if (result.kind === "ok") {
      writeCommandSuccess(
        merged.output,
        healthHumanSuccessLine(result.status, result.body),
        {
          ok: true,
          status: result.status,
          path: HEALTH_PATH,
          body: result.body,
        },
      );
      return;
    }
    if (result.kind === "http") {
      writeCommandError(merged.output, {
        code: CLI_ERROR_HTTP,
        message: healthHttpErrorMessage(result.status, result.body),
      });
      process.exit(exitCodeForHttpStatus(result.status));
    }
    writeCommandError(merged.output, {
      code: CLI_ERROR_TRANSPORT,
      message: transportErrorMessage(result.error),
    });
    process.exit(exitCodeForFetchFailure(result.error));
  });

const serverCmd = program
  .command("server")
  .description("Commands that call the Tempo HTTP API (read-only).");

serverCmd
  .command("version")
  .description(
    "GET /version from the server without sending an API key (public meta endpoint when exposed).",
  )
  .addHelpText(
    "after",
    `
Examples:
  TEMPO_BASE_URL=http://localhost:5001 tempo server version
  tempo server version --base-url http://localhost:5001
  tempo --output json server version

This command does not send an API key.

${HELP_GLOBALS_HINT}
`,
  )
  .action(async function (this: Command) {
    const merged = this.optsWithGlobals() as {
      output: "human" | "json";
      baseUrl: string;
      apiKey?: string;
    };
    setEffectiveGlobalConfig({
      baseUrl: merged.baseUrl,
      output: merged.output,
    });
    const result = await probeServerVersion(merged.baseUrl);
    if (result.kind === "ok") {
      writeCommandSuccess(
        merged.output,
        serverVersionHumanSuccessLine(result.status, result.body),
        {
          ok: true,
          status: result.status,
          path: VERSION_PATH,
          body: result.body,
        },
      );
      return;
    }
    if (result.kind === "http") {
      writeCommandError(merged.output, {
        code: CLI_ERROR_HTTP,
        message: serverVersionHttpErrorMessage(result.status, result.body),
      });
      process.exit(exitCodeForHttpStatus(result.status));
    }
    writeCommandError(merged.output, {
      code: CLI_ERROR_TRANSPORT,
      message: transportErrorMessage(result.error),
    });
    process.exit(exitCodeForFetchFailure(result.error));
  });

const authCmd = program
  .command("auth")
  .description("Authenticated API checks (read-only).");

authCmd
  .command("me")
  .description(
    "GET /auth/me with your API key (Bearer). Does not use cookies or POST /auth/login.",
  )
  .addHelpText(
    "after",
    `
Examples:
  TEMPO_BASE_URL=https://tempo.example.com TEMPO_API_KEY=tmp_... tempo auth me
  tempo --base-url https://tempo.example.com --api-key tmp_... auth me
  tempo --output json auth me

Requires an API key (--api-key, TEMPO_API_KEY, or api_key in config).

${HELP_GLOBALS_HINT}
`,
  )
  .action(async function (this: Command) {
    const merged = this.optsWithGlobals() as {
      output: "human" | "json";
      baseUrl: string;
      apiKey?: string;
    };
    const key = pickApiKey(merged.apiKey, fileLayer);
    if (!key) {
      writeCommandError(merged.output, {
        code: CLI_ERROR_MISSING_API_KEY,
        message:
          "tempo auth me: provide --api-key, set TEMPO_API_KEY, or set api_key in config.toml.",
      });
      process.exit(EXIT_USAGE);
    }
    setEffectiveGlobalConfig({
      baseUrl: merged.baseUrl,
      output: merged.output,
      apiKey: key,
    });
    const result = await probeAuthMe(merged.baseUrl, key);
    if (result.kind === "ok") {
      writeCommandSuccess(
        merged.output,
        authMeHumanSuccessLine(result.status, result.body),
        {
          ok: true,
          status: result.status,
          path: AUTH_ME_PATH,
          body: result.body,
        },
      );
      return;
    }
    if (result.kind === "http") {
      writeCommandError(merged.output, {
        code: CLI_ERROR_HTTP,
        message: authMeHttpErrorMessageForCli(
          result.status,
          result.body,
          key,
        ),
      });
      process.exit(exitCodeForHttpStatus(result.status));
    }
    writeCommandError(merged.output, {
      code: CLI_ERROR_TRANSPORT,
      message: transportErrorMessage(result.error),
    });
    process.exit(exitCodeForFetchFailure(result.error));
  });

const workoutCmd = program
  .command("workout")
  .description(
    "Single-workout read-only commands (GET /workouts/{id} and related).",
  );

workoutCmd
  .command("get")
  .description("GET /workouts/{id} — full workout payload (route, splits, etc.).")
  .argument("<id>", "Workout id (UUID)")
  .addHelpText(
    "after",
    `
Examples:
  TEMPO_BASE_URL=https://tempo.example.com TEMPO_API_KEY=tmp_... tempo workout get 550e8400-e29b-41d4-a716-446655440000
  tempo workout get 550e8400-e29b-41d4-a716-446655440000 --base-url https://tempo.example.com --api-key tmp_...
  tempo --output json workout get 550e8400-e29b-41d4-a716-446655440000

Human mode prints a short summary when the response is JSON, using fields that exist:
  id, name, startedAt, duration, distance, runType, notes (camelCase or PascalCase).
  Use --output json for the full API body inside the standard wrapper on stdout.

Requires an API key (--api-key, TEMPO_API_KEY, or api_key in config).

${HELP_GLOBALS_HINT}
`,
  )
  .action(async function (this: Command, id: string) {
    const merged = this.optsWithGlobals() as {
      output: "human" | "json";
      baseUrl: string;
      apiKey?: string;
    };
    const key = pickApiKey(merged.apiKey, fileLayer);
    if (!key) {
      writeCommandError(merged.output, {
        code: CLI_ERROR_MISSING_API_KEY,
        message:
          "tempo workout get: provide --api-key, set TEMPO_API_KEY, or set api_key in config.toml.",
      });
      process.exit(EXIT_USAGE);
    }
    const workoutId = trimWorkoutId(id);
    if (!isValidWorkoutId(workoutId)) {
      writeCommandError(merged.output, {
        code: CLI_ERROR_INVALID_ARGUMENTS,
        message: `tempo workout get: "${id}" is not a valid UUID`,
      });
      process.exit(EXIT_USAGE);
    }
    setEffectiveGlobalConfig({
      baseUrl: merged.baseUrl,
      output: merged.output,
      apiKey: key,
    });
    const result = await probeWorkoutGet(merged.baseUrl, key, workoutId);
    if (result.kind === "ok") {
      writeCommandSuccess(
        merged.output,
        workoutGetHumanSuccessLine(result.status, result.body),
        {
          ok: true,
          status: result.status,
          path: buildWorkoutGetPath(workoutId),
          body: result.body,
        },
      );
      return;
    }
    if (result.kind === "http") {
      writeCommandError(merged.output, {
        code: CLI_ERROR_HTTP,
        message: workoutGetHttpErrorMessageForCli(
          result.status,
          result.body,
          key,
          workoutId,
        ),
      });
      process.exit(exitCodeForHttpStatus(result.status));
    }
    writeCommandError(merged.output, {
      code: CLI_ERROR_TRANSPORT,
      message: transportErrorMessage(result.error),
    });
    process.exit(exitCodeForFetchFailure(result.error));
  });

workoutCmd
  .command("similar-routes")
  .description(
    "GET /workouts/{id}/similar-routes — past efforts on similar routes (workout needs route data).",
  )
  .argument("<id>", "Workout id (UUID)")
  .option(
    "--max-results <n>",
    "Maximum matches to return (query: maxResults; API default 10)",
  )
  .addHelpText(
    "after",
    `
Examples:
  TEMPO_BASE_URL=https://tempo.example.com TEMPO_API_KEY=tmp_... tempo workout similar-routes 550e8400-e29b-41d4-a716-446655440000
  tempo workout similar-routes 550e8400-e29b-41d4-a716-446655440000 --max-results 5
  tempo --output json workout similar-routes 550e8400-e29b-41d4-a716-446655440000

Human mode summarizes JSON arrays (up to 20 rows) with id, name, startedAt, distance, duration when present.
Use --output json for the full API body inside the standard wrapper on stdout.

Requires an API key (--api-key, TEMPO_API_KEY, or api_key in config).

${HELP_GLOBALS_HINT}
`,
  )
  .action(async function (this: Command, id: string) {
    const merged = this.optsWithGlobals() as {
      output: "human" | "json";
      baseUrl: string;
      apiKey?: string;
      maxResults?: string;
    };
    const key = pickApiKey(merged.apiKey, fileLayer);
    if (!key) {
      writeCommandError(merged.output, {
        code: CLI_ERROR_MISSING_API_KEY,
        message:
          "tempo workout similar-routes: provide --api-key, set TEMPO_API_KEY, or set api_key in config.toml.",
      });
      process.exit(EXIT_USAGE);
    }
    const workoutId = trimWorkoutId(id);
    if (!isValidWorkoutId(workoutId)) {
      writeCommandError(merged.output, {
        code: CLI_ERROR_INVALID_ARGUMENTS,
        message: `tempo workout similar-routes: "${id}" is not a valid UUID`,
      });
      process.exit(EXIT_USAGE);
    }
    const parsed = similarRoutesQueryFromCli({
      maxResults: merged.maxResults,
    });
    if ("error" in parsed) {
      writeCommandError(merged.output, {
        code: CLI_ERROR_INVALID_ARGUMENTS,
        message: parsed.error,
      });
      process.exit(EXIT_USAGE);
    }
    setEffectiveGlobalConfig({
      baseUrl: merged.baseUrl,
      output: merged.output,
      apiKey: key,
    });
    const result = await probeWorkoutSimilarRoutes(
      merged.baseUrl,
      key,
      workoutId,
      parsed.ok,
    );
    if (result.kind === "ok") {
      writeCommandSuccess(
        merged.output,
        workoutSimilarRoutesHumanSuccessLine(result.status, result.body),
        {
          ok: true,
          status: result.status,
          path: buildWorkoutSimilarRoutesPath(workoutId, parsed.ok),
          body: result.body,
        },
      );
      return;
    }
    if (result.kind === "http") {
      writeCommandError(merged.output, {
        code: CLI_ERROR_HTTP,
        message: workoutSimilarRoutesHttpErrorMessageForCli(
          result.status,
          result.body,
          key,
          workoutId,
          parsed.ok,
        ),
      });
      process.exit(exitCodeForHttpStatus(result.status));
    }
    writeCommandError(merged.output, {
      code: CLI_ERROR_TRANSPORT,
      message: transportErrorMessage(result.error),
    });
    process.exit(exitCodeForFetchFailure(result.error));
  });

const workoutMediaCmd = workoutCmd
  .command("media")
  .description(
    "Workout media (read-only list metadata here; file download is a separate subcommand).",
  );

workoutMediaCmd
  .command("list")
  .description(
    "GET /workouts/{id}/media — list attachment metadata (read-only; no upload).",
  )
  .argument("<id>", "Workout id (UUID)")
  .addHelpText(
    "after",
    `
Examples:
  TEMPO_BASE_URL=https://tempo.example.com TEMPO_API_KEY=tmp_... tempo workout media list 550e8400-e29b-41d4-a716-446655440000
  tempo workout media list 550e8400-e29b-41d4-a716-446655440000 --base-url https://tempo.example.com --api-key tmp_...
  tempo --output json workout media list 550e8400-e29b-41d4-a716-446655440000

This command only performs GET (lists metadata). It does not upload files (no POST).

Human mode summarizes JSON arrays (up to 20 rows): id, filename, mime type, size, caption, createdAt when present.
Use --output json for the full API body inside the standard wrapper on stdout.

Requires an API key (--api-key, TEMPO_API_KEY, or api_key in config).

${HELP_GLOBALS_HINT}
`,
  )
  .action(async function (this: Command, id: string) {
    const merged = this.optsWithGlobals() as {
      output: "human" | "json";
      baseUrl: string;
      apiKey?: string;
    };
    const key = pickApiKey(merged.apiKey, fileLayer);
    if (!key) {
      writeCommandError(merged.output, {
        code: CLI_ERROR_MISSING_API_KEY,
        message:
          "tempo workout media list: provide --api-key, set TEMPO_API_KEY, or set api_key in config.toml.",
      });
      process.exit(EXIT_USAGE);
    }
    const workoutId = trimWorkoutId(id);
    if (!isValidWorkoutId(workoutId)) {
      writeCommandError(merged.output, {
        code: CLI_ERROR_INVALID_ARGUMENTS,
        message: `tempo workout media list: "${id}" is not a valid UUID`,
      });
      process.exit(EXIT_USAGE);
    }
    setEffectiveGlobalConfig({
      baseUrl: merged.baseUrl,
      output: merged.output,
      apiKey: key,
    });
    const result = await probeWorkoutMediaList(merged.baseUrl, key, workoutId);
    if (result.kind === "ok") {
      writeCommandSuccess(
        merged.output,
        workoutMediaListHumanSuccessLine(result.status, result.body),
        {
          ok: true,
          status: result.status,
          path: buildWorkoutMediaListPath(workoutId),
          body: result.body,
        },
      );
      return;
    }
    if (result.kind === "http") {
      writeCommandError(merged.output, {
        code: CLI_ERROR_HTTP,
        message: workoutMediaListHttpErrorMessageForCli(
          result.status,
          result.body,
          key,
          workoutId,
        ),
      });
      process.exit(exitCodeForHttpStatus(result.status));
    }
    writeCommandError(merged.output, {
      code: CLI_ERROR_TRANSPORT,
      message: transportErrorMessage(result.error),
    });
    process.exit(exitCodeForFetchFailure(result.error));
  });

const workoutsCmd = program
  .command("workouts")
  .description("Workout listing and related read-only API commands.");

workoutsCmd
  .command("list")
  .description(
    "GET /workouts — list workouts with pagination and filters (OpenAPI query param names).",
  )
  .option("--page <n>", "Page number (query: page)")
  .option(
    "--page-size <n>",
    "Items per page (query: pageSize; API default 20, max 100)",
  )
  .option(
    "--start-date <date>",
    "Inclusive start filter (query: startDate, ISO 8601 date-time)",
  )
  .option(
    "--end-date <date>",
    "Inclusive end filter (query: endDate, ISO 8601 date-time)",
  )
  .option("--min-distance-m <m>", "Minimum distance in meters (minDistanceM)")
  .option("--max-distance-m <m>", "Maximum distance in meters (maxDistanceM)")
  .option("--keyword <text>", "Search name, device, source (keyword)")
  .option(
    "--run-type <type>",
    'Run type filter (runType), e.g. "Race", "Long Run", "Easy Run"',
  )
  .option(
    "--sort-by <field>",
    'Sort field (sortBy): name, duration, distance, elevation, relativeeffort, startedAt',
  )
  .option("--sort-order <order>", 'Sort order (sortOrder): "asc" or "desc"')
  .addHelpText(
    "after",
    `
Examples:
  TEMPO_BASE_URL=https://tempo.example.com TEMPO_API_KEY=tmp_... tempo workouts list
  tempo workouts list --page 2 --page-size 50 --keyword "morning"
  tempo workouts list --start-date 2025-01-01T00:00:00Z --sort-by distance --sort-order asc
  tempo --output json workouts list --run-type "Long Run"

Requires an API key (--api-key, TEMPO_API_KEY, or api_key in config).

${HELP_GLOBALS_HINT}
`,
  )
  .action(async function (this: Command) {
    const merged = this.optsWithGlobals() as {
      output: "human" | "json";
      baseUrl: string;
      apiKey?: string;
      page?: string;
      pageSize?: string;
      startDate?: string;
      endDate?: string;
      minDistanceM?: string;
      maxDistanceM?: string;
      keyword?: string;
      runType?: string;
      sortBy?: string;
      sortOrder?: string;
    };
    const key = pickApiKey(merged.apiKey, fileLayer);
    if (!key) {
      writeCommandError(merged.output, {
        code: CLI_ERROR_MISSING_API_KEY,
        message:
          "tempo workouts list: provide --api-key, set TEMPO_API_KEY, or set api_key in config.toml.",
      });
      process.exit(EXIT_USAGE);
    }
    const parsed = workoutsListQueryFromCli({
      page: merged.page,
      pageSize: merged.pageSize,
      startDate: merged.startDate,
      endDate: merged.endDate,
      minDistanceM: merged.minDistanceM,
      maxDistanceM: merged.maxDistanceM,
      keyword: merged.keyword,
      runType: merged.runType,
      sortBy: merged.sortBy,
      sortOrder: merged.sortOrder,
    });
    if ("error" in parsed) {
      writeCommandError(merged.output, {
        code: CLI_ERROR_INVALID_ARGUMENTS,
        message: parsed.error,
      });
      process.exit(EXIT_USAGE);
    }
    setEffectiveGlobalConfig({
      baseUrl: merged.baseUrl,
      output: merged.output,
      apiKey: key,
    });
    const result = await probeWorkoutsList(merged.baseUrl, key, parsed.ok);
    if (result.kind === "ok") {
      writeCommandSuccess(
        merged.output,
        workoutsListHumanSuccessLine(result.status, result.body),
        {
          ok: true,
          status: result.status,
          path: buildWorkoutsListPath(parsed.ok),
          body: result.body,
        },
      );
      return;
    }
    if (result.kind === "http") {
      writeCommandError(merged.output, {
        code: CLI_ERROR_HTTP,
        message: workoutsListHttpErrorMessageForCli(
          result.status,
          result.body,
          key,
        ),
      });
      process.exit(exitCodeForHttpStatus(result.status));
    }
    writeCommandError(merged.output, {
      code: CLI_ERROR_TRANSPORT,
      message: transportErrorMessage(result.error),
    });
    process.exit(exitCodeForFetchFailure(result.error));
  });

program
  .command("version")
  .description(
    "Print the local CLI version (npm package). For the running server response from GET /version, use: tempo server version.",
  )
  .addHelpText(
    "after",
    `
Examples:
  tempo version
  tempo --output json version

${HELP_GLOBALS_HINT}
`,
  )
  .action(function (this: Command) {
    const merged = this.optsWithGlobals() as {
      output: "human" | "json";
      baseUrl: string;
      apiKey?: string;
    };
    setEffectiveGlobalConfig({
      baseUrl: merged.baseUrl,
      output: merged.output,
      apiKey: pickApiKey(merged.apiKey, fileLayer),
    });
    const name = pkg.name ?? "tempo-cli";
    const version = pkg.version;
    writeCommandSuccess(merged.output, `${name} ${version}`, {
      ok: true,
      cliVersion: version,
      cli: { name, version },
    });
  });

program.action(() => {
  const opts = program.opts<{
    baseUrl: string;
    output: "human" | "json";
    apiKey?: string;
  }>();
  setEffectiveGlobalConfig({
    baseUrl: opts.baseUrl,
    output: opts.output,
    apiKey: pickApiKey(opts.apiKey, fileLayer),
  });
  program.help();
});

program.parse();
