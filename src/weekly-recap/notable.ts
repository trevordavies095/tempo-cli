/**
 * §2.8 Notable: best-effort PRs vs cached snapshot, shoe mileage warn, RE overload heuristic.
 */

import { isPlainObject, pickFirst } from "../output/human-summary.js";
import type { RecapSummaryFromStats } from "./recap-summary-stats.js";

const METERS_PER_MILE = 1609.344;
/** Weekly recap spec §2.8 — shoe approaching mileage limit */
export const NOTABLE_SHOE_MILEAGE_WARN_MI = 400;
/** Weekly recap spec §2.8 — relative effort vs 3-wk avg */
export const NOTABLE_RE_OVERLOAD_FACTOR = 1.3;

export type BestEffortPr = {
  key: string;
  label: string;
  previousSeconds: number;
  currentSeconds: number;
};

export type RecapNotableSnapshot = {
  /** Plain bullets without leading `- ` (Markdown builder adds list markers). */
  bullets: string[];
  bestEfforts: {
    fetchOk: boolean;
    hadPriorCache: boolean;
    prs: BestEffortPr[];
  };
  shoesOverThreshold: { shoeId: string; label: string; mileageMi: number }[];
  overload: {
    flagged: boolean;
    weekRelativeEffort?: number;
    threeWeekAverage?: number;
  };
};

function normalizeEffortKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

function pickEffortValue(row: Record<string, unknown>): unknown {
  return pickFirst(row, [
    "time",
    "Time",
    "duration",
    "Duration",
    "bestTime",
    "BestTime",
    "value",
    "Value",
  ]);
}

function pickDistanceLabel(row: Record<string, unknown>): string | undefined {
  const raw = pickFirst(row, [
    "distance",
    "Distance",
    "distanceLabel",
    "DistanceLabel",
    "name",
    "Name",
  ]);
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return undefined;
}

/** Parse race/time value to seconds (best-effort JSON shapes vary). */
export function parseEffortSeconds(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    if (raw > 1_000_000) return raw / 1000;
    return raw;
  }
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  if (!t) return undefined;
  const parts = t.split(":").map((p) => Number.parseFloat(p.trim()));
  if (parts.some((p) => !Number.isFinite(p))) return undefined;
  if (parts.length === 3) {
    return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  }
  if (parts.length === 2) {
    return parts[0]! * 60 + parts[1]!;
  }
  const n = Number.parseFloat(t);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export type ParsedEffortRow = { seconds: number; label: string };

/**
 * Parse GET /stats/best-efforts JSON into comparable rows keyed by normalized distance label.
 */
export function parseBestEffortsBody(body: string): Map<string, ParsedEffortRow> {
  const map = new Map<string, ParsedEffortRow>();
  const trimmed = body.trim();
  if (!trimmed) return map;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return map;
  }

  function addRow(labelRaw: string, seconds: number | undefined): void {
    if (seconds === undefined || !Number.isFinite(seconds)) return;
    const label = labelRaw.trim() || "effort";
    const key = normalizeEffortKey(label);
    if (!key) return;
    map.set(key, { seconds, label });
  }

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (!isPlainObject(item)) continue;
      const keyAlt = pickFirst(item, ["key", "Key"]);
      const label =
        pickDistanceLabel(item) ??
        (typeof keyAlt === "string" && keyAlt.trim() ? keyAlt.trim() : undefined) ??
        "effort";
      const sec = parseEffortSeconds(pickEffortValue(item));
      addRow(label, sec);
    }
    return map;
  }

  if (isPlainObject(parsed)) {
    for (const [outerKey, v] of Object.entries(parsed)) {
      if (isPlainObject(v)) {
        const label = pickDistanceLabel(v) ?? outerKey;
        const sec = parseEffortSeconds(pickEffortValue(v));
        addRow(label, sec);
      }
    }
  }

  return map;
}

