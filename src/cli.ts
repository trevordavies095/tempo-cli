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
  atomicWriteFile,
  probeWorkoutMediaDownload,
  workoutMediaDownloadHttpErrorMessageForCli,
} from "./commands/workout-media-download.js";
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
  buildStatsWeeklyPath,
  probeStatsWeekly,
  statsWeeklyHumanSuccessLine,
  statsWeeklyHttpErrorMessageForCli,
  statsWeeklyQueryFromCli,
} from "./commands/stats-weekly.js";
import {
  buildStatsYearlyPath,
  probeStatsYearly,
  statsYearlyHumanSuccessLine,
  statsYearlyHttpErrorMessageForCli,
  statsYearlyQueryFromCli,
} from "./commands/stats-yearly.js";
import {
  buildStatsYearlyWeeklyPath,
  probeStatsYearlyWeekly,
  statsYearlyWeeklyHumanSuccessLine,
  statsYearlyWeeklyHttpErrorMessageForCli,
  statsYearlyWeeklyQueryFromCli,
} from "./commands/stats-yearly-weekly.js";
import {
  buildStatsRelativeEffortPath,
  probeStatsRelativeEffort,
  statsRelativeEffortHumanSuccessLine,
  statsRelativeEffortHttpErrorMessageForCli,
  statsRelativeEffortQueryFromCli,
} from "./commands/stats-relative-effort.js";
import {
  STATS_BEST_EFFORTS_PATH,
  probeStatsBestEfforts,
  statsBestEffortsHumanSuccessLine,
  statsBestEffortsHttpErrorMessageForCli,
} from "./commands/stats-best-efforts.js";
import {
  buildStatsAvailablePeriodsPath,
  probeStatsAvailablePeriods,
  statsAvailablePeriodsHumanSuccessLine,
  statsAvailablePeriodsHttpErrorMessageForCli,
  statsAvailablePeriodsQueryFromCli,
} from "./commands/stats-available-periods.js";
import {
  STATS_AVAILABLE_YEARS_PATH,
  probeStatsAvailableYears,
  statsAvailableYearsHumanSuccessLine,
  statsAvailableYearsHttpErrorMessageForCli,
} from "./commands/stats-available-years.js";
import {
  STATS_INSIGHTS_PATH,
  probeStatsInsights,
  statsInsightsHumanSuccessLine,
  statsInsightsHttpErrorMessageForCli,
} from "./commands/stats-insights.js";
import {
  SETTINGS_HEART_RATE_ZONES_PATH,
  probeSettingsHeartRateZones,
  settingsHeartRateZonesHumanSuccessLine,
  settingsHeartRateZonesHttpErrorMessageForCli,
} from "./commands/settings-heart-rate-zones.js";
import {
  SETTINGS_UNIT_PREFERENCE_PATH,
  probeSettingsUnitPreference,
  settingsUnitPreferenceHumanSuccessLine,
  settingsUnitPreferenceHttpErrorMessageForCli,
} from "./commands/settings-unit-preference.js";
import {
  SETTINGS_DEFAULT_SHOE_PATH,
  probeSettingsDefaultShoe,
  settingsDefaultShoeHumanSuccessLine,
  settingsDefaultShoeHttpErrorMessageForCli,
} from "./commands/settings-default-shoe.js";
import {
  SHOES_LIST_PATH,
  probeShoesList,
  shoesListHumanSuccessLine,
  shoesListHttpErrorMessageForCli,
} from "./commands/shoes-list.js";
import {
  buildShoeMileagePath,
  probeShoeMileage,
  shoeMileageHumanSuccessLine,
  shoeMileageHttpErrorMessageForCli,
} from "./commands/shoe-mileage.js";
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

/** Shown on workout-related --help: canonical list vs get naming (P6). */
const HELP_WORKOUT_CLI_NAMING = `CLI naming:
  Use "tempo workouts list" (plural workouts) to list or filter workouts.
  Use "tempo workout get <uuid>" (singular workout) for one workout by id.
  "tempo workout list" is not a command here (a common mistake); use "tempo workouts list" instead.`;

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

