#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, Option } from "commander";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf8"),
) as { version: string; description?: string };

const defaultBaseUrl =
  process.env.TEMPO_BASE_URL?.trim() || "http://localhost:5001";

const program = new Command();

program
  .name("tempo")
  .description(pkg.description ?? "Command-line client for Tempo")
  .version(pkg.version)
  .option(
    "--base-url <url>",
    "Tempo API base URL (no trailing slash required)",
    defaultBaseUrl,
  )
  .addOption(
    new Option("--output <mode>", "Output format for successful command data")
      .choices(["human", "json"])
      .default("human"),
  )
  .option(
    "--api-key <key>",
    "API key (Bearer token). The CLI never logs or echoes this value.",
  )
  .addHelpText(
    "after",
    `
Environment:
  TEMPO_BASE_URL    If set, used as the default for --base-url; if unset, default is http://localhost:5001.
  TEMPO_API_KEY     API key for authenticated requests (admin-issued in Tempo); never logged or echoed.
`,
  );

// No resource subcommands yet: any successful parse without --version/--help shows full help on stdout and exits 0.
program.action(() => {
  program.help();
});

program.parse();
