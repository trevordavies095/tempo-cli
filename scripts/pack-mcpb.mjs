#!/usr/bin/env node
/**
 * Build and pack the Tempo MCP Bundle (.mcpb) for Claude Desktop.
 *
 * Stages production dist + deps under .mcpb-staging/, injects package.json
 * version into the manifest, then runs `mcpb pack`.
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const staging = join(root, ".mcpb-staging");
const artifacts = join(root, "artifacts");
const manifestSrc = join(root, "mcpb", "manifest.json");
const outMcpb = join(artifacts, "tempo-cli.mcpb");

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = typeof pkg.version === "string" ? pkg.version : "0.0.0";

console.error(`pack-mcpb: building (version ${version})…`);
run("npm", ["run", "build"]);

if (existsSync(staging)) {
  rmSync(staging, { recursive: true, force: true });
}
mkdirSync(staging, { recursive: true });
mkdirSync(artifacts, { recursive: true });

const prodPkg = {
  name: pkg.name,
  version,
  description: pkg.description,
  type: pkg.type ?? "module",
  bin: pkg.bin,
  engines: pkg.engines,
  license: pkg.license,
  dependencies: pkg.dependencies ?? {},
};
writeFileSync(
  join(staging, "package.json"),
  `${JSON.stringify(prodPkg, null, 2)}\n`,
);
copyFileSync(join(root, "package-lock.json"), join(staging, "package-lock.json"));
cpSync(join(root, "dist"), join(staging, "dist"), { recursive: true });

const manifest = JSON.parse(readFileSync(manifestSrc, "utf8"));
manifest.version = version;
writeFileSync(
  join(staging, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.error("pack-mcpb: installing production dependencies in staging…");
run("npm", ["ci", "--omit=dev"], { cwd: staging });

if (existsSync(outMcpb)) {
  rmSync(outMcpb, { force: true });
}

console.error(`pack-mcpb: packing → ${outMcpb}`);
run("npx", ["mcpb", "pack", staging, outMcpb]);

console.error(`pack-mcpb: done (${outMcpb})`);
