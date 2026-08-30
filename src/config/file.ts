import { existsSync, readFileSync } from "node:fs";
import { parse } from "smol-toml";
import { readOptionalEnv } from "./env.js";

export type OutputMode = "human" | "json";

/** Optional `[report]` table for `tempo weekly-recap` (spec §3.11-style sidecars and cache). */
export type ReportLayer = {
  includeTrends?: boolean;
  prescribedDir?: string;
  subjectiveDir?: string;
  cacheDir?: string;
};

/** Values read from config.toml (optional keys). */
export type FileLayer = {
  baseUrl?: string;
  output?: OutputMode;
  apiKey?: string;
  /** Default IANA zone when `weekly-recap --timezone` is omitted. */
  timezone?: string;
  report?: ReportLayer;
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
  } catch {
    throw new Error(`Invalid TOML in config file ${configPath}.`);
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

  if ("timezone" in table && table.timezone != null) {
    if (typeof table.timezone !== "string") {
      throw new Error(`Invalid "timezone" in ${configPath}: expected a string.`);
    }
    const tz = table.timezone.trim();
    if (tz) layer.timezone = tz;
  }

  if ("report" in table && table.report != null) {
    if (typeof table.report !== "object" || Array.isArray(table.report)) {
      throw new Error(
        `Invalid "report" in ${configPath}: expected a table (use [report]).`,
      );
    }
    const rep = table.report as Record<string, unknown>;
    const report: ReportLayer = {};

    if ("include_trends" in rep && rep.include_trends != null) {
      if (typeof rep.include_trends !== "boolean") {
        throw new Error(
          `Invalid "report.include_trends" in ${configPath}: expected a boolean.`,
        );
      }
      report.includeTrends = rep.include_trends;
    }

    if ("prescribed_dir" in rep && rep.prescribed_dir != null) {
      if (typeof rep.prescribed_dir !== "string") {
        throw new Error(
          `Invalid "report.prescribed_dir" in ${configPath}: expected a string.`,
        );
      }
      const d = rep.prescribed_dir.trim();
      if (d) report.prescribedDir = d;
    }

    if ("subjective_dir" in rep && rep.subjective_dir != null) {
      if (typeof rep.subjective_dir !== "string") {
        throw new Error(
          `Invalid "report.subjective_dir" in ${configPath}: expected a string.`,
        );
      }
      const d = rep.subjective_dir.trim();
      if (d) report.subjectiveDir = d;
    }

    if ("cache_dir" in rep && rep.cache_dir != null) {
      if (typeof rep.cache_dir !== "string") {
        throw new Error(
          `Invalid "report.cache_dir" in ${configPath}: expected a string.`,
        );
      }
      const d = rep.cache_dir.trim();
      if (d) report.cacheDir = d;
    }

    layer.report = report;
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

  const envUrl = readOptionalEnv("TEMPO_BASE_URL");
  if (envUrl) baseUrl = normalizeBaseUrl(envUrl);

  return { baseUrl, output };
}
