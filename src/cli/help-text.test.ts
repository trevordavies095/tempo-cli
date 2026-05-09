import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliJs = join(root, "dist", "cli.js");

beforeAll(() => {
  if (!existsSync(cliJs)) {
    execSync("npm run build", { cwd: root, stdio: "inherit" });
  }
});

function helpFor(args: string[]): string {
  const r = spawnSync(process.execPath, [cliJs, ...args], {
    encoding: "utf8",
  });
  expect(r.status).toBe(0);
  return r.stdout;
}

describe("subcommand --help (P6)", () => {
  it("health --help includes examples and pointer to tempo --help", () => {
    const out = helpFor(["health", "--help"]);
    expect(out).toContain("TEMPO_BASE_URL");
    expect(out).toContain("tempo --help");
    expect(out).toContain("tempo health");
  });

  it("server version --help includes examples and pointer to tempo --help", () => {
    const out = helpFor(["server", "version", "--help"]);
    expect(out).toContain("TEMPO_BASE_URL");
    expect(out).toContain("tempo --help");
    expect(out).toContain("server version");
  });

  it("auth me --help includes TEMPO_API_KEY and auth me", () => {
    const out = helpFor(["auth", "me", "--help"]);
    expect(out).toContain("TEMPO_API_KEY");
    expect(out).toContain("tempo --help");
    expect(out).toContain("auth me");
  });

  it("workouts list --help includes TEMPO_API_KEY and workouts list", () => {
    const out = helpFor(["workouts", "list", "--help"]);
    expect(out).toContain("TEMPO_API_KEY");
    expect(out).toContain("tempo --help");
    expect(out).toContain("workouts list");
  });

  it("workout get --help includes TEMPO_API_KEY and workout get", () => {
    const out = helpFor(["workout", "get", "--help"]);
    expect(out).toContain("TEMPO_API_KEY");
    expect(out).toContain("tempo --help");
    expect(out).toContain("workout get");
  });

  it("workout similar-routes --help includes TEMPO_API_KEY and similar-routes", () => {
    const out = helpFor(["workout", "similar-routes", "--help"]);
    expect(out).toContain("TEMPO_API_KEY");
    expect(out).toContain("tempo --help");
    expect(out).toContain("similar-routes");
  });

  it("workout media list --help includes TEMPO_API_KEY and media list", () => {
    const out = helpFor(["workout", "media", "list", "--help"]);
    expect(out).toContain("TEMPO_API_KEY");
    expect(out).toContain("tempo --help");
    expect(out).toContain("media");
    expect(out).toContain("list");
  });

  it("version --help includes tempo version and tempo --help", () => {
    const out = helpFor(["version", "--help"]);
    expect(out).toContain("tempo version");
    expect(out).toContain("tempo --help");
  });
});
