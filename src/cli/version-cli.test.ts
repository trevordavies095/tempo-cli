import { execSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliJs = join(root, "dist", "cli.js");

const pkg = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
) as { name: string; version: string };

let cleanupInvalidConfig: (() => void) | undefined;

beforeAll(() => {
  if (!existsSync(cliJs)) {
    execSync("npm run build", { cwd: root, stdio: "inherit" });
  }
});

afterEach(() => {
  cleanupInvalidConfig?.();
  cleanupInvalidConfig = undefined;
});

function runTempo(
  args: string[],
  extraEnv: Record<string, string | undefined> = {},
) {
  return spawnSync(process.execPath, [cliJs, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });
}

describe("tempo version (subprocess)", () => {
  it("prints human line to stdout", () => {
    const r = runTempo(["version"]);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(`${pkg.name} ${pkg.version}`);
  });

  it("prints JSON when --output json precedes subcommand", () => {
    const r = runTempo(["--output", "json", "version"]);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const body = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.cliVersion).toBe(pkg.version);
    expect(body.cli).toEqual({ name: pkg.name, version: pkg.version });
  });

  it("prints JSON when --output json follows subcommand", () => {
    const r = runTempo(["version", "--output", "json"]);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const body = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    expect(body.cliVersion).toBe(pkg.version);
  });

  it("succeeds when config.toml is invalid TOML", () => {
    const base = mkdtempSync(join(tmpdir(), "tempo-cli-version-"));
    const tempoDir = join(base, "tempo");
    mkdirSync(tempoDir);
    writeFileSync(join(tempoDir, "config.toml"), "not [[ valid toml");
    cleanupInvalidConfig = () => rmSync(base, { recursive: true, force: true });

    const env: Record<string, string | undefined> =
      process.platform === "win32"
        ? { APPDATA: base }
        : { XDG_CONFIG_HOME: base };

    const r = runTempo(["version"], env);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(`${pkg.name} ${pkg.version}`);
  });
});
