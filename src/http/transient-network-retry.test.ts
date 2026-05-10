import { describe, expect, it, vi } from "vitest";

import {
  isTransientNetworkError,
  runWithTransientNetworkRetry,
  sleep,
} from "./transient-network-retry.js";

describe("isTransientNetworkError", () => {
  it("returns true for AbortError", () => {
    const e = new Error("aborted");
    e.name = "AbortError";
    expect(isTransientNetworkError(e)).toBe(true);
  });

  it("returns true for errno ECONNREFUSED on error chain", () => {
    const inner = { code: "ECONNREFUSED" };
    expect(isTransientNetworkError(inner)).toBe(true);
  });

  it("returns true for TypeError fetch failed", () => {
    expect(isTransientNetworkError(new TypeError("fetch failed"))).toBe(true);
  });

  it("returns false for arbitrary Error", () => {
    expect(isTransientNetworkError(new Error("boom"))).toBe(false);
  });
});

describe("runWithTransientNetworkRetry", () => {
  it("returns on first success", async () => {
    const fn = vi.fn().mockResolvedValue(42);
    await expect(
      runWithTransientNetworkRetry(fn, { delaysMs: [1, 2, 3] }),
    ).resolves.toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures then succeeds", async () => {
    vi.useFakeTimers();
    const err = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ECONNREFUSED" },
    });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce("ok");
    const p = runWithTransientNetworkRetry(fn, { delaysMs: [10, 20, 40] });
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(20);
    await expect(p).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("does not retry non-transient errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("logic"));
    await expect(
      runWithTransientNetworkRetry(fn, { delaysMs: [1] }),
    ).rejects.toThrow("logic");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("sleep", () => {
  it("resolves after ms", async () => {
    vi.useFakeTimers();
    const p = sleep(100);
    await vi.advanceTimersByTimeAsync(100);
    await expect(p).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
