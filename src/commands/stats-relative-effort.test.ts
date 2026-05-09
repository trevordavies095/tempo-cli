import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exitCodeForFetchFailure,
  exitCodeForHttpStatus,
} from "../exit/exits.js";
import { API_KEY_REDACTED } from "./auth-me.js";
import {
  buildStatsRelativeEffortPath,
  probeStatsRelativeEffort,
  statsRelativeEffortHttpErrorMessage,
  statsRelativeEffortHttpErrorMessageForCli,
  statsRelativeEffortHumanSuccessLine,
  statsRelativeEffortQueryFromCli,
} from "./stats-relative-effort.js";

const originalFetch = globalThis.fetch;
const SECRET_KEY = "tmp_secret_key_for_tests";

describe("buildStatsRelativeEffortPath", () => {
  it("returns bare path when no params", () => {
    expect(buildStatsRelativeEffortPath()).toBe("/stats/relative-effort");
    expect(buildStatsRelativeEffortPath({})).toBe("/stats/relative-effort");
  });

  it("renders signed integers in the camelCase query", () => {
    expect(
      buildStatsRelativeEffortPath({ timezoneOffsetMinutes: -300 }),
    ).toBe("/stats/relative-effort?timezoneOffsetMinutes=-300");
    expect(
      buildStatsRelativeEffortPath({ timezoneOffsetMinutes: 0 }),
    ).toBe("/stats/relative-effort?timezoneOffsetMinutes=0");
    expect(
      buildStatsRelativeEffortPath({ timezoneOffsetMinutes: 60 }),
    ).toBe("/stats/relative-effort?timezoneOffsetMinutes=60");
  });
});

describe("statsRelativeEffortQueryFromCli", () => {
  it("returns empty query when flag absent", () => {
    expect(statsRelativeEffortQueryFromCli({})).toEqual({ ok: {} });
  });

  it("accepts zero and negative integers", () => {
    expect(
      statsRelativeEffortQueryFromCli({ timezoneOffsetMinutes: "0" }),
    ).toEqual({ ok: { timezoneOffsetMinutes: 0 } });
    expect(
      statsRelativeEffortQueryFromCli({ timezoneOffsetMinutes: " -300 " }),
    ).toEqual({ ok: { timezoneOffsetMinutes: -300 } });
  });

  it("rejects non-integer tz offset", () => {
    expect(
      statsRelativeEffortQueryFromCli({ timezoneOffsetMinutes: "1.5" }),
    ).toEqual({
      error:
        "tempo stats relative-effort: timezone-offset-minutes must be an integer (int32)",
    });
  });

  it("rejects values outside int32 range", () => {
    expect(
      statsRelativeEffortQueryFromCli({
        timezoneOffsetMinutes: "2147483648",
      }),
    ).toEqual({
      error:
        "tempo stats relative-effort: timezone-offset-minutes must be within int32 range",
    });
  });
});

describe("probeStatsRelativeEffort", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("GET with query string, Authorization Bearer, credentials omit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await probeStatsRelativeEffort(
      "http://localhost:5001",
      SECRET_KEY,
      { timezoneOffsetMinutes: -300 },
    );
    expect(result).toEqual({ kind: "ok", status: 200, body: "{}" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://localhost:5001/stats/relative-effort?timezoneOffsetMinutes=-300",
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

    const result = await probeStatsRelativeEffort(
      "http://localhost:5001",
      SECRET_KEY,
    );
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      const msg = statsRelativeEffortHttpErrorMessageForCli(
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
    let result = await probeStatsRelativeEffort(
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
    result = await probeStatsRelativeEffort(
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

    const result = await probeStatsRelativeEffort(
      "http://localhost:5001",
      SECRET_KEY,
    );
    expect(result.kind).toBe("transport");
    if (result.kind === "transport") {
      expect(exitCodeForFetchFailure(result.error)).toBe(5);
    }
  });
});

describe("statsRelativeEffortHumanSuccessLine", () => {
  it("renders sorted key: value lines for JSON object", () => {
    const body = JSON.stringify({ currentWeek: 12, threeWeekAvg: 10.5 });
    expect(statsRelativeEffortHumanSuccessLine(200, body)).toBe(
      "OK (HTTP 200)\ncurrentWeek: 12\nthreeWeekAvg: 10.5",
    );
  });

  it("falls back to plain text for non-JSON body", () => {
    expect(statsRelativeEffortHumanSuccessLine(200, "raw")).toBe(
      "OK (HTTP 200)\nraw",
    );
  });

  it("returns just the OK header when body is empty", () => {
    expect(statsRelativeEffortHumanSuccessLine(200, "")).toBe(
      "OK (HTTP 200)",
    );
  });
});

describe("statsRelativeEffortHttpErrorMessage", () => {
  it("includes path and status with no params", () => {
    expect(statsRelativeEffortHttpErrorMessage(401, "")).toBe(
      "GET /stats/relative-effort returned 401",
    );
  });

  it("includes query when params provided", () => {
    expect(
      statsRelativeEffortHttpErrorMessage(400, "bad", {
        timezoneOffsetMinutes: -300,
      }),
    ).toBe(
      "GET /stats/relative-effort?timezoneOffsetMinutes=-300 returned 400: bad",
    );
  });
});
