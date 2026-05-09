import { homedir } from "node:os";
import { join } from "node:path";

/** Default config.toml location (XDG-style on Unix, AppData on Windows). */
export function getDefaultConfigPath(): string {
  if (process.platform === "win32") {
    const base =
      process.env.APPDATA?.trim() || join(homedir(), "AppData", "Roaming");
    return join(base, "tempo", "config.toml");
  }
  const base =
    process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(base, "tempo", "config.toml");
}
