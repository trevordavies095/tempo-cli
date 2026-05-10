/**
 * §2.4 “Similar route: …” line from GET /workouts/{id}/similar-routes (first/best row).
 */

import { DateTime } from "luxon";

import { isPlainObject, pickFirst } from "../output/human-summary.js";
import type { RecapUnitPreference } from "./recap-settings.js";

const METERS_PER_MILE = 1609.344;

/** Stored per workout after similar-routes retrieval; failures are non-fatal. */
export type RecapSimilarRoutesEntry =
  | { ok: true; body: string }
  | { ok: false; skipped?: boolean; httpStatus?: number };

export function parseSimilarRoutesBody(body: string): unknown[] {
  const t = body.trim();
  if (!t) return [];
  try {
    const parsed: unknown = JSON.parse(t);
    if (Array.isArray(parsed)) return parsed;
    if (isPlainObject(parsed)) {
      const inner = pickFirst(parsed, [
        "items",
        "Items",
        "similarRoutes",
        "SimilarRoutes",
        "routes",
        "Routes",
        "data",
        "Data",
      ]);
      if (Array.isArray(inner)) return inner;
    }
  } catch {
    return [];
  }
  return [];
}

/** Unwrap API row to workout-shaped object. */
export function pickSimilarWorkoutRow(entry: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(entry)) return undefined;
  const nested = pickFirst(entry, ["workout", "Workout", "pastWorkout", "PastWorkout"]);
  if (isPlainObject(nested)) return nested;
  return entry;
}

function formatPaceSecPerUnit(secPerKm: number, unit: RecapUnitPreference): number {
  return unit === "imperial"
    ? secPerKm * (METERS_PER_MILE / 1000)
    : secPerKm;
}

function formatPaceLabel(secPerKm: number, unit: RecapUnitPreference): string {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return "n/a";
  const secPerUnit = formatPaceSecPerUnit(secPerKm, unit);
  const m = Math.floor(secPerUnit / 60);
  const s = Math.round(secPerUnit % 60);
  const suf = unit === "imperial" ? "/mi" : "/km";
  return `${m}:${String(s).padStart(2, "0")}${suf}`;
}

function formatDistanceShort(meters: number, unit: RecapUnitPreference): string {
  if (!Number.isFinite(meters) || meters < 0) return "";
  if (unit === "imperial") {
    const mi = meters / METERS_PER_MILE;
    return `${mi.toFixed(1)} mi`;
  }
  const km = meters / 1000;
  return `${km.toFixed(2)} km`;
}

function weeksAgoLabel(currentStarted: string, similarStarted: string): string | undefined {
  const a = DateTime.fromISO(currentStarted.trim(), { setZone: true });
  const b = DateTime.fromISO(similarStarted.trim(), { setZone: true });
  if (!a.isValid || !b.isValid) return undefined;
  const diffWeeks = a.diff(b, "weeks").weeks;
  if (!Number.isFinite(diffWeeks) || diffWeeks < 0) return undefined;
  const w = Math.max(0, Math.round(diffWeeks));
  if (w === 0) return "this period";
  if (w === 1) return "1 week ago";
  return `${w} weeks ago`;
}

function pickOptionalDeltaSeconds(
  row: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  const v = pickFirst(row, keys);
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return v;
}

function pickOptionalDeltaBpm(
  row: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  const v = pickFirst(row, keys);
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return v;
}

/**
 * Narrative after `Similar route: ` — returns `n/a` when nothing to show.
 */
