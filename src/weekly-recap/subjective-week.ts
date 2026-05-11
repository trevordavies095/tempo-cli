/**
 * §3.8 subjective YAML/JSON: per-run RPE/Felt/Pain and weekly fields for §2.9 / §2.10.
 */

import { parse as parseYaml } from "yaml";

import { DateTime } from "luxon";

import { isPlainObject, pickFirst } from "../output/human-summary.js";
import type { RecapWeekResolved } from "./resolve-week.js";

export type SubjectiveRunFields = {
  rpe?: number;
  felt?: number;
  pain?: string;
};

export type SubjectiveRunRow = SubjectiveRunFields & {
  date: string;
};

export type StrengthSessionsMeta = {
  completed?: number;
  planned?: number;
  notes?: string;
};

export type SubjectiveWeeklyMeta = {
  sleep_avg_hrs?: number;
  sleep_range_hrs?: [number, number];
  strength_sessions?: StrengthSessionsMeta;
  stress_level?: string;
  body_check?: string;
  feeling_into_next_week?: string;
  questions_for_coach?: string[];
};

export type SubjectiveWeekDoc = {
  week: string;
  runs: SubjectiveRunRow[];
  weekly?: SubjectiveWeeklyMeta;
};

export type ParseSubjectiveWeekOk = { ok: true; value: SubjectiveWeekDoc };
export type ParseSubjectiveWeekErr = { ok: false; message: string };
export type ParseSubjectiveWeekResult = ParseSubjectiveWeekOk | ParseSubjectiveWeekErr;

export function clampOptionalRating(n: number): number | undefined {
  if (!Number.isFinite(n)) return undefined;
  const r = Math.round(n);
  if (r < 1 || r > 10) return undefined;
  return r;
}

function parseRunRow(raw: unknown): SubjectiveRunRow | undefined {
  if (!isPlainObject(raw)) return undefined;
  const dateRaw = pickFirst(raw, ["date", "Date"]);
  if (typeof dateRaw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateRaw.trim())) {
    return undefined;
  }
  const date = dateRaw.trim();
  const rpeRaw = pickFirst(raw, ["rpe", "Rpe", "RPE"]);
  const feltRaw = pickFirst(raw, ["felt", "Felt"]);
  const painRaw = pickFirst(raw, ["pain", "Pain"]);
  let rpe: number | undefined;
  let felt: number | undefined;
  if (typeof rpeRaw === "number") rpe = clampOptionalRating(rpeRaw);
  if (typeof feltRaw === "number") felt = clampOptionalRating(feltRaw);
  const pain =
    typeof painRaw === "string" && painRaw.trim() ? painRaw.trim() : undefined;
  return { date, rpe, felt, pain };
}

