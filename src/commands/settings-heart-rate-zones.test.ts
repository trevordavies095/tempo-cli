import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exitCodeForFetchFailure,
  exitCodeForHttpStatus,
} from "../exit/exits.js";
import { API_KEY_REDACTED } from "./auth-me.js";
import {
  probeSettingsHeartRateZones,
  settingsHeartRateZonesHttpErrorMessage,
  settingsHeartRateZonesHttpErrorMessageForCli,
  settingsHeartRateZonesHumanSuccessLine,
} from "./settings-heart-rate-zones.js";

const originalFetch = globalThis.fetch;
const SECRET_KEY = "tmp_secret_key_for_tests";

describe("probeSettingsHeartRateZones", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("GET /settings/heart-rate-zones with Authorization Bearer, credentials omit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await probeSettingsHeartRateZones(
      "http://localhost:5001",
      SECRET_KEY,
    );
    expect(result).toEqual({ kind: "ok", status: 200, body: "{}" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:5001/settings/heart-rate-zones");
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

    const result = await probeSettingsHeartRateZones(
      "http://localhost:5001",
      SECRET_KEY,
    );
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      const msg = settingsHeartRateZonesHttpErrorMessageForCli(
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
    let result = await probeSettingsHeartRateZones(
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
    result = await probeSettingsHeartRateZones(
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

    const result = await probeSettingsHeartRateZones(
      "http://localhost:5001",
      SECRET_KEY,
    );
    expect(result.kind).toBe("transport");
    if (result.kind === "transport") {
      expect(exitCodeForFetchFailure(result.error)).toBe(5);
    }
  });
});

describe("settingsHeartRateZonesHumanSuccessLine", () => {
  it("renders sorted key: value lines for JSON object", () => {
    const body = JSON.stringify({ method: "AgeBased", maxHr: 190 });
    expect(settingsHeartRateZonesHumanSuccessLine(200, body)).toBe(
      "OK (HTTP 200)\nmaxHr: 190\nmethod: AgeBased",
    );
  });

  it("falls back to plain text for non-JSON body", () => {
    expect(settingsHeartRateZonesHumanSuccessLine(200, "raw")).toBe(
      "OK (HTTP 200)\nraw",
    );
  });

  it("returns just the OK header when body is empty", () => {
    expect(settingsHeartRateZonesHumanSuccessLine(200, "")).toBe(
      "OK (HTTP 200)",
    );
  });
});

describe("settingsHeartRateZonesHttpErrorMessage", () => {
  it("includes path and status", () => {
    expect(settingsHeartRateZonesHttpErrorMessage(401, "")).toBe(
      "GET /settings/heart-rate-zones returned 401",
    );
  });

  it("appends a snippet of the body when present", () => {
    expect(settingsHeartRateZonesHttpErrorMessage(500, "boom")).toBe(
      "GET /settings/heart-rate-zones returned 500: boom",
    );
  });
});
