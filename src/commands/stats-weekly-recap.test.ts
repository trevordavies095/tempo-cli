import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exitCodeForFetchFailure,
  exitCodeForHttpStatus,
} from "../exit/exits.js";
import { API_KEY_REDACTED } from "./auth-me.js";
import {
  buildStatsWeeklyRecapPath,
  probeStatsWeeklyRecap,
  statsWeeklyRecapHttpErrorMessage,
  statsWeeklyRecapHttpErrorMessageForCli,
  statsWeeklyRecapHumanSuccessLine,
  statsWeeklyRecapQueryFromCli,
} from "./stats-weekly-recap.js";

const originalFetch = globalThis.fetch;
const SECRET_KEY = "tmp_secret_key_for_tests";

describe("buildStatsWeeklyRecapPath", () => {
  it("returns bare path when no params", () => {
    expect(buildStatsWeeklyRecapPath()).toBe("/stats/weekly-recap");
    expect(buildStatsWeeklyRecapPath({})).toBe("/stats/weekly-recap");
  });

  it("renders timezoneOffsetMinutes and referenceDate in camelCase query", () => {
    expect(
      buildStatsWeeklyRecapPath({
        timezoneOffsetMinutes: -300,
        referenceDate: "2026-04-27",
      }),
    ).toBe(
      "/stats/weekly-recap?timezoneOffsetMinutes=-300&referenceDate=2026-04-27",
    );
    expect(
      buildStatsWeeklyRecapPath({ timezoneOffsetMinutes: 0 }),
    ).toBe("/stats/weekly-recap?timezoneOffsetMinutes=0");
  });
});

describe("statsWeeklyRecapQueryFromCli", () => {
  it("returns empty query when flags absent", () => {
    expect(statsWeeklyRecapQueryFromCli({})).toEqual({ ok: {} });
  });

  it("accepts reference-date YYYY-MM-DD", () => {
    expect(
      statsWeeklyRecapQueryFromCli({ referenceDate: "2026-05-03" }),
    ).toEqual({ ok: { referenceDate: "2026-05-03" } });
  });

  it("rejects invalid reference-date", () => {
    expect(
      statsWeeklyRecapQueryFromCli({ referenceDate: "05-03-2026" }),
    ).toEqual({
      error: "tempo stats weekly-recap: reference-date must be YYYY-MM-DD",
    });
  });

  it("rejects non-integer tz offset", () => {
    expect(
      statsWeeklyRecapQueryFromCli({ timezoneOffsetMinutes: "x" }),
    ).toEqual({
      error:
        "tempo stats weekly-recap: timezone-offset-minutes must be an integer (int32)",
    });
  });
});

describe("probeStatsWeeklyRecap", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("GET with query string, Authorization Bearer, credentials omit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await probeStatsWeeklyRecap(
      "http://localhost:5001",
      SECRET_KEY,
      { timezoneOffsetMinutes: -300, referenceDate: "2026-04-27" },
    );
    expect(result).toEqual({ kind: "ok", status: 200, body: "{}" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://localhost:5001/stats/weekly-recap?timezoneOffsetMinutes=-300&referenceDate=2026-04-27",
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

    const result = await probeStatsWeeklyRecap(
      "http://localhost:5001",
      SECRET_KEY,
    );
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      const msg = statsWeeklyRecapHttpErrorMessageForCli(
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
    let result = await probeStatsWeeklyRecap(
      "http://localhost:5001",
      SECRET_KEY,
    );
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      expect(exitCodeForHttpStatus(result.status)).toBe(4);
    }

    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("x", { status: 503 })) as typeof fetch;
    result = await probeStatsWeeklyRecap(
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

    const result = await probeStatsWeeklyRecap(
      "http://localhost:5001",
      SECRET_KEY,
    );
    expect(result.kind).toBe("transport");
    if (result.kind === "transport") {
      expect(exitCodeForFetchFailure(result.error)).toBe(5);
    }
  });
});

describe("statsWeeklyRecapHumanSuccessLine", () => {
  it("prints top-level fields and metrics block count", () => {
    const body = JSON.stringify({
      weekStart: "2026-04-27",
      weekEnd: "2026-05-03",
      referenceDate: "2026-04-27",
      currentWeekIsPartial: false,
      generatedAtUtc: "2026-05-10T12:00:00Z",
      metrics: { runs: {}, distanceM: {} },
    });
    expect(statsWeeklyRecapHumanSuccessLine(200, body)).toBe(
      [
        "OK (HTTP 200)",
        "weekStart: 2026-04-27",
        "weekEnd: 2026-05-03",
        "referenceDate: 2026-04-27",
        "currentWeekIsPartial: false",
        "generatedAtUtc: 2026-05-10T12:00:00Z",
        "metrics: 2 blocks",
      ].join("\n"),
    );
  });

  it("falls back to sorted key: value for unrecognized JSON object", () => {
    const body = JSON.stringify({ foo: 1, bar: 2 });
    expect(statsWeeklyRecapHumanSuccessLine(200, body)).toBe(
      "OK (HTTP 200)\nbar: 2\nfoo: 1",
    );
  });
});

describe("statsWeeklyRecapHttpErrorMessage", () => {
  it("includes path and status with no params", () => {
    expect(statsWeeklyRecapHttpErrorMessage(401, "")).toBe(
      "GET /stats/weekly-recap returned 401",
    );
  });

  it("includes query when params provided", () => {
    expect(
      statsWeeklyRecapHttpErrorMessage(400, "bad", {
        timezoneOffsetMinutes: -300,
        referenceDate: "2026-04-27",
      }),
    ).toBe(
      "GET /stats/weekly-recap?timezoneOffsetMinutes=-300&referenceDate=2026-04-27 returned 400: bad",
    );
  });
});
