import { describe, expect, it } from "vitest";
import {
  isVersionInvocation,
  peekOutputModeFromArgv,
  stripGlobalOptionsFromArgv,
} from "./argv-output-peek.js";

describe("stripGlobalOptionsFromArgv", () => {
  it("removes globals and leaves the subcommand first", () => {
    expect(stripGlobalOptionsFromArgv(["--output", "json", "version"])).toEqual([
      "version",
    ]);
    expect(
      stripGlobalOptionsFromArgv(["version", "--output", "json"]),
    ).toEqual(["version"]);
    expect(
      stripGlobalOptionsFromArgv([
        "--base-url",
        "http://x.test",
        "--api-key",
        "tmp_x",
        "version",
      ]),
    ).toEqual(["version"]);
  });

  it("supports --flag=value form", () => {
    expect(
      stripGlobalOptionsFromArgv(["--output=json", "version"]),
    ).toEqual(["version"]);
  });
});

describe("isVersionInvocation", () => {
  it("is true for version alone or with globals", () => {
    expect(isVersionInvocation(["version"])).toBe(true);
    expect(isVersionInvocation(["--output", "json", "version"])).toBe(true);
    expect(isVersionInvocation(["version", "--output", "json"])).toBe(true);
  });

  it("is false for other subcommands", () => {
    expect(isVersionInvocation(["config", "set-api-key"])).toBe(false);
    expect(isVersionInvocation(["health"])).toBe(false);
    expect(isVersionInvocation([])).toBe(false);
  });
});

describe("peekOutputModeFromArgv", () => {
  it("defaults to human", () => {
    expect(peekOutputModeFromArgv(["version"])).toBe("human");
  });

  it("recognizes --output json", () => {
    expect(peekOutputModeFromArgv(["--output", "json", "version"])).toBe(
      "json",
    );
  });

  it("recognizes --output=json", () => {
    expect(peekOutputModeFromArgv(["--output=json", "version"])).toBe("json");
  });

  it("last recognized flag wins", () => {
    expect(
      peekOutputModeFromArgv([
        "--output",
        "json",
        "--output",
        "human",
        "version",
      ]),
    ).toBe("human");
    expect(
      peekOutputModeFromArgv([
        "--output",
        "human",
        "--output",
        "json",
        "version",
      ]),
    ).toBe("json");
  });

  it("treats unknown value as human for peek", () => {
    expect(peekOutputModeFromArgv(["--output", "bogus", "version"])).toBe(
      "human",
    );
  });

  it("ignores --output when value is missing (next arg is another flag)", () => {
    expect(peekOutputModeFromArgv(["--output", "--help"])).toBe("human");
  });
});
