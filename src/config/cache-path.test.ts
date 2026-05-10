import { afterEach, describe, expect, it } from "vitest";

import { getDefaultTempoCacheDir } from "./cache-path.js";

describe("getDefaultTempoCacheDir", () => {
  const orig =
    process.platform === "win32"
      ? process.env.LOCALAPPDATA
      : process.env.XDG_CACHE_HOME;

  afterEach(() => {
    if (process.platform === "win32") {
      if (orig === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = orig;
    } else {
      if (orig === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = orig;
    }
  });

  it("uses XDG_CACHE_HOME/tempo on Unix when set", () => {
    if (process.platform === "win32") return;
    process.env.XDG_CACHE_HOME = "/custom/cache";
    expect(getDefaultTempoCacheDir()).toBe("/custom/cache/tempo");
  });

  it("returns LocalAppData/tempo/cache on Windows when LOCALAPPDATA is set", () => {
    if (process.platform !== "win32") return;
    process.env.LOCALAPPDATA = "C:\\Users\\me\\AppData\\Local";
    expect(getDefaultTempoCacheDir().replace(/\\/g, "/")).toBe(
      "C:/Users/me/AppData/Local/tempo/cache",
    );
  });
});
