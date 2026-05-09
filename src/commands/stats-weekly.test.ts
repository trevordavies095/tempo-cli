import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exitCodeForFetchFailure,
  exitCodeForHttpStatus,
} from "../exit/exits.js";
import { API_KEY_REDACTED } from "./auth-me.js";
import {
  buildStatsWeeklyPath,
  probeStatsWeekly,
  statsWeeklyHttpErrorMessage,
  statsWeeklyHttpErrorMessageForCli,
  statsWeeklyHumanSuccessLine,
  statsWeeklyQueryFromCli,
} from "./stats-weekly.js";

const originalFetch = globalThis.fetch;
const SECRET_KEY = "tmp_secret_key_for_tests";

describe("buildStatsWeeklyPath", () => {
  it("returns bare path when no params", () => {
    expect(buildStatsWeeklyPath()).toBe("/stats/weekly");
    expect(buildStatsWeeklyPath({})).toBe("/stats/weekly");
  });

  it("uses OpenAPI camelCase query names with signed integers", () => {
    expect(buildStatsWeeklyPath({ timezoneOffsetMinutes: -300 })).toBe(
      "/stats/weekly?timezoneOffsetMinutes=-300",
    );
    expect(buildStatsWeeklyPath({ timezoneOffsetMinutes: 0 })).toBe(
      "/stats/weekly?timezoneOffsetMinutes=0",
    );
    expect(buildStatsWeeklyPath({ timezoneOffsetMinutes: 60 })).toBe(
      "/stats/weekly?timezoneOffsetMinutes=60",
    );
  });
});

describe("statsWeeklyQueryFromCli", () => {
  it("returns empty query when flag absent", () => {
    expect(statsWeeklyQueryFromCli({})).toEqual({ ok: {} });
  });

  it("accepts zero and negative integers", () => {
    expect(statsWeeklyQueryFromCli({ timezoneOffsetMinutes: "0" })).toEqual({
      ok: { timezoneOffsetMinutes: 0 },
    });
    expect(
      statsWeeklyQueryFromCli({ timezoneOffsetMinutes: " -300 " }),
    ).toEqual({ ok: { timezoneOffsetMinutes: -300 } });
  });

  it("rejects non-integer tz offset", () => {
    expect(
      statsWeeklyQueryFromCli({ timezoneOffsetMinutes: "1.5" }),
    ).toEqual({
      error:
        "tempo stats weekly: timezone-offset-minutes must be an integer (int32)",
    });
    expect(statsWeeklyQueryFromCli({ timezoneOffsetMinutes: "abc" })).toEqual({
      error:
        "tempo stats weekly: timezone-offset-minutes must be an integer (int32)",
    });
  });

  it("rejects values outside int32 range", () => {
    expect(
      statsWeeklyQueryFromCli({ timezoneOffsetMinutes: "2147483648" }),
    ).toEqual({
      error:
        "tempo stats weekly: timezone-offset-minutes must be within int32 range",
    });
  });
});

describe("probeStatsWeekly", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("GET with query string, Authorization Bearer, credentials omit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await probeStatsWeekly(
      "http://localhost:5001",
      SECRET_KEY,
      { timezoneOffsetMinutes: -300 },
    );
    expect(result).toEqual({ kind: "ok", status: 200, body: "{}" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://localhost:5001/stats/weekly?timezoneOffsetMinutes=-300",
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

    const result = await probeStatsWeekly("http://localhost:5001", SECRET_KEY);
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      const msg = statsWeeklyHttpErrorMessageForCli(
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
    let result = await probeStatsWeekly("http://localhost:5001", SECRET_KEY);
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      expect(exitCodeForHttpStatus(result.status)).toBe(4);
    }

    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("x", { status: 500 })) as typeof fetch;
    result = await probeStatsWeekly("http://localhost:5001", SECRET_KEY);
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

    const result = await probeStatsWeekly("http://localhost:5001", SECRET_KEY);
    expect(result.kind).toBe("transport");
    if (result.kind === "transport") {
      expect(exitCodeForFetchFailure(result.error)).toBe(5);
    }
  });
});

describe("statsWeeklyHumanSuccessLine", () => {
  it("formats a 7-day array with numbered rows", () => {
    const body = JSON.stringify([
      { date: "2025-01-06", distance: 5000, duration: 1800 },
      { date: "2025-01-07", distance: 0 },
    ]);
    expect(statsWeeklyHumanSuccessLine(200, body)).toBe(
      [
        "OK (HTTP 200)",
        "2 day(s)",
        "1. 2025-01-06 | distance=5000 | duration=1800",
        "2. 2025-01-07 | distance=0",
      ].join("\n"),
    );
  });

  it("renders an inner days array on objects", () => {
    const body = JSON.stringify({
      days: [{ day: "Mon", distance: 5000 }],
      totalMiles: 12.5,
    });
    expect(statsWeeklyHumanSuccessLine(200, body)).toBe(
      ["OK (HTTP 200)", "1 day(s)", "1. Mon | distance=5000"].join("\n"),
    );
  });

  it("caps rows at 20 and reports remainder", () => {
    const rows = Array.from({ length: 22 }, (_, i) => ({ date: `d${i}` }));
    const out = statsWeeklyHumanSuccessLine(200, JSON.stringify(rows));
    expect(out).toContain("22 day(s)");
    expect(out).toContain("… and 2 more");
    expect(out.split("\n").filter((l) => /^\d+\./.test(l))).toHaveLength(20);
  });

  it("falls back to sorted key: value lines for unrecognized JSON object", () => {
    const body = JSON.stringify({ totalMiles: 12.5, weeks: 4 });
    expect(statsWeeklyHumanSuccessLine(200, body)).toBe(
      "OK (HTTP 200)\ntotalMiles: 12.5\nweeks: 4",
    );
  });

  it("falls back to plain text for non-JSON body", () => {
    expect(statsWeeklyHumanSuccessLine(200, "plain")).toBe(
      "OK (HTTP 200)\nplain",
    );
  });

  it("returns just the OK header when body is empty", () => {
    expect(statsWeeklyHumanSuccessLine(200, "")).toBe("OK (HTTP 200)");
  });
});

describe("statsWeeklyHttpErrorMessage", () => {
  it("includes path and status with no params", () => {
    expect(statsWeeklyHttpErrorMessage(401, "")).toBe(
      "GET /stats/weekly returned 401",
    );
  });

  it("includes query when params provided", () => {
    expect(
      statsWeeklyHttpErrorMessage(400, "", { timezoneOffsetMinutes: -300 }),
    ).toBe("GET /stats/weekly?timezoneOffsetMinutes=-300 returned 400");
  });
});
