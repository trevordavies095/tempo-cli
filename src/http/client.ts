import { normalizeBaseUrl } from "../config/file.js";
import {
  DEFAULT_TRANSIENT_RETRY_DELAYS_MS,
  runWithTransientNetworkRetry,
} from "./transient-network-retry.js";

export const DEFAULT_TIMEOUT_MS = 30_000;

export type CreateHttpClientOptions = {
  baseUrl: string;
  /** @default DEFAULT_TIMEOUT_MS */
  timeoutMs?: number;
  /** When non-empty after trim, sets `Authorization: Bearer <key>` on every GET. */
  apiKey?: string;
  /**
   * Retry transient network failures (timeouts, connection errors) with §3.10 backoff.
   * Defaults to true when running the CLI; false when `NODE_ENV=test` (e.g. Vitest).
   */
  transientNetworkRetry?: boolean;
};

export type HttpClient = {
  readonly baseUrl: string;
  /** Async so invalid paths reject the promise instead of throwing synchronously. */
  get(path: string, init?: RequestInit): Promise<Response>;
};

function resolveRequestUrl(base: string, path: string): string {
  const p = path.trim();
  const lower = p.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    throw new Error(
      "Absolute URLs are not supported; pass a path such as /version",
    );
  }
  const normPath = p.startsWith("/") ? p : `/${p}`;
  const baseNorm = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${baseNorm}${normPath}`;
}

function mergeAbortSignals(
  timeoutMs: number,
  userSignal: AbortSignal | null | undefined,
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (userSignal == null) return timeoutSignal;
  return AbortSignal.any([timeoutSignal, userSignal]);
}

export function createHttpClient(options: CreateHttpClientOptions): HttpClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const configuredApiKey = options.apiKey;
  const transientNetworkRetry =
    options.transientNetworkRetry ?? process.env.NODE_ENV !== "test";

  return {
    baseUrl,
    async get(path: string, init?: RequestInit): Promise<Response> {
      const url = resolveRequestUrl(baseUrl, path);
      const signal = mergeAbortSignals(timeoutMs, init?.signal);
      const { signal: _s, method: _m, headers: _h, ...rest } = init ?? {};
      const headers = new Headers(init?.headers);
      const token = configuredApiKey?.trim();
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      const doFetch = () =>
        fetch(url, {
          ...rest,
          method: "GET",
          headers,
          signal,
          credentials: "omit",
        });
      if (!transientNetworkRetry) {
        return doFetch();
      }
      return runWithTransientNetworkRetry(doFetch, {
        delaysMs: DEFAULT_TRANSIENT_RETRY_DELAYS_MS,
      });
    },
  };
}
