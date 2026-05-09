import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { parse, stringify } from "smol-toml";

/**
 * Merge api_key into config.toml, preserving other top-level keys.
 * On POSIX, creates parent dir with 0700 (when supported) and sets file mode 0600.
 */
export function persistApiKey(configPath: string, apiKey: string): void {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    throw new Error("API key must be non-empty.");
  }

  const dir = dirname(configPath);
  const mkdirOpts: { recursive: true; mode?: number } = { recursive: true };
  if (process.platform !== "win32") {
    mkdirOpts.mode = 0o700;
  }
  mkdirSync(dir, mkdirOpts);

  let table: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    let raw: unknown;
    try {
      raw = parse(readFileSync(configPath, "utf8"));
    } catch {
      throw new Error(`Invalid TOML in config file ${configPath}.`);
    }
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(
        `Config file ${configPath} must be a TOML table at the top level.`,
      );
    }
    table = raw as Record<string, unknown>;
  }

  table["api_key"] = trimmed;

  let content: string;
  try {
    content = stringify(table);
  } catch {
    throw new Error(`Failed to serialize config for ${configPath}.`);
  }

  writeFileSync(configPath, content, {
    encoding: "utf8",
    mode: process.platform === "win32" ? undefined : 0o600,
  });

  if (process.platform !== "win32") {
    chmodSync(configPath, 0o600);
  }
}
