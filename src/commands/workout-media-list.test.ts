import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exitCodeForFetchFailure,
  exitCodeForHttpStatus,
} from "../exit/exits.js";
import { API_KEY_REDACTED } from "./auth-me.js";
import {
  buildWorkoutMediaListPath,
  probeWorkoutMediaList,
  workoutMediaListHttpErrorMessage,
  workoutMediaListHttpErrorMessageForCli,
  workoutMediaListHumanSuccessLine,
} from "./workout-media-list.js";

const originalFetch = globalThis.fetch;
const SECRET_KEY = "tmp_secret_key_for_tests";
const SAMPLE_UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("buildWorkoutMediaListPath", () => {
  it("builds GET path", () => {
    expect(buildWorkoutMediaListPath(SAMPLE_UUID)).toBe(
      `/workouts/${SAMPLE_UUID}/media`,
    );
  });
});

describe("probeWorkoutMediaList", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("GET with Bearer", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("[]", { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await probeWorkoutMediaList(
      "http://localhost:5001",
      SECRET_KEY,
      SAMPLE_UUID,
    );
    expect(result).toEqual({ kind: "ok", status: 200, body: "[]" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://localhost:5001/workouts/${SAMPLE_UUID}/media`);
    expect(init.credentials).toBe("omit");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      `Bearer ${SECRET_KEY}`,
    );
  });

  it("redacts API key in error body", async () => {
    const body = `x ${SECRET_KEY}`;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(body, { status: 401 })) as typeof fetch;

    const result = await probeWorkoutMediaList(
      "http://localhost:5001",
      SECRET_KEY,
      SAMPLE_UUID,
    );
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      const msg = workoutMediaListHttpErrorMessageForCli(
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

    const result = await probeWorkoutMediaList(
      "http://localhost:5001",
      SECRET_KEY,
      SAMPLE_UUID,
    );
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      expect(exitCodeForHttpStatus(result.status)).toBe(4);
    }
  });

  it("transport on fetch failure", async () => {
    const cause = Object.assign(new Error("ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    const err = Object.assign(new TypeError("fetch failed"), { cause });
    globalThis.fetch = vi.fn().mockRejectedValue(err) as typeof fetch;

    const result = await probeWorkoutMediaList(
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

describe("workoutMediaListHumanSuccessLine", () => {
  it("formats media array", () => {
    const mid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const body = JSON.stringify([
      {
        id: mid,
        filename: "a.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        caption: "x",
        createdAt: "2025-01-01T00:00:00Z",
      },
    ]);
    expect(workoutMediaListHumanSuccessLine(200, body)).toBe(
      [
        "OK (HTTP 200)",
        "1 media file(s)",
        "1. aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee | a.jpg | image/jpeg | size=1024 | caption=x | created=2025-01-01T00:00:00Z",
      ].join("\n"),
    );
  });

  it("caps at 20 rows", () => {
    const rows = Array.from({ length: 22 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    }));
    const out = workoutMediaListHumanSuccessLine(200, JSON.stringify(rows));
    expect(out).toContain("22 media file(s)");
    expect(out).toContain("… and 2 more");
    expect(out.split("\n").filter((l) => /^\d+\./.test(l))).toHaveLength(20);
  });
});

describe("workoutMediaListHttpErrorMessage", () => {
  it("includes path", () => {
    expect(workoutMediaListHttpErrorMessage(404, "", SAMPLE_UUID)).toBe(
      `GET /workouts/${SAMPLE_UUID}/media returned 404`,
    );
  });
});
