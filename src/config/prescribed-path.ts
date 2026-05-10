import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { getDefaultConfigPath } from "./path.js";

/**
 * Default `prescribed-{YYYY-Www}.yaml` beside `config.toml`, or under `prescribedDir`
 * when set (config `[report].prescribed_dir`).
 */
export function getDefaultPrescribedFilePath(
  isoWeekId: string,
  prescribedDir?: string,
): string {
  const base =
    prescribedDir?.trim() !== undefined && prescribedDir.trim() !== ""
      ? expandUserHomePath(prescribedDir.trim())
      : dirname(getDefaultConfigPath());
  return join(base, `prescribed-${isoWeekId}.yaml`);
}

/** Expand leading `~` to the user home directory (Unix-style paths). */
export function expandUserHomePath(input: string): string {
  const t = input.trim();
  if (t.startsWith("~/")) return join(homedir(), t.slice(2));
  if (t === "~") return homedir();
  return t;
}
