import type { FileLayer, OutputMode } from "./file.js";

export type EffectiveGlobalConfig = {
  baseUrl: string;
  output: OutputMode;
  apiKey?: string;
};

let effective: EffectiveGlobalConfig | undefined;

export function setEffectiveGlobalConfig(config: EffectiveGlobalConfig): void {
  effective = config;
}

export function getEffectiveGlobalConfig(): EffectiveGlobalConfig | undefined {
  return effective;
}

/** CLI flag wins, then environment, then config file (P3 precedence). */
export function pickApiKey(
  flagValue: string | undefined,
  file: FileLayer,
): string | undefined {
  const fromFlag = flagValue?.trim();
  if (fromFlag) return fromFlag;
  const fromEnv = process.env.TEMPO_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  return file.apiKey;
}
