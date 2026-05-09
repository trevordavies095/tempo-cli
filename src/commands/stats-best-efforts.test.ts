import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exitCodeForFetchFailure,
  exitCodeForHttpStatus,
} from "../exit/exits.js";
import { API_KEY_REDACTED } from "./auth-me.js";
import {
  probeStatsBestEfforts,
  statsBestEffortsHttpErrorMessage,
  statsBestEffortsHttpErrorMessageForCli,
  statsBestEffortsHumanSuccessLine,
} from "./stats-best-efforts.js";

const originalFetch = globalThis.fetch;
const SECRET_KEY = "tmp_secret_key_for_tests";

describe("probeStatsBestEfforts", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("GET /stats/best-efforts with Authorization Bearer, credentials omit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await probeStatsBestEfforts(
      "http://localhost:5001",
      SECRET_KEY,
    );
    expect(result).toEqual({ kind: "ok", status: 200, body: "{}" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:5001/stats/best-efforts");
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

    const result = await probeStatsBestEfforts(
      "http://localhost:5001",
      SECRET_KEY,
    );
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      const msg = statsBestEffortsHttpErrorMessageForCli(
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
    let result = await probeStatsBestEfforts(
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
    result = await probeStatsBestEfforts(
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

    const result = await probeStatsBestEfforts(
      "http://localhost:5001",
      SECRET_KEY,
    );
    expect(result.kind).toBe("transport");
    if (result.kind === "transport") {
      expect(exitCodeForFetchFailure(result.error)).toBe(5);
    }
  });
});

describe("statsBestEffortsHumanSuccessLine", () => {
  it("renders distance → time lines for an object map of efforts", () => {
    const body = JSON.stringify({
      "10K": { time: "00:42:00", workoutId: "w1" },
      "5K": { duration: "00:20:30" },
    });
    expect(statsBestEffortsHumanSuccessLine(200, body)).toBe(
      [
        "OK (HTTP 200)",
        "10K: 00:42:00",
        "5K: 00:20:30",
      ].join("\n"),
    );
  });

  it("formats arrays of effort objects with numbered rows", () => {
    const body = JSON.stringify([
      { distance: "5K", time: "00:20:30" },
      { distance: "10K", duration: "00:42:00" },
    ]);
    expect(statsBestEffortsHumanSuccessLine(200, body)).toBe(
      [
        "OK (HTTP 200)",
        "2 effort(s)",
        "1. 5K | time=00:20:30",
        "2. 10K | time=00:42:00",
      ].join("\n"),
    );
  });

  it("falls back to sorted key: value lines for scalar-valued objects", () => {
    const body = JSON.stringify({ marathon: "3:10:00", tenK: "00:42:00" });
    expect(statsBestEffortsHumanSuccessLine(200, body)).toBe(
      "OK (HTTP 200)\nmarathon: 3:10:00\ntenK: 00:42:00",
    );
  });

  it("falls back to plain text for non-JSON body", () => {
    expect(statsBestEffortsHumanSuccessLine(200, "raw")).toBe(
      "OK (HTTP 200)\nraw",
    );
  });

  it("returns just the OK header when body is empty", () => {
    expect(statsBestEffortsHumanSuccessLine(200, "")).toBe("OK (HTTP 200)");
  });
});

describe("statsBestEffortsHttpErrorMessage", () => {
  it("includes path and status", () => {
    expect(statsBestEffortsHttpErrorMessage(401, "")).toBe(
      "GET /stats/best-efforts returned 401",
    );
  });

  it("appends a snippet of the body when present", () => {
    expect(statsBestEffortsHttpErrorMessage(500, "boom")).toBe(
      "GET /stats/best-efforts returned 500: boom",
    );
  });
});
