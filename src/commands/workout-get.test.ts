import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exitCodeForFetchFailure,
  exitCodeForHttpStatus,
} from "../exit/exits.js";
import { API_KEY_REDACTED } from "./auth-me.js";
import {
  buildWorkoutGetPath,
  isValidWorkoutId,
  probeWorkoutGet,
  trimWorkoutId,
  workoutGetHttpErrorMessage,
  workoutGetHttpErrorMessageForCli,
  workoutGetHumanSuccessLine,
} from "./workout-get.js";

const originalFetch = globalThis.fetch;
const SECRET_KEY = "tmp_secret_key_for_tests";
const SAMPLE_UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("isValidWorkoutId", () => {
  it("accepts lowercase and uppercase UUID", () => {
    expect(isValidWorkoutId(SAMPLE_UUID)).toBe(true);
    expect(isValidWorkoutId(SAMPLE_UUID.toUpperCase())).toBe(true);
    expect(isValidWorkoutId(`  ${SAMPLE_UUID}  `)).toBe(true);
  });

  it("rejects non-UUID strings", () => {
    expect(isValidWorkoutId("")).toBe(false);
    expect(isValidWorkoutId("not-a-uuid")).toBe(false);
    expect(isValidWorkoutId("550e8400-e29b-41d4-a716-44665544000")).toBe(false);
  });
});

describe("buildWorkoutGetPath", () => {
  it("encodes path segment", () => {
    expect(buildWorkoutGetPath(SAMPLE_UUID)).toBe(
      `/workouts/${SAMPLE_UUID}`,
    );
    expect(trimWorkoutId(`  ${SAMPLE_UUID}  `)).toBe(SAMPLE_UUID);
  });
});

describe("probeWorkoutGet", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("GET /workouts/{id} with Authorization Bearer", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await probeWorkoutGet(
      "http://localhost:5001",
      SECRET_KEY,
      SAMPLE_UUID,
    );
    expect(result).toEqual({ kind: "ok", status: 200, body: "{}" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://localhost:5001/workouts/${SAMPLE_UUID}`);
    expect(init.credentials).toBe("omit");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      `Bearer ${SECRET_KEY}`,
    );
  });

  it("redacts API key in HTTP error body for CLI message", async () => {
    const body = `missing ${SECRET_KEY}`;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(body, { status: 401 })) as typeof fetch;

    const result = await probeWorkoutGet(
      "http://localhost:5001",
      SECRET_KEY,
      SAMPLE_UUID,
    );
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      const msg = workoutGetHttpErrorMessageForCli(
        result.status,
        result.body,
        SECRET_KEY,
        SAMPLE_UUID,
      );
      expect(msg).not.toContain(SECRET_KEY);
      expect(msg).toContain(API_KEY_REDACTED);
    }
  });

  it("maps 404 to exit 4", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 404 })) as typeof fetch;

    const result = await probeWorkoutGet(
      "http://localhost:5001",
      SECRET_KEY,
      SAMPLE_UUID,
    );
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      expect(exitCodeForHttpStatus(result.status)).toBe(4);
    }
  });

  it("maps 5xx to exit 3", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("e", { status: 500 })) as typeof fetch;

    const result = await probeWorkoutGet(
      "http://localhost:5001",
      SECRET_KEY,
      SAMPLE_UUID,
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

    const result = await probeWorkoutGet(
      "http://localhost:5001",
      SECRET_KEY,
      SAMPLE_UUID,
    );
    expect(result.kind).toBe("transport");
    if (result.kind === "transport") {
      expect(exitCodeForFetchFailure(result.error)).toBe(5);
    }
  });
});

describe("workoutGetHumanSuccessLine", () => {
  it("prints subset lines for JSON object with camelCase keys", () => {
    const body = JSON.stringify({
      id: SAMPLE_UUID,
      name: "Morning",
      startedAt: "2025-01-01T12:00:00Z",
      duration: 3600,
      distance: 10000,
      runType: "Easy Run",
    });
    expect(workoutGetHumanSuccessLine(200, body)).toBe(
      [
        "OK (HTTP 200)",
        `id: ${SAMPLE_UUID}`,
        "name: Morning",
        "startedAt: 2025-01-01T12:00:00Z",
        "duration: 3600",
        "distance: 10000",
        "runType: Easy Run",
      ].join("\n"),
    );
  });

  it("matches PascalCase keys", () => {
    const body = JSON.stringify({
      Id: SAMPLE_UUID,
      Name: "X",
    });
    const out = workoutGetHumanSuccessLine(200, body);
    expect(out).toContain(`id: ${SAMPLE_UUID}`);
    expect(out).toContain("name: X");
  });
});

describe("workoutGetHttpErrorMessage", () => {
  it("includes path with id and status", () => {
    expect(workoutGetHttpErrorMessage(404, "", SAMPLE_UUID)).toBe(
      `GET /workouts/${SAMPLE_UUID} returned 404`,
    );
  });
});