function parseWeekly(raw: unknown): SubjectiveWeeklyMeta | undefined {
  if (!isPlainObject(raw)) return undefined;
  const out: SubjectiveWeeklyMeta = {};

  const sleepAvg = pickFirst(raw, ["sleep_avg_hrs", "sleepAvgHrs"]);
  if (typeof sleepAvg === "number" && Number.isFinite(sleepAvg)) {
    out.sleep_avg_hrs = sleepAvg;
  }

  const rangeRaw = pickFirst(raw, ["sleep_range_hrs", "sleepRangeHrs"]);
  if (Array.isArray(rangeRaw) && rangeRaw.length >= 2) {
    const a = rangeRaw[0];
    const b = rangeRaw[1];
    if (typeof a === "number" && typeof b === "number" && Number.isFinite(a) && Number.isFinite(b)) {
      out.sleep_range_hrs = [a, b];
    }
  }

  const strengthRaw = pickFirst(raw, ["strength_sessions", "strengthSessions"]);
  if (isPlainObject(strengthRaw)) {
    const completed = pickFirst(strengthRaw, ["completed", "Completed"]);
    const planned = pickFirst(strengthRaw, ["planned", "Planned"]);
    const notes = pickFirst(strengthRaw, ["notes", "Notes"]);
    const ss: StrengthSessionsMeta = {};
    if (typeof completed === "number" && Number.isFinite(completed)) {
      ss.completed = Math.round(completed);
    }
    if (typeof planned === "number" && Number.isFinite(planned)) {
      ss.planned = Math.round(planned);
    }
    if (typeof notes === "string" && notes.trim()) ss.notes = notes.trim();
    if (Object.keys(ss).length > 0) out.strength_sessions = ss;
  }

  const stress = pickFirst(raw, ["stress_level", "stressLevel"]);
  if (typeof stress === "string" && stress.trim()) out.stress_level = stress.trim();

  const body = pickFirst(raw, ["body_check", "bodyCheck"]);
  if (typeof body === "string" && body.trim()) out.body_check = body.trim();

  const feeling = pickFirst(raw, ["feeling_into_next_week", "feelingIntoNextWeek"]);
  if (typeof feeling === "string" && feeling.trim()) {
    out.feeling_into_next_week = feeling.trim();
  }

  const qRaw = pickFirst(raw, ["questions_for_coach", "questionsForCoach"]);
  if (Array.isArray(qRaw)) {
    const qs = qRaw
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((x) => x.trim());
    if (qs.length > 0) out.questions_for_coach = qs;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

export function parseSubjectiveWeek(
  raw: string,
  pathHint: string,
): ParseSubjectiveWeekResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, message: "subjective file is empty" };
  }

  let doc: unknown;
  try {
    doc = JSON.parse(trimmed) as unknown;
  } catch {
    try {
      doc = parseYaml(trimmed);
    } catch (e) {
      return {
        ok: false,
        message: `invalid subjective file (${pathHint}): ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  if (!isPlainObject(doc)) {
    return { ok: false, message: "subjective root must be an object" };
  }

  const weekRaw = pickFirst(doc, ["week", "Week"]);
  if (typeof weekRaw !== "string" || !weekRaw.trim()) {
    return { ok: false, message: "subjective.week is required" };
  }

  const runsRaw = pickFirst(doc, ["runs", "Runs"]);
  const runs: SubjectiveRunRow[] = [];
  if (runsRaw !== undefined) {
    if (!Array.isArray(runsRaw)) {
      return { ok: false, message: "subjective.runs must be an array" };
    }
    for (let i = 0; i < runsRaw.length; i++) {
      const row = parseRunRow(runsRaw[i]);
      if (!row) {
        return {
          ok: false,
          message: `subjective.runs[${i}] needs a valid date (YYYY-MM-DD)`,
        };
      }
      runs.push(row);
    }
  }

  const weeklyRaw = pickFirst(doc, ["weekly", "Weekly"]);
  const weekly =
    weeklyRaw !== undefined ? parseWeekly(weeklyRaw) : undefined;

  return {
    ok: true,
    value: {
      week: weekRaw.trim(),
      runs,
      weekly,
    },
  };
}

export function workoutLocalDate(
  startedAt: string | undefined,
  timeZoneId: string,
): string | undefined {
  if (!startedAt?.trim()) return undefined;
  const dt = DateTime.fromISO(startedAt.trim(), { setZone: true });
  if (!dt.isValid) return undefined;
  return dt.setZone(timeZoneId).toFormat("yyyy-LL-dd");
}

/** Last row wins when duplicate dates appear in the file. */
export function subjectiveRunsToDateMap(
  runs: readonly SubjectiveRunRow[],
): Map<string, SubjectiveRunFields> {
  const m = new Map<string, SubjectiveRunFields>();
  for (const r of runs) {
    const bits: SubjectiveRunFields = {};
    if (r.rpe !== undefined) bits.rpe = r.rpe;
    if (r.felt !== undefined) bits.felt = r.felt;
    if (r.pain !== undefined) bits.pain = r.pain;
    m.set(r.date, bits);
  }
  return m;
}

/** Keep subjective runs whose date falls in the recap Mon–Sun range (local calendar dates). */
export function filterRunsInRecapRange(
  runs: readonly SubjectiveRunRow[],
  resolved: RecapWeekResolved,
): SubjectiveRunRow[] {
  const { start, end } = resolved.localRange;
  return runs.filter((r) => r.date >= start && r.date <= end);
}

export function formatSubjectiveRunLine(fields: SubjectiveRunFields): string | undefined {
  const parts: string[] = [];
  if (fields.rpe !== undefined) parts.push(`RPE: ${fields.rpe}/10`);
  if (fields.felt !== undefined) parts.push(`Felt: ${fields.felt}/10`);
  if (fields.pain !== undefined && fields.pain.trim()) {
    parts.push(`Pain: ${fields.pain.trim()}`);
  }
  return parts.length > 0 ? parts.join("  ·  ") : undefined;
}

export function buildSubjectiveRecapMarkdown(
  weekly: SubjectiveWeeklyMeta | undefined,
): string {
  if (!weekly) return "";
  const lines: string[] = [];
  lines.push("## Subjective recap");
  lines.push("");

  if (weekly.sleep_avg_hrs !== undefined) {
    let sleepLine = `Sleep avg this week: ${weekly.sleep_avg_hrs} hrs`;
    if (
      weekly.sleep_range_hrs !== undefined &&
      weekly.sleep_range_hrs.length >= 2
    ) {
      const [lo, hi] = weekly.sleep_range_hrs;
      sleepLine += ` (range ${lo}–${hi})`;
    }
    lines.push(sleepLine);
    lines.push("");
  }

  const ss = weekly.strength_sessions;
  if (ss !== undefined) {
    const c = ss.completed;
    const p = ss.planned;
    if (c !== undefined && p !== undefined) {
      let s = `Strength sessions completed: ${c} of ${p}`;
      if (ss.notes?.trim()) s += ` (${ss.notes.trim()})`;
      lines.push(s);
      lines.push("");
    }
  }

  if (weekly.stress_level?.trim()) {
    lines.push(`Stress level: ${weekly.stress_level.trim()}`);
    lines.push("");
  }

  if (weekly.body_check?.trim()) {
    lines.push(`Body check: ${weekly.body_check.trim()}`);
    lines.push("");
  }

  if (weekly.feeling_into_next_week?.trim()) {
    lines.push(
      `Going into next week feeling: ${weekly.feeling_into_next_week.trim()}`,
    );
    lines.push("");
  }

  const body = lines.join("\n").trimEnd();
  if (body.length <= "## Subjective recap".length + 5) return "";
  return `${body}\n`;
}

export function buildCoachPromptMarkdown(
  questions: string[] | undefined,
): string {
  const qs = questions?.filter((q) => q.trim()) ?? [];
  if (qs.length === 0) return "";
  const lines: string[] = ["## Questions for coach", ""];
  qs.forEach((q, i) => lines.push(`${i + 1}. ${q.trim()}`));
  lines.push("");
  return `${lines.join("\n")}\n`;
}
