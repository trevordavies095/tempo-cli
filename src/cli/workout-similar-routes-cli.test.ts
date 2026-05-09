import { execSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  CLI_ERROR_INVALID_ARGUMENTS,
  CLI_ERROR_MISSING_API_KEY,
} from "../output/error.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliJs = join(root, "dist", "cli.js");

let cleanup: (() => void) | undefined;

beforeAll(() => {
  if (!existsSync(cliJs)) {
    execSync("npm run build", { cwd: root, stdio: "inherit" });
  }
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function runTempo(
  args: string[],
  extraEnv: Record<string, string | undefined>,
) {
  return spawnSync(process.execPath, [cliJs, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });
}

const SAMPLE_UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("tempo workout similar-routes (subprocess)", () => {
  it("exits 1 with MISSING_API_KEY JSON when no key is configured", () => {
    const base = mkdtempSync(join(tmpdir(), "tempo-cli-similar-routes-"));
    const tempoDir = join(base, "tempo");
    mkdirSync(tempoDir, { recursive: true });
    writeFileSync(
      join(tempoDir, "config.toml"),
      'base_url = "http://localhost:5001"\n',
    );
    cleanup = () => rmSync(base, { recursive: true, force: true });

    const env: Record<string, string | undefined> =
      process.platform === "win32"
        ? { APPDATA: base, TEMPO_API_KEY: "" }
        : { XDG_CONFIG_HOME: base, TEMPO_API_KEY: "" };

    const r = runTempo(
      ["--output", "json", "workout", "similar-routes", SAMPLE_UUID],
      env,
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    const err = JSON.parse(r.stderr.trim()) as {
      error: { code: string; message: string };
    };
    expect(err.error.code).toBe(CLI_ERROR_MISSING_API_KEY);
    expect(err.error.message).toContain("similar-routes");
  });

  it("exits 1 with INVALID_ARGUMENTS when id is not a UUID", () => {
    const base = mkdtempSync(
      join(tmpdir(), "tempo-cli-similar-routes-badid-"),
    );
    const tempoDir = join(base, "tempo");
    mkdirSync(tempoDir, { recursive: true });
    writeFileSync(
      join(tempoDir, "config.toml"),
      'base_url = "http://localhost:5001"\napi_key = "tmp_test_key"\n',
    );
    cleanup = () => rmSync(base, { recursive: true, force: true });

    const env: Record<string, string | undefined> =
      process.platform === "win32"
        ? { APPDATA: base, TEMPO_API_KEY: "" }
        : { XDG_CONFIG_HOME: base, TEMPO_API_KEY: "" };

    const r = runTempo(
      ["--output", "json", "workout", "similar-routes", "bad"],
      env,
    );
    expect(r.status).toBe(1);
    const err = JSON.parse(r.stderr.trim()) as {
      error: { code: string; message: string };
    };
    expect(err.error.code).toBe(CLI_ERROR_INVALID_ARGUMENTS);
    expect(err.error.message).toContain("UUID");
  });
});
