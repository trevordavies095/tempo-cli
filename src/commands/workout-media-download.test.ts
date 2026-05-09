import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exitCodeForFetchFailure,
  exitCodeForHttpStatus,
} from "../exit/exits.js";
import { API_KEY_REDACTED } from "./auth-me.js";
import {
  atomicWriteFile,
  buildWorkoutMediaDownloadPath,
  probeWorkoutMediaDownload,
  workoutMediaDownloadHttpErrorMessage,
  workoutMediaDownloadHttpErrorMessageForCli,
} from "./workout-media-download.js";

const originalFetch = globalThis.fetch;
const SECRET_KEY = "tmp_secret_key_for_tests";
const W = "550e8400-e29b-41d4-a716-446655440000";
const M = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

describe("buildWorkoutMediaDownloadPath", () => {
  it("builds GET path with encoded segments", () => {
    expect(buildWorkoutMediaDownloadPath(W, M)).toBe(
      `/workouts/${W}/media/${M}`,
    );
  });
});

describe("probeWorkoutMediaDownload", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns ArrayBuffer and content-type on 200", async () => {
    const buf = new Uint8Array([1, 2, 3]).buffer;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(buf, {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await probeWorkoutMediaDownload(
      "http://localhost:5001",
      SECRET_KEY,
      W,
      M,
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.status).toBe(200);
      expect(result.contentType).toBe("image/jpeg");
      expect(new Uint8Array(result.body)).toEqual(new Uint8Array([1, 2, 3]));
    }

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`http://localhost:5001/workouts/${W}/media/${M}`);
  });

  it("sets Authorization Bearer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new ArrayBuffer(0), { status: 200 }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await probeWorkoutMediaDownload(
      "http://localhost:5001",
      SECRET_KEY,
      W,
      M,
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("Authorization")).toBe(
      `Bearer ${SECRET_KEY}`,
    );
    expect(init.credentials).toBe("omit");
  });

  it("returns http kind with body text on error status", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("gone", { status: 404 })) as typeof fetch;

    const result = await probeWorkoutMediaDownload(
      "http://localhost:5001",
      SECRET_KEY,
      W,
      M,
    );
    expect(result).toEqual({
      kind: "http",
      status: 404,
      bodyText: "gone",
    });
  });

  it("redacts API key in CLI error message", async () => {
    const body = `x ${SECRET_KEY}`;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(body, { status: 401 })) as typeof fetch;

    const result = await probeWorkoutMediaDownload(
      "http://localhost:5001",
      SECRET_KEY,
      W,
      M,
    );
    expect(result.kind).toBe("http");
    if (result.kind === "http") {
      const msg = workoutMediaDownloadHttpErrorMessageForCli(
        result.status,
        result.bodyText,
        SECRET_KEY,
        W,
        M,
      );
      expect(msg).not.toContain(SECRET_KEY);
      expect(msg).toContain(API_KEY_REDACTED);
    }
  });

  it("maps 404 to exit 4", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 404 })) as typeof fetch;

    const result = await probeWorkoutMediaDownload(
      "http://localhost:5001",
      SECRET_KEY,
      W,
      M,
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

    const result = await probeWorkoutMediaDownload(
      "http://localhost:5001",
      SECRET_KEY,
      W,
      M,
    );
    expect(result.kind).toBe("transport");
    if (result.kind === "transport") {
      expect(exitCodeForFetchFailure(result.error)).toBe(5);
    }
  });
});

describe("workoutMediaDownloadHttpErrorMessage", () => {
  it("includes path", () => {
    expect(workoutMediaDownloadHttpErrorMessage(404, "", W, M)).toBe(
      `GET /workouts/${W}/media/${M} returned 404`,
    );
  });
});

describe("atomicWriteFile", () => {
  it("writes content that can be read back", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tempo-cli-atomic-"));
    try {
      const dest = join(dir, "out.bin");
      const data = new Uint8Array([9, 8, 7]);
      await atomicWriteFile(dest, data);
      expect(readFileSync(dest)).toEqual(Buffer.from([9, 8, 7]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
