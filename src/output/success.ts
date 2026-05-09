import type { OutputMode } from "../config/file.js";

/** Successful command payload to stdout (human line or compact JSON). */
export function writeCommandSuccess(
  output: OutputMode,
  humanLine: string,
  jsonBody: Record<string, unknown>,
): void {
  if (output === "json") {
    console.log(JSON.stringify(jsonBody));
  } else {
    console.log(humanLine);
  }
}
