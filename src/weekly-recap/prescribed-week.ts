/**
 * Parses coach prescribed-week YAML (weekly recap spec §3.7).
 */

import { parse as parseYaml } from "yaml";

import { isPlainObject, pickFirst } from "../output/human-summary.js";

export type TargetMinMax = { min: number; max: number };

export type PrescribedWorkoutSession = {
  kind: "workout";
  date: string;
  description?: string;
  /** Pace bounds as seconds per mile (parsed from M:SS strings). */
  paceSecPerMi: TargetMinMax;
  /** Raw strings for display */
  paceMinStr: string;
  paceMaxStr: string;
  hrBpm: TargetMinMax;
  reps: number;
  repDistanceMi: number;
};

export type PrescribedLongRunSession = {
  kind: "long_run";
  date: string;
  description?: string;
  targetDistanceMi: number;
  targetHrBpmMax: number;
};

export type PrescribedSession = PrescribedWorkoutSession | PrescribedLongRunSession;

export type PrescribedWeek = {
  week: string;
  sessions: PrescribedSession[];
};

export type ParsePrescribedWeekOk = { ok: true; value: PrescribedWeek };
export type ParsePrescribedWeekErr = { ok: false; message: string };
export type ParsePrescribedWeekResult =
  | ParsePrescribedWeekOk
  | ParsePrescribedWeekErr;

/** Normalize ISO week id for comparison (e.g. 2026-W9 → 2026-W09). */
export function normalizeIsoWeekId(raw: string): string {
  const m = /^(\d{4})-W(\d{1,2})$/i.exec(raw.trim());
  if (!m) return raw.trim();
  const w = String(Number.parseInt(m[2], 10)).padStart(2, "0");
  return `${m[1]}-W${w}`;
}

/** Parse `"M:SS"` or `"H:MM:SS"` clock string to seconds (running pace per mile). */
export function parseClockToSeconds(raw: string): number | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const parts = t.split(":").map((p) => Number.parseInt(p.trim(), 10));
  if (parts.some((x) => !Number.isFinite(x))) return undefined;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  return undefined;
}

function parseTargetPaceMi(raw: unknown): { min: number; max: number } | undefined {
  if (!isPlainObject(raw)) return undefined;
  const minStr = pickFirst(raw, ["min", "Min"]);
  const maxStr = pickFirst(raw, ["max", "Max"]);
  if (typeof minStr !== "string" || typeof maxStr !== "string") return undefined;
  const min = parseClockToSeconds(minStr);
  const max = parseClockToSeconds(maxStr);
  if (min === undefined || max === undefined) return undefined;
  if (min > max) return undefined;
  return { min, max };
}

function parseTargetHr(raw: unknown): { min: number; max: number } | undefined {
  if (!isPlainObject(raw)) return undefined;
  const minRaw = pickFirst(raw, ["min", "Min"]);
  const maxRaw = pickFirst(raw, ["max", "Max"]);
  if (typeof minRaw !== "number" || typeof maxRaw !== "number") return undefined;
  if (!Number.isFinite(minRaw) || !Number.isFinite(maxRaw)) return undefined;
  const min = Math.round(minRaw);
  const max = Math.round(maxRaw);
  if (min > max) return undefined;
  return { min, max };
}

