/**
 * Interactive §3.8 subjective capture when no sidecar file exists (TTY stdin).
 */

import { DateTime } from "luxon";
import { createInterface } from "node:readline/promises";

import { isPlainObject, pickFirst } from "../output/human-summary.js";
import {
  formatDistanceDm,
  formatDuration,
  formatStartedTitle,
} from "./markdown-report.js";
import type { RecapUnitPreference } from "./recap-settings.js";
import type { SubjectiveRunRow, SubjectiveWeekDoc, SubjectiveWeeklyMeta } from "./subjective-week.js";
import { clampOptionalRating, workoutLocalDate } from "./subjective-week.js";

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

function sortDetailsByStart(
  details: readonly { id: string; body: string }[],
  timeZoneId: string,
): { id: string; body: string }[] {
  return [...details].sort((a, b) => {
    const wa = parseJsonObject(a.body);
    const wb = parseJsonObject(b.body);
    const sa =
      wa && typeof pickFirst(wa, ["startedAt", "StartedAt"]) === "string"
        ? DateTime.fromISO(
            (pickFirst(wa, ["startedAt", "StartedAt"]) as string).trim(),
            { setZone: true },
          ).toMillis()
        : 0;
    const sb =
      wb && typeof pickFirst(wb, ["startedAt", "StartedAt"]) === "string"
        ? DateTime.fromISO(
            (pickFirst(wb, ["startedAt", "StartedAt"]) as string).trim(),
            { setZone: true },
          ).toMillis()
        : 0;
    if (sa !== sb) return sa - sb;
    return a.id.localeCompare(b.id);
  });
}

function parseOptionalRating(line: string): number | undefined {
  const t = line.trim();
  if (!t) return undefined;
  const n = Number.parseInt(t, 10);
  if (!Number.isFinite(n) || n < 1 || n > 10) return undefined;
  return n;
}

/** Read RPE from Tempo workout detail JSON (GET /workouts/{id} body). Exported for tests. */
export function extractApiRpe(w: Record<string, unknown>): number | undefined {
  const raw = pickFirst(w, ["rpe", "Rpe", "RPE"]);
  if (typeof raw !== "number") return undefined;
  return clampOptionalRating(raw);
}

function parseOptionalFloat(line: string): number | undefined {
  const t = line.trim();
  if (!t) return undefined;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : undefined;
}

function parseOptionalInt(line: string): number | undefined {
  const t = line.trim();
  if (!t) return undefined;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) ? n : undefined;
}

function buildRunTitleLine(
  workout: Record<string, unknown>,
  timeZoneId: string,
  unit: RecapUnitPreference,
): string {
  const startedRaw = pickFirst(workout, ["startedAt", "StartedAt"]);
  const startedAt =
    typeof startedRaw === "string" && startedRaw.trim()
      ? startedRaw.trim()
      : undefined;
  const { titleDate } = formatStartedTitle(startedAt, timeZoneId);
  const runTypeRaw = pickFirst(workout, ["runType", "RunType"]);
  const runType =
    typeof runTypeRaw === "string" && runTypeRaw.trim()
      ? runTypeRaw.trim()
      : "Run";
  const dm = pickFirst(workout, ["distanceM", "Distance"]);
  const distanceM =
    typeof dm === "number" && Number.isFinite(dm) ? dm : undefined;
  const ds = pickFirst(workout, ["durationS", "Duration"]);
  const durationS =
    typeof ds === "number" && Number.isFinite(ds) ? ds : undefined;
  const distStr =
    distanceM !== undefined ? formatDistanceDm(distanceM, unit) : "n/a";
  const durStr =
    durationS !== undefined ? formatDuration(durationS) : "n/a";
  return `${titleDate} — ${runType} — ${distStr} / ${durStr}`;
}

/**
 * Prompts for subjective fields and returns a document suitable for YAML export.
 */
