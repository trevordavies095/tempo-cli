import type { OutputMode } from "../config/file.js";
import { writeErrLine } from "../io/streams.js";

/** Stable codes for CLI-local failures (distinct from future HTTP API error codes). */
export const CLI_ERROR_CONFIG_INVALID = "CONFIG_INVALID";
export const CLI_ERROR_MISSING_API_KEY = "MISSING_API_KEY";
export const CLI_ERROR_CONFIG_WRITE_FAILED = "CONFIG_WRITE_FAILED";

export type CommandErrorPayload = {
  code: string;
  message: string;
  request_id?: string | null;
};

/** One line to stderr: PRD-shaped JSON in json mode, plain message in human mode. */
export function writeCommandError(
  output: OutputMode,
  err: CommandErrorPayload,
): void {
  if (output === "json") {
    writeErrLine(
      JSON.stringify({
        error: {
          code: err.code,
          message: err.message,
          request_id: err.request_id ?? null,
        },
      }),
    );
  } else {
    writeErrLine(err.message);
  }
}
