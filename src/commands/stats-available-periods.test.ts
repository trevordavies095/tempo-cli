import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exitCodeForFetchFailure,
  exitCodeForHttpStatus,
} from "../exit/exits.js";
import { API_KEY_REDACTED } from "./auth-me.js";
import {
  buildStatsAvailablePeriodsPath,
  probeStatsAvailablePeriods,
  statsAvailablePeriodsHttpErrorMessage,
  statsAvailablePeriodsHttpErrorMessageForCli,
  statsAvailablePeriodsHumanSuccessLine,
  statsAvailablePeriodsQueryFromCli,
} from "./stats-available-periods.js";

const originalFetch = globalThis.fetch;
const SECRET_KEY = "tmp_secret_key_for_tests";

describe("buildStatsAvailablePeriodsPath", () => {
  it("returns bare path when no params", () => {
    expect(buildStatsAvailablePeriodsPath()).toBe("/stats/available-periods");
    expect(buildStatsAvailablePeriodsPath({})).toBe(
      "/stats/available-periods",
    );
  });

  it("renders signed integers in the camelCase query", () => {
    expect(
      buildStatsAvailablePeriodsPath({ timezoneOffsetMinutes: -300 }),
    ).toBe("/stats/available-periods?timezoneOffsetMinutes=-300");
    expect(
      buildStatsAvailablePeriodsPath({ timezoneOffsetMinutes: 0 }),
    ).toBe("/stats/available-periods?timezoneOffsetMinutes=0");
  });
});

describe("statsAvailablePeriodsQueryFromCli", () => {
  it("returns empty query when flag absent", () => {
    expect(statsAvailablePeriodsQueryFromCli({})).toEqual({ ok: {} });
  });

  it("accepts zero and negative integers", () => {
    expect(
      statsAvailablePeriodsQueryFromCli({ timezoneOffsetMinutes: "0" }),
    ).toEqual({ ok: { timezoneOffsetMinutes: 0 } });
    expect(
      statsAvailablePeriodsQueryFromCli({ timezoneOffsetMinutes: " -480 " }),
    ).toEqual({ ok: { timezoneOffsetMinutes: -480 } });
  });

  it("rejects non-integer tz offset", () => {
    expect(
      statsAvailablePeriodsQueryFromCli({ timezoneOffsetMinutes: "abc" }),
    ).toEqual({
      error:
        "tempo stats available-periods: timezone-offset-minutes must be an integer (int32)",
    });
  });

  it("rejects values outside int32 range", () => {
    expect(
      statsAvailablePeriodsQueryFromCli({
        timezoneOffsetMinutes: "-2147483649",
      }),
    ).toEqual({
      error:
        "tempo stats available-periods: timezone-offset-minutes must be within int32 range",
    });
  });
});

describe("probeStatsAvailablePeriods", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("GET with query string, Authorization Bearer, credentials omit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("[]", { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await probeStatsAvailablePeriods(
      "http://localhost:5001",
      SECRET_KEY,
      { timezoneOffsetMinutes: 60 },
    );
    expect(result).toEqual({ kind: "ok", status: 200, body: "[]" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://localhost:5001/stats/available-periods?timezoneOffsetMinutes=60",
    );
    expect(init.credentials).toBe("omit");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      `Bearer ${SECRET_KEY}`,
    );
  });

  it("redacts API key in HTTP error body for CLI message", async () => {
    const body = `bad ${SECRET_KEY}`;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(body, { status: 401 })) as typeof fetch;

    const result = await probeStatsAvailablePeriods(
      "http://localhost:5001",
      SECRET_KEY,
    );
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      const msg = statsAvailablePeriodsHttpErrorMessageForCli(
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
    let result = await probeStatsAvailablePeriods(
      "http://localhost:5001",
      SECRET_KEY,
    );
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      expect(exitCodeForHttpStatus(result.status)).toBe(4);
    }

    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("x", { status: 500 })) as typeof fetch;
    result = await probeStatsAvailablePeriods(
      "http://localhost:5001",
      SECRET_KEY,
    );
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      expect(exitCodeForHttpStatus(result.status)).toBe(3);
    }
  });

  it("returns transport when fetch throws", async () => {
    const cause = Object.assign(new Error("ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    const err = Object.assign(new TypeError("fetch failed"), { cause });
    globalThis.fetch = vi.fn().mockRejectedValue(err) as typeof fetch;

    const result = await probeStatsAvailablePeriods(
      "http://localhost:5001",
      SECRET_KEY,
    );
    expect(result.kind).toBe("transport");
    if (result.kind === "transport") {
      expect(exitCodeForFetchFailure(result.error)).toBe(5);
    }
  });
});

describe("statsAvailablePeriodsHumanSuccessLine", () => {
  it("renders sorted key: value lines for JSON object", () => {
    const body = JSON.stringify({ count: 3, oldest: "2022-01-01" });
    expect(statsAvailablePeriodsHumanSuccessLine(200, body)).toBe(
      "OK (HTTP 200)\ncount: 3\noldest: 2022-01-01",
    );
  });

  it("falls back to plain text for non-JSON body", () => {
    expect(statsAvailablePeriodsHumanSuccessLine(200, "raw")).toBe(
      "OK (HTTP 200)\nraw",
    );
  });

  it("returns just the OK header when body is empty", () => {
    expect(statsAvailablePeriodsHumanSuccessLine(200, "")).toBe(
      "OK (HTTP 200)",
    );
  });
});

describe("statsAvailablePeriodsHttpErrorMessage", () => {
  it("includes path and status with no params", () => {
    expect(statsAvailablePeriodsHttpErrorMessage(401, "")).toBe(
      "GET /stats/available-periods returned 401",
    );
  });

  it("includes query when params provided", () => {
    expect(
      statsAvailablePeriodsHttpErrorMessage(400, "", {
        timezoneOffsetMinutes: 60,
      }),
    ).toBe(
      "GET /stats/available-periods?timezoneOffsetMinutes=60 returned 400",
    );
  });
});
