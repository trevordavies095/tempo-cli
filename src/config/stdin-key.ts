import { readFileSync } from "node:fs";

/** First non-empty line from stdin when not a TTY; otherwise undefined. */
export function readKeyFromStdinIfAvailable(): string | undefined {
  if (process.stdin.isTTY) return undefined;
  let raw: string;
  try {
    raw = readFileSync(0, "utf8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "EAGAIN" || err.code === "EINVAL") return undefined;
    throw e;
  }
  const line = raw.split(/\r?\n/).find((l) => l.trim().length > 0);
  return line?.trim();
}
