import { dirname, join } from "node:path";

import { getDefaultConfigPath } from "./path.js";
import { expandUserHomePath } from "./prescribed-path.js";

/**
 * Default `subjective-{YYYY-Www}.yaml` beside `config.toml`, or under `subjectiveDir`
 * when set (config `[report].subjective_dir`).
 */
export function getDefaultSubjectiveFilePath(
  isoWeekId: string,
  subjectiveDir?: string,
): string {
  const base =
    subjectiveDir?.trim() !== undefined && subjectiveDir.trim() !== ""
      ? expandUserHomePath(subjectiveDir.trim())
      : dirname(getDefaultConfigPath());
  return join(base, `subjective-${isoWeekId}.yaml`);
}
