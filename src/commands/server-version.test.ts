import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exitCodeForFetchFailure,
  exitCodeForHttpStatus,
} from "../exit/exits.js";
import {
  probeServerVersion,
  serverVersionHttpErrorMessage,
  serverVersionHumanSuccessLine,
} from "./server-version.js";

const originalFetch = globalThis.fetch;

describe("probeServerVersion", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("GET /version without Authorization", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await probeServerVersion("http://localhost:5001");
    expect(result).toEqual({ kind: "ok", status: 200, body: "" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:5001/version");
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });

  it("returns body text on 200", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('{"version":"1.0.0"}', { status: 200 }),
      ) as typeof fetch;

    const result = await probeServerVersion("http://localhost:5001");
    expect(result).toEqual({
      kind: "ok",
      status: 200,
      body: '{"version":"1.0.0"}',
    });
  });

  it("returns http kind for 401", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("no", { status: 401 })) as typeof fetch;

    const result = await probeServerVersion("http://localhost:5001");
    expect(result).toEqual({ kind: "http", status: 401, body: "no" });
    expect(exitCodeForHttpStatus(401)).toBe(2);
  });

  it("maps 404 and 5xx for exit codes", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 404 })) as typeof fetch;
    let result = await probeServerVersion("http://localhost:5001");
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      expect(exitCodeForHttpStatus(result.status)).toBe(4);
    }

    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("x", { status: 502 })) as typeof fetch;
    result = await probeServerVersion("http://localhost:5001");
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

    const result = await probeServerVersion("http://localhost:5001");
    expect(result.kind).toBe("transport");
    if (result.kind === "transport") {
      expect(exitCodeForFetchFailure(result.error)).toBe(5);
    }
  });
});

describe("serverVersionHumanSuccessLine", () => {
  it("omits body line when empty", () => {
    expect(serverVersionHumanSuccessLine(200, "")).toBe("OK (HTTP 200)");
  });

  it("appends trimmed body for non-object responses", () => {
    expect(serverVersionHumanSuccessLine(200, "v1")).toBe("OK (HTTP 200)\nv1");
  });

  it("formats JSON object bodies as sorted key lines", () => {
    expect(
      serverVersionHumanSuccessLine(200, '{"version":"1.0","commit":"abc"}'),
    ).toBe("OK (HTTP 200)\ncommit: abc\nversion: 1.0");
  });
});

describe("serverVersionHttpErrorMessage", () => {
  it("includes status and optional body snippet", () => {
    expect(serverVersionHttpErrorMessage(500, "")).toBe(
      "GET /version returned 500",
    );
    expect(serverVersionHttpErrorMessage(400, "bad")).toBe(
      "GET /version returned 400: bad",
    );
  });
});
