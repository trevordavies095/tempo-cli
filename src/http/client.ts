import { normalizeBaseUrl } from "../config/file.js";

export const DEFAULT_TIMEOUT_MS = 30_000;

export type CreateHttpClientOptions = {
  baseUrl: string;
  /** @default DEFAULT_TIMEOUT_MS */
  timeoutMs?: number;
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

  return {
    baseUrl,
    async get(path: string, init?: RequestInit): Promise<Response> {
      const url = resolveRequestUrl(baseUrl, path);
      const signal = mergeAbortSignals(timeoutMs, init?.signal);
      const { signal: _omit, method: _m, ...rest } = init ?? {};
      return fetch(url, {
        ...rest,
        method: "GET",
        signal,
      });
    },
  };
}