export async function collectSubjectiveInteractive(args: {
  isoWeekId: string;
  workoutDetails: readonly { id: string; body: string }[];
  timeZoneId: string;
  unit: RecapUnitPreference;
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
}): Promise<SubjectiveWeekDoc> {
  const rl = createInterface({
    input: args.stdin,
    output: args.stdout,
    terminal: args.stdin.isTTY,
  });

  const runs: SubjectiveRunRow[] = [];

  try {
    args.stdout.write("\nSubjective inputs (weekly recap §3.8). Enter to skip any prompt.\n\n");

    const ordered = sortDetailsByStart(args.workoutDetails, args.timeZoneId);
    for (const d of ordered) {
      const w = parseJsonObject(d.body);
      if (!w) continue;
      const started = pickFirst(w, ["startedAt", "StartedAt"]);
      const date =
        typeof started === "string"
          ? workoutLocalDate(started, args.timeZoneId)
          : undefined;
      if (!date) continue;

      const header = buildRunTitleLine(w, args.timeZoneId, args.unit);
      args.stdout.write(`${header}\n`);

      const apiRpe = extractApiRpe(w);
      let rpe: number | undefined;
      if (apiRpe !== undefined) {
        args.stdout.write(`  RPE: ${apiRpe}/10 (from Tempo)\n`);
        rpe = apiRpe;
      } else {
        const rpeLine = await rl.question("  RPE (1-10) [Enter to skip]: ");
        rpe = parseOptionalRating(rpeLine);
      }
      const feltLine = await rl.question("  Felt (1-10) [Enter to skip]: ");
      const painLine = await rl.question("  Pain/niggles [Enter to skip]: ");

      const felt = parseOptionalRating(feltLine);
      const pain =
        painLine.trim().length > 0 ? painLine.trim() : undefined;

      if (rpe !== undefined || felt !== undefined || pain !== undefined) {
        runs.push({ date, rpe, felt, pain });
      }
    }

    args.stdout.write("\nWeekly subjective fields:\n");

    const sleepAvgLine = await rl.question("Sleep avg (hours) [skip]: ");
    const sleepLoLine = await rl.question("Sleep range low (hours) [skip]: ");
    const sleepHiLine = await rl.question("Sleep range high (hours) [skip]: ");
    const strCompletedLine = await rl.question(
      "Strength sessions completed [skip]: ",
    );
    const strPlannedLine = await rl.question("Strength sessions planned [skip]: ");
    const strNotesLine = await rl.question("Strength session notes [skip]: ");
    const stressLine = await rl.question("Stress level [skip]: ");
    const bodyLine = await rl.question("Body check [skip]: ");
    const feelingLine = await rl.question(
      "Going into next week feeling [skip]: ",
    );

    const weekly: SubjectiveWeeklyMeta = {};

    const sleepAvg = parseOptionalFloat(sleepAvgLine);
    if (sleepAvg !== undefined) weekly.sleep_avg_hrs = sleepAvg;
    const lo = parseOptionalFloat(sleepLoLine);
    const hi = parseOptionalFloat(sleepHiLine);
    if (lo !== undefined && hi !== undefined) {
      weekly.sleep_range_hrs = [lo, hi];
    }

    const sc = parseOptionalInt(strCompletedLine);
    const sp = parseOptionalInt(strPlannedLine);
    if (sc !== undefined || sp !== undefined || strNotesLine.trim()) {
      weekly.strength_sessions = {};
      if (sc !== undefined) weekly.strength_sessions.completed = sc;
      if (sp !== undefined) weekly.strength_sessions.planned = sp;
      if (strNotesLine.trim()) weekly.strength_sessions.notes = strNotesLine.trim();
    }

    if (stressLine.trim()) weekly.stress_level = stressLine.trim();
    if (bodyLine.trim()) weekly.body_check = bodyLine.trim();
    if (feelingLine.trim()) weekly.feeling_into_next_week = feelingLine.trim();

    args.stdout.write(
      "\nCoach questions (one line each; empty line to finish):\n",
    );
    const coachQs: string[] = [];
    for (;;) {
      const q = await rl.question(`Question ${coachQs.length + 1} [done if empty]: `);
      if (!q.trim()) break;
      coachQs.push(q.trim());
    }
    if (coachQs.length > 0) weekly.questions_for_coach = coachQs;

    const weeklyOut =
      Object.keys(weekly).length > 0 ? weekly : undefined;

    return {
      week: args.isoWeekId,
      runs,
      weekly: weeklyOut,
    };
  } finally {
    rl.close();
  }
}
