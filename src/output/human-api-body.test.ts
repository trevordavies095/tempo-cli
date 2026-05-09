import { describe, expect, it } from "vitest";
import { humanLinesFromApiBody } from "./human-api-body.js";

describe("humanLinesFromApiBody", () => {
  it("returns empty string for blank input", () => {
    expect(humanLinesFromApiBody("")).toBe("");
    expect(humanLinesFromApiBody("  \n")).toBe("");
  });

  it("formats plain JSON objects with sorted keys", () => {
    const raw = '{"z":1,"a":2}';
    expect(humanLinesFromApiBody(raw)).toBe("a: 2\nz: 1");
  });

  it("stringifies nested structures on one line", () => {
    const raw = JSON.stringify({ user: { id: 1 }, tags: ["x"] });
    expect(humanLinesFromApiBody(raw)).toBe(
      `tags: ${JSON.stringify(["x"])}\nuser: ${JSON.stringify({ id: 1 })}`,
    );
  });

  it("returns raw trimmed text for JSON arrays", () => {
    const raw = "[1,2]";
    expect(humanLinesFromApiBody(raw)).toBe("[1,2]");
  });

  it("returns raw text for invalid JSON", () => {
    expect(humanLinesFromApiBody("not json")).toBe("not json");
  });

  it("returns raw for JSON primitives", () => {
    expect(humanLinesFromApiBody("42")).toBe("42");
    expect(humanLinesFromApiBody('"hi"')).toBe('"hi"');
  });
});
