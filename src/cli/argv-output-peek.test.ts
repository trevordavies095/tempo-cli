import { describe, expect, it } from "vitest";
import { peekOutputModeFromArgv } from "./argv-output-peek.js";

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
