import { describe, expect, it } from "vitest";

import { resolveRecapCacheDir } from "./recap-paths.js";

describe("resolveRecapCacheDir", () => {
  it("prefers flag over report.cache_dir over default", () => {
    expect(
      resolveRecapCacheDir({
        cacheDirFlag: "/flag/cache",
        reportCacheDir: "/report/cache",
      }),
    ).toBe("/flag/cache");
    expect(
      resolveRecapCacheDir({
        reportCacheDir: "~/from-report",
      }),
    ).toMatch(/from-report$/);
  });
});
