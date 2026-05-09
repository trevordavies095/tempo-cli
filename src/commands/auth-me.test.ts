import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exitCodeForFetchFailure,
  exitCodeForHttpStatus,
} from "../exit/exits.js";
import {
  API_KEY_REDACTED,
  authFailedApiKeysSettingsMessage,
  authMeHttpErrorMessage,
  authMeHttpErrorMessageForCli,
  authMeHumanSuccessLine,
  probeAuthMe,
  redactApiKeyInText,
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

  it("CLI HTTP error message redacts API key echoed by server body", async () => {
    const body = `invalid token ${SECRET_KEY}`;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(body, { status: 401 })) as typeof fetch;

    const result = await probeAuthMe("http://localhost:5001", SECRET_KEY);
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      const msg = authMeHttpErrorMessageForCli(
        result.status,
        result.body,
        SECRET_KEY,
      );
      expect(msg).not.toContain(SECRET_KEY);
      expect(msg).toContain(API_KEY_REDACTED);
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
  it("matches plain text for non-object bodies", () => {
    expect(authMeHumanSuccessLine(200, "")).toBe("OK (HTTP 200)");
    expect(authMeHumanSuccessLine(200, "x")).toBe("OK (HTTP 200)\nx");
  });

  it("formats JSON object bodies as sorted key lines", () => {
    expect(
      authMeHumanSuccessLine(
        200,
        JSON.stringify({ email: "a@b.co", id: "u1" }),
      ),
    ).toBe("OK (HTTP 200)\nemail: a@b.co\nid: u1");
  });
});

describe("authMeHttpErrorMessage", () => {
  it("includes path and status", () => {
    expect(authMeHttpErrorMessage(401, "")).toBe("GET /auth/me returned 401");
  });
});

describe("redactApiKeyInText", () => {
  it("returns unchanged when key is blank", () => {
    expect(redactApiKeyInText("x", "")).toBe("x");
    expect(redactApiKeyInText("x", "   ")).toBe("x");
  });

  it("replaces literal key and Bearer prefix form", () => {
    const k = "tmp_abc123";
    expect(redactApiKeyInText(`Bearer ${k}`, k)).toBe(`Bearer ${API_KEY_REDACTED}`);
    expect(redactApiKeyInText(`echo ${k} done`, k)).toBe(
      `echo ${API_KEY_REDACTED} done`,
    );
  });
});

describe("authFailedApiKeysSettingsMessage", () => {
  it("uses origin for http localhost", () => {
    expect(authFailedApiKeysSettingsMessage("http://localhost:5001")).toBe(
      "Auth failed. Check your API key (tmp_...) at http://localhost:5001/settings/api-keys",
    );
  });

  it("uses origin for https host and strips path", () => {
    expect(
      authFailedApiKeysSettingsMessage("https://tempo.example.com/v1/"),
    ).toBe(
      "Auth failed. Check your API key (tmp_...) at https://tempo.example.com/settings/api-keys",
    );
  });

  it("adds https when scheme omitted", () => {
    expect(authFailedApiKeysSettingsMessage("tempo.example.com")).toBe(
      "Auth failed. Check your API key (tmp_...) at https://tempo.example.com/settings/api-keys",
    );
  });
});

describe("authMeHttpErrorMessageForCli", () => {
  it("matches plain helper when body has no key", () => {
    expect(authMeHttpErrorMessageForCli(400, "bad request", SECRET_KEY)).toBe(
      authMeHttpErrorMessage(400, "bad request"),
    );
  });

  it("redacts before truncating", () => {
    const msg = authMeHttpErrorMessageForCli(
      401,
      `x${SECRET_KEY}y`,
      SECRET_KEY,
    );
    expect(msg).not.toContain(SECRET_KEY);
    expect(msg).toContain(API_KEY_REDACTED);
  });
});
