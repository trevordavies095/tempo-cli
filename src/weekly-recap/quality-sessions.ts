/**
 * §2.5 Quality session check: prescribed YAML vs actual splits / HR (weekly recap spec §3.7).
 *
 * Rep mapping: first `reps` rows in `splits` align with prescribed reps when route-derived splits exist.
 * HR: per-split avg fields when present; else mean HR from time-series samples in the split’s elapsed
 * window; else workout summary avg with “(avg HR)” (conservative verdict when pace-only is reliable).
 */

import { DateTime } from "luxon";

import { isPlainObject, pickFirst } from "../output/human-summary.js";
import type { HrSamplePoint } from "./hr-analytics.js";
import {
  normalizeIsoWeekId,
  parsePrescribedWeekYaml,
  type PrescribedWorkoutSession,
} from "./prescribed-week.js";

const METERS_PER_MILE = 1609.344;

export type RepEvalResult = {
  repIndex: number;
  paceSecPerMi?: number;
  paceDisplay?: string;
  avgHr?: number;
  hrSource: "split" | "time_series" | "workout_avg";
  verdict: "ok" | "partial" | "miss";
};

function parseJsonObject(body: string): Record<string, unknown> | undefined {
  const t = body.trim();
  if (!t) return undefined;
  try {
    const v = JSON.parse(t) as unknown;
    return isPlainObject(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

function workoutLocalDate(
  startedAt: string | undefined,
  timeZoneId: string,
): string | undefined {
  if (!startedAt?.trim()) return undefined;
  const dt = DateTime.fromISO(startedAt.trim(), { setZone: true });
  if (!dt.isValid) return undefined;
  return dt.setZone(timeZoneId).toFormat("yyyy-LL-dd");
}

/** Runs eligible for §2.5 quality block per spec (Workout / Race style). */
export function isQualitySessionRunType(runType: unknown): boolean {
  if (typeof runType !== "string") return false;
  const t = runType.trim().toLowerCase();
  return t === "workout" || t === "race" || /\brace\b/.test(t) || /\bworkout\b/.test(t);
}

function pickAvgHrSummary(workout: Record<string, unknown>): number | undefined {
  const v = pickFirst(workout, [
    "avgHeartRateBpm",
    "AvgHeartRateBpm",
    "averageHeartRateBpm",
  ]);
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.round(v);
  return undefined;
}

function paceSecPerKmToSecPerMi(paceS: number): number {
  return paceS * (METERS_PER_MILE / 1000);
}

function formatSecPerMiClock(secPerMi: number): string {
  const s = Math.round(secPerMi);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function splitDurationS(row: Record<string, unknown>): number | undefined {
  const raw = pickFirst(row, ["durationS", "Duration"]);
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return undefined;
}

function avgHrFromSamples(
  samples: readonly HrSamplePoint[] | undefined,
  startSec: number,
  endSec: number,
): number | undefined {
  if (!samples || samples.length === 0 || endSec <= startSec) return undefined;
  let sum = 0;
  let n = 0;
  for (const p of samples) {
    if (p.elapsedSeconds >= startSec && p.elapsedSeconds < endSec) {
      sum += p.heartRateBpm;
      n += 1;
    }
  }
  if (n === 0) return undefined;
  return Math.round(sum / n);
}

function verdictForRep(paceOk: boolean, hrOk: boolean): RepEvalResult["verdict"] {
  if (paceOk && hrOk) return "ok";
  if (paceOk !== hrOk) return "partial";
  return "miss";
}

function verdictGlyph(v: RepEvalResult["verdict"]): string {
  if (v === "ok") return "✓";
  if (v === "partial") return "⚠";
  return "✗";
}

function evaluateWorkoutSession(args: {
  session: PrescribedWorkoutSession;
  workout: Record<string, unknown>;
  samples: readonly HrSamplePoint[] | undefined;
}): RepEvalResult[] {
  const { session, workout, samples } = args;
  const splitsRaw = pickFirst(workout, ["splits", "Splits"]);
  const splits = Array.isArray(splitsRaw)
    ? splitsRaw.filter(isPlainObject) as Record<string, unknown>[]
    : [];

  const workoutDur = pickFirst(workout, ["durationS", "Duration"]);
  const durationFallback =
    typeof workoutDur === "number" && Number.isFinite(workoutDur) && workoutDur > 0
      ? Math.floor(workoutDur)
      : undefined;
  const equalChunk =
    durationFallback !== undefined
      ? Math.max(1, Math.floor(durationFallback / session.reps))
      : undefined;

  const reps: RepEvalResult[] = [];
  let cumElapsed = 0;

  for (let i = 0; i < session.reps; i++) {
    const row = splits[i];
    let paceSecPerMi: number | undefined;
    let paceDisplay: string | undefined;
    if (row) {
      const paceS = pickFirst(row, ["paceS", "PaceS"]);
      if (typeof paceS === "number" && Number.isFinite(paceS) && paceS > 0) {
        paceSecPerMi = paceSecPerKmToSecPerMi(paceS);
        paceDisplay = formatSecPerMiClock(paceSecPerMi);
      }
    }

    const paceMin = session.paceSecPerMi.min;
    const paceMax = session.paceSecPerMi.max;
    const paceOk =
      paceSecPerMi !== undefined &&
      paceSecPerMi >= paceMin &&
      paceSecPerMi <= paceMax;

    let avgHr: number | undefined;
    let hrSource: RepEvalResult["hrSource"] = "workout_avg";

    if (row) {
      const hrSplit = pickFirst(row, [
        "avgHeartRateBpm",
        "AvgHeartRateBpm",
        "averageHeartRateBpm",
      ]);
      if (typeof hrSplit === "number" && Number.isFinite(hrSplit) && hrSplit > 0) {
        avgHr = Math.round(hrSplit);
        hrSource = "split";
      }
    }

    const splitDur = row ? splitDurationS(row) : undefined;
    const segDur = splitDur ?? equalChunk;

    if (avgHr === undefined && samples !== undefined && segDur !== undefined) {
      const startSec = cumElapsed;
      const endSec = cumElapsed + segDur;
      const tsHr = avgHrFromSamples(samples, startSec, endSec);
      if (tsHr !== undefined) {
        avgHr = tsHr;
        hrSource = "time_series";
      }
    }

    if (segDur !== undefined) {
      cumElapsed += segDur;
    }

    if (avgHr === undefined) {
      avgHr = pickAvgHrSummary(workout);
      hrSource = "workout_avg";
    }

    const hrMin = session.hrBpm.min;
    const hrMax = session.hrBpm.max;
    const hrOk =
      avgHr !== undefined && avgHr >= hrMin && avgHr <= hrMax;

    const verdict = verdictForRep(!!paceOk, !!hrOk);

    reps.push({
      repIndex: i + 1,
      paceSecPerMi,
      paceDisplay,
      avgHr,
      hrSource,
      verdict,
    });
  }

  return reps;
}

function sessionTitleDate(dateYmd: string, timeZoneId: string): string {
  const dt = DateTime.fromISO(dateYmd, { zone: timeZoneId });
  if (!dt.isValid) return dateYmd;
  return `${dt.toFormat("ccc")} ${dt.toFormat("MMM d")}`;
}

function verdictSummaryLine(reps: RepEvalResult[]): string {
  if (reps.every((r) => r.verdict === "ok")) return "Verdict: on target.";
  if (reps.every((r) => r.verdict === "ok" || r.verdict === "partial")) {
    return "Verdict: mostly on target (see ⚠ reps).";
  }
  return "Verdict: one or more reps outside prescribed pace/HR.";
}

export type BuildPrescribedQualityArgs = {
  /** Raw file contents; `undefined` if file missing or unreadable */
  fileContent: string | undefined;
  resolvedPath: string;
  resolvedIsoWeekId: string;
  timeZoneId: string;
  workoutDetails: readonly { id: string; body: string }[];
  timeSeriesByWorkoutId?: Readonly<Record<string, readonly HrSamplePoint[]>>;
};

export function buildPrescribedQualityOutput(
  args: BuildPrescribedQualityArgs,
): { markdown: string; json: Record<string, unknown> } {
  const baseJson: Record<string, unknown> = {
    path: args.resolvedPath,
    loaded: args.fileContent !== undefined,
  };

  if (args.fileContent === undefined) {
    return { markdown: "", json: baseJson };
  }

  const parsed = parsePrescribedWeekYaml(args.fileContent);
  if (!parsed.ok) {
    return {
      markdown: "",
      json: {
        ...baseJson,
        loaded: true,
        parseError: parsed.message,
      },
    };
  }

  const week = parsed.value;
  const fileWeekNorm = normalizeIsoWeekId(week.week);
  const recapWeekNorm = normalizeIsoWeekId(args.resolvedIsoWeekId);
  const weekMismatch = fileWeekNorm !== recapWeekNorm;

  const sessionResults: Record<string, unknown>[] = [];
  const mdParts: string[] = [];

  if (weekMismatch) {
    mdParts.push(
      `> Prescribed file week (\`${week.week}\`) does not match recap week (\`${args.resolvedIsoWeekId}\`); quality checks may not align.`,
      "",
    );
  }

  for (const session of week.sessions) {
    if (session.kind === "long_run") {
      sessionResults.push({
        kind: "long_run",
        date: session.date,
        skippedReason: "long_run_deferred_to_p12",
        description: session.description,
      });
      continue;
    }

    let matched: { id: string; workout: Record<string, unknown> } | undefined;
    for (const d of args.workoutDetails) {
      const w = parseJsonObject(d.body);
      if (!w) continue;
      const started = pickFirst(w, ["startedAt", "StartedAt"]);
      if (typeof started !== "string") continue;
      const localD = workoutLocalDate(started, args.timeZoneId);
      if (localD !== session.date) continue;
      const rt = pickFirst(w, ["runType", "RunType"]);
      if (!isQualitySessionRunType(rt)) continue;
      matched = { id: d.id, workout: w };
      break;
    }

    if (!matched) {
      sessionResults.push({
        kind: "workout",
        date: session.date,
        description: session.description,
        matched: false,
        reason: "no_workout_or_race_on_date",
      });
      continue;
    }

    const samples = args.timeSeriesByWorkoutId?.[matched.id];
    const repResults = evaluateWorkoutSession({
      session,
      workout: matched.workout,
      samples,
    });

    sessionResults.push({
      kind: "workout",
      date: session.date,
      workoutId: matched.id,
      description: session.description,
      matched: true,
      reps: repResults,
    });

    const title = sessionTitleDate(session.date, args.timeZoneId);
    const desc =
      session.description ??
      `${session.reps} × ${session.repDistanceMi} mi`;
    const prescribedLine = `Prescribed: ${session.paceMinStr}–${session.paceMaxStr}/mi @ ${session.hrBpm.min}–${session.hrBpm.max} bpm`;

    const actualBits = repResults.map((r) => {
      const pace = r.paceDisplay ?? "n/a";
      const hrBit =
        r.avgHr !== undefined
          ? `avg HR ${r.avgHr}${r.hrSource === "workout_avg" ? " (avg HR)" : ""}`
          : "HR n/a";
      return `rep ${r.repIndex} = ${pace} (${hrBit}) ${verdictGlyph(r.verdict)}`;
    });

    mdParts.push(
      `### Quality session — ${title} — ${desc}`,
      "",
      prescribedLine,
      "",
      `Actual: ${actualBits.join("  ·  ")}`,
      "",
      verdictSummaryLine(repResults),
      "",
    );
  }

  const markdown =
    mdParts.length > 0
      ? `${mdParts.join("\n").trimEnd()}\n`
      : "";

  return {
    markdown,
    json: {
      ...baseJson,
      loaded: true,
      week: week.week,
      weekMismatch,
      sessions: sessionResults,
    },
  };
}
