/**
 * Stream discipline (P8): primary command output on stdout; diagnostics on stderr.
 * Use writeOutLine for successful payloads (human lines, JSON). Use writeErrLine for
 * errors, warnings, progress, and non-primary hints.
 */
export function writeOutLine(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function writeErrLine(message: string): void {
  process.stderr.write(`${message}\n`);
}
