import { describe, expect, it } from "vitest";
import {
  EXIT_AUTH,
  EXIT_NOT_FOUND,
  EXIT_SERVER_ERROR,
  EXIT_TRANSPORT,
  EXIT_USAGE,
  exitCodeForFetchFailure,
  exitCodeForHttpStatus,
} from "./exits.js";

describe("exitCodeForHttpStatus", () => {
  it.each([
    [401, EXIT_AUTH],
    [403, EXIT_AUTH],
    [404, EXIT_NOT_FOUND],
    [500, EXIT_SERVER_ERROR],
    [599, EXIT_SERVER_ERROR],
    [400, EXIT_USAGE],
    [418, EXIT_USAGE],
    [200, EXIT_USAGE],
    [302, EXIT_USAGE],
  ])("status %s -> %s", (status, expected) => {
    expect(exitCodeForHttpStatus(status)).toBe(expected);
  });
});

describe("exitCodeForFetchFailure", () => {
  it("maps AbortError to transport", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(exitCodeForFetchFailure(err)).toBe(EXIT_TRANSPORT);
  });

  it("maps TimeoutError to transport", () => {
    const err = new Error("timed out");
    err.name = "TimeoutError";
    expect(exitCodeForFetchFailure(err)).toBe(EXIT_TRANSPORT);
  });

  it("maps DOMException AbortError to transport when available", () => {
    if (typeof DOMException === "undefined") return;
    const err = new DOMException("Aborted", "AbortError");
    expect(exitCodeForFetchFailure(err)).toBe(EXIT_TRANSPORT);
  });

  it("maps nested cause errno ENOTFOUND to transport", () => {
    const err = new Error("wrap");
    (err as Error & { cause: unknown }).cause = { code: "ENOTFOUND" };
    expect(exitCodeForFetchFailure(err)).toBe(EXIT_TRANSPORT);
  });

  it("maps TypeError fetch failed with errno cause to transport", () => {
    const inner = { code: "ECONNREFUSED" as const };
    const err = new TypeError("fetch failed", { cause: inner });
    expect(exitCodeForFetchFailure(err)).toBe(EXIT_TRANSPORT);
  });

  it("defaults other Error instances to transport", () => {
    expect(exitCodeForFetchFailure(new Error("something"))).toBe(
      EXIT_TRANSPORT,
    );
  });

  it("defaults non-Error throws to transport", () => {
    expect(exitCodeForFetchFailure("boom")).toBe(EXIT_TRANSPORT);
  });
});
