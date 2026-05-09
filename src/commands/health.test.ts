import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exitCodeForFetchFailure,
  exitCodeForHttpStatus,
} from "../exit/exits.js";
import {
  healthHttpErrorMessage,
  healthHumanSuccessLine,
  probeHealth,
  transportErrorMessage,
} from "./health.js";

const originalFetch = globalThis.fetch;

describe("probeHealth", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("GET /health without Authorization", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await probeHealth("http://localhost:5001");
    expect(result).toEqual({ kind: "ok", status: 200, body: "" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });

  it("returns body text on 200", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("healthy\n", { status: 200 })) as typeof fetch;

    const result = await probeHealth("http://localhost:5001");
    expect(result).toEqual({ kind: "ok", status: 200, body: "healthy\n" });
  });

  it("returns http kind for 401", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 401 })) as typeof fetch;

    const result = await probeHealth("http://localhost:5001");
    expect(result).toEqual({ kind: "http", status: 401, body: "nope" });
    expect(exitCodeForHttpStatus(401)).toBe(2);
  });

  it("returns http kind for 404 and 500 with correct exit mapping", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 404 })) as typeof fetch;
    let result = await probeHealth("http://localhost:5001");
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      expect(exitCodeForHttpStatus(result.status)).toBe(4);
    }

    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("err", { status: 503 })) as typeof fetch;
    result = await probeHealth("http://localhost:5001");
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

    const result = await probeHealth("http://localhost:5001");
    expect(result.kind).toBe("transport");
    if (result.kind === "transport") {
      expect(exitCodeForFetchFailure(result.error)).toBe(5);
    }
  });
});

describe("healthHumanSuccessLine", () => {
  it("omits body line when empty", () => {
    expect(healthHumanSuccessLine(200, "")).toBe("OK (HTTP 200)");
    expect(healthHumanSuccessLine(204, "  \n")).toBe("OK (HTTP 204)");
  });

  it("appends trimmed body", () => {
    expect(healthHumanSuccessLine(200, "alive")).toBe("OK (HTTP 200)\nalive");
  });
});

describe("healthHttpErrorMessage", () => {
  it("includes status and optional body snippet", () => {
    expect(healthHttpErrorMessage(503, "")).toBe("GET /health returned 503");
    expect(healthHttpErrorMessage(400, "bad")).toBe(
      "GET /health returned 400: bad",
    );
  });
});

describe("transportErrorMessage", () => {
  it("uses Error.message", () => {
    expect(transportErrorMessage(new Error("timeout"))).toBe("timeout");
  });

  it("stringifies non-errors", () => {
    expect(transportErrorMessage(42)).toBe("42");
  });
});