export function diffBestEfforts(
  currentBody: string,
  priorBody: string | undefined,
): BestEffortPr[] {
  const cur = parseBestEffortsBody(currentBody);
  const prev = priorBody?.trim()
    ? parseBestEffortsBody(priorBody)
    : new Map<string, ParsedEffortRow>();
  const prs: BestEffortPr[] = [];
  for (const [key, c] of cur) {
    const p = prev.get(key);
    if (!p) continue;
    if (c.seconds < p.seconds) {
      prs.push({
        key,
        label: c.label,
        previousSeconds: p.seconds,
        currentSeconds: c.seconds,
      });
    }
  }
  return prs.sort((a, b) => a.label.localeCompare(b.label));
}

function formatSecondsAsClock(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rs = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(rs).padStart(2, "0")}`;
  return `${m}:${String(rs).padStart(2, "0")}`;
}

/** Shoes list: root array or `{ items | shoes }`. */
function parseShoesArray(body: string): Record<string, unknown>[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return [];
  }
  if (Array.isArray(parsed)) {
    return parsed.filter(isPlainObject) as Record<string, unknown>[];
  }
  if (!isPlainObject(parsed)) return [];
  const inner = pickFirst(parsed, ["items", "Items", "shoes", "Shoes", "data", "Data"]);
  if (!Array.isArray(inner)) return [];
  return inner.filter(isPlainObject) as Record<string, unknown>[];
}

function shoeIdKey(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  return s.length > 0 ? s : undefined;
}

function pickShoeMileageMi(item: Record<string, unknown>): number | undefined {
  const mileLike = pickFirst(item, [
    "totalMileageMi",
    "totalMileageMiles",
    "mileageMi",
    "mileageMiles",
  ]);
  if (typeof mileLike === "number" && Number.isFinite(mileLike) && mileLike >= 0) {
    return mileLike;
  }
  const raw = pickFirst(item, [
    "mileage",
    "Mileage",
    "totalMileage",
    "TotalMileage",
    "distance",
    "Distance",
  ]);
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return undefined;
  if (raw > 500) return raw / METERS_PER_MILE;
  return raw;
}

function buildShoeLookup(
  shoesBody: string,
): Map<string, { label: string; mileageMi?: number }> {
  const map = new Map<string, { label: string; mileageMi?: number }>();
  for (const item of parseShoesArray(shoesBody)) {
    const idRaw = pickFirst(item, ["id", "Id", "shoeId", "ShoeId"]);
    const id = shoeIdKey(idRaw);
    if (!id) continue;
    const brand = pickFirst(item, ["brand", "Brand"]);
    const model = pickFirst(item, ["model", "Model"]);
    const name = pickFirst(item, ["name", "Name", "nickname", "Nickname"]);
    const bits: string[] = [];
    if (typeof brand === "string" && brand.trim()) bits.push(brand.trim());
    if (typeof model === "string" && model.trim()) bits.push(model.trim());
    const label =
      bits.length > 0
        ? bits.join(" ")
        : typeof name === "string" && name.trim()
          ? name.trim()
          : id.slice(0, 8);
    const mileageMi = pickShoeMileageMi(item);
    map.set(id.toLowerCase(), { label, mileageMi });
  }
  return map;
}

function parseWorkoutJson(body: string): Record<string, unknown> | undefined {
  const t = body.trim();
  if (!t) return undefined;
  try {
    const v = JSON.parse(t) as unknown;
    return isPlainObject(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

export function collectShoesOverMileageThreshold(args: {
  shoesBody: string;
  workoutDetails: readonly { id: string; body: string }[];
  thresholdMi?: number;
}): { shoeId: string; label: string; mileageMi: number }[] {
  const threshold = args.thresholdMi ?? NOTABLE_SHOE_MILEAGE_WARN_MI;
  const lookup = buildShoeLookup(args.shoesBody);
  const seen = new Set<string>();
  const out: { shoeId: string; label: string; mileageMi: number }[] = [];

  for (const d of args.workoutDetails) {
    const w = parseWorkoutJson(d.body);
    if (!w) continue;
    const sidRaw = pickFirst(w, ["shoeId", "ShoeId", "shoe_id"]);
    const sid = typeof sidRaw === "string" ? sidRaw.trim() : "";
    if (!sid) continue;
    const key = sid.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const row = lookup.get(key);
    const mileageMi = row?.mileageMi;
    if (mileageMi === undefined || mileageMi <= threshold) continue;
    out.push({
      shoeId: sid,
      label: row?.label ?? sid.slice(0, 8),
      mileageMi,
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

export function evaluateRelativeEffortOverload(args: {
  workoutReSum: number;
  summaryFromStats: RecapSummaryFromStats | undefined;
}): { flagged: boolean; weekRelativeEffort?: number; threeWeekAverage?: number } {
  const summary = args.summaryFromStats;
  const avg = summary?.relativeEffort.threeWkAvg;
  if (
    avg === undefined ||
    !Number.isFinite(avg) ||
    avg <= 0 ||
    !Number.isFinite(args.workoutReSum)
  ) {
    return { flagged: false };
  }
  const flagged = args.workoutReSum >= NOTABLE_RE_OVERLOAD_FACTOR * avg;
  return {
    flagged,
    weekRelativeEffort: Math.round(args.workoutReSum),
    threeWeekAverage: avg,
  };
}

export function buildRecapNotableSnapshot(args: {
  bestEffortsFetchOk: boolean;
  currentBestEffortsBody?: string;
  priorBestEffortsBody?: string;
  hadPriorCache: boolean;
  shoesBody: string;
  workoutDetails: readonly { id: string; body: string }[];
  workoutReSum: number;
  summaryFromStats: RecapSummaryFromStats | undefined;
}): RecapNotableSnapshot {
  const prs =
    args.bestEffortsFetchOk && args.currentBestEffortsBody?.trim()
      ? diffBestEfforts(
          args.currentBestEffortsBody,
          args.priorBestEffortsBody,
        )
      : [];

  const shoesOverThreshold = collectShoesOverMileageThreshold({
    shoesBody: args.shoesBody,
    workoutDetails: args.workoutDetails,
  });

  const overload = evaluateRelativeEffortOverload({
    workoutReSum: args.workoutReSum,
    summaryFromStats: args.summaryFromStats,
  });

  const bullets: string[] = [];

  if (args.bestEffortsFetchOk && args.currentBestEffortsBody?.trim()) {
    if (!args.hadPriorCache) {
      bullets.push(
        "Best-effort PRs: no prior-week snapshot yet (next recap will compare against this run).",
      );
    } else if (prs.length === 0) {
      bullets.push("No PRs");
    } else {
      for (const p of prs) {
        bullets.push(
          `PR'd **${p.label}** (was ${formatSecondsAsClock(p.previousSeconds)} → ${formatSecondsAsClock(p.currentSeconds)})`,
        );
      }
    }
  }

  for (const s of shoesOverThreshold) {
    bullets.push(
      `Shoe **${s.label}** at ${Math.round(s.mileageMi)} mi (>${NOTABLE_SHOE_MILEAGE_WARN_MI} mi)`,
    );
  }

  if (overload.flagged) {
    bullets.push(
      `Relative effort (${overload.weekRelativeEffort}) ≥ ${NOTABLE_RE_OVERLOAD_FACTOR}× 3-wk avg (${Math.round(overload.threeWeekAverage!)}) — possible overload`,
    );
  }

  return {
    bullets,
    bestEfforts: {
      fetchOk: args.bestEffortsFetchOk,
      hadPriorCache: args.hadPriorCache,
      prs,
    },
    shoesOverThreshold,
    overload,
  };
}

export function buildNotableMarkdownSection(snapshot: RecapNotableSnapshot): string {
  if (snapshot.bullets.length === 0) return "";
  const lines = ["## Notable", ""];
  for (const b of snapshot.bullets) {
    lines.push(`- ${b}`);
  }
  lines.push("");
  return lines.join("\n").trimEnd() + "\n";
}

export function recapNotableSnapshotToJson(snapshot: RecapNotableSnapshot): Record<string, unknown> {
  return {
    bullets: snapshot.bullets,
    bestEfforts: snapshot.bestEfforts,
    shoesOverMileageThresholdMi: snapshot.shoesOverThreshold,
    overload: snapshot.overload,
  };
}
