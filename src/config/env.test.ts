import { afterEach, describe, expect, it } from "vitest";

import { computePreFlagDefaults } from "./file.js";
import { readOptionalEnv } from "./env.js";
import { pickApiKey } from "./runtime.js";

describe("readOptionalEnv", () => {
  const keys = ["TEMPO_BASE_URL", "TEMPO_API_KEY"] as const;
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const k of keys) {
      if (k in saved) {
        const v = saved[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
        delete saved[k];
      }
    }
  });

  function setEnv(name: (typeof keys)[number], value: string | undefined) {
    if (!(name in saved)) saved[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  it("returns undefined for missing, blank, and unsubstituted user_config placeholders", () => {
    setEnv("TEMPO_BASE_URL", undefined);
    expect(readOptionalEnv("TEMPO_BASE_URL")).toBeUndefined();

    setEnv("TEMPO_BASE_URL", "   ");
    expect(readOptionalEnv("TEMPO_BASE_URL")).toBeUndefined();

    setEnv("TEMPO_BASE_URL", "${user_config.base_url}");
    expect(readOptionalEnv("TEMPO_BASE_URL")).toBeUndefined();

    setEnv("TEMPO_API_KEY", "${user_config.api_key}");
    expect(readOptionalEnv("TEMPO_API_KEY")).toBeUndefined();
  });

  it("returns real values", () => {
    setEnv("TEMPO_BASE_URL", "https://tempo.example.com/api");
    expect(readOptionalEnv("TEMPO_BASE_URL")).toBe(
      "https://tempo.example.com/api",
    );
  });
});

describe("MCPB blank user_config does not override config.toml", () => {
  const savedUrl = process.env.TEMPO_BASE_URL;
  const savedKey = process.env.TEMPO_API_KEY;

  afterEach(() => {
    if (savedUrl === undefined) delete process.env.TEMPO_BASE_URL;
    else process.env.TEMPO_BASE_URL = savedUrl;
    if (savedKey === undefined) delete process.env.TEMPO_API_KEY;
    else process.env.TEMPO_API_KEY = savedKey;
  });

  it("computePreFlagDefaults falls through to file base_url", () => {
    process.env.TEMPO_BASE_URL = "${user_config.base_url}";
    const defaults = computePreFlagDefaults({
      baseUrl: "https://tempo.mirrorballed.com/api",
    });
    expect(defaults.baseUrl).toBe("https://tempo.mirrorballed.com/api");
  });

  it("pickApiKey falls through to file api_key", () => {
    process.env.TEMPO_API_KEY = "${user_config.api_key}";
    expect(pickApiKey(undefined, { apiKey: "tmp_from_file" })).toBe(
      "tmp_from_file",
    );
  });
});
