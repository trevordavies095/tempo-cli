import { getDefaultTempoCacheDir } from "./cache-path.js";
import { expandUserHomePath } from "./prescribed-path.js";

/** Best-efforts cache dir: `--cache-dir` > `report.cache_dir` > default XDG/cache. */
export function resolveRecapCacheDir(options: {
  cacheDirFlag?: string;
  reportCacheDir?: string;
}): string {
  const raw =
    options.cacheDirFlag?.trim() || options.reportCacheDir?.trim();
  if (raw) return expandUserHomePath(raw);
  return getDefaultTempoCacheDir();
}
