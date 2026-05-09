import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exitCodeForFetchFailure,
  exitCodeForHttpStatus,
} from "../exit/exits.js";
import { API_KEY_REDACTED } from "./auth-me.js";
import {
  buildWorkoutsListPath,
  probeWorkoutsList,
  workoutsListHttpErrorMessage,
  workoutsListHttpErrorMessageForCli,
  workoutsListHumanSuccessLine,
  workoutsListQueryFromCli,
} from "./workouts-list.js";

const originalFetch = globalThis.fetch;
const SECRET_KEY = "tmp_secret_key_for_tests";

describe("buildWorkoutsListPath", () => {
  it("returns bare path when no params", () => {
    expect(buildWorkoutsListPath({})).toBe("/workouts");
  });

  it("uses OpenAPI camelCase query names", () => {
    const path = buildWorkoutsListPath({
      page: 2,
      pageSize: 10,
      keyword: "hill",
      minDistanceM: 1000.5,
      sortBy: "distance",
      sortOrder: "asc",
    });
    expect(path).toBe(
      "/workouts?page=2&pageSize=10&minDistanceM=1000.5&keyword=hill&sortBy=distance&sortOrder=asc",
    );
  });
});

describe("workoutsListQueryFromCli", () => {
  it("accepts valid flags and normalizes strings", () => {
    const r = workoutsListQueryFromCli({
      page: "1",
      pageSize: "20",
      startDate: " 2025-01-01T00:00:00Z ",
      keyword: "x",
    });
    expect(r).toEqual({
      ok: {
        page: 1,
        pageSize: 20,
        startDate: "2025-01-01T00:00:00Z",
        keyword: "x",
      },
    });
  });

  it("rejects non-integer page", () => {
    const r = workoutsListQueryFromCli({ page: "2.5" });
    expect(r).toEqual({
      error: "tempo workouts list: page must be a positive integer",
    });
  });

  it("rejects pageSize over API max", () => {
    const r = workoutsListQueryFromCli({ pageSize: "101" });
    expect(r).toEqual({
      error:
        "tempo workouts list: pageSize must be between 1 and 100 (API max)",
    });
  });

  it("rejects non-finite distance", () => {
    const r = workoutsListQueryFromCli({ minDistanceM: "nan" });
    expect(r).toEqual({
      error:
        "tempo workouts list: min-distance-m must be a finite number",
    });
  });
});

describe("probeWorkoutsList", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("GET with query string, Authorization Bearer, credentials omit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await probeWorkoutsList("http://localhost:5001", SECRET_KEY, {
      page: 3,
      keyword: "a b",
    });
    expect(result).toEqual({ kind: "ok", status: 200, body: "{}" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://localhost:5001/workouts?page=3&keyword=a+b",
    );
    expect(init.credentials).toBe("omit");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      `Bearer ${SECRET_KEY}`,
    );
  });

  it("redacts API key in HTTP error body for CLI message", async () => {
    const body = `invalid ${SECRET_KEY}`;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(body, { status: 401 })) as typeof fetch;

    const result = await probeWorkoutsList("http://localhost:5001", SECRET_KEY, {});
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      const msg = workoutsListHttpErrorMessageForCli(
        result.status,
        result.body,
        SECRET_KEY,
      );
      expect(msg).not.toContain(SECRET_KEY);
      expect(msg).toContain(API_KEY_REDACTED);
    }
  });

  it("maps 404 and 5xx for exit codes", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 404 })) as typeof fetch;
    let result = await probeWorkoutsList("http://localhost:5001", SECRET_KEY, {});
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      expect(exitCodeForHttpStatus(result.status)).toBe(4);
    }

    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("x", { status: 500 })) as typeof fetch;
    result = await probeWorkoutsList("http://localhost:5001", SECRET_KEY, {});
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      expect(exitCodeForHttpStatus(result.status)).toBe(3);
    }
  });

  it("returns transport kind when fetch throws", async () => {
    const cause = Object.assign(new Error("ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    const err = Object.assign(new TypeError("fetch failed"), { cause });
    globalThis.fetch = vi.fn().mockRejectedValue(err) as typeof fetch;

    const result = await probeWorkoutsList("http://localhost:5001", SECRET_KEY, {});
    expect(result.kind).toBe("transport");
    if (result.kind === "transport") {
      expect(exitCodeForFetchFailure(result.error)).toBe(5);
    }
  });
});

describe("workoutsListHumanSuccessLine", () => {
  it("formats paginated items with totals and compact rows", () => {
    const wid = "550e8400-e29b-41d4-a716-446655440000";
    const body = JSON.stringify({
      items: [
        {
          id: wid,
          name: "Morning",
          startedAt: "2025-01-01T12:00:00Z",
          distance: 5000,
          duration: 1800,
          runType: "Easy Run",
        },
      ],
      totalCount: 42,
    });
    expect(workoutsListHumanSuccessLine(200, body)).toBe(
      [
        "OK (HTTP 200)",
        "1 on this page (total 42)",
        `1. ${wid} | Morning | 2025-01-01T12:00:00Z | distance=5000 | duration=1800 | runType=Easy Run`,
      ].join("\n"),
    );
  });

  it("formats empty items array with total", () => {
    expect(
      workoutsListHumanSuccessLine(
        200,
        JSON.stringify({ items: [], totalCount: 0 }),
      ),
    ).toBe("OK (HTTP 200)\n0 on this page (total 0)");
  });

  it("formats root JSON array of workouts", () => {
    expect(
      workoutsListHumanSuccessLine(
        200,
        JSON.stringify([
          { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", name: "Solo" },
        ]),
      ),
    ).toBe(
      [
        "OK (HTTP 200)",
        "1 workout(s)",
        "1. aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee | Solo",
      ].join("\n"),
    );
  });

  it("falls back to sorted key lines for non-list-shaped JSON object", () => {
    expect(
      workoutsListHumanSuccessLine(200, JSON.stringify({ foo: 1, bar: 2 })),
    ).toBe("OK (HTTP 200)\nbar: 2\nfoo: 1");
  });
});

describe("workoutsListHttpErrorMessage", () => {
  it("includes path and status", () => {
    expect(workoutsListHttpErrorMessage(401, "")).toBe(
      "GET /workouts returned 401",
    );
  });
});
