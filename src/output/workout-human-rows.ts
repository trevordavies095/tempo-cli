/** Max rows rendered in human-mode workout tables (list, similar-routes, etc.). */
export const HUMAN_WORKOUT_TABLE_ROW_CAP = 20;

function pickFirst(
  obj: Record<string, unknown>,
  keys: readonly string[],
): unknown {
  for (const k of keys) {
    if (
      Object.prototype.hasOwnProperty.call(obj, k) &&
      obj[k] !== undefined &&
      obj[k] !== null &&
      obj[k] !== ""
    ) {
      return obj[k];
    }
  }
  return undefined;
}

/** Scalar / JSON cell for human-mode workout rows. */
export function displayCellForHuman(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * One compact line for a workout-shaped JSON object (list items, similar routes, etc.).
 */
export function compactWorkoutSummaryRow(obj: Record<string, unknown>): string {
  const bits: string[] = [];
  const id = pickFirst(obj, ["workoutId", "id", "WorkoutId", "Id"]);
  if (id !== undefined) bits.push(displayCellForHuman(id));
  const name = pickFirst(obj, ["name", "Name"]);
  if (name !== undefined) bits.push(displayCellForHuman(name));
  const started = pickFirst(obj, ["startedAt", "StartedAt"]);
  if (started !== undefined) bits.push(displayCellForHuman(started));
  const distance = pickFirst(obj, ["distance", "Distance"]);
  if (distance !== undefined) {
    bits.push(`distance=${displayCellForHuman(distance)}`);
  }
  const duration = pickFirst(obj, ["duration", "Duration"]);
  if (duration !== undefined) {
    bits.push(`duration=${displayCellForHuman(duration)}`);
  }
  const runType = pickFirst(obj, ["runType", "RunType"]);
  if (runType !== undefined) {
    bits.push(`runType=${displayCellForHuman(runType)}`);
  }
  return bits.length > 0 ? bits.join(" | ") : JSON.stringify(obj);
}
