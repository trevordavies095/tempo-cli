import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadConfigFile } from "./file.js";

describe("loadConfigFile", () => {
  it("parses [report] and timezone", () => {
    const dir = mkdtempSync(join(tmpdir(), "tempo-config-test-"));
    try {
      const path = join(dir, "config.toml");
      writeFileSync(
        path,
        `
timezone = "America/Chicago"

[report]
include_trends = false
prescribed_dir = "~/prescribed-sidecar"
subjective_dir = "~/subjective-sidecar"
cache_dir = "~/.cache/tempo-custom"
`,
        "utf8",
      );
      const layer = loadConfigFile(path);
      expect(layer.timezone).toBe("America/Chicago");
      expect(layer.report?.includeTrends).toBe(false);
      expect(layer.report?.prescribedDir).toBe("~/prescribed-sidecar");
      expect(layer.report?.subjectiveDir).toBe("~/subjective-sidecar");
      expect(layer.report?.cacheDir).toBe("~/.cache/tempo-custom");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects invalid report.include_trends type", () => {
    const dir = mkdtempSync(join(tmpdir(), "tempo-config-test-"));
    try {
      const path = join(dir, "config.toml");
      writeFileSync(
        path,
        `
[report]
include_trends = "yes"
`,
        "utf8",
      );
      expect(() => loadConfigFile(path)).toThrow(/include_trends/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
