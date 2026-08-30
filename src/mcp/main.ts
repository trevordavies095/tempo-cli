#!/usr/bin/env node
/**
 * Dedicated MCP entry for Claude Desktop (.mcpb / UtilityProcess).
 *
 * Desktop's built-in nodeHost `import()`s each `mcp_config.args` path as a
 * module — it does not run `tempo mcp` as a CLI. This file starts the stdio
 * server as a side effect of being loaded/executed, with no Commander argv.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { computePreFlagDefaults, loadConfigFile } from "../config/file.js";
import type { FileLayer } from "../config/file.js";
import { getDefaultConfigPath } from "../config/path.js";
import { pickApiKey, setEffectiveGlobalConfig } from "../config/runtime.js";
import { writeErrLine } from "../io/streams.js";
import { runStdioMcpServer } from "./run-stdio.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadPackageMeta(): { name: string; version: string } {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "package.json"), "utf8"),
    ) as { name?: string; version?: string };
    return {
      name: pkg.name ?? "tempo-cli",
      version: typeof pkg.version === "string" ? pkg.version : "0.0.0",
    };
  } catch {
    return { name: "tempo-cli", version: "0.0.0" };
  }
}

async function main(): Promise<void> {
  const pkg = loadPackageMeta();
  let fileLayer: FileLayer = {};
  try {
    fileLayer = loadConfigFile(getDefaultConfigPath());
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    writeErrLine(`tempo mcp: config error: ${message}`);
    process.exit(1);
  }

  const preFlag = computePreFlagDefaults(fileLayer);
  const apiKey = pickApiKey(undefined, fileLayer);
  setEffectiveGlobalConfig({
    baseUrl: preFlag.baseUrl,
    output: preFlag.output,
    apiKey,
  });

  await runStdioMcpServer({
    baseUrl: preFlag.baseUrl,
    apiKey,
    name: pkg.name,
    version: pkg.version,
    timezone: fileLayer.timezone,
    includeTrendsDefault: fileLayer.report?.includeTrends,
    prescribedDir: fileLayer.report?.prescribedDir,
    subjectiveDir: fileLayer.report?.subjectiveDir,
    cacheDir: fileLayer.report?.cacheDir,
  });
}

main().catch((err) => {
  writeErrLine(
    `tempo mcp: fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`,
  );
  process.exit(1);
});
