import { afterEach, describe, expect, it, vi } from "vitest";
import { API_KEY_REDACTED } from "../commands/auth-me.js";
import { checkConnection } from "./check-connection.js";

const originalFetch = globalThis.fetch;
const SECRET_KEY = "tmp_secret_key_for_mcp_tests";
const BASE = "http://localhost:5001";

function connRefused(): TypeError {
  const err = new TypeError("fetch failed");
  (err as Error & { cause: { code: string } }).cause = {
    code: "ECONNREFUSED",
  };
  return err;
}

describe("checkConnection", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("reports unreachable on health transport failure", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(connRefused()) as typeof fetch;

    const outcome = await checkConnection({ baseUrl: BASE, apiKey: SECRET_KEY });
    expect(outcome.taxonomy).toBe("transport");
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain("Unreachable");
    expect(outcome.text).toContain(BASE);
    expect(outcome.text).not.toContain(SECRET_KEY);
  });

  it("reports reachable but key rejected on 401", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(`bad token ${SECRET_KEY}`, { status: 401 }),
      ) as typeof fetch;

    const outcome = await checkConnection({ baseUrl: BASE, apiKey: SECRET_KEY });
    expect(outcome.taxonomy).toBe("auth");
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toMatch(/reachable/i);
    expect(outcome.text).toMatch(/rejected|Auth failed/i);
    expect(outcome.text).toContain("/settings/api-keys");
    expect(outcome.text).not.toContain(SECRET_KEY);
    expect(outcome.text).not.toContain(API_KEY_REDACTED); // auth path uses settings message, not body snip
  });

  it("reports reachable and authenticated on success", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ email: "runner@example.com" }), {
          status: 200,
        }),
      ) as typeof fetch;

    const outcome = await checkConnection({ baseUrl: BASE, apiKey: SECRET_KEY });
    expect(outcome.taxonomy).toBe("ok");
    expect(outcome.isError).toBe(false);
    expect(outcome.text).toMatch(/Reachable/);
    expect(outcome.text).toMatch(/authenticated/);
    expect(outcome.text).toContain("email=runner@example.com");
    expect(outcome.text).not.toContain(SECRET_KEY);
  });

  it("reports missing API key after successful health", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("ok", { status: 200 })) as typeof fetch;

    const outcome = await checkConnection({ baseUrl: BASE });
    expect(outcome.taxonomy).toBe("usage");
    expect(outcome.isError).toBe(false);
    expect(outcome.text).toMatch(/no API key/i);
    expect(outcome.text).toContain("TEMPO_API_KEY");
  });

  it("redacts API key from unexpected auth HTTP error bodies", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(`server echoed ${SECRET_KEY}`, { status: 500 }),
      ) as typeof fetch;

    const outcome = await checkConnection({ baseUrl: BASE, apiKey: SECRET_KEY });
    expect(outcome.taxonomy).toBe("server");
    expect(outcome.isError).toBe(true);
    expect(outcome.text).not.toContain(SECRET_KEY);
    expect(outcome.text).toContain(API_KEY_REDACTED);
  });

  it("reports health HTTP failure distinctly from auth", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("down", { status: 503 })) as typeof fetch;

    const outcome = await checkConnection({ baseUrl: BASE, apiKey: SECRET_KEY });
    expect(outcome.taxonomy).toBe("server");
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toMatch(/health check failed/i);
  });
});
