import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createHttpClient,
  DEFAULT_TIMEOUT_MS,
} from "./client.js";

const originalFetch = globalThis.fetch;

describe("createHttpClient", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("GET uses normalized base URL, method GET, and default timeout signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createHttpClient({ baseUrl: "http://localhost:5001/" });
    await client.get("/version");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:5001/version");
    expect(init.method).toBe("GET");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init.headers);
    expect(headers.has("Authorization")).toBe(false);
  });

  it("sets Authorization Bearer when apiKey is non-empty", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createHttpClient({
      baseUrl: "http://localhost:5001",
      apiKey: "tmp_test_token",
    });
    await client.get("/version");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer tmp_test_token");
  });

  it("omits Authorization when apiKey is unset", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createHttpClient({ baseUrl: "http://localhost:5001" });
    await client.get("/x");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });

  it("omits Authorization when apiKey is whitespace-only", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createHttpClient({
      baseUrl: "http://localhost:5001",
      apiKey: "   \n\t  ",
    });
    await client.get("/x");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });

  it("allows Authorization from init when factory has no apiKey", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createHttpClient({ baseUrl: "http://localhost:5001" });
    await client.get("/x", {
      headers: { Authorization: "Bearer from-init" },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer from-init");
  });

  it("factory apiKey overrides Authorization from init", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createHttpClient({
      baseUrl: "http://localhost:5001",
      apiKey: "from-factory",
    });
    await client.get("/x", {
      headers: { Authorization: "Bearer from-init" },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer from-factory",
    );
  });

  it("prefixes path without leading slash", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createHttpClient({ baseUrl: "https://tempo.example.com" });
    await client.get("workouts");

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://tempo.example.com/workouts");
  });

  it("merges user AbortSignal with timeout via AbortSignal.any", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const user = new AbortController();
    const client = createHttpClient({
      baseUrl: "http://localhost:5001",
      timeoutMs: 60_000,
    });
    await client.get("/x", { signal: user.signal });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal).not.toBe(user.signal);
  });

  it("uses custom timeoutMs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createHttpClient({ baseUrl: "http://a", timeoutMs: 5_000 });
    await client.get("/");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects absolute path URLs", async () => {
    const client = createHttpClient({ baseUrl: "http://localhost:5001" });
    await expect(client.get("https://evil.test/x")).rejects.toThrow(
      /Absolute URLs are not supported/,
    );
  });

  it("exports default timeout constant", () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(30_000);
  });
});
