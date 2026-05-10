import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Default cache directory for recap artifacts (best-efforts snapshots per weekly recap spec §3.6).
 * Unix/macOS: `$XDG_CACHE_HOME/tempo` or `~/.cache/tempo`.
 * Windows: `%LOCALAPPDATA%/tempo/cache`.
 */
export function getDefaultTempoCacheDir(): string {
  if (process.platform === "win32") {
    const base =
      process.env.LOCALAPPDATA?.trim() ||
      join(homedir(), "AppData", "Local");
    return join(base, "tempo", "cache");
  }
  const base =
    process.env.XDG_CACHE_HOME?.trim() || join(homedir(), ".cache");
  return join(base, "tempo");
}
