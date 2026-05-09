import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exitCodeForFetchFailure,
  exitCodeForHttpStatus,
} from "../exit/exits.js";
import { API_KEY_REDACTED } from "./auth-me.js";
import {
  buildStatsYearlyWeeklyPath,
  probeStatsYearlyWeekly,
  statsYearlyWeeklyHttpErrorMessage,
  statsYearlyWeeklyHttpErrorMessageForCli,
  statsYearlyWeeklyHumanSuccessLine,
  statsYearlyWeeklyQueryFromCli,
} from "./stats-yearly-weekly.js";

const originalFetch = globalThis.fetch;
const SECRET_KEY = "tmp_secret_key_for_tests";

describe("buildStatsYearlyWeeklyPath", () => {
  it("returns bare path when no params", () => {
    expect(buildStatsYearlyWeeklyPath()).toBe("/stats/yearly-weekly");
    expect(buildStatsYearlyWeeklyPath({})).toBe("/stats/yearly-weekly");
  });

  it("uses OpenAPI camelCase query names with both flags", () => {
    expect(
      buildStatsYearlyWeeklyPath({
        periodEndDate: "2025-12-31",
        timezoneOffsetMinutes: -300,
      }),
    ).toBe(
      "/stats/yearly-weekly?periodEndDate=2025-12-31&timezoneOffsetMinutes=-300",
    );
  });

  it("emits only the flag that was set", () => {
    expect(
      buildStatsYearlyWeeklyPath({ periodEndDate: "2025-06-01" }),
    ).toBe("/stats/yearly-weekly?periodEndDate=2025-06-01");
    expect(
      buildStatsYearlyWeeklyPath({ timezoneOffsetMinutes: 0 }),
    ).toBe("/stats/yearly-weekly?timezoneOffsetMinutes=0");
  });
});

describe("statsYearlyWeeklyQueryFromCli", () => {
  it("returns empty query when nothing is passed", () => {
    expect(statsYearlyWeeklyQueryFromCli({})).toEqual({ ok: {} });
  });

  it("trims periodEndDate and accepts signed integers", () => {
    expect(
      statsYearlyWeeklyQueryFromCli({
        periodEndDate: "  2025-12-31 ",
        timezoneOffsetMinutes: " -480 ",
      }),
    ).toEqual({
      ok: {
        periodEndDate: "2025-12-31",
        timezoneOffsetMinutes: -480,
      },
    });
  });

  it("ignores empty periodEndDate", () => {
    expect(
      statsYearlyWeeklyQueryFromCli({ periodEndDate: "   " }),
    ).toEqual({ ok: {} });
  });

  it("rejects non-integer tz offset", () => {
    expect(
      statsYearlyWeeklyQueryFromCli({ timezoneOffsetMinutes: "abc" }),
    ).toEqual({
      error:
        "tempo stats yearly-weekly: timezone-offset-minutes must be an integer (int32)",
    });
  });

  it("rejects values outside int32 range", () => {
    expect(
      statsYearlyWeeklyQueryFromCli({ timezoneOffsetMinutes: "2147483648" }),
    ).toEqual({
      error:
        "tempo stats yearly-weekly: timezone-offset-minutes must be within int32 range",
    });
  });
});

describe("probeStatsYearlyWeekly", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("GET with query string, Authorization Bearer, credentials omit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await probeStatsYearlyWeekly(
      "http://localhost:5001",
      SECRET_KEY,
      { periodEndDate: "2025-12-31", timezoneOffsetMinutes: -300 },
    );
    expect(result).toEqual({ kind: "ok", status: 200, body: "{}" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://localhost:5001/stats/yearly-weekly?periodEndDate=2025-12-31&timezoneOffsetMinutes=-300",
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

    const result = await probeStatsYearlyWeekly(
      "http://localhost:5001",
      SECRET_KEY,
    );
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      const msg = statsYearlyWeeklyHttpErrorMessageForCli(
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
    let result = await probeStatsYearlyWeekly(
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
    result = await probeStatsYearlyWeekly(
      "http://localhost:5001",
      SECRET_KEY,
    );
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

    const result = await probeStatsYearlyWeekly(
      "http://localhost:5001",
      SECRET_KEY,
    );
    expect(result.kind).toBe("transport");
    if (result.kind === "transport") {
      expect(exitCodeForFetchFailure(result.error)).toBe(5);
    }
  });
});

describe("statsYearlyWeeklyHumanSuccessLine", () => {
  it("formats an array of weeks with numbered rows", () => {
    const body = JSON.stringify([
      { weekStart: "2025-01-06", distance: 12000, count: 4 },
      { weekStart: "2025-01-13", distance: 8000 },
    ]);
    expect(statsYearlyWeeklyHumanSuccessLine(200, body)).toBe(
      [
        "OK (HTTP 200)",
        "2 week(s)",
        "1. 2025-01-06 | distance=12000 | count=4",
        "2. 2025-01-13 | distance=8000",
      ].join("\n"),
    );
  });

  it("renders an inner weeks array on objects", () => {
    const body = JSON.stringify({
      weeks: [{ weekStart: "2025-01-06", distance: 12000 }],
    });
    expect(statsYearlyWeeklyHumanSuccessLine(200, body)).toBe(
      [
        "OK (HTTP 200)",
        "1 week(s)",
        "1. 2025-01-06 | distance=12000",
      ].join("\n"),
    );
  });

  it("caps rows at 20 and reports remainder for a 52-week year", () => {
    const rows = Array.from({ length: 52 }, (_, i) => ({
      weekStart: `2025-w${i}`,
    }));
    const out = statsYearlyWeeklyHumanSuccessLine(200, JSON.stringify(rows));
    expect(out).toContain("52 week(s)");
    expect(out).toContain("… and 32 more");
    expect(out.split("\n").filter((l) => /^\d+\./.test(l))).toHaveLength(20);
  });

  it("falls back to sorted key: value lines for unrecognized JSON object", () => {
    const body = JSON.stringify({ buckets: 52, totalMiles: 312.4 });
    expect(statsYearlyWeeklyHumanSuccessLine(200, body)).toBe(
      "OK (HTTP 200)\nbuckets: 52\ntotalMiles: 312.4",
    );
  });

  it("falls back to plain text for non-JSON body", () => {
    expect(statsYearlyWeeklyHumanSuccessLine(200, "raw")).toBe(
      "OK (HTTP 200)\nraw",
    );
  });

  it("returns just the OK header when body is empty", () => {
    expect(statsYearlyWeeklyHumanSuccessLine(200, "")).toBe(
      "OK (HTTP 200)",
    );
  });
});

describe("statsYearlyWeeklyHttpErrorMessage", () => {
  it("includes path and status with no params", () => {
    expect(statsYearlyWeeklyHttpErrorMessage(401, "")).toBe(
      "GET /stats/yearly-weekly returned 401",
    );
  });

  it("includes the full query when params provided", () => {
    expect(
      statsYearlyWeeklyHttpErrorMessage(400, "", {
        periodEndDate: "2025-06-01",
        timezoneOffsetMinutes: 60,
      }),
    ).toBe(
      "GET /stats/yearly-weekly?periodEndDate=2025-06-01&timezoneOffsetMinutes=60 returned 400",
    );
  });
});
