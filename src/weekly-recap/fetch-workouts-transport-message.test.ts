import { describe, expect, it } from "vitest";

import { formatTransportMessageWithAttempts } from "./fetch-workouts.js";

describe("formatTransportMessageWithAttempts", () => {
  it("appends endpoints when provided", () => {
    expect(
      formatTransportMessageWithAttempts("boom", ["GET /workouts", "GET /shoes"]),
    ).toBe(
      "boom\nEndpoints attempted: GET /workouts; GET /shoes",
    );
  });

  it("returns base only when no endpoints", () => {
    expect(formatTransportMessageWithAttempts("boom", [])).toBe("boom");
    expect(formatTransportMessageWithAttempts("boom", undefined)).toBe("boom");
  });
});
