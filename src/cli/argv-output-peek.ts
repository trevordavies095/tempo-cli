import type { OutputMode } from "../config/file.js";

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
