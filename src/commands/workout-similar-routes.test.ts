import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exitCodeForFetchFailure,
  exitCodeForHttpStatus,
} from "../exit/exits.js";
import { API_KEY_REDACTED } from "./auth-me.js";
import {
  buildWorkoutSimilarRoutesPath,
  probeWorkoutSimilarRoutes,
  similarRoutesQueryFromCli,
  workoutSimilarRoutesHttpErrorMessage,
  workoutSimilarRoutesHttpErrorMessageForCli,
  workoutSimilarRoutesHumanSuccessLine,
} from "./workout-similar-routes.js";

const originalFetch = globalThis.fetch;
const SECRET_KEY = "tmp_secret_key_for_tests";
const SAMPLE_UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("buildWorkoutSimilarRoutesPath", () => {
  it("omits query when maxResults unset", () => {
    expect(buildWorkoutSimilarRoutesPath(SAMPLE_UUID)).toBe(
      `/workouts/${SAMPLE_UUID}/similar-routes`,
    );
  });

  it("adds maxResults query param", () => {
    expect(
      buildWorkoutSimilarRoutesPath(SAMPLE_UUID, { maxResults: 5 }),
    ).toBe(`/workouts/${SAMPLE_UUID}/similar-routes?maxResults=5`);
  });
});

describe("similarRoutesQueryFromCli", () => {
  it("accepts valid max-results", () => {
    expect(similarRoutesQueryFromCli({ maxResults: "12" })).toEqual({
      ok: { maxResults: 12 },
    });
  });

  it("rejects non-integer max-results", () => {
    expect(similarRoutesQueryFromCli({ maxResults: "x" })).toEqual({
      error:
        "tempo workout similar-routes: max-results must be a positive integer",
    });
  });
});

describe("probeWorkoutSimilarRoutes", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("GET with Bearer and credentials omit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("[]", { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await probeWorkoutSimilarRoutes(
      "http://localhost:5001",
      SECRET_KEY,
      SAMPLE_UUID,
      { maxResults: 3 },
    );
    expect(result).toEqual({ kind: "ok", status: 200, body: "[]" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `http://localhost:5001/workouts/${SAMPLE_UUID}/similar-routes?maxResults=3`,
    );
    expect(init.credentials).toBe("omit");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      `Bearer ${SECRET_KEY}`,
    );
  });

  it("redacts API key in error body for CLI message", async () => {
    const body = `err ${SECRET_KEY}`;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(body, { status: 401 })) as typeof fetch;

    const result = await probeWorkoutSimilarRoutes(
      "http://localhost:5001",
      SECRET_KEY,
      SAMPLE_UUID,
    );
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      const msg = workoutSimilarRoutesHttpErrorMessageForCli(
        result.status,
        result.body,
        SECRET_KEY,
        SAMPLE_UUID,
      );
      expect(msg).not.toContain(SECRET_KEY);
      expect(msg).toContain(API_KEY_REDACTED);
    }
  });

  it("maps 404 to exit 4", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 404 })) as typeof fetch;

    const result = await probeWorkoutSimilarRoutes(
      "http://localhost:5001",
      SECRET_KEY,
      SAMPLE_UUID,
    );
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      expect(exitCodeForHttpStatus(result.status)).toBe(4);
    }
  });

  it("returns transport when fetch throws", async () => {
    const cause = Object.assign(new Error("ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    const err = Object.assign(new TypeError("fetch failed"), { cause });
    globalThis.fetch = vi.fn().mockRejectedValue(err) as typeof fetch;

    const result = await probeWorkoutSimilarRoutes(
      "http://localhost:5001",
      SECRET_KEY,
      SAMPLE_UUID,
    );
    expect(result.kind).toBe("transport");
    if (result.kind === "transport") {
      expect(exitCodeForFetchFailure(result.error)).toBe(5);
    }
  });
});

describe("workoutSimilarRoutesHumanSuccessLine", () => {
  it("formats array of objects with numbered rows", () => {
    const body = JSON.stringify([
      {
        workoutId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        name: "A",
        startedAt: "2025-01-01T00:00:00Z",
        distance: 5000,
        duration: 1800,
      },
    ]);
    expect(workoutSimilarRoutesHumanSuccessLine(200, body)).toBe(
      [
        "OK (HTTP 200)",
        "1 similar route(s)",
        "1. aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee | A | 2025-01-01T00:00:00Z | distance=5000 | duration=1800",
      ].join("\n"),
    );
  });

  it("caps rows at 20 and reports remainder", () => {
    const rows = Array.from({ length: 22 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    }));
    const body = JSON.stringify(rows);
    const out = workoutSimilarRoutesHumanSuccessLine(200, body);
    expect(out).toContain("22 similar route(s)");
    expect(out).toContain("… and 2 more");
    expect(out.split("\n").filter((l) => /^\d+\./.test(l))).toHaveLength(20);
  });

  it("formats plain object with humanLinesFromApiBody", () => {
    const body = JSON.stringify({ count: 2, items: [] });
    const out = workoutSimilarRoutesHumanSuccessLine(200, body);
    expect(out.startsWith("OK (HTTP 200)\n")).toBe(true);
    expect(out).toContain("count:");
    expect(out).toContain("items:");
  });
});

describe("workoutSimilarRoutesHttpErrorMessage", () => {
  it("includes full path with query when maxResults set", () => {
    expect(
      workoutSimilarRoutesHttpErrorMessage(400, "", SAMPLE_UUID, {
        maxResults: 2,
      }),
    ).toBe(
      `GET /workouts/${SAMPLE_UUID}/similar-routes?maxResults=2 returned 400`,
    );
  });
});