${HELP_WORKOUT_CLI_NAMING}

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

${HELP_WORKOUT_CLI_NAMING}

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
    "Workout media: list attachment metadata or download a file (GET only).",
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

${HELP_WORKOUT_CLI_NAMING}

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

workoutMediaCmd
  .command("download")
  .description(
    "GET /workouts/{id}/media/{mediaId} — download media bytes (supports range requests on the server).",
  )
  .argument("<workoutId>", "Workout id (UUID)")
  .argument("<mediaId>", "Media attachment id (UUID)")
  .option(
    "-o, --out-file <path>",
    "Write the response body to this path (atomic replace). Defaults to binary on stdout.",
  )
  .addHelpText(
    "after",
    `
Examples:
  tempo workout media download 550e8400-e29b-41d4-a716-446655440000 f47ac10b-58cc-4372-a567-0e02b2c3d479 > photo.jpg
  tempo workout media download 550e8400-e29b-41d4-a716-446655440000 f47ac10b-58cc-4372-a567-0e02b2c3d479 -o photo.jpg
  TEMPO_API_KEY=tmp_... tempo workout media download --base-url https://tempo.example.com W1 M1 --out-file ./video.mp4

Successful downloads write raw bytes to stdout unless --out-file / -o is set (no JSON wrapper on stdout).

Global --output human|json applies to error messages on stderr only (structured JSON on failure when --output json).

Writing binary to an interactive terminal can corrupt the display; redirect to a file or use --out-file.

Requires an API key (--api-key, TEMPO_API_KEY, or api_key in config).

${HELP_WORKOUT_CLI_NAMING}

${HELP_GLOBALS_HINT}
`,
  )
  .action(async function (this: Command, workoutIdArg: string, mediaIdArg: string) {
    const merged = this.optsWithGlobals() as {
      output: "human" | "json";
      baseUrl: string;
      apiKey?: string;
      outFile?: string;
    };
    const key = pickApiKey(merged.apiKey, fileLayer);
    if (!key) {
      writeCommandError(merged.output, {
        code: CLI_ERROR_MISSING_API_KEY,
        message:
          "tempo workout media download: provide --api-key, set TEMPO_API_KEY, or set api_key in config.toml.",
      });
      process.exit(EXIT_USAGE);
    }
    const workoutId = trimWorkoutId(workoutIdArg);
    const mediaId = trimWorkoutId(mediaIdArg);
    if (!isValidWorkoutId(workoutId)) {
      writeCommandError(merged.output, {
        code: CLI_ERROR_INVALID_ARGUMENTS,
        message: `tempo workout media download: workout id "${workoutIdArg}" is not a valid UUID`,
      });
      process.exit(EXIT_USAGE);
    }
    if (!isValidWorkoutId(mediaId)) {
      writeCommandError(merged.output, {
        code: CLI_ERROR_INVALID_ARGUMENTS,
        message: `tempo workout media download: media id "${mediaIdArg}" is not a valid UUID`,
      });
      process.exit(EXIT_USAGE);
    }
    setEffectiveGlobalConfig({
      baseUrl: merged.baseUrl,
      output: merged.output,
      apiKey: key,
    });
    const result = await probeWorkoutMediaDownload(
      merged.baseUrl,
      key,
      workoutId,
      mediaId,
    );
    if (result.kind === "ok") {
      const bytes = new Uint8Array(result.body);
      const outPath = merged.outFile?.trim();
      if (outPath) {
        try {
          await atomicWriteFile(outPath, bytes);
        } catch (e) {
          writeCommandError(merged.output, {
            code: CLI_ERROR_CONFIG_WRITE_FAILED,
            message: `tempo workout media download: could not write --out-file: ${e instanceof Error ? e.message : String(e)}`,
          });
          process.exit(EXIT_USAGE);
        }
        const ct = result.contentType;
        const ctHint = ct ? ` (${ct})` : "";
        writeErrLine(
          `Wrote ${bytes.byteLength} bytes to ${outPath}${ctHint}`,
        );
        return;
      }
      if (process.stdout.isTTY) {
        writeErrLine(
          "tempo: writing binary data to stdout; redirect to a file or use --out-file (-o) to avoid garbling a terminal.",
        );
      }
      await new Promise<void>((resolve, reject) => {
        process.stdout.write(Buffer.from(bytes), (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      return;
    }
    if (result.kind === "http") {
      writeCommandError(merged.output, {
        code: CLI_ERROR_HTTP,
        message: workoutMediaDownloadHttpErrorMessageForCli(
          result.status,
          result.bodyText,
          key,
          workoutId,
          mediaId,
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

workoutCmd.addHelpText(
  "after",
  `
Subcommands: get, similar-routes, media list, media download. Run tempo workout <command> --help for each.

${HELP_WORKOUT_CLI_NAMING}

${HELP_GLOBALS_HINT}
`,
);

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

Filter flags use the same names as the Tempo API query parameters (see Examples above).

Requires an API key (--api-key, TEMPO_API_KEY, or api_key in config).

${HELP_WORKOUT_CLI_NAMING}

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

const statsCmd = program
  .command("stats")
  .description("Read-only Tempo stats commands (GET only).");

statsCmd
  .command("weekly")
  .description(
    "GET /stats/weekly — daily miles for the current week (Monday-Sunday).",
  )
  .option(
    "--timezone-offset-minutes <n>",
    "Timezone offset in minutes (query: timezoneOffsetMinutes; negative for behind UTC)",
  )
  .addHelpText(
    "after",
    `
Examples:
  TEMPO_BASE_URL=https://tempo.example.com TEMPO_API_KEY=tmp_... tempo stats weekly
  tempo stats weekly --timezone-offset-minutes -300
  tempo --output json stats weekly

Requires an API key (--api-key, TEMPO_API_KEY, or api_key in config).

${HELP_GLOBALS_HINT}
`,
  )
  .action(async function (this: Command) {
    const merged = this.optsWithGlobals() as {
      output: "human" | "json";
      baseUrl: string;
      apiKey?: string;
      timezoneOffsetMinutes?: string;
    };
    const key = pickApiKey(merged.apiKey, fileLayer);
    if (!key) {
      writeCommandError(merged.output, {
        code: CLI_ERROR_MISSING_API_KEY,
        message:
          "tempo stats weekly: provide --api-key, set TEMPO_API_KEY, or set api_key in config.toml.",
      });
      process.exit(EXIT_USAGE);
    }
    const parsed = statsWeeklyQueryFromCli({
      timezoneOffsetMinutes: merged.timezoneOffsetMinutes,
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
    const result = await probeStatsWeekly(merged.baseUrl, key, parsed.ok);
    if (result.kind === "ok") {
      writeCommandSuccess(
        merged.output,
        statsWeeklyHumanSuccessLine(result.status, result.body),
        {
          ok: true,
          status: result.status,
          path: buildStatsWeeklyPath(parsed.ok),
          body: result.body,
        },
      );
      return;
    }
    if (result.kind === "http") {
      writeCommandError(merged.output, {
        code: CLI_ERROR_HTTP,
        message: statsWeeklyHttpErrorMessageForCli(
          result.status,
          result.body,
          key,
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

statsCmd
  .command("yearly")
  .description(
    "GET /stats/yearly — total miles for the current year and the previous year.",
  )
  .option(
    "--timezone-offset-minutes <n>",
    "Timezone offset in minutes (query: timezoneOffsetMinutes; negative for behind UTC)",
  )
  .addHelpText(
    "after",
    `
Examples:
  TEMPO_BASE_URL=https://tempo.example.com TEMPO_API_KEY=tmp_... tempo stats yearly
  tempo stats yearly --timezone-offset-minutes 60
  tempo --output json stats yearly

Requires an API key (--api-key, TEMPO_API_KEY, or api_key in config).

${HELP_GLOBALS_HINT}
`,
  )
  .action(async function (this: Command) {
    const merged = this.optsWithGlobals() as {
      output: "human" | "json";
      baseUrl: string;
      apiKey?: string;
      timezoneOffsetMinutes?: string;
    };
    const key = pickApiKey(merged.apiKey, fileLayer);
    if (!key) {
      writeCommandError(merged.output, {
        code: CLI_ERROR_MISSING_API_KEY,
        message:
          "tempo stats yearly: provide --api-key, set TEMPO_API_KEY, or set api_key in config.toml.",
      });
      process.exit(EXIT_USAGE);
    }
    const parsed = statsYearlyQueryFromCli({
      timezoneOffsetMinutes: merged.timezoneOffsetMinutes,
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
    const result = await probeStatsYearly(merged.baseUrl, key, parsed.ok);
    if (result.kind === "ok") {
      writeCommandSuccess(
        merged.output,
        statsYearlyHumanSuccessLine(result.status, result.body),
        {
          ok: true,
          status: result.status,
          path: buildStatsYearlyPath(parsed.ok),
          body: result.body,
        },
      );
      return;
    }
    if (result.kind === "http") {
      writeCommandError(merged.output, {
        code: CLI_ERROR_HTTP,
        message: statsYearlyHttpErrorMessageForCli(
          result.status,
          result.body,
          key,
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

statsCmd
  .command("yearly-weekly")
  .description(
    "GET /stats/yearly-weekly — 52 equal week buckets within a 1-year period.",
  )
  .option(
    "--period-end-date <yyyy-mm-dd>",
    "End date of the period (query: periodEndDate, YYYY-MM-DD; defaults to today on the server)",
  )
  .option(
    "--timezone-offset-minutes <n>",
    "Timezone offset in minutes (query: timezoneOffsetMinutes; negative for behind UTC)",
  )
  .addHelpText(
    "after",
    `
Examples:
  TEMPO_BASE_URL=https://tempo.example.com TEMPO_API_KEY=tmp_... tempo stats yearly-weekly
  tempo stats yearly-weekly --period-end-date 2025-12-31 --timezone-offset-minutes -300
  tempo --output json stats yearly-weekly

Requires an API key (--api-key, TEMPO_API_KEY, or api_key in config).

${HELP_GLOBALS_HINT}
`,
  )
  .action(async function (this: Command) {
    const merged = this.optsWithGlobals() as {
      output: "human" | "json";
      baseUrl: string;
      apiKey?: string;
      periodEndDate?: string;
      timezoneOffsetMinutes?: string;
    };
    const key = pickApiKey(merged.apiKey, fileLayer);
    if (!key) {
      writeCommandError(merged.output, {
        code: CLI_ERROR_MISSING_API_KEY,
        message:
          "tempo stats yearly-weekly: provide --api-key, set TEMPO_API_KEY, or set api_key in config.toml.",
      });
      process.exit(EXIT_USAGE);
    }
    const parsed = statsYearlyWeeklyQueryFromCli({
      periodEndDate: merged.periodEndDate,
      timezoneOffsetMinutes: merged.timezoneOffsetMinutes,
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
    const result = await probeStatsYearlyWeekly(
      merged.baseUrl,
      key,
      parsed.ok,
    );
    if (result.kind === "ok") {
      writeCommandSuccess(
        merged.output,
        statsYearlyWeeklyHumanSuccessLine(result.status, result.body),
        {
          ok: true,
          status: result.status,
          path: buildStatsYearlyWeeklyPath(parsed.ok),
          body: result.body,
        },
      );
      return;
    }
    if (result.kind === "http") {
      writeCommandError(merged.output, {
        code: CLI_ERROR_HTTP,
        message: statsYearlyWeeklyHttpErrorMessageForCli(
          result.status,
          result.body,
          key,
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

statsCmd
  .command("relative-effort")
  .description(
    "GET /stats/relative-effort — cumulative relative effort and 3-week average.",
  )
  .option(
    "--timezone-offset-minutes <n>",
    "Timezone offset in minutes (query: timezoneOffsetMinutes; negative for behind UTC)",
  )
  .addHelpText(
    "after",
    `
Examples:
  TEMPO_BASE_URL=https://tempo.example.com TEMPO_API_KEY=tmp_... tempo stats relative-effort
  tempo stats relative-effort --timezone-offset-minutes -300
  tempo --output json stats relative-effort

Requires an API key (--api-key, TEMPO_API_KEY, or api_key in config).

${HELP_GLOBALS_HINT}
`,
  )
  .action(async function (this: Command) {
    const merged = this.optsWithGlobals() as {
      output: "human" | "json";
      baseUrl: string;
      apiKey?: string;
      timezoneOffsetMinutes?: string;
    };
    const key = pickApiKey(merged.apiKey, fileLayer);
    if (!key) {
      writeCommandError(merged.output, {
        code: CLI_ERROR_MISSING_API_KEY,
        message:
          "tempo stats relative-effort: provide --api-key, set TEMPO_API_KEY, or set api_key in config.toml.",
      });
      process.exit(EXIT_USAGE);
    }
    const parsed = statsRelativeEffortQueryFromCli({
      timezoneOffsetMinutes: merged.timezoneOffsetMinutes,
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
    const result = await probeStatsRelativeEffort(
      merged.baseUrl,
      key,
      parsed.ok,
    );
    if (result.kind === "ok") {
      writeCommandSuccess(
        merged.output,
        statsRelativeEffortHumanSuccessLine(result.status, result.body),
        {
          ok: true,
          status: result.status,
          path: buildStatsRelativeEffortPath(parsed.ok),
          body: result.body,
        },
      );
      return;
    }
    if (result.kind === "http") {
      writeCommandError(merged.output, {
        code: CLI_ERROR_HTTP,
        message: statsRelativeEffortHttpErrorMessageForCli(
          result.status,
          result.body,
          key,
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

statsCmd
  .command("best-efforts")
  .description(
    "GET /stats/best-efforts — fastest time for each standard distance (read-only; never recalculates).",
  )
  .addHelpText(
    "after",
    `
Examples:
  TEMPO_BASE_URL=https://tempo.example.com TEMPO_API_KEY=tmp_... tempo stats best-efforts
  tempo --output json stats best-efforts

This command only performs GET. It does not call POST /stats/best-efforts/recalculate.

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
          "tempo stats best-efforts: provide --api-key, set TEMPO_API_KEY, or set api_key in config.toml.",
      });
      process.exit(EXIT_USAGE);
    }
    setEffectiveGlobalConfig({
      baseUrl: merged.baseUrl,
      output: merged.output,
      apiKey: key,
    });
    const result = await probeStatsBestEfforts(merged.baseUrl, key);
    if (result.kind === "ok") {
      writeCommandSuccess(
        merged.output,
        statsBestEffortsHumanSuccessLine(result.status, result.body),
        {
          ok: true,
          status: result.status,
          path: STATS_BEST_EFFORTS_PATH,
          body: result.body,
        },
      );
      return;
    }
    if (result.kind === "http") {
      writeCommandError(merged.output, {
        code: CLI_ERROR_HTTP,
        message: statsBestEffortsHttpErrorMessageForCli(
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

statsCmd
  .command("available-periods")
  .description(
    "GET /stats/available-periods — consecutive 1-year periods going backwards from today.",
  )
  .option(
    "--timezone-offset-minutes <n>",
    "Timezone offset in minutes (query: timezoneOffsetMinutes; negative for behind UTC)",
  )
  .addHelpText(
    "after",
    `
Examples:
  TEMPO_BASE_URL=https://tempo.example.com TEMPO_API_KEY=tmp_... tempo stats available-periods
  tempo stats available-periods --timezone-offset-minutes -300
  tempo --output json stats available-periods

Requires an API key (--api-key, TEMPO_API_KEY, or api_key in config).

${HELP_GLOBALS_HINT}
`,
  )
  .action(async function (this: Command) {
    const merged = this.optsWithGlobals() as {
      output: "human" | "json";
      baseUrl: string;
      apiKey?: string;
      timezoneOffsetMinutes?: string;
    };
    const key = pickApiKey(merged.apiKey, fileLayer);
    if (!key) {
      writeCommandError(merged.output, {
        code: CLI_ERROR_MISSING_API_KEY,
        message:
          "tempo stats available-periods: provide --api-key, set TEMPO_API_KEY, or set api_key in config.toml.",
      });
      process.exit(EXIT_USAGE);
    }
    const parsed = statsAvailablePeriodsQueryFromCli({
      timezoneOffsetMinutes: merged.timezoneOffsetMinutes,
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
    const result = await probeStatsAvailablePeriods(
      merged.baseUrl,
      key,
      parsed.ok,
    );
    if (result.kind === "ok") {
      writeCommandSuccess(
        merged.output,
        statsAvailablePeriodsHumanSuccessLine(result.status, result.body),
        {
          ok: true,
          status: result.status,
          path: buildStatsAvailablePeriodsPath(parsed.ok),
          body: result.body,
        },
      );
      return;
    }
    if (result.kind === "http") {
      writeCommandError(merged.output, {
        code: CLI_ERROR_HTTP,
        message: statsAvailablePeriodsHttpErrorMessageForCli(
          result.status,
          result.body,
          key,
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

statsCmd
  .command("available-years")
  .description(
    "GET /stats/available-years — distinct years with workouts (descending).",
  )
  .addHelpText(
    "after",
    `
Examples:
  TEMPO_BASE_URL=https://tempo.example.com TEMPO_API_KEY=tmp_... tempo stats available-years
  tempo --output json stats available-years

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
          "tempo stats available-years: provide --api-key, set TEMPO_API_KEY, or set api_key in config.toml.",
      });
      process.exit(EXIT_USAGE);
    }
    setEffectiveGlobalConfig({
      baseUrl: merged.baseUrl,
      output: merged.output,
      apiKey: key,
    });
    const result = await probeStatsAvailableYears(merged.baseUrl, key);
    if (result.kind === "ok") {
      writeCommandSuccess(
        merged.output,
        statsAvailableYearsHumanSuccessLine(result.status, result.body),
        {
          ok: true,
          status: result.status,
          path: STATS_AVAILABLE_YEARS_PATH,
          body: result.body,
        },
      );
      return;
    }
    if (result.kind === "http") {
      writeCommandError(merged.output, {
        code: CLI_ERROR_HTTP,
        message: statsAvailableYearsHttpErrorMessageForCli(
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

statsCmd
  .command("insights")
  .description(
    "GET /stats/insights — running insights including data coverage metadata.",
  )
  .addHelpText(
    "after",
    `
Examples:
  TEMPO_BASE_URL=https://tempo.example.com TEMPO_API_KEY=tmp_... tempo stats insights
  tempo --output json stats insights

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
          "tempo stats insights: provide --api-key, set TEMPO_API_KEY, or set api_key in config.toml.",
      });
      process.exit(EXIT_USAGE);
    }
    setEffectiveGlobalConfig({
      baseUrl: merged.baseUrl,
      output: merged.output,
      apiKey: key,
    });
    const result = await probeStatsInsights(merged.baseUrl, key);
    if (result.kind === "ok") {
      writeCommandSuccess(
        merged.output,
        statsInsightsHumanSuccessLine(result.status, result.body),
        {
          ok: true,
          status: result.status,
          path: STATS_INSIGHTS_PATH,
          body: result.body,
        },
      );
      return;
    }
    if (result.kind === "http") {
      writeCommandError(merged.output, {
        code: CLI_ERROR_HTTP,
        message: statsInsightsHttpErrorMessageForCli(
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

statsCmd.addHelpText(
  "after",
  `
Subcommands: weekly, yearly, yearly-weekly, relative-effort, best-efforts, available-periods, available-years, insights. Run tempo stats <command> --help for each.

All stats commands are read-only (GET) and require an API key (--api-key, TEMPO_API_KEY, or api_key in config).

${HELP_GLOBALS_HINT}
`,
);

const settingsCmd = program
  .command("settings")
  .description("Read-only Tempo settings commands (GET only).");

settingsCmd
  .command("heart-rate-zones")
  .description(
    "GET /settings/heart-rate-zones — current HR zones (read-only; never updates or recalculates).",
  )
  .addHelpText(
    "after",
    `
Examples:
  TEMPO_BASE_URL=https://tempo.example.com TEMPO_API_KEY=tmp_... tempo settings heart-rate-zones
  tempo --output json settings heart-rate-zones

This command only performs GET. It does not update settings (no PUT) and does not recalculate relative effort (no POST /settings/heart-rate-zones/update-with-recalc).

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
          "tempo settings heart-rate-zones: provide --api-key, set TEMPO_API_KEY, or set api_key in config.toml.",
      });
      process.exit(EXIT_USAGE);
    }
    setEffectiveGlobalConfig({
      baseUrl: merged.baseUrl,
      output: merged.output,
      apiKey: key,
    });
    const result = await probeSettingsHeartRateZones(merged.baseUrl, key);
    if (result.kind === "ok") {
      writeCommandSuccess(
        merged.output,
        settingsHeartRateZonesHumanSuccessLine(result.status, result.body),
        {
          ok: true,
          status: result.status,
          path: SETTINGS_HEART_RATE_ZONES_PATH,
          body: result.body,
        },
      );
      return;
    }
    if (result.kind === "http") {
      writeCommandError(merged.output, {
        code: CLI_ERROR_HTTP,
        message: settingsHeartRateZonesHttpErrorMessageForCli(
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

settingsCmd
  .command("unit-preference")
  .description(
    "GET /settings/unit-preference — stored unit preference (read-only; never updates).",
  )
  .addHelpText(
    "after",
    `
Examples:
  TEMPO_BASE_URL=https://tempo.example.com TEMPO_API_KEY=tmp_... tempo settings unit-preference
  tempo --output json settings unit-preference

This command only performs GET. It does not update the unit preference (no PUT).

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
          "tempo settings unit-preference: provide --api-key, set TEMPO_API_KEY, or set api_key in config.toml.",
      });
      process.exit(EXIT_USAGE);
    }
    setEffectiveGlobalConfig({
      baseUrl: merged.baseUrl,
      output: merged.output,
      apiKey: key,
    });
    const result = await probeSettingsUnitPreference(merged.baseUrl, key);
    if (result.kind === "ok") {
      writeCommandSuccess(
        merged.output,
        settingsUnitPreferenceHumanSuccessLine(result.status, result.body),
        {
          ok: true,
          status: result.status,
          path: SETTINGS_UNIT_PREFERENCE_PATH,
          body: result.body,
        },
      );
      return;
    }
    if (result.kind === "http") {
      writeCommandError(merged.output, {
        code: CLI_ERROR_HTTP,
        message: settingsUnitPreferenceHttpErrorMessageForCli(
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

settingsCmd
  .command("default-shoe")
  .description(
    "GET /settings/default-shoe — current default shoe or null (read-only; never updates).",
  )
  .addHelpText(
    "after",
    `
Examples:
  TEMPO_BASE_URL=https://tempo.example.com TEMPO_API_KEY=tmp_... tempo settings default-shoe
  tempo --output json settings default-shoe

This command only performs GET. It does not update or clear the default shoe (no PUT).

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
          "tempo settings default-shoe: provide --api-key, set TEMPO_API_KEY, or set api_key in config.toml.",
      });
      process.exit(EXIT_USAGE);
    }
    setEffectiveGlobalConfig({
      baseUrl: merged.baseUrl,
      output: merged.output,
      apiKey: key,
    });
    const result = await probeSettingsDefaultShoe(merged.baseUrl, key);
    if (result.kind === "ok") {
      writeCommandSuccess(
        merged.output,
        settingsDefaultShoeHumanSuccessLine(result.status, result.body),
        {
          ok: true,
          status: result.status,
          path: SETTINGS_DEFAULT_SHOE_PATH,
          body: result.body,
        },
      );
      return;
    }
    if (result.kind === "http") {
      writeCommandError(merged.output, {
        code: CLI_ERROR_HTTP,
        message: settingsDefaultShoeHttpErrorMessageForCli(
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

settingsCmd.addHelpText(
  "after",
  `
Subcommands: heart-rate-zones, unit-preference, default-shoe. Run tempo settings <command> --help for each.

All settings commands are read-only (GET) and require an API key (--api-key, TEMPO_API_KEY, or api_key in config). The CLI never calls PUT/POST under /settings/* (no updates, no recalculate).

${HELP_GLOBALS_HINT}
`,
);

const shoesCmd = program
  .command("shoes")
  .description("Read-only shoes commands (GET only).");

shoesCmd
  .command("list")
  .description(
    "GET /shoes — list shoes with calculated mileage (read-only; never creates, edits, or deletes).",
  )
  .addHelpText(
    "after",
    `
Examples:
  TEMPO_BASE_URL=https://tempo.example.com TEMPO_API_KEY=tmp_... tempo shoes list
  tempo --output json shoes list

This command only performs GET. It does not create shoes (no POST /shoes).

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
          "tempo shoes list: provide --api-key, set TEMPO_API_KEY, or set api_key in config.toml.",
      });
      process.exit(EXIT_USAGE);
    }
    setEffectiveGlobalConfig({
      baseUrl: merged.baseUrl,
      output: merged.output,
      apiKey: key,
    });
    const result = await probeShoesList(merged.baseUrl, key);
    if (result.kind === "ok") {
      writeCommandSuccess(
        merged.output,
        shoesListHumanSuccessLine(result.status, result.body),
        {
          ok: true,
          status: result.status,
          path: SHOES_LIST_PATH,
          body: result.body,
        },
      );
      return;
    }
    if (result.kind === "http") {
      writeCommandError(merged.output, {
        code: CLI_ERROR_HTTP,
        message: shoesListHttpErrorMessageForCli(
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

shoesCmd
  .command("mileage")
  .description(
    "GET /shoes/{id}/mileage — calculated total mileage for a shoe (read-only).",
  )
  .argument("<id>", "Shoe id (UUID)")
  .addHelpText(
    "after",
    `
Examples:
  TEMPO_BASE_URL=https://tempo.example.com TEMPO_API_KEY=tmp_... tempo shoes mileage 550e8400-e29b-41d4-a716-446655440000
  tempo --output json shoes mileage 550e8400-e29b-41d4-a716-446655440000

Returns 404 when the shoe id does not exist for the authenticated user.

This command only performs GET. It does not edit (no PATCH /shoes/{id}) or delete (no DELETE /shoes/{id}) shoes.

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
          "tempo shoes mileage: provide --api-key, set TEMPO_API_KEY, or set api_key in config.toml.",
      });
      process.exit(EXIT_USAGE);
    }
    const shoeId = trimWorkoutId(id);
    if (!isValidWorkoutId(shoeId)) {
      writeCommandError(merged.output, {
        code: CLI_ERROR_INVALID_ARGUMENTS,
        message: `tempo shoes mileage: "${id}" is not a valid UUID`,
      });
      process.exit(EXIT_USAGE);
    }
    setEffectiveGlobalConfig({
      baseUrl: merged.baseUrl,
      output: merged.output,
      apiKey: key,
    });
    const result = await probeShoeMileage(merged.baseUrl, key, shoeId);
    if (result.kind === "ok") {
      writeCommandSuccess(
        merged.output,
        shoeMileageHumanSuccessLine(result.status, result.body),
        {
          ok: true,
          status: result.status,
          path: buildShoeMileagePath(shoeId),
          body: result.body,
        },
      );
      return;
    }
    if (result.kind === "http") {
      writeCommandError(merged.output, {
        code: CLI_ERROR_HTTP,
        message: shoeMileageHttpErrorMessageForCli(
          result.status,
          result.body,
          key,
          shoeId,
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

shoesCmd.addHelpText(
  "after",
  `
Subcommands: list, mileage. Run tempo shoes <command> --help for each.

All shoes commands are read-only (GET) and require an API key (--api-key, TEMPO_API_KEY, or api_key in config). The CLI never calls POST /shoes, PATCH /shoes/{id}, or DELETE /shoes/{id}. There is no GET /shoes/{id} in the API spec, so "tempo shoes get" is intentionally not provided; use "tempo shoes mileage <id>" for per-shoe data.

${HELP_GLOBALS_HINT}
`,
);

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
