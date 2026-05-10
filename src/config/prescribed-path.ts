import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { getDefaultConfigPath } from "./path.js";

/** Default `prescribed-{YYYY-Www}.yaml` next to `config.toml` (weekly recap spec §3.2 / §3.3). */
export function getDefaultPrescribedFilePath(isoWeekId: string): string {
  const tempoDir = dirname(getDefaultConfigPath());
  return join(tempoDir, `prescribed-${isoWeekId}.yaml`);
}

/** Expand leading `~` to the user home directory (Unix-style paths). */
export function expandUserHomePath(input: string): string {
  const t = input.trim();
  if (t.startsWith("~/")) return join(homedir(), t.slice(2));
  if (t === "~") return homedir();
  return t;
}