export function parsePrescribedWeekYaml(raw: string): ParsePrescribedWeekResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, message: "prescribed file is empty" };
  }
  let doc: unknown;
  try {
    doc = parseYaml(trimmed);
  } catch (e) {
    return {
      ok: false,
      message: `invalid YAML: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (!isPlainObject(doc)) {
    return { ok: false, message: "prescribed root must be a YAML mapping" };
  }

  const weekRaw = pickFirst(doc, ["week", "Week"]);
  if (typeof weekRaw !== "string" || !weekRaw.trim()) {
    return { ok: false, message: "prescribed.week is required" };
  }

  const sessionsRaw = pickFirst(doc, ["sessions", "Sessions"]);
  if (!Array.isArray(sessionsRaw)) {
    return { ok: false, message: "prescribed.sessions must be an array" };
  }

  const sessions: PrescribedSession[] = [];
  for (let i = 0; i < sessionsRaw.length; i++) {
    const row = sessionsRaw[i];
    if (!isPlainObject(row)) {
      return { ok: false, message: `sessions[${i}] must be a mapping` };
    }
    const dateRaw = pickFirst(row, ["date", "Date"]);
    if (typeof dateRaw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateRaw.trim())) {
      return {
        ok: false,
        message: `sessions[${i}].date must be YYYY-MM-DD`,
      };
    }
    const date = dateRaw.trim();
    const typeRaw = pickFirst(row, ["type", "Type"]);
    if (typeof typeRaw !== "string" || !typeRaw.trim()) {
      return { ok: false, message: `sessions[${i}].type is required` };
    }
    const type = typeRaw.trim().toLowerCase();
    const descRaw = pickFirst(row, ["description", "Description"]);
    const description =
      typeof descRaw === "string" && descRaw.trim() ? descRaw.trim() : undefined;

    if (type === "long_run") {
      const dist = pickFirst(row, ["target_distance_mi", "targetDistanceMi"]);
      const hrMax = pickFirst(row, ["target_hr_bpm_max", "targetHrBpmMax"]);
      if (typeof dist !== "number" || !Number.isFinite(dist)) {
        return {
          ok: false,
          message: `sessions[${i}].target_distance_mi must be a number`,
        };
      }
      if (typeof hrMax !== "number" || !Number.isFinite(hrMax)) {
        return {
          ok: false,
          message: `sessions[${i}].target_hr_bpm_max must be a number`,
        };
      }
      sessions.push({
        kind: "long_run",
        date,
        description,
        targetDistanceMi: dist,
        targetHrBpmMax: Math.round(hrMax),
      });
      continue;
    }

    if (type === "workout") {
      const paceRaw = pickFirst(row, ["target_pace_per_mi", "targetPacePerMi"]);
      const hrRaw = pickFirst(row, ["target_hr_bpm", "targetHrBpm"]);
      const paceBounds = parseTargetPaceMi(paceRaw);
      const hrBounds = parseTargetHr(hrRaw);
      const repsRaw = pickFirst(row, ["reps", "Reps"]);
      const repDist = pickFirst(row, ["rep_distance_mi", "repDistanceMi"]);
      if (!paceBounds) {
        return {
          ok: false,
          message: `sessions[${i}].target_pace_per_mi.min/max (M:SS) is invalid`,
        };
      }
      if (!hrBounds) {
        return {
          ok: false,
          message: `sessions[${i}].target_hr_bpm.min/max must be numbers`,
        };
      }
      if (typeof repsRaw !== "number" || !Number.isFinite(repsRaw) || repsRaw < 1) {
        return { ok: false, message: `sessions[${i}].reps must be a positive number` };
      }
      if (typeof repDist !== "number" || !Number.isFinite(repDist) || repDist <= 0) {
        return {
          ok: false,
          message: `sessions[${i}].rep_distance_mi must be a positive number`,
        };
      }
      const minStr = isPlainObject(paceRaw)
        ? String(pickFirst(paceRaw, ["min", "Min"]) ?? "")
        : "";
      const maxStr = isPlainObject(paceRaw)
        ? String(pickFirst(paceRaw, ["max", "Max"]) ?? "")
        : "";
      sessions.push({
        kind: "workout",
        date,
        description,
        paceSecPerMi: paceBounds,
        paceMinStr: minStr.trim(),
        paceMaxStr: maxStr.trim(),
        hrBpm: hrBounds,
        reps: Math.round(repsRaw),
        repDistanceMi: repDist,
      });
      continue;
    }

    return { ok: false, message: `sessions[${i}].type must be workout or long_run` };
  }

  return {
    ok: true,
    value: {
      week: weekRaw.trim(),
      sessions,
    },
  };
}
