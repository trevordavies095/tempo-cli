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
    expect(out).toContain("Filter flags use the same names");
    expect(out).toContain("tempo workout list");
    expect(out).toContain("tempo workout get");
  });

  it("workout get --help includes TEMPO_API_KEY and workout get", () => {
    const out = helpFor(["workout", "get", "--help"]);
    expect(out).toContain("TEMPO_API_KEY");
    expect(out).toContain("tempo --help");
    expect(out).toContain("workout get");
    expect(out).toContain("tempo workouts list");
    expect(out).toContain("tempo workout list");
  });

  it("workout similar-routes --help includes TEMPO_API_KEY and similar-routes", () => {
    const out = helpFor(["workout", "similar-routes", "--help"]);
    expect(out).toContain("TEMPO_API_KEY");
    expect(out).toContain("tempo --help");
    expect(out).toContain("similar-routes");
    expect(out).toContain("tempo workouts list");
    expect(out).toContain("tempo workout list");
  });

  it("workout media list --help includes TEMPO_API_KEY and media list", () => {
    const out = helpFor(["workout", "media", "list", "--help"]);
    expect(out).toContain("TEMPO_API_KEY");
    expect(out).toContain("tempo --help");
    expect(out).toContain("media");
    expect(out).toContain("list");
    expect(out).toContain("tempo workouts list");
    expect(out).toContain("tempo workout list");
  });

  it("workout media download --help includes TEMPO_API_KEY and download", () => {
    const out = helpFor(["workout", "media", "download", "--help"]);
    expect(out).toContain("TEMPO_API_KEY");
    expect(out).toContain("tempo --help");
    expect(out).toContain("download");
    expect(out).toContain("media");
    expect(out).toContain("tempo workouts list");
    expect(out).toContain("tempo workout list");
  });

  it("workout --help lists subcommands and CLI naming", () => {
    const out = helpFor(["workout", "--help"]);
    expect(out).toContain("tempo --help");
    expect(out).toContain("Subcommands:");
    expect(out).toContain("tempo workouts list");
    expect(out).toContain("tempo workout list");
    expect(out).toContain("TEMPO_API_KEY");
  });

  it("version --help includes tempo version and tempo --help", () => {
    const out = helpFor(["version", "--help"]);
    expect(out).toContain("tempo version");
    expect(out).toContain("tempo --help");
  });

  it("stats weekly --help documents path, env, and globals", () => {
    const out = helpFor(["stats", "weekly", "--help"]);
    expect(out).toContain("TEMPO_API_KEY");
    expect(out).toContain("TEMPO_BASE_URL");
    expect(out).toContain("Examples:");
    expect(out).toContain("tempo --help");
    expect(out).toContain("stats weekly");
    expect(out).toContain("GET /stats/weekly");
    expect(out).toContain("--timezone-offset-minutes");
  });

  it("stats yearly --help documents path, env, and globals", () => {
    const out = helpFor(["stats", "yearly", "--help"]);
    expect(out).toContain("TEMPO_API_KEY");
    expect(out).toContain("TEMPO_BASE_URL");
    expect(out).toContain("Examples:");
    expect(out).toContain("tempo --help");
    expect(out).toContain("stats yearly");
    expect(out).toContain("GET /stats/yearly");
    expect(out).toContain("--timezone-offset-minutes");
  });

  it("stats yearly-weekly --help documents path, flags, env, and globals", () => {
    const out = helpFor(["stats", "yearly-weekly", "--help"]);
    expect(out).toContain("TEMPO_API_KEY");
    expect(out).toContain("TEMPO_BASE_URL");
    expect(out).toContain("Examples:");
    expect(out).toContain("tempo --help");
    expect(out).toContain("stats yearly-weekly");
    expect(out).toContain("GET /stats/yearly-weekly");
    expect(out).toContain("--period-end-date");
    expect(out).toContain("--timezone-offset-minutes");
  });

  it("stats --help lists all subcommands and globals hint", () => {
    const out = helpFor(["stats", "--help"]);
    expect(out).toContain("tempo --help");
    expect(out).toContain("tempo stats <command> --help");
    expect(out).toContain("read-only (GET)");
    expect(out).toContain("Subcommands:");
    expect(out).toContain("weekly");
    expect(out).toContain("yearly");
    expect(out).toContain("yearly-weekly");
    expect(out).toContain("relative-effort");
    expect(out).toContain("weekly-recap");
    expect(out).toContain("best-efforts");
    expect(out).toContain("available-periods");
    expect(out).toContain("available-years");
    expect(out).toContain("insights");
  });

  it("stats relative-effort --help documents path, env, and globals", () => {
    const out = helpFor(["stats", "relative-effort", "--help"]);
    expect(out).toContain("TEMPO_API_KEY");
    expect(out).toContain("TEMPO_BASE_URL");
    expect(out).toContain("Examples:");
    expect(out).toContain("tempo --help");
    expect(out).toContain("stats relative-effort");
    expect(out).toContain("GET /stats/relative-effort");
    expect(out).toContain("--timezone-offset-minutes");
  });

  it("stats weekly-recap --help documents path, flags, env, and globals", () => {
    const out = helpFor(["stats", "weekly-recap", "--help"]);
    expect(out).toContain("TEMPO_API_KEY");
    expect(out).toContain("TEMPO_BASE_URL");
    expect(out).toContain("Examples:");
    expect(out).toContain("tempo --help");
    expect(out).toContain("stats weekly-recap");
    expect(out).toContain("GET /stats/weekly-recap");
    expect(out).toContain("--timezone-offset-minutes");
    expect(out).toContain("--reference-date");
  });

  it("stats best-efforts --help documents path, GET-only, env, and globals", () => {
    const out = helpFor(["stats", "best-efforts", "--help"]);
    expect(out).toContain("TEMPO_API_KEY");
    expect(out).toContain("TEMPO_BASE_URL");
    expect(out).toContain("Examples:");
    expect(out).toContain("tempo --help");
    expect(out).toContain("stats best-efforts");
    expect(out).toContain("GET /stats/best-efforts");
    expect(out).toContain("recalculate");
  });

  it("stats available-periods --help documents path, env, and globals", () => {
    const out = helpFor(["stats", "available-periods", "--help"]);
    expect(out).toContain("TEMPO_API_KEY");
    expect(out).toContain("TEMPO_BASE_URL");
    expect(out).toContain("Examples:");
    expect(out).toContain("tempo --help");
    expect(out).toContain("stats available-periods");
    expect(out).toContain("GET /stats/available-periods");
    expect(out).toContain("--timezone-offset-minutes");
  });

  it("stats available-years --help documents path, env, and globals", () => {
    const out = helpFor(["stats", "available-years", "--help"]);
    expect(out).toContain("TEMPO_API_KEY");
    expect(out).toContain("TEMPO_BASE_URL");
    expect(out).toContain("Examples:");
    expect(out).toContain("tempo --help");
    expect(out).toContain("stats available-years");
    expect(out).toContain("GET /stats/available-years");
  });

  it("stats insights --help documents path, env, and globals", () => {
    const out = helpFor(["stats", "insights", "--help"]);
    expect(out).toContain("TEMPO_API_KEY");
    expect(out).toContain("TEMPO_BASE_URL");
    expect(out).toContain("Examples:");
    expect(out).toContain("tempo --help");
    expect(out).toContain("stats insights");
    expect(out).toContain("GET /stats/insights");
  });

  it("settings --help lists subcommands and GET-only contract", () => {
    const out = helpFor(["settings", "--help"]);
    expect(out).toContain("tempo --help");
    expect(out).toContain("tempo settings <command> --help");
    expect(out).toContain("read-only (GET)");
    expect(out).toContain("Subcommands:");
    expect(out).toContain("heart-rate-zones");
    expect(out).toContain("unit-preference");
    expect(out).toContain("default-shoe");
    expect(out).toContain("never calls PUT/POST");
  });

  it("settings heart-rate-zones --help documents path, GET-only, env, and globals", () => {
    const out = helpFor(["settings", "heart-rate-zones", "--help"]);
    expect(out).toContain("TEMPO_API_KEY");
    expect(out).toContain("TEMPO_BASE_URL");
    expect(out).toContain("Examples:");
    expect(out).toContain("tempo --help");
    expect(out).toContain("settings heart-rate-zones");
    expect(out).toContain("GET /settings/heart-rate-zones");
    expect(out).toContain("no PUT");
    expect(out).toContain("update-with-recalc");
  });

  it("settings unit-preference --help documents path, GET-only, env, and globals", () => {
    const out = helpFor(["settings", "unit-preference", "--help"]);
    expect(out).toContain("TEMPO_API_KEY");
    expect(out).toContain("TEMPO_BASE_URL");
    expect(out).toContain("Examples:");
    expect(out).toContain("tempo --help");
    expect(out).toContain("settings unit-preference");
    expect(out).toContain("GET /settings/unit-preference");
    expect(out).toContain("no PUT");
  });

  it("settings default-shoe --help documents path, GET-only, env, and globals", () => {
    const out = helpFor(["settings", "default-shoe", "--help"]);
    expect(out).toContain("TEMPO_API_KEY");
    expect(out).toContain("TEMPO_BASE_URL");
    expect(out).toContain("Examples:");
    expect(out).toContain("tempo --help");
    expect(out).toContain("settings default-shoe");
    expect(out).toContain("GET /settings/default-shoe");
    expect(out).toContain("no PUT");
  });

  it("shoes --help lists subcommands, GET-only contract, and no shoes get", () => {
    const out = helpFor(["shoes", "--help"]);
    expect(out).toContain("tempo --help");
    expect(out).toContain("tempo shoes <command> --help");
    expect(out).toContain("read-only (GET)");
    expect(out).toContain("Subcommands:");
    expect(out).toContain("list");
    expect(out).toContain("mileage");
    expect(out).toContain("POST /shoes");
    expect(out).toContain("PATCH /shoes");
    expect(out).toContain("DELETE /shoes");
    expect(out).toContain("tempo shoes get");
  });

  it("shoes list --help documents path, GET-only, env, and globals", () => {
    const out = helpFor(["shoes", "list", "--help"]);
    expect(out).toContain("TEMPO_API_KEY");
    expect(out).toContain("TEMPO_BASE_URL");
    expect(out).toContain("Examples:");
    expect(out).toContain("tempo --help");
    expect(out).toContain("shoes list");
    expect(out).toContain("GET /shoes");
    expect(out).toContain("no POST");
  });

  it("shoes mileage --help documents path, UUID arg, env, and globals", () => {
    const out = helpFor(["shoes", "mileage", "--help"]);
    expect(out).toContain("TEMPO_API_KEY");
    expect(out).toContain("TEMPO_BASE_URL");
    expect(out).toContain("Examples:");
    expect(out).toContain("tempo --help");
    expect(out).toContain("shoes mileage");
    expect(out).toContain("GET /shoes/{id}/mileage");
    expect(out).toContain("UUID");
  });

  it("weekly-recap --help documents week, timezone, write, auth, settings, and global output vs report path", () => {
    const out = helpFor(["weekly-recap", "--help"]);
    expect(out).toContain("--week");
    expect(out).toContain("--timezone");
    expect(out).toContain("--write");
    expect(out).toContain("--format");
    expect(out).toContain("markdown");
    expect(out).toContain("compact");
    expect(out).toContain("tempo --help");
    expect(out).toContain("weekly-recap");
    expect(out).toContain("Global --output");
    expect(out).toContain("human");
    expect(out).toContain("json");
    expect(out).toContain("TEMPO_API_KEY");
    expect(out).toContain("GET /auth/me");
    expect(out).toContain("heart-rate-zones");
    expect(out).toContain("unit-preference");
    expect(out).toContain("GET /workouts");
    expect(out).toContain("/workouts/{id}/time-series");
    expect(out).toContain("GET /shoes");
    expect(out).toContain("/stats/weekly-recap");
    expect(out).toContain("/stats/relative-effort");
    expect(out).toContain("similar-routes");
    expect(out).toContain("maxResults=3");
    expect(out).toContain("--include-trends");
    expect(out).toContain("--no-include-trends");
    expect(out).toContain("/stats/best-efforts");
    expect(out).toContain("--prescribed-file");
    expect(out).toContain("--subjective-file");
    expect(out).toContain("--no-subjective");
    expect(out).toContain("--refresh-subjective");
    expect(out).toContain("--verbose");
    expect(out).toContain("--cache-dir");
  });
});
