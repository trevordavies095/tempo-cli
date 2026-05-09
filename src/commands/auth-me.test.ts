import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exitCodeForFetchFailure,
  exitCodeForHttpStatus,
} from "../exit/exits.js";
import {
  authMeHttpErrorMessage,
  authMeHumanSuccessLine,
  probeAuthMe,
} from "./auth-me.js";

const originalFetch = globalThis.fetch;
const SECRET_KEY = "tmp_secret_key_for_tests";

describe("probeAuthMe", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("GET /auth/me with Authorization Bearer and credentials omit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await probeAuthMe("http://localhost:5001", SECRET_KEY);
    expect(result).toEqual({ kind: "ok", status: 200, body: "{}" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:5001/auth/me");
    expect(init.credentials).toBe("omit");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      `Bearer ${SECRET_KEY}`,
    );
  });

  it("error messages from server body do not echo our API key", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("Unauthorized", { status: 401 }),
      ) as typeof fetch;

    const result = await probeAuthMe("http://localhost:5001", SECRET_KEY);
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      const msg = authMeHttpErrorMessage(result.status, result.body);
      expect(msg).not.toContain(SECRET_KEY);
      expect(msg).toContain("401");
    }
  });

  it("returns http kind for 403", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 403 })) as typeof fetch;

    const result = await probeAuthMe("http://localhost:5001", SECRET_KEY);
    expect(result).toEqual({ kind: "http", status: 403, body: "" });
    expect(exitCodeForHttpStatus(403)).toBe(2);
  });

  it("maps 404 and 5xx for exit codes", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 404 })) as typeof fetch;
    let result = await probeAuthMe("http://localhost:5001", SECRET_KEY);
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      expect(exitCodeForHttpStatus(result.status)).toBe(4);
    }

    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("x", { status: 500 })) as typeof fetch;
    result = await probeAuthMe("http://localhost:5001", SECRET_KEY);
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

    const result = await probeAuthMe("http://localhost:5001", SECRET_KEY);
    expect(result.kind).toBe("transport");
    if (result.kind === "transport") {
      expect(exitCodeForFetchFailure(result.error)).toBe(5);
    }
  });
});

describe("authMeHumanSuccessLine", () => {
  it("matches health-style output", () => {
    expect(authMeHumanSuccessLine(200, "")).toBe("OK (HTTP 200)");
    expect(authMeHumanSuccessLine(200, "x")).toBe("OK (HTTP 200)\nx");
  });
});

describe("authMeHttpErrorMessage", () => {
  it("includes path and status", () => {
    expect(authMeHttpErrorMessage(401, "")).toBe("GET /auth/me returned 401");
  });
});
