import type { OutputMode } from "../config/file.js";
import { writeOutLine } from "../io/streams.js";

/** Successful command payload to stdout (human line or compact JSON). */
export function writeCommandSuccess(
  output: OutputMode,
  humanLine: string,
  jsonBody: Record<string, unknown>,
): void {
  if (output === "json") {
    writeOutLine(JSON.stringify(jsonBody));
  } else {
    writeOutLine(humanLine);
  }
}
