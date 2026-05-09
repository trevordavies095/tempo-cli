function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function displayCell(value: unknown): string {
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
 * Human-readable lines for API response bodies in terminal mode.
 * JSON objects become sorted `key: value` lines; other bodies stay as trimmed text.
 */
export function humanLinesFromApiBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isPlainObject(parsed)) return trimmed;
    const keys = Object.keys(parsed).sort();
    return keys.map((k) => `${k}: ${displayCell(parsed[k])}`).join("\n");
  } catch {
    return trimmed;
  }
}
