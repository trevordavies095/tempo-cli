import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exitCodeForFetchFailure,
  exitCodeForHttpStatus,
} from "../exit/exits.js";
import { API_KEY_REDACTED } from "./auth-me.js";
import {
  buildStatsYearlyPath,
  probeStatsYearly,
  statsYearlyHttpErrorMessage,
  statsYearlyHttpErrorMessageForCli,
  statsYearlyHumanSuccessLine,
  statsYearlyQueryFromCli,
} from "./stats-yearly.js";

const originalFetch = globalThis.fetch;
const SECRET_KEY = "tmp_secret_key_for_tests";

describe("buildStatsYearlyPath", () => {
  it("returns bare path when no params", () => {
    expect(buildStatsYearlyPath()).toBe("/stats/yearly");
    expect(buildStatsYearlyPath({})).toBe("/stats/yearly");
  });

  it("uses OpenAPI camelCase query names with signed integers", () => {
    expect(buildStatsYearlyPath({ timezoneOffsetMinutes: -300 })).toBe(
      "/stats/yearly?timezoneOffsetMinutes=-300",
    );
    expect(buildStatsYearlyPath({ timezoneOffsetMinutes: 0 })).toBe(
      "/stats/yearly?timezoneOffsetMinutes=0",
    );
  });
});

describe("statsYearlyQueryFromCli", () => {
  it("returns empty query when flag absent", () => {
    expect(statsYearlyQueryFromCli({})).toEqual({ ok: {} });
  });

  it("accepts zero and negative integers", () => {
    expect(statsYearlyQueryFromCli({ timezoneOffsetMinutes: "0" })).toEqual({
      ok: { timezoneOffsetMinutes: 0 },
    });
    expect(
      statsYearlyQueryFromCli({ timezoneOffsetMinutes: " -480 " }),
    ).toEqual({ ok: { timezoneOffsetMinutes: -480 } });
  });

  it("rejects non-integer tz offset", () => {
    expect(statsYearlyQueryFromCli({ timezoneOffsetMinutes: "x" })).toEqual({
      error:
        "tempo stats yearly: timezone-offset-minutes must be an integer (int32)",
    });
  });

  it("rejects values outside int32 range", () => {
    expect(
      statsYearlyQueryFromCli({ timezoneOffsetMinutes: "-2147483649" }),
    ).toEqual({
      error:
        "tempo stats yearly: timezone-offset-minutes must be within int32 range",
    });
  });
});

describe("probeStatsYearly", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("GET with query string, Authorization Bearer, credentials omit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await probeStatsYearly(
      "http://localhost:5001",
      SECRET_KEY,
      { timezoneOffsetMinutes: 60 },
    );
    expect(result).toEqual({ kind: "ok", status: 200, body: "{}" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://localhost:5001/stats/yearly?timezoneOffsetMinutes=60",
    );
    expect(init.credentials).toBe("omit");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      `Bearer ${SECRET_KEY}`,
    );
  });

  it("redacts API key in HTTP error body for CLI message", async () => {
    const body = `nope ${SECRET_KEY}`;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(body, { status: 401 })) as typeof fetch;

    const result = await probeStatsYearly("http://localhost:5001", SECRET_KEY);
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      const msg = statsYearlyHttpErrorMessageForCli(
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
    let result = await probeStatsYearly("http://localhost:5001", SECRET_KEY);
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      expect(exitCodeForHttpStatus(result.status)).toBe(4);
    }

    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("x", { status: 503 })) as typeof fetch;
    result = await probeStatsYearly("http://localhost:5001", SECRET_KEY);
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

    const result = await probeStatsYearly("http://localhost:5001", SECRET_KEY);
    expect(result.kind).toBe("transport");
    if (result.kind === "transport") {
      expect(exitCodeForFetchFailure(result.error)).toBe(5);
    }
  });
});

describe("statsYearlyHumanSuccessLine", () => {
  it("prints ordered current/previous year lines when present", () => {
    const body = JSON.stringify({
      currentYear: { year: 2025, distance: 250 },
      previousYear: { year: 2024, distance: 312 },
    });
    expect(statsYearlyHumanSuccessLine(200, body)).toBe(
      [
        "OK (HTTP 200)",
        'currentYear: {"year":2025,"distance":250}',
        'previousYear: {"year":2024,"distance":312}',
      ].join("\n"),
    );
  });

  it("supports flat numeric keys like currentYearMiles", () => {
    const body = JSON.stringify({
      currentYearMiles: 250,
      previousYearMiles: 312,
    });
    expect(statsYearlyHumanSuccessLine(200, body)).toBe(
      [
        "OK (HTTP 200)",
        "currentYearMiles: 250",
        "previousYearMiles: 312",
      ].join("\n"),
    );
  });

  it("falls back to sorted key: value lines for unrecognized JSON object", () => {
    const body = JSON.stringify({ foo: 1, bar: 2 });
    expect(statsYearlyHumanSuccessLine(200, body)).toBe(
      "OK (HTTP 200)\nbar: 2\nfoo: 1",
    );
  });

  it("falls back to plain text for non-JSON body", () => {
    expect(statsYearlyHumanSuccessLine(200, "raw")).toBe(
      "OK (HTTP 200)\nraw",
    );
  });

  it("returns just the OK header when body is empty", () => {
    expect(statsYearlyHumanSuccessLine(200, "")).toBe("OK (HTTP 200)");
  });
});

describe("statsYearlyHttpErrorMessage", () => {
  it("includes path and status with no params", () => {
    expect(statsYearlyHttpErrorMessage(401, "")).toBe(
      "GET /stats/yearly returned 401",
    );
  });

  it("includes query when params provided", () => {
    expect(
      statsYearlyHttpErrorMessage(400, "bad", { timezoneOffsetMinutes: 60 }),
    ).toBe(
      "GET /stats/yearly?timezoneOffsetMinutes=60 returned 400: bad",
    );
  });
});
