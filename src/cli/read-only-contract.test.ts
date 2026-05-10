import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readSrc(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const READ_ONLY_GROUP_FILES: readonly string[] = [
  "src/commands/stats-weekly.ts",
  "src/commands/stats-yearly.ts",
  "src/commands/stats-yearly-weekly.ts",
  "src/commands/stats-relative-effort.ts",
  "src/commands/stats-weekly-recap.ts",
  "src/commands/stats-best-efforts.ts",
  "src/commands/stats-available-periods.ts",
  "src/commands/stats-available-years.ts",
  "src/commands/stats-insights.ts",
  "src/commands/settings-heart-rate-zones.ts",
  "src/commands/settings-unit-preference.ts",
  "src/commands/settings-default-shoe.ts",
  "src/commands/shoes-list.ts",
  "src/commands/shoe-mileage.ts",
];

function listProductionTsFiles(absStart: string, out: string[] = []): string[] {
  for (const entry of readdirSync(absStart, { withFileTypes: true })) {
    const abs = join(absStart, entry.name);
    if (entry.isDirectory()) {
      listProductionTsFiles(abs, out);
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      out.push(abs);
    }
  }
  return out;
}

function lineNumberOfMatch(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) {
    if (src.charCodeAt(i) === 10 /* \n */) line += 1;
  }
  return line;
}

describe("read-only HTTP contract (Epic 04 P7)", () => {
  it("no stats/settings/shoes module sets `method: \"POST|PUT|PATCH|DELETE\"`", () => {
    const re = /method\s*:\s*["'`](POST|PUT|PATCH|DELETE)["'`]/i;
    const offenders: string[] = [];
    for (const rel of READ_ONLY_GROUP_FILES) {
      const src = readSrc(rel);
      const m = re.exec(src);
      if (m && m.index !== undefined) {
        const line = lineNumberOfMatch(src, m.index);
        offenders.push(`${rel}:${line}: ${m[0]}`);
      }
    }
    expect(
      offenders,
      `Stats/settings/shoes modules must not declare a non-GET HTTP method literal.\nOffenders:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("only `.get(` is invoked on the HTTP client in stats/settings/shoes modules", () => {
    const verbRe = /\.(get|post|put|patch|delete)\s*\(/g;
    const offenders: string[] = [];
    for (const rel of READ_ONLY_GROUP_FILES) {
      const src = readSrc(rel);
      let m: RegExpExecArray | null;
      while ((m = verbRe.exec(src)) !== null) {
        const verb = m[1];
        if (verb !== "get") {
          const line = lineNumberOfMatch(src, m.index);
          offenders.push(`${rel}:${line}: ${m[0]}`);
        }
      }
    }
    expect(
      offenders,
      `Stats/settings/shoes modules must only invoke .get(...) on HTTP-shaped objects.\nOffenders:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("no stats/settings/shoes module references mutate-only Tempo paths in string literals", () => {
    const mutatePathRe = /(["'])[^"'\n]*\/(recalculate|update-with-recalc)\1/;
    const offenders: string[] = [];
    for (const rel of READ_ONLY_GROUP_FILES) {
      const src = readSrc(rel);
      const m = mutatePathRe.exec(src);
      if (m && m.index !== undefined) {
        const line = lineNumberOfMatch(src, m.index);
        offenders.push(`${rel}:${line}: ${m[0]}`);
      }
    }
    expect(
      offenders,
      `Stats/settings/shoes modules must not embed mutate-only Tempo paths (/recalculate, /update-with-recalc) as string literals.\nOffenders:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("only src/http/client.ts calls `fetch(` in production sources", () => {
    const fetchRe = /\bfetch\s*\(/;
    const allowedAbs = join(root, "src/http/client.ts");
    const allTs = listProductionTsFiles(join(root, "src"));
    const offenders: string[] = [];
    for (const abs of allTs) {
      if (abs === allowedAbs) continue;
      const src = readFileSync(abs, "utf8");
      const m = fetchRe.exec(src);
      if (m && m.index !== undefined) {
        const line = lineNumberOfMatch(src, m.index);
        offenders.push(`${relative(root, abs)}:${line}: ${m[0]}`);
      }
    }
    expect(
      offenders,
      `Only src/http/client.ts is allowed to call fetch(...) in production sources.\nOffenders:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("HttpClient surface in src/http/client.ts exposes only `get`", () => {
    const src = readSrc("src/http/client.ts");
    expect(
      /\bget\s*\(/.test(src),
      "src/http/client.ts must still expose a get(...) method (positive sanity check).",
    ).toBe(true);

    const verbRe = /\b(post|put|patch|delete)\s*\(/gi;
    const offenders: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = verbRe.exec(src)) !== null) {
      const line = lineNumberOfMatch(src, m.index);
      offenders.push(`src/http/client.ts:${line}: ${m[0]}`);
    }
    expect(
      offenders,
      `src/http/client.ts must not expose any mutating HTTP verb method (post/put/patch/delete).\nOffenders:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
