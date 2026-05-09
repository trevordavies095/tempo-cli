import { describe, expect, it } from "vitest";
import {
  displayCell,
  formatCappedArrayLines,
  formatFieldLines,
  HUMAN_GENERIC_ROW_CAP,
  isPlainObject,
  pickFirst,
} from "./human-summary.js";

describe("pickFirst", () => {
  it("returns the first present, non-empty value", () => {
    expect(pickFirst({ id: "a", Id: "b" }, ["id", "Id"])).toBe("a");
    expect(pickFirst({ Id: "b" }, ["id", "Id"])).toBe("b");
  });

  it("skips null, undefined, and empty-string entries", () => {
    expect(pickFirst({ a: null, b: "", c: "x" }, ["a", "b", "c"])).toBe("x");
    expect(pickFirst({ a: undefined, b: 0 }, ["a", "b"])).toBe(0);
    expect(pickFirst({ a: false }, ["a"])).toBe(false);
  });

  it("returns undefined when no key matches", () => {
    expect(pickFirst({ x: 1 }, ["a", "b"])).toBeUndefined();
  });
});

describe("displayCell", () => {
  it("stringifies scalars verbatim", () => {
    expect(displayCell("x")).toBe("x");
    expect(displayCell(42)).toBe("42");
    expect(displayCell(true)).toBe("true");
    expect(displayCell(null)).toBe("null");
  });

  it("JSON-stringifies objects and arrays", () => {
    expect(displayCell({ a: 1 })).toBe('{"a":1}');
    expect(displayCell([1, 2])).toBe("[1,2]");
  });
});

describe("isPlainObject", () => {
  it("identifies plain objects", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
  });

  it("rejects arrays and primitives", () => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject("x")).toBe(false);
    expect(isPlainObject(0)).toBe(false);
  });
});

describe("formatCappedArrayLines", () => {
  it("renders count header and numbered rows", () => {
    const lines = formatCappedArrayLines(
      ["a", "b", "c"],
      "thing(s)",
      (s) => s.toUpperCase(),
    );
    expect(lines).toEqual([
      "3 thing(s)",
      "1. A",
      "2. B",
      "3. C",
    ]);
  });

  it("caps at HUMAN_GENERIC_ROW_CAP and appends `… and N more`", () => {
    expect(HUMAN_GENERIC_ROW_CAP).toBe(20);
    const items = Array.from({ length: 22 }, (_, i) => i);
    const lines = formatCappedArrayLines(items, "row(s)", (n) => `n=${n}`);
    expect(lines[0]).toBe("22 row(s)");
    expect(lines.length).toBe(1 + 20 + 1);
    expect(lines[lines.length - 1]).toBe("… and 2 more");
    const numbered = lines.filter((l) => /^\d+\./.test(l));
    expect(numbered).toHaveLength(20);
  });

  it("honors a custom rowCap", () => {
    const items = [1, 2, 3, 4, 5];
    const lines = formatCappedArrayLines(items, "x(s)", String, 2);
    expect(lines).toEqual(["5 x(s)", "1. 1", "2. 2", "… and 3 more"]);
  });

  it("returns just the count header for an empty array", () => {
    expect(
      formatCappedArrayLines([], "shoe(s)", () => "unused"),
    ).toEqual(["0 shoe(s)"]);
  });
});

describe("formatFieldLines", () => {
  it("orders fields and uses the first matching key per spec", () => {
    const parsed = { id: "abc", Name: "Morning", duration: 1800 };
    const lines = formatFieldLines(parsed, [
      ["id", "id", "Id"],
      ["name", "name", "Name"],
      ["duration", "duration", "Duration"],
      ["missing", "missing", "Missing"],
    ]);
    expect(lines).toEqual([
      "id: abc",
      "name: Morning",
      "duration: 1800",
    ]);
  });

  it("supports PascalCase fallbacks", () => {
    const lines = formatFieldLines(
      { Id: "x", Distance: 5000 },
      [
        ["id", "id", "Id"],
        ["distance", "distance", "Distance"],
      ],
    );
    expect(lines).toEqual(["id: x", "distance: 5000"]);
  });

  it("returns [] when nothing matches", () => {
    expect(
      formatFieldLines({ x: 1 }, [["id", "id", "Id"]]),
    ).toEqual([]);
  });

  it("renders nested objects via JSON.stringify in the cell", () => {
    const lines = formatFieldLines(
      { currentYear: { year: 2025, distance: 120 } },
      [["currentYear", "currentYear"]],
    );
    expect(lines).toEqual([
      'currentYear: {"year":2025,"distance":120}',
    ]);
  });
});
