import { existsSync, readFileSync } from "node:fs";
import { parse } from "smol-toml";

export type OutputMode = "human" | "json";

/** Values read from config.toml (optional keys). */
export type FileLayer = {
  baseUrl?: string;
  output?: OutputMode;
  apiKey?: string;
};

const BUILTIN_BASE_URL = "http://localhost:5001";
const BUILTIN_OUTPUT: OutputMode = "human";

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function parseOutputMode(value: unknown, configPath: string): OutputMode {
  if (typeof value !== "string") {
    throw new Error(
      `Invalid "output" in ${configPath}: expected "human" or "json".`,
    );
  }
  if (value === "human" || value === "json") return value;
  throw new Error(
    `Invalid "output" in ${configPath}: "${value}" (use "human" or "json").`,
  );
}

/**
 * Load optional config.toml. Missing file yields {}.
 * Invalid TOML or invalid field types throw Error (message for stderr).
 */
export function loadConfigFile(configPath: string): FileLayer {
  if (!existsSync(configPath)) return {};

  let raw: unknown;
  try {
    raw = parse(readFileSync(configPath, "utf8"));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid TOML in config file ${configPath}: ${msg}`);
  }

  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      `Config file ${configPath} must be a TOML table at the top level.`,
    );
  }

  const table = raw as Record<string, unknown>;
  const layer: FileLayer = {};

  if ("base_url" in table && table.base_url != null) {
    if (typeof table.base_url !== "string") {
      throw new Error(
        `Invalid "base_url" in ${configPath}: expected a string.`,
      );
    }
    layer.baseUrl = normalizeBaseUrl(table.base_url);
  }

  if ("output" in table && table.output != null) {
    layer.output = parseOutputMode(table.output, configPath);
  }

  if ("api_key" in table && table.api_key != null) {
    if (typeof table.api_key !== "string") {
      throw new Error(`Invalid "api_key" in ${configPath}: expected a string.`);
    }
    const k = table.api_key.trim();
    if (k) layer.apiKey = k;
  }

  return layer;
}

/**
 * Built-in defaults, then config file, then environment (TEMPO_BASE_URL only for URL).
 * Used as Commander defaults for flags (before explicit CLI overrides).
 */
export function computePreFlagDefaults(file: FileLayer): {
  baseUrl: string;
  output: OutputMode;
} {
  let baseUrl = BUILTIN_BASE_URL;
  let output: OutputMode = BUILTIN_OUTPUT;

  if (file.baseUrl != null) baseUrl = file.baseUrl;

  if (file.output != null) output = file.output;

  const envUrl = process.env.TEMPO_BASE_URL?.trim();
  if (envUrl) baseUrl = normalizeBaseUrl(envUrl);

  return { baseUrl, output };
}
