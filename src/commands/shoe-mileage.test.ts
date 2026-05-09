import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exitCodeForFetchFailure,
  exitCodeForHttpStatus,
} from "../exit/exits.js";
import { API_KEY_REDACTED } from "./auth-me.js";
import {
  buildShoeMileagePath,
  probeShoeMileage,
  shoeMileageHttpErrorMessage,
  shoeMileageHttpErrorMessageForCli,
  shoeMileageHumanSuccessLine,
} from "./shoe-mileage.js";

const originalFetch = globalThis.fetch;
const SECRET_KEY = "tmp_secret_key_for_tests";
const VALID_ID = "11111111-2222-4333-8444-555555555555";

describe("buildShoeMileagePath", () => {
  it("returns /shoes/<id>/mileage and trims the id", () => {
    expect(buildShoeMileagePath(`  ${VALID_ID}  `)).toBe(
      `/shoes/${VALID_ID}/mileage`,
    );
  });

  it("encodeURIComponent's the id segment", () => {
    expect(buildShoeMileagePath("a/b")).toBe("/shoes/a%2Fb/mileage");
  });
});

describe("probeShoeMileage", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("GET /shoes/<id>/mileage with Authorization Bearer, credentials omit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await probeShoeMileage(
      "http://localhost:5001",
      SECRET_KEY,
      VALID_ID,
    );
    expect(result).toEqual({ kind: "ok", status: 200, body: "{}" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://localhost:5001/shoes/${VALID_ID}/mileage`);
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

    const result = await probeShoeMileage(
      "http://localhost:5001",
      SECRET_KEY,
      VALID_ID,
    );
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      const msg = shoeMileageHttpErrorMessageForCli(
        result.status,
        result.body,
        SECRET_KEY,
        VALID_ID,
      );
      expect(msg).not.toContain(SECRET_KEY);
      expect(msg).toContain(API_KEY_REDACTED);
    }
  });

  it("maps 404 and 5xx for exit codes", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 404 })) as typeof fetch;
    let result = await probeShoeMileage(
      "http://localhost:5001",
      SECRET_KEY,
      VALID_ID,
    );
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      expect(exitCodeForHttpStatus(result.status)).toBe(4);
    }

    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("x", { status: 500 })) as typeof fetch;
    result = await probeShoeMileage(
      "http://localhost:5001",
      SECRET_KEY,
      VALID_ID,
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

    const result = await probeShoeMileage(
      "http://localhost:5001",
      SECRET_KEY,
      VALID_ID,
    );
    expect(result.kind).toBe("transport");
    if (result.kind === "transport") {
      expect(exitCodeForFetchFailure(result.error)).toBe(5);
    }
  });
});

describe("shoeMileageHumanSuccessLine", () => {
  it("renders sorted key: value lines for JSON object", () => {
    const body = JSON.stringify({ totalKm: 234.5, unit: "km" });
    expect(shoeMileageHumanSuccessLine(200, body)).toBe(
      "OK (HTTP 200)\ntotalKm: 234.5\nunit: km",
    );
  });

  it("falls back to plain text for non-JSON body", () => {
    expect(shoeMileageHumanSuccessLine(200, "raw")).toBe(
      "OK (HTTP 200)\nraw",
    );
  });

  it("returns just the OK header when body is empty", () => {
    expect(shoeMileageHumanSuccessLine(200, "")).toBe("OK (HTTP 200)");
  });
});

describe("shoeMileageHttpErrorMessage", () => {
  it("includes path and status with the id segment", () => {
    expect(shoeMileageHttpErrorMessage(404, "", VALID_ID)).toBe(
      `GET /shoes/${VALID_ID}/mileage returned 404`,
    );
  });

  it("appends a snippet of the body when present", () => {
    expect(shoeMileageHttpErrorMessage(500, "boom", VALID_ID)).toBe(
      `GET /shoes/${VALID_ID}/mileage returned 500: boom`,
    );
  });
});
