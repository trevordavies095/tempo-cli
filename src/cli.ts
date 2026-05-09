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
const fileLayer = shouldSkipConfigLoad(process.argv.slice(2))
  ? {}
  : (() => {
      try {
        return loadConfigFile(configPath);
      } catch (e) {
        console.error(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    })();

const preFlag = computePreFlagDefaults(fileLayer);

const platformHint = process.platform === "win32" ? "Windows" : "Unix";

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
    const merged = this.optsWithGlobals() as { apiKey?: string };
    let key = merged.apiKey?.trim();
    if (!key) key = process.env.TEMPO_API_KEY?.trim();
    if (!key) key = readKeyFromStdinIfAvailable();
    if (!key) {
      console.error(
        "tempo config set-api-key: provide --api-key, set TEMPO_API_KEY, or pipe the key on stdin (non-interactive).",
      );
      process.exit(1);
    }
    const path = getDefaultConfigPath();
    try {
      persistApiKey(path, key);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
    console.log(`Wrote API key to ${path}`);
    if (process.platform !== "win32") {
      console.error("Set config file mode to 0600 (user read/write only).");
    }
  });

program
  .command("version")
  .description(
    "Print the local CLI version (npm package). A future release may add the Tempo server version via the API.",
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
