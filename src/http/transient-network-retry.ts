/**
 * §3.10 — transient network failure detection and bounded retries with backoff.
 */

const TRANSPORT_ERRNO = new Set([
  "ENOTFOUND",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
]);

/** Initial attempt plus three retries (4 attempts total). */
export const DEFAULT_TRANSIENT_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

function errnoFromErrorChain(err: unknown): string | undefined {
  let cur: unknown = err;
  const seen = new Set<unknown>();
  while (cur != null && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const o = cur as Record<string, unknown>;
    const code = o.code;
    if (typeof code === "string") return code;
    cur = o.cause;
  }
  return undefined;
}

function isAbortLike(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return true;
  if (err.name === "TimeoutError") return true;
  return false;
}

function isFetchFailedTypeError(err: unknown): boolean {
  return (
    err instanceof TypeError &&
    typeof err.message === "string" &&
    err.message === "fetch failed"
  );
}

/** True when the failure is a transient network/transport issue worth retrying. */
export function isTransientNetworkError(err: unknown): boolean {
  if (isAbortLike(err)) return true;
  const errno = errnoFromErrorChain(err);
  if (errno !== undefined && TRANSPORT_ERRNO.has(errno)) return true;
  if (isFetchFailedTypeError(err)) return true;
  return false;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type RunWithTransientNetworkRetryOptions = {
  delaysMs?: readonly number[];
};

/**
 * Runs `fn` up to `1 + delaysMs.length` times; sleeps before each retry after a transient failure.
 */
export async function runWithTransientNetworkRetry<T>(
  fn: () => Promise<T>,
  options?: RunWithTransientNetworkRetryOptions,
): Promise<T> {
  const delays = options?.delaysMs ?? DEFAULT_TRANSIENT_RETRY_DELAYS_MS;
  const maxAttempts = 1 + delays.length;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (!isTransientNetworkError(e) || attempt >= maxAttempts - 1) {
        throw e;
      }
      await sleep(delays[attempt]!);
    }
  }
  throw lastError;
}
