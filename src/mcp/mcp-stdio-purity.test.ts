import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliJs = join(root, "dist", "cli.js");

beforeAll(() => {
  if (!existsSync(cliJs)) {
    execSync("npm run build", { cwd: root, stdio: "inherit" });
  }
});

function isJsonRpcLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return false;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return false;
  }
  const o = parsed as Record<string, unknown>;
  return o.jsonrpc === "2.0";
}

describe("tempo mcp stdout purity (subprocess)", () => {
  it("stdout lines are JSON-RPC only during initialize + tools/list", async () => {
    const child = spawn(
      process.execPath,
      [cliJs, "--base-url", "http://127.0.0.1:9", "mcp"],
      {
        cwd: root,
        env: {
          ...process.env,
          TEMPO_API_KEY: "",
          // Avoid picking up a real user config that might surprise the run.
          XDG_CONFIG_HOME: join(root, ".scratch", "empty-xdg-config-mcp-test"),
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const initReq = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "purity-test", version: "0.0.0" },
      },
    };
    const initializedNote = {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    };
    const listReq = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    };

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`timeout; stdout=${stdout} stderr=${stderr}`));
      }, 10_000);

      let sawListResult = false;
      child.stdout?.on("data", () => {
        if (stdout.includes('"id":2') || stdout.includes('"id": 2')) {
          sawListResult = true;
          clearTimeout(timer);
          child.kill("SIGTERM");
          resolve();
        }
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.stdin?.write(`${JSON.stringify(initReq)}\n`);
      // Wait briefly for initialize response before continuing — write all after a tick
      setTimeout(() => {
        child.stdin?.write(`${JSON.stringify(initializedNote)}\n`);
        child.stdin?.write(`${JSON.stringify(listReq)}\n`);
      }, 50);

      // Fallback: if we never see id 2, still resolve when process exits after kill path
      child.on("close", () => {
        if (!sawListResult) {
          // allow assertion below to fail on incomplete exchange
          clearTimeout(timer);
          resolve();
        }
      });
    });

    const lines = stdout.split(/\r?\n/);
    for (const line of lines) {
      expect(isJsonRpcLine(line), `non-JSON-RPC stdout line: ${JSON.stringify(line)}`).toBe(
        true,
      );
    }
    expect(stdout).toMatch(/check_connection/);
    // Diagnostics may appear on stderr; must not appear as non-RPC on stdout
    expect(stdout).not.toMatch(/OK \(HTTP/);
    expect(stderr).not.toContain("tmp_");
  }, 15_000);
});
