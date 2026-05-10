import { dirname, join } from "node:path";

import { getDefaultConfigPath } from "./path.js";

/** Default `subjective-{YYYY-Www}.yaml` beside config (weekly recap spec §3.3). */
export function getDefaultSubjectiveFilePath(isoWeekId: string): string {
  const tempoDir = dirname(getDefaultConfigPath());
  return join(tempoDir, `subjective-${isoWeekId}.yaml`);
}
