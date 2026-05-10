import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { getDefaultConfigPath } from "./path.js";
import {
  expandUserHomePath,
  getDefaultPrescribedFilePath,
} from "./prescribed-path.js";

describe("prescribed-path", () => {
  it("getDefaultPrescribedFilePath sits beside config.toml with prescribed-{isoWeek}.yaml", () => {
    const iso = "2026-W19";
    const p = getDefaultPrescribedFilePath(iso);
    expect(p).toBe(join(dirname(getDefaultConfigPath()), `prescribed-${iso}.yaml`));
  });

  it("getDefaultPrescribedFilePath uses prescribedDir when provided", () => {
    const iso = "2026-W19";
    const p = getDefaultPrescribedFilePath(iso, "/custom/prescribed");
    expect(p).toBe(join("/custom/prescribed", `prescribed-${iso}.yaml`));
  });

  it("expandUserHomePath expands ~/ and lone ~", () => {
    expect(expandUserHomePath("~/Documents/foo.yaml")).toBe(
      join(homedir(), "Documents/foo.yaml"),
    );
    expect(expandUserHomePath("~")).toBe(homedir());
    expect(expandUserHomePath("/abs/path")).toBe("/abs/path");
  });
});
