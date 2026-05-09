import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exitCodeForFetchFailure,
  exitCodeForHttpStatus,
} from "../exit/exits.js";
import { API_KEY_REDACTED } from "./auth-me.js";
import {
  probeStatsAvailableYears,
  statsAvailableYearsHttpErrorMessage,
  statsAvailableYearsHttpErrorMessageForCli,
  statsAvailableYearsHumanSuccessLine,
} from "./stats-available-years.js";

const originalFetch = globalThis.fetch;
const SECRET_KEY = "tmp_secret_key_for_tests";

describe("probeStatsAvailableYears", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("GET /stats/available-years with Authorization Bearer, credentials omit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("[2024,2025]", { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await probeStatsAvailableYears(
      "http://localhost:5001",
      SECRET_KEY,
    );
    expect(result).toEqual({ kind: "ok", status: 200, body: "[2024,2025]" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:5001/stats/available-years");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("omit");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      `Bearer ${SECRET_KEY}`,
    );
  });

  it("redacts API key in HTTP error body for CLI message", async () => {
    const body = `denied ${SECRET_KEY}`;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(body, { status: 401 })) as typeof fetch;

    const result = await probeStatsAvailableYears(
      "http://localhost:5001",
      SECRET_KEY,
    );
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      const msg = statsAvailableYearsHttpErrorMessageForCli(
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
    let result = await probeStatsAvailableYears(
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
    result = await probeStatsAvailableYears(
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

    const result = await probeStatsAvailableYears(
      "http://localhost:5001",
      SECRET_KEY,
    );
    expect(result.kind).toBe("transport");
    if (result.kind === "transport") {
      expect(exitCodeForFetchFailure(result.error)).toBe(5);
    }
  });
});

describe("statsAvailableYearsHumanSuccessLine", () => {
  it("formats an array of primitive years as a single line", () => {
    const body = JSON.stringify([2025, 2024, 2023]);
    expect(statsAvailableYearsHumanSuccessLine(200, body)).toBe(
      "OK (HTTP 200)\nYears: 2025, 2024, 2023",
    );
  });

  it("appends `… and N more` when the year list exceeds the cap", () => {
    const years = Array.from({ length: 22 }, (_, i) => 2025 - i);
    const out = statsAvailableYearsHumanSuccessLine(
      200,
      JSON.stringify(years),
    );
    expect(out.startsWith("OK (HTTP 200)\nYears: 2025, ")).toBe(true);
    expect(out).toContain("(… and 2 more)");
  });

  it("formats arrays of year objects with numbered rows", () => {
    const body = JSON.stringify([
      { year: 2025, distance: 1200 },
      { year: 2024, distance: 950 },
    ]);
    expect(statsAvailableYearsHumanSuccessLine(200, body)).toBe(
      [
        "OK (HTTP 200)",
        "2 year(s)",
        "1. 2025 | distance=1200",
        "2. 2024 | distance=950",
      ].join("\n"),
    );
  });

  it("renders an inner years array on objects", () => {
    const body = JSON.stringify({ years: [2025, 2024] });
    expect(statsAvailableYearsHumanSuccessLine(200, body)).toBe(
      "OK (HTTP 200)\nYears: 2025, 2024",
    );
  });

  it("falls back to sorted key: value lines for unrecognized JSON object", () => {
    const body = JSON.stringify({ count: 4, latest: 2025 });
    expect(statsAvailableYearsHumanSuccessLine(200, body)).toBe(
      "OK (HTTP 200)\ncount: 4\nlatest: 2025",
    );
  });

  it("falls back to plain text for non-JSON body", () => {
    expect(statsAvailableYearsHumanSuccessLine(200, "raw")).toBe(
      "OK (HTTP 200)\nraw",
    );
  });

  it("returns just the OK header when body is empty", () => {
    expect(statsAvailableYearsHumanSuccessLine(200, "")).toBe(
      "OK (HTTP 200)",
    );
  });
});

describe("statsAvailableYearsHttpErrorMessage", () => {
  it("includes path and status", () => {
    expect(statsAvailableYearsHttpErrorMessage(401, "")).toBe(
      "GET /stats/available-years returned 401",
    );
  });

  it("appends a snippet of the body when present", () => {
    expect(statsAvailableYearsHttpErrorMessage(500, "boom")).toBe(
      "GET /stats/available-years returned 500: boom",
    );
  });
});