export function formatSimilarRouteMarkdownLine(args: {
  currentWorkout: Record<string, unknown>;
  entry: RecapSimilarRoutesEntry | undefined;
  unit: RecapUnitPreference;
}): string {
  const { currentWorkout, entry, unit } = args;

  if (!entry || !entry.ok) return "n/a";

  const rows = parseSimilarRoutesBody(entry.body);
  if (rows.length === 0) return "n/a";

  const rawRow = rows[0];
  const similar = pickSimilarWorkoutRow(rawRow);
  if (!similar) return "n/a";

  const startedRaw = pickFirst(similar, ["startedAt", "StartedAt"]);
  const curStartedRaw = pickFirst(currentWorkout, ["startedAt", "StartedAt"]);
  if (typeof startedRaw !== "string" || typeof curStartedRaw !== "string") {
    return "n/a";
  }

  const wk = weeksAgoLabel(curStartedRaw, startedRaw);
  if (!wk) return "n/a";

  const dm = pickFirst(similar, ["distanceM", "Distance"]);
  const distanceM =
    typeof dm === "number" && Number.isFinite(dm) ? dm : undefined;
  const distPart =
    distanceM !== undefined ? formatDistanceShort(distanceM, unit) : "";

  const routeName = pickFirst(similar, [
    "name",
    "Name",
    "routeName",
    "RouteName",
    "title",
    "Title",
  ]);
  const runType = pickFirst(similar, ["runType", "RunType"]);
  const label =
    typeof routeName === "string" && routeName.trim()
      ? routeName.trim()
      : typeof runType === "string" && runType.trim()
        ? runType.trim()
        : "run";

  const lead =
    distPart.length > 0 ? `${distPart} ${label}` : label;

  const simPace = pickFirst(similar, ["avgPaceS", "AvgPaceS"]);
  const curPace = pickFirst(currentWorkout, ["avgPaceS", "AvgPaceS"]);
  const simPaceN =
    typeof simPace === "number" && Number.isFinite(simPace) ? simPace : undefined;
  const curPaceN =
    typeof curPace === "number" && Number.isFinite(curPace) ? curPace : undefined;

  const simHr = pickFirst(similar, ["avgHeartRateBpm", "AvgHeartRateBpm"]);
  const curHr = pickFirst(currentWorkout, ["avgHeartRateBpm", "AvgHeartRateBpm"]);
  const simHrN =
    typeof simHr === "number" && Number.isFinite(simHr) ? simHr : undefined;
  const curHrN =
    typeof curHr === "number" && Number.isFinite(curHr) ? curHr : undefined;

  if (simPaceN === undefined && simHrN === undefined) return "n/a";

  const atParts: string[] = [];
  if (simPaceN !== undefined) atParts.push(formatPaceLabel(simPaceN, unit));
  if (simHrN !== undefined) atParts.push(`avg HR ${Math.round(simHrN)}`);
  const atSegment = atParts.length > 0 ? ` at ${atParts.join(" · ")}` : "";

  const mid = `${lead} ${wk}${atSegment}`;

  const wrap = isPlainObject(rawRow) ? rawRow : {};
  let paceDeltaSecPerUnit: number | undefined;
  let hrDelta: number | undefined;

  const paceDeltaKeys = [
    "paceDifferenceSecondsPerKm",
    "PaceDifferenceSecondsPerKm",
    "paceDifferenceSeconds",
    "PaceDifferenceSeconds",
    "averagePaceDifferenceSeconds",
  ] as const;
  const hrDeltaKeys = [
    "heartRateDifferenceBpm",
    "HeartRateDifferenceBpm",
    "avgHeartRateDifferenceBpm",
    "AvgHeartRateDifferenceBpm",
  ] as const;

  const apiPaceDelta =
    pickOptionalDeltaSeconds(wrap, paceDeltaKeys) ??
    pickOptionalDeltaSeconds(similar, paceDeltaKeys);
  const apiHrDelta =
    pickOptionalDeltaBpm(wrap, hrDeltaKeys) ??
    pickOptionalDeltaBpm(similar, hrDeltaKeys);

  if (apiPaceDelta !== undefined) {
    paceDeltaSecPerUnit =
      unit === "imperial"
        ? apiPaceDelta * (METERS_PER_MILE / 1000)
        : apiPaceDelta;
  } else if (
    curPaceN !== undefined &&
    simPaceN !== undefined
  ) {
    /** Positive = current faster (lower sec/km). Convert delta to display unit. */
    const deltaKm = simPaceN - curPaceN;
    paceDeltaSecPerUnit = formatPaceSecPerUnit(deltaKm, unit);
  }

  if (apiHrDelta !== undefined) {
    hrDelta = apiHrDelta;
  } else if (curHrN !== undefined && simHrN !== undefined) {
    hrDelta = curHrN - simHrN;
  }

  if (paceDeltaSecPerUnit === undefined && hrDelta === undefined) {
    return mid;
  }

  const bits: string[] = [];
  if (paceDeltaSecPerUnit !== undefined && Number.isFinite(paceDeltaSecPerUnit)) {
    const absS = Math.abs(Math.round(paceDeltaSecPerUnit));
    const faster = paceDeltaSecPerUnit > 0;
    const unitLabel = unit === "imperial" ? "mi" : "km";
    bits.push(
      `${absS}s/${unitLabel} ${faster ? "faster" : "slower"}`,
    );
  }
  if (hrDelta !== undefined && Number.isFinite(hrDelta)) {
    const sign = hrDelta >= 0 ? "+" : "";
    bits.push(`${sign}${Math.round(hrDelta)} bpm avg HR`);
  }

  let tail = bits.length > 0 ? ` → ${bits.join(" at ")}` : "";

  /** ✓ when faster pace (positive paceDeltaSecPerUnit) and lower HR vs similar (negative hrDelta). */
  if (
    paceDeltaSecPerUnit !== undefined &&
    hrDelta !== undefined &&
    paceDeltaSecPerUnit > 0 &&
    hrDelta < 0
  ) {
    tail += " ✓";
  }

  return `${mid}${tail}`;
}
