#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, Option } from "commander";
import { stringify as stringifyYaml } from "yaml";
import { computePreFlagDefaults, loadConfigFile } from "./config/file.js";
import { expandUserHomePath } from "./config/prescribed-path.js";
import { getDefaultSubjectiveFilePath } from "./config/subjective-path.js";
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
import { runStdioMcpServer } from "./mcp/run-stdio.js";
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
  buildStatsWeeklyRecapPath,
  probeStatsWeeklyRecap,
  statsWeeklyRecapHumanSuccessLine,
  statsWeeklyRecapHttpErrorMessageForCli,
  statsWeeklyRecapQueryFromCli,
} from "./commands/stats-weekly-recap.js";
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
  getSystemTimeZone,
  isValidIanaTimeZone,
  resolveDefaultRecapWeekSpec,
  resolveRecapWeek,
} from "./weekly-recap/resolve-week.js";
import {
  runWeeklyRecap,
  type SubjectiveCollect,
  type SubjectiveSource,
} from "./weekly-recap/run-weekly-recap.js";
import { collectSubjectiveInteractive } from "./weekly-recap/subjective-interactive.js";
import { parseSubjectiveWeek } from "./weekly-recap/subjective-week.js";
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
  .command("weekly-recap")
  .description(
    "GET /stats/weekly-recap — current week aggregates vs previous week and 3-week trailing averages (Monday–Sunday via timezoneOffsetMinutes).",
  )
  .option(
    "--timezone-offset-minutes <n>",
    "Timezone offset in minutes (query: timezoneOffsetMinutes; negative for behind UTC)",
  )
  .option(
    "--reference-date <yyyy-mm-dd>",
    "Anchor calendar date for which week is current (query: referenceDate, YYYY-MM-DD)",
  )
  .addHelpText(
    "after",
    `
Examples:
  TEMPO_BASE_URL=https://tempo.example.com TEMPO_API_KEY=tmp_... tempo stats weekly-recap
  tempo stats weekly-recap --timezone-offset-minutes -300 --reference-date 2026-04-27
  tempo --output json stats weekly-recap

Week boundaries follow the fixed offset (not DST). Mid-week responses are week-to-date unless reference-date pins a past week.

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
      referenceDate?: string;
    };
    const key = pickApiKey(merged.apiKey, fileLayer);
    if (!key) {
      writeCommandError(merged.output, {
        code: CLI_ERROR_MISSING_API_KEY,
        message:
          "tempo stats weekly-recap: provide --api-key, set TEMPO_API_KEY, or set api_key in config.toml.",
      });
      process.exit(EXIT_USAGE);
    }
    const parsed = statsWeeklyRecapQueryFromCli({
      timezoneOffsetMinutes: merged.timezoneOffsetMinutes,
      referenceDate: merged.referenceDate,
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
    const result = await probeStatsWeeklyRecap(
      merged.baseUrl,
      key,
      parsed.ok,
    );
    if (result.kind === "ok") {
      writeCommandSuccess(
        merged.output,
        statsWeeklyRecapHumanSuccessLine(result.status, result.body),
        {
          ok: true,
          status: result.status,
          path: buildStatsWeeklyRecapPath(parsed.ok),
          body: result.body,
        },
      );
      return;
    }
    if (result.kind === "http") {
      writeCommandError(merged.output, {
        code: CLI_ERROR_HTTP,
        message: statsWeeklyRecapHttpErrorMessageForCli(
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
Subcommands: weekly, yearly, yearly-weekly, relative-effort, weekly-recap, best-efforts, available-periods, available-years, insights. Run tempo stats <command> --help for each.

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
  .command("weekly-recap")
  .description(
    "Resolve the recap week (Mon–Sun), verify auth and settings, fetch workouts (list + detail + similar-routes when route data exists), shoes, weekly stats (weekly-recap + relative-effort, with yearly-weekly fallback), then derive HR zone mix and drift from per-second HR when present.",
  )
  .option(
    "--week <spec>",
    'Which week: omit for a smart default (Sat–Sun → current, Mon → last completed, Tue–Fri → current), or pass "last", "current", YYYY-Www (ISO week), or YYYY-MM-DD (a date in the week)',
  )
  .option(
    "--timezone <iana>",
    "IANA timezone for Mon–Sun boundaries (default: system timezone)",
  )
  .option(
    "--write <path>",
    "Write output to this path (- or omit = stdout). Use this for the report file; global --output only selects human vs JSON.",
  )
  .addOption(
    new Option(
      "--format <mode>",
      'Report payload: "markdown" (full weekly recap document), "compact" (terminal-friendly summary), or "json" (structured diagnostics without Markdown body)',
    )
      .choices(["markdown", "json", "compact"])
      .default("markdown"),
  )
  .option(
    "--include-trends",
    "Include §2.7 rolling trends (extra GET /workouts for mon−21d…sun−7d). Default: on or from config [report].include_trends.",
    fileLayer.report?.includeTrends ?? true,
  )
  .option(
    "--no-include-trends",
    "Skip §2.7 trends for a faster run (no extra workouts list).",
  )
  .option(
    "--cache-dir <path>",
    "Directory for best-efforts JSON cache (overrides config [report].cache_dir).",
  )
  .option(
    "--verbose",
    "Log resolved paths and recap steps to stderr only.",
    false,
  )
  .option(
    "--prescribed-file <path>",
    "YAML prescribed week for §2.5 quality sessions (default: prescribed-{ISO week}.yaml beside config)",
  )
  .option(
    "--subjective-file <path>",
    "YAML/JSON subjective inputs for §2.4 RPE/Felt/Pain and §2.9 weekly recap (default: subjective-{ISO week}.yaml beside config)",
  )
  .option(
    "--no-subjective",
    "Skip subjective file, prompts, and §2.9/§2.10 sections.",
  )
  .option(
    "--refresh-subjective",
    "Ignore any existing subjective sidecar and re-prompt (TTY) or skip file load.",
    false,
  )
  .addHelpText(
    "after",
    `
Examples:
  tempo weekly-recap
  tempo weekly-recap --week current --timezone America/New_York
  tempo weekly-recap --week last
  tempo weekly-recap --week 2026-W19 --output json
  tempo weekly-recap --write ./recap.md
  tempo weekly-recap --refresh-subjective
  tempo weekly-recap --no-include-trends

When --week is omitted, Sat–Sun resolve to the in-progress Mon–Sun week (typical coach recap); Mon resolves to the week that just ended; Tue–Fri resolve to the current week. Pass --week last or --week current to override explicitly.

Runs GET /auth/me, settings (heart-rate-zones, unit-preference), then GET /workouts for the week, GET /workouts/{id} per workout (max 4 concurrent), GET /workouts/{id}/time-series (paginated HR samples, max 4 concurrent workouts), GET /workouts/{id}/similar-routes (maxResults=3 when the workout has route data), GET /shoes, GET /stats/weekly-recap (referenceDate = recap Monday, timezoneOffsetMinutes) for §2.2 summary columns with GET /stats/yearly-weekly as fallback when that response is missing or invalid, GET /stats/relative-effort (timezoneOffsetMinutes) to enrich the relative-effort 3-week cell, and GET /stats/best-efforts for §2.8 PR detection (cached under the default tempo cache dir for week-over-week diffs). Optional local YAML prescribed-file enables §2.5 quality session checks vs splits/HR. With trends enabled (default), also GET /workouts for the rolling §2.7 window (mon−21d…sun−7d). With --format markdown (default), success output is the full Markdown weekly recap; --format compact prints a shorter terminal summary; --format json prints structured diagnostics only (no recap body). JSON CLI mode (--output json) always includes a structured "report" object (week, range, summary, zones, runs, trends, subjective) alongside existing keys; it includes reportMarkdown when --format markdown and compactText when --format compact. Same API key resolution: --api-key, TEMPO_API_KEY, config.

Use --write for the report file path. Global --output is only "human" | "json" for CLI output mode.

${HELP_GLOBALS_HINT}
`,
  )
  .action(async function (this: Command) {
    const merged = this.optsWithGlobals() as {
      output: "human" | "json";
      baseUrl: string;
      apiKey?: string;
      week?: string;
      timezone?: string;
      write?: string;
      format: "markdown" | "json" | "compact";
      includeTrends: boolean;
      prescribedFile?: string;
      subjectiveFile?: string;
      subjective: boolean;
      refreshSubjective: boolean;
      cacheDir?: string;
      verbose: boolean;
    };

    const tzFromFlag = merged.timezone?.trim();
    const tzFromConfig = fileLayer.timezone?.trim();
    const tzCandidate =
      tzFromFlag && tzFromFlag.length > 0
        ? tzFromFlag
        : tzFromConfig && tzFromConfig.length > 0
          ? tzFromConfig
          : "";
    const tz =
      tzCandidate.length > 0 ? tzCandidate : getSystemTimeZone();
    if (!isValidIanaTimeZone(tz)) {
      writeCommandError(merged.output, {
        code: CLI_ERROR_INVALID_ARGUMENTS,
        message: `tempo weekly-recap: invalid IANA timezone: ${tzCandidate}`,
      });
      process.exit(EXIT_USAGE);
    }

    if (merged.verbose) {
      writeErrLine(
        `tempo weekly-recap: timezone=${tz}${tzCandidate.length === 0 ? " (system default)" : ""}`,
      );
    }

    const weekFromCli =
      typeof merged.week === "string" ? merged.week.trim() : "";
    const weekSpec =
      weekFromCli.length > 0
        ? weekFromCli
        : resolveDefaultRecapWeekSpec(new Date(), tz);
    if (merged.verbose && weekFromCli.length === 0) {
      writeErrLine(`tempo weekly-recap: --week omitted; using "${weekSpec}"`);
    }

    const resolvedEarly = resolveRecapWeek({
      weekSpec,
      timeZoneId: tz,
      now: new Date(),
    });
    if (!resolvedEarly.ok) {
      writeCommandError(merged.output, {
        code: CLI_ERROR_INVALID_ARGUMENTS,
        message: `tempo weekly-recap: ${resolvedEarly.message}`,
      });
      process.exit(EXIT_USAGE);
    }

    const key = pickApiKey(merged.apiKey, fileLayer);
    if (!key) {
      writeCommandError(merged.output, {
        code: CLI_ERROR_MISSING_API_KEY,
        message:
          "tempo weekly-recap: provide --api-key, set TEMPO_API_KEY, or set api_key in config.toml.",
      });
      process.exit(EXIT_USAGE);
    }

    setEffectiveGlobalConfig({
      baseUrl: merged.baseUrl,
      output: merged.output,
      apiKey: key,
    });

    const isoWeekId = resolvedEarly.value.isoWeekId;
    let subjective: SubjectiveSource | SubjectiveCollect;

    if (merged.subjective === false) {
      subjective = { kind: "skipped" };
    } else {
      const subjectivePathResolved = expandUserHomePath(
        merged.subjectiveFile?.trim() ||
          getDefaultSubjectiveFilePath(
            isoWeekId,
            fileLayer.report?.subjectiveDir,
          ),
      );
      const savePath = getDefaultSubjectiveFilePath(
        isoWeekId,
        fileLayer.report?.subjectiveDir,
      );
      const refreshSubjective = merged.refreshSubjective;
      const verbose = merged.verbose;
      // Defer file load / TTY until after workouts are fetched (same order as before).
      subjective = {
        kind: "collect",
        path: subjectivePathResolved,
        collect: async (ctx) => {
          let parseError: string | undefined;

          if (refreshSubjective) {
            if (verbose) {
              writeErrLine(
                "tempo weekly-recap: --refresh-subjective; ignoring existing subjective file",
              );
            }
          } else {
            let rawSub: string | undefined;
            try {
              rawSub = await readFile(subjectivePathResolved, "utf8");
            } catch {
              rawSub = undefined;
            }
            if (rawSub?.trim()) {
              const parsed = parseSubjectiveWeek(
                rawSub,
                subjectivePathResolved,
              );
              if (parsed.ok) {
                return {
                  kind: "provided",
                  path: subjectivePathResolved,
                  doc: parsed.value,
                  loadedFromFile: true,
                  interactiveSaved: false,
                  source: "file",
                };
              }
              parseError = parsed.message;
              writeErrLine(`tempo weekly-recap: ${parsed.message}`);
            }
          }

          if (process.stdin.isTTY) {
            const subjectiveDoc = await collectSubjectiveInteractive({
              isoWeekId: ctx.isoWeekId,
              workoutDetails: ctx.workoutDetails,
              timeZoneId: ctx.timeZoneId,
              unit: ctx.unit,
              stdin: process.stdin,
              stdout: process.stdout,
            });
            let interactiveSaved = false;
            try {
              await mkdir(dirname(savePath), { recursive: true });
              await atomicWriteFile(
                savePath,
                new TextEncoder().encode(stringifyYaml(subjectiveDoc)),
              );
              interactiveSaved = true;
            } catch {
              writeErrLine(
                "tempo weekly-recap: could not save subjective file (non-fatal).",
              );
            }
            return {
              kind: "provided",
              path: subjectivePathResolved,
              doc: subjectiveDoc,
              loadedFromFile: false,
              interactiveSaved,
              savePath: interactiveSaved ? savePath : undefined,
              source: "interactive",
              parseError,
            };
          }

          writeErrLine(
            "tempo weekly-recap: no subjective file and stdin is not a TTY; subjective sections omitted.",
          );
          return {
            kind: "absent",
            path: subjectivePathResolved,
            parseError,
          };
        },
      };
    }

    const result = await runWeeklyRecap({
      baseUrl: merged.baseUrl,
      apiKey: key,
      weekSpec,
      timeZoneId: tz,
      format: merged.format,
      includeTrends: merged.includeTrends,
      prescribedFile: merged.prescribedFile,
      prescribedDir: fileLayer.report?.prescribedDir,
      cacheDirFlag: merged.cacheDir,
      cacheDirConfig: fileLayer.report?.cacheDir,
      subjective,
      onProgress: merged.verbose ? writeErrLine : undefined,
    });

    if (!result.ok) {
      writeCommandError(merged.output, {
        code: result.code,
        message: result.message,
      });
      if (result.exit === "usage") {
        process.exit(EXIT_USAGE);
      }
      if ("httpStatus" in result.exit) {
        process.exit(exitCodeForHttpStatus(result.exit.httpStatus));
      }
      process.exit(exitCodeForFetchFailure(result.exit.transport));
    }

    for (const w of result.warnings) {
      writeErrLine(w);
    }

    const writePath = merged.write?.trim();
    const useStdout =
      writePath === undefined || writePath === "" || writePath === "-";

    if (useStdout) {
      writeCommandSuccess(
        merged.output,
        result.humanSuccessBody,
        result.jsonBody,
      );
      return;
    }

    const payload =
      merged.output === "json"
        ? `${JSON.stringify(result.jsonBody)}\n`
        : `${result.humanSuccessBody}\n`;
    try {
      await atomicWriteFile(writePath, new TextEncoder().encode(payload));
    } catch (e) {
      writeCommandError(merged.output, {
        code: CLI_ERROR_CONFIG_WRITE_FAILED,
        message: `tempo weekly-recap: could not write --write: ${e instanceof Error ? e.message : String(e)}`,
      });
      process.exit(EXIT_USAGE);
    }
  });

program
  .command("mcp")
  .description(
    "Start a stdio MCP server for Claude Desktop (and other MCP clients). Exposes check_connection; uses the same base URL and API key resolution as other commands. Stdout is JSON-RPC only — do not pipe CLI success output through this process.",
  )
  .addHelpText(
    "after",
    `
Examples:
  tempo mcp
  TEMPO_BASE_URL=http://localhost:5001 TEMPO_API_KEY=tmp_... tempo mcp
  tempo --base-url http://localhost:5001 --api-key tmp_... mcp

Contributor wiring for Claude Desktop: docs/contributing/mcp-dev.md

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
    setEffectiveGlobalConfig({
      baseUrl: merged.baseUrl,
      output: merged.output,
      apiKey: key,
    });
    await runStdioMcpServer({
      baseUrl: merged.baseUrl,
      apiKey: key,
      name: pkg.name ?? "tempo-cli",
      version: typeof pkg.version === "string" ? pkg.version : "0.0.0",
    });
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
