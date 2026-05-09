/** Process exit codes used by the CLI (success, usage, HTTP-style semantics, transport). */

export const EXIT_SUCCESS = 0;
export const EXIT_USAGE = 1;
export const EXIT_AUTH = 2;
export const EXIT_SERVER_ERROR = 3;
export const EXIT_NOT_FOUND = 4;
export const EXIT_TRANSPORT = 5;

const TRANSPORT_ERRNO = new Set([
  "ENOTFOUND",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
]);

/**
 * Map an HTTP status to a process exit code. Intended for `!response.ok` only;
 * success (2xx/3xx) and other unexpected values map to {@link EXIT_USAGE} so bugs are not masked.
 */
export function exitCodeForHttpStatus(status: number): number {
  if (status === 401 || status === 403) return EXIT_AUTH;
  if (status === 404) return EXIT_NOT_FOUND;
  if (status >= 500 && status <= 599) return EXIT_SERVER_ERROR;
  if (status >= 400 && status <= 499) return EXIT_USAGE;
  return EXIT_USAGE;
}

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

/**
 * Map a thrown value from `fetch` (or related transport) to a process exit code.
 * Unknown errors default to {@link EXIT_TRANSPORT} so "no response" stays distinct from bad CLI usage.
 */
export function exitCodeForFetchFailure(err: unknown): number {
  if (isAbortLike(err)) return EXIT_TRANSPORT;

  const errno = errnoFromErrorChain(err);
  if (errno !== undefined && TRANSPORT_ERRNO.has(errno)) return EXIT_TRANSPORT;

  if (isFetchFailedTypeError(err)) {
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause !== undefined) {
      const cerrno = errnoFromErrorChain(cause);
      if (cerrno !== undefined && TRANSPORT_ERRNO.has(cerrno)) return EXIT_TRANSPORT;
    }
    return EXIT_TRANSPORT;
  }

  if (err instanceof Error) return EXIT_TRANSPORT;

  return EXIT_TRANSPORT;
}
