import type { OutputMode } from "../config/file.js";

/** Root global options (strip before detecting the subcommand). */
const GLOBAL_LONG_OPTS = new Set(["--output", "--base-url", "--api-key"]);

/**
 * Remove Commander root global options and their values so the first remaining
 * token is the subcommand name (if any). Does not parse `-V` / `--version`.
 */
export function stripGlobalOptionsFromArgv(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (GLOBAL_LONG_OPTS.has(a)) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) i++;
      continue;
    }
    if (
      a.startsWith("--output=") ||
      a.startsWith("--base-url=") ||
      a.startsWith("--api-key=")
    ) {
      continue;
    }
    out.push(a);
  }
  return out;
}

/** True when argv runs the `version` subcommand (after stripping root globals). */
export function isVersionInvocation(argv: string[]): boolean {
  return stripGlobalOptionsFromArgv(argv)[0] === "version";
}

/**
 * Read `--output` from argv before Commander runs (e.g. config load failures).
 * Last recognized value wins. Unknown values are treated as `human` for peek only.
 */
export function peekOutputModeFromArgv(argv: string[]): OutputMode {
  let mode: OutputMode = "human";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--output") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) continue;
      mode = normalizePeekOutput(next);
      continue;
    }
    if (a.startsWith("--output=")) {
      mode = normalizePeekOutput(a.slice("--output=".length));
    }
  }
  return mode;
}

function normalizePeekOutput(value: string): OutputMode {
  const v = value.trim();
  if (v === "json") return "json";
  return "human";
}
