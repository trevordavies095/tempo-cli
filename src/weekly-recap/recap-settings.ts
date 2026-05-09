import { isPlainObject, pickFirst } from "../output/human-summary.js";

/** §3.10 intent: actionable copy aligned with shipped CLI (read-only `settings heart-rate-zones`). */
export const RECAP_HR_ZONES_REQUIRED_MESSAGE =
  "HR zones must be configured before recap. Use `tempo settings heart-rate-zones` to inspect current zones, or configure them in the Tempo web UI.";

export type RecapUnitPreference = "metric" | "imperial";

export type RecapHeartRateZone = {
  zone: number;
  minBpm: number;
  maxBpm: number;
};

export type ParseRecapUnitResult =
  | { ok: true; unit: RecapUnitPreference }
  | { ok: false };

export type ParseRecapHeartRateZonesResult =
  | { ok: true; zones: RecapHeartRateZone[] }
  | { ok: false };

function asFiniteInt(n: unknown): number | undefined {
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  return Math.round(n);
}

/** Normalize API JSON for preferred distance / pace units. */
export function parseRecapUnitPreference(body: string): ParseRecapUnitResult {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return { ok: false };
  }

  let raw: unknown;
  if (isPlainObject(parsed)) {
    raw = pickFirst(parsed, [
      "unit",
      "Unit",
      "unitPreference",
      "UnitPreference",
      "preference",
      "Preference",
    ]);
  } else {
    raw = parsed;
  }

  if (typeof raw !== "string") return { ok: false };
  const low = raw.trim().toLowerCase();
  if (low === "metric" || low === "imperial") {
    return { ok: true, unit: low };
  }
  return { ok: false };
}

function extractZonesArray(parsed: unknown): unknown[] | undefined {
  if (Array.isArray(parsed)) return parsed;
  if (!isPlainObject(parsed)) return undefined;
  const zones = pickFirst(parsed, ["zones", "Zones", "items", "Items"]);
  return Array.isArray(zones) ? zones : undefined;
}

function zoneNumberFromItem(item: Record<string, unknown>): number | undefined {
  const z = pickFirst(item, [
    "zone",
    "Zone",
    "number",
    "Number",
    "index",
    "Index",
    "id",
    "Id",
  ]);
  if (typeof z === "number" && Number.isFinite(z)) return z;
  if (typeof z === "string" && /^\d+$/.test(z.trim())) return Number.parseInt(z.trim(), 10);
  return undefined;
}

/** Five bounded zones with integer bpm limits; sorted by zone index when present, else by minBpm. */
export function parseAndValidateHeartRateZones(
  body: string,
): ParseRecapHeartRateZonesResult {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return { ok: false };
  }

  const arr = extractZonesArray(parsed);
  if (!arr || arr.length !== 5) return { ok: false };

  const out: RecapHeartRateZone[] = [];
  for (let i = 0; i < 5; i++) {
    const item = arr[i];
    if (!isPlainObject(item)) return { ok: false };
    const minRaw = pickFirst(item, ["minBpm", "MinBpm", "min", "Min"]);
    const maxRaw = pickFirst(item, ["maxBpm", "MaxBpm", "max", "Max"]);
    const minBpm = asFiniteInt(minRaw);
    const maxBpm = asFiniteInt(maxRaw);
    if (minBpm === undefined || maxBpm === undefined) return { ok: false };
    if (minBpm >= maxBpm) return { ok: false };
    const zoneNum = zoneNumberFromItem(item) ?? i + 1;
    out.push({ zone: zoneNum, minBpm, maxBpm });
  }

  out.sort((a, b) => {
    const za = a.zone;
    const zb = b.zone;
    if (za !== zb) return za - zb;
    return a.minBpm - b.minBpm;
  });

  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1]!;
    const cur = out[i]!;
    if (cur.minBpm < prev.maxBpm) return { ok: false };
  }

  return { ok: true, zones: out };
}

/** One-line human summary for weekly-recap output. */
export function formatRecapZonesSummary(zones: readonly RecapHeartRateZone[]): string {
  const sorted = [...zones].sort((a, b) => a.zone - b.zone);
  return sorted.map((z) => `Z${z.zone} ${z.minBpm}–${z.maxBpm}`).join(" · ");
}
