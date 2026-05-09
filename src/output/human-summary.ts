/** Default cap for numbered rows rendered in human-mode array summaries. */
export const HUMAN_GENERIC_ROW_CAP = 20;

/**
 * Returns the first non-null, non-undefined, non-empty-string value for any of
 * the given keys on `obj`, or `undefined` if no such key is present.
 *
 * Use to read JSON shapes defensively when the OpenAPI spec does not pin field
 * casing (e.g. accept both camelCase and PascalCase).
 */
export function pickFirst(
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

/** Render a JSON value as a single human-mode cell. */
export function displayCell(value: unknown): string {
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

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Lines for a capped numbered list. Returns:
 *   ["<n> <label>", "1. ...", ..., "… and <rest> more"?]
 *
 * Callers prepend their own `OK (HTTP <status>)` header.
 */
export function formatCappedArrayLines<T>(
  items: readonly T[],
  label: string,
  rowFormatter: (item: T, index: number) => string,
  rowCap: number = HUMAN_GENERIC_ROW_CAP,
): string[] {
  const lines: string[] = [`${items.length} ${label}`];
  const shown = items.slice(0, rowCap);
  let i = 0;
  for (const item of shown) {
    i += 1;
    lines.push(`${i}. ${rowFormatter(item, i)}`);
  }
  const rest = items.length - shown.length;
  if (rest > 0) {
    lines.push(`… and ${rest} more`);
  }
  return lines;
}

/**
 * Field spec entry: `[label, ...candidateKeys]`. The first present, non-empty
 * value among `candidateKeys` is rendered as `${label}: ${displayCell(value)}`;
 * entries with no matching key are skipped.
 */
export type HumanFieldSpec = readonly [string, ...string[]];

/**
 * Lines for an ordered subset of object fields, picking the first matching key
 * per spec. Returns `[]` when nothing matches (caller decides whether to fall
 * back to the generic body renderer).
 */
export function formatFieldLines(
  parsed: Record<string, unknown>,
  fieldSpecs: readonly HumanFieldSpec[],
): string[] {
  const lines: string[] = [];
  for (const spec of fieldSpecs) {
    const [label, ...keys] = spec;
    const value = pickFirst(parsed, keys);
    if (value !== undefined) {
      lines.push(`${label}: ${displayCell(value)}`);
    }
  }
  return lines;
}
