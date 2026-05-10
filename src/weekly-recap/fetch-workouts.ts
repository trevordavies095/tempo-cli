import {
  isPlainObject,
  pickFirst,
} from "../output/human-summary.js";
import {
  probeWorkoutGet,
  workoutGetHttpErrorMessageForCli,
  isValidWorkoutId,
  trimWorkoutId,
  type WorkoutGetResult,
} from "../commands/workout-get.js";
import {
  mergeWorkoutTimeSeriesSamplesByElapsedSecond,
  parseWorkoutTimeSeriesPageBody,
  probeWorkoutTimeSeries,
  type WorkoutTimeSeriesSampleRow,
  workoutTimeSeriesHttpErrorMessageForCli,
} from "../commands/workout-time-series.js";
import type { HrSamplePoint } from "./hr-analytics.js";
import {
  probeWorkoutsList,
  workoutsListHttpErrorMessageForCli,
  type WorkoutsListQuery,
} from "../commands/workouts-list.js";
import { probeShoesList, shoesListHttpErrorMessageForCli } from "../commands/shoes-list.js";
import { probeWorkoutSimilarRoutes } from "../commands/workout-similar-routes.js";
import { transportErrorMessage } from "../commands/health.js";
import type { RecapSimilarRoutesEntry } from "./similar-route-line.js";

export const RECAP_WORKOUT_LIST_PAGE_SIZE = 100;
export const RECAP_WORKOUT_LIST_MAX_PAGES = 50;
export const RECAP_WORKOUT_GET_CONCURRENCY = 4;
/** §3.5 — GET /workouts/{id}/similar-routes?maxResults=3 */
export const RECAP_SIMILAR_ROUTES_MAX_RESULTS = 3;
/** Matches API default; max allowed by server is 5000. */
export const RECAP_WORKOUT_TS_PAGE_SIZE = 1000;
/** Safety cap on pagination (1000 × 500 = 500k samples max per workout). */
export const RECAP_WORKOUT_TS_MAX_PAGES = 500;

export type ParsedWorkoutsListBody = {
  items: Record<string, unknown>[];
  totalCount?: number;
};

/** Align with {@link ../commands/workouts-list.ts} list response shapes. */
export function parseWorkoutsListBody(
  body: string,
): { ok: true; value: ParsedWorkoutsListBody } | { ok: false } {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return { ok: false };
  }

  if (Array.isArray(parsed)) {
    const items = parsed.filter(isPlainObject) as Record<string, unknown>[];
    return { ok: true, value: { items } };
  }

  if (!isPlainObject(parsed)) return { ok: false };

  const itemsRaw = parsed.items ?? parsed.Items;
  if (!Array.isArray(itemsRaw)) return { ok: false };

  const items = itemsRaw.filter(isPlainObject) as Record<string, unknown>[];
  const totalCount = pickTotalCount(parsed);
  return { ok: true, value: { items, totalCount } };
}

function pickTotalCount(obj: Record<string, unknown>): number | undefined {
  const keys = ["totalCount", "TotalCount", "total", "Total"] as const;
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && /^\d+$/.test(v.trim())) {
      return Number.parseInt(v.trim(), 10);
    }
  }
  return undefined;
}

export function extractWorkoutId(item: Record<string, unknown>): string | undefined {
  const raw = pickFirst(item, ["workoutId", "id", "WorkoutId", "Id"]);
  if (typeof raw !== "string") return undefined;
  const id = trimWorkoutId(raw);
  return isValidWorkoutId(id) ? id : undefined;
}

/** Stable dedupe: first occurrence wins (list order). */
export function dedupeWorkoutIds(
  items: readonly Record<string, unknown>[],
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const item of items) {
    const id = extractWorkoutId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered;
}

/**
 * Runs `fn` over `items` with at most `concurrency` in-flight async tasks.
 */
export async function runPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  }

  const workers = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

function workoutTimeSeriesRowsToHrSamples(
  rows: readonly WorkoutTimeSeriesSampleRow[],
): HrSamplePoint[] {
  return rows.map((r) => ({
    elapsedSeconds: r.elapsedSeconds,
    heartRateBpm: r.heartRateBpm,
  }));
}

async function fetchWorkoutTimeSeriesAllPages(
  baseUrl: string,
  apiKey: string,
  id: string,
): Promise<
  | { ok: true; samples: HrSamplePoint[] }
  | {
      ok: false;
      kind: "http" | "transport" | "invalid";
      message: string;
      httpStatus?: number;
      transportError?: unknown;
    }
> {
  const merged: WorkoutTimeSeriesSampleRow[] = [];
  let page = 1;
  while (page <= RECAP_WORKOUT_TS_MAX_PAGES) {
    const res = await probeWorkoutTimeSeries(baseUrl, apiKey, id, {
      page,
      pageSize: RECAP_WORKOUT_TS_PAGE_SIZE,
    });
    if (res.kind === "transport") {
      return {
        ok: false,
        kind: "transport",
        message: transportErrorMessage(res.error),
        transportError: res.error,
      };
    }
    if (res.kind === "http") {
      if (res.status === 404) {
        if (page === 1) {
          return { ok: true, samples: [] };
        }
        break;
      }
      return {
        ok: false,
        kind: "http",
        httpStatus: res.status,
        message: `tempo weekly-recap: ${workoutTimeSeriesHttpErrorMessageForCli(
          res.status,
          res.body,
          apiKey,
          id,
        )}`,
      };
    }
    const parsed = parseWorkoutTimeSeriesPageBody(res.body);
    if (!parsed.ok) {
      return {
        ok: false,
        kind: "invalid",
        message:
          "tempo weekly-recap: could not parse GET /workouts/{id}/time-series response as JSON array or { items }",
      };
    }
    merged.push(...parsed.items);
    if (parsed.items.length < RECAP_WORKOUT_TS_PAGE_SIZE) break;
    page += 1;
  }
  const deduped = mergeWorkoutTimeSeriesSamplesByElapsedSecond(merged);
  return {
    ok: true,
    samples: workoutTimeSeriesRowsToHrSamples(deduped),
  };
}

export type WorkoutDetailOk = {
  id: string;
  status: number;
  body: string;
};

export type FetchRecapWorkoutDataOk = {
  ok: true;
  listItemCount: number;
  workoutIds: string[];
  workoutDetails: WorkoutDetailOk[];
  /**
   * Sparse HR samples from GET /workouts/{id}/time-series (all pages), used for HR analytics.
   * Not included in CLI JSON output (can be large); passed only to {@link computeRecapHrAnalytics}.
   */
  timeSeriesByWorkoutId: Record<string, HrSamplePoint[]>;
  shoesStatus: number;
  shoesBody: string;
  /** Per workout; failures do not fail the overall fetch. */
  similarRoutesByWorkoutId: Record<string, RecapSimilarRoutesEntry>;
};

export type FetchRecapWorkoutDataErr = {
  ok: false;
  message: string;
  /** Hint for CLI exit mapping: http uses status, transport uses fetch failure, invalid uses EXIT_USAGE */
  kind: "http" | "transport" | "invalid";
  httpStatus?: number;
  /** Original error when kind === "transport" (for exitCodeForFetchFailure). */
  transportError?: unknown;
};

export type FetchRecapWorkoutDataArgs = {
  baseUrl: string;
  apiKey: string;
  startDate: string;
  endDate: string;
};

/** §3.10 — skip similar-routes HTTP when detail has no route/polyline-like fields. */
export function workoutDetailHasLikelyRoute(body: string): boolean {
  const t = body.trim();
  if (!t) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(t) as unknown;
  } catch {
    return false;
  }
  if (!isPlainObject(parsed)) return false;
  const w = parsed;
  const routeLike = pickFirst(w, [
    "route",
    "Route",
    "routeId",
    "RouteId",
    "routePolyline",
    "RoutePolyline",
  ]);
  if (
    routeLike !== undefined &&
    routeLike !== null &&
    routeLike !== ""
  ) {
    return true;
  }
  const poly = pickFirst(w, [
    "polyline",
    "Polyline",
    "encodedPolyline",
    "EncodedPolyline",
  ]);
  if (typeof poly === "string" && poly.trim().length > 0) return true;
  if (isPlainObject(poly) && Object.keys(poly).length > 0) return true;
  return false;
}

export async function fetchRecapWorkoutData(
  args: FetchRecapWorkoutDataArgs,
): Promise<FetchRecapWorkoutDataOk | FetchRecapWorkoutDataErr> {
  const { baseUrl, apiKey, startDate, endDate } = args;

  const listParamsBase: WorkoutsListQuery = {
    startDate,
    endDate,
    pageSize: RECAP_WORKOUT_LIST_PAGE_SIZE,
    sortBy: "startedAt",
    sortOrder: "asc",
  };

  const allItems: Record<string, unknown>[] = [];
  let page = 1;

  while (true) {
    if (page > RECAP_WORKOUT_LIST_MAX_PAGES) {
      return {
        ok: false,
        kind: "invalid",
        message: `tempo weekly-recap: workout list exceeded ${RECAP_WORKOUT_LIST_MAX_PAGES} pages (pageSize ${RECAP_WORKOUT_LIST_PAGE_SIZE}); too many workouts in this window.`,
      };
    }

    const listRes = await probeWorkoutsList(baseUrl, apiKey, {
      ...listParamsBase,
      page,
    });

    if (listRes.kind === "transport") {
      return {
        ok: false,
        kind: "transport",
        message: transportErrorMessage(listRes.error),
        transportError: listRes.error,
      };
    }
    if (listRes.kind === "http") {
      return {
        ok: false,
        kind: "http",
        httpStatus: listRes.status,
        message: `tempo weekly-recap: ${workoutsListHttpErrorMessageForCli(
          listRes.status,
          listRes.body,
          apiKey,
        )}`,
      };
    }

    const parsedList = parseWorkoutsListBody(listRes.body);
    if (!parsedList.ok) {
      return {
        ok: false,
        kind: "invalid",
        message:
          "tempo weekly-recap: could not parse GET /workouts response body as JSON list or { items }",
      };
    }

    const { items, totalCount } = parsedList.value;
    allItems.push(...items);

    if (items.length < RECAP_WORKOUT_LIST_PAGE_SIZE) break;
    if (totalCount !== undefined && allItems.length >= totalCount) break;

    page += 1;
  }

  const workoutIds = dedupeWorkoutIds(allItems);

  const [detailPairs, shoesRes] = await Promise.all([
    workoutIds.length === 0
      ? Promise.resolve([] as { id: string; r: WorkoutGetResult }[])
      : runPool(workoutIds, RECAP_WORKOUT_GET_CONCURRENCY, async (id) => {
          const r = await probeWorkoutGet(baseUrl, apiKey, id);
          return { id, r };
        }),
    probeShoesList(baseUrl, apiKey),
  ]);

  for (const { id, r } of detailPairs) {
    if (r.kind === "transport") {
      return {
        ok: false,
        kind: "transport",
        message: transportErrorMessage(r.error),
        transportError: r.error,
      };
    }
    if (r.kind === "http") {
      return {
        ok: false,
        kind: "http",
        httpStatus: r.status,
        message: `tempo weekly-recap: ${workoutGetHttpErrorMessageForCli(
          r.status,
          r.body,
          apiKey,
          id,
        )}`,
      };
    }
  }

  const workoutDetails: WorkoutDetailOk[] = [];
  for (const { id, r } of detailPairs) {
    if (r.kind === "ok") {
      workoutDetails.push({ id, status: r.status, body: r.body });
    }
  }

  const timeSeriesByWorkoutId: Record<string, HrSamplePoint[]> = {};
  if (workoutIds.length > 0) {
    const tsPairs = await runPool(workoutIds, RECAP_WORKOUT_GET_CONCURRENCY, async (id) => {
      const result = await fetchWorkoutTimeSeriesAllPages(baseUrl, apiKey, id);
      return { id, result };
    });
    for (const { id, result } of tsPairs) {
      if (!result.ok) {
        if (result.kind === "transport") {
          return {
            ok: false,
            kind: "transport",
            message: result.message,
            transportError: result.transportError,
          };
        }
        if (result.kind === "http") {
          return {
            ok: false,
            kind: "http",
            httpStatus: result.httpStatus,
            message: result.message,
          };
        }
        return {
          ok: false,
          kind: "invalid",
          message: result.message,
        };
      }
      timeSeriesByWorkoutId[id] = result.samples;
    }
  }

  const similarRoutesByWorkoutId: Record<string, RecapSimilarRoutesEntry> = {};
  if (workoutIds.length > 0) {
    const srPairs = await runPool(
      workoutIds,
      RECAP_WORKOUT_GET_CONCURRENCY,
      async (id) => {
        const detail = workoutDetails.find((d) => d.id === id);
        const body = detail?.body ?? "";
        if (!workoutDetailHasLikelyRoute(body)) {
          return {
            id,
            entry: { ok: false as const, skipped: true },
          };
        }
        const res = await probeWorkoutSimilarRoutes(baseUrl, apiKey, id, {
          maxResults: RECAP_SIMILAR_ROUTES_MAX_RESULTS,
        });
        if (res.kind === "ok") {
          return { id, entry: { ok: true as const, body: res.body } };
        }
        if (res.kind === "http") {
          return {
            id,
            entry: { ok: false as const, httpStatus: res.status },
          };
        }
        return { id, entry: { ok: false as const } };
      },
    );
    for (const { id, entry } of srPairs) {
      similarRoutesByWorkoutId[id] = entry;
    }
  }

  if (shoesRes.kind === "transport") {
    return {
      ok: false,
      kind: "transport",
      message: transportErrorMessage(shoesRes.error),
      transportError: shoesRes.error,
    };
  }
  if (shoesRes.kind === "http") {
    return {
      ok: false,
      kind: "http",
      httpStatus: shoesRes.status,
      message: `tempo weekly-recap: ${shoesListHttpErrorMessageForCli(
        shoesRes.status,
        shoesRes.body,
        apiKey,
      )}`,
    };
  }

  return {
    ok: true,
    listItemCount: allItems.length,
    workoutIds,
    workoutDetails,
    timeSeriesByWorkoutId,
    shoesStatus: shoesRes.status,
    shoesBody: shoesRes.body,
    similarRoutesByWorkoutId,
  };
}

/** §3.6 step 10 — trend window list only (paginated GET /workouts). */
export type FetchTrendWorkoutListItemsOk = {
  ok: true;
  items: Record<string, unknown>[];
};

export type FetchTrendWorkoutListItemsErr = {
  ok: false;
  kind: "http" | "transport" | "invalid";
  message: string;
  httpStatus?: number;
  transportError?: unknown;
};

export async function fetchTrendWorkoutListItems(args: {
  baseUrl: string;
  apiKey: string;
  utcStartDate: string;
  utcEndDate: string;
}): Promise<FetchTrendWorkoutListItemsOk | FetchTrendWorkoutListItemsErr> {
  const { baseUrl, apiKey, utcStartDate, utcEndDate } = args;

  const listParamsBase: WorkoutsListQuery = {
    startDate: utcStartDate,
    endDate: utcEndDate,
    pageSize: RECAP_WORKOUT_LIST_PAGE_SIZE,
    sortBy: "startedAt",
    sortOrder: "asc",
  };

  const allItems: Record<string, unknown>[] = [];
  let page = 1;

  while (true) {
    if (page > RECAP_WORKOUT_LIST_MAX_PAGES) {
      return {
        ok: false,
        kind: "invalid",
        message: `tempo weekly-recap: trend workout list exceeded ${RECAP_WORKOUT_LIST_MAX_PAGES} pages (pageSize ${RECAP_WORKOUT_LIST_PAGE_SIZE}); too many workouts in this window.`,
      };
    }

    const listRes = await probeWorkoutsList(baseUrl, apiKey, {
      ...listParamsBase,
      page,
    });

    if (listRes.kind === "transport") {
      return {
        ok: false,
        kind: "transport",
        message: transportErrorMessage(listRes.error),
        transportError: listRes.error,
      };
    }
    if (listRes.kind === "http") {
      return {
        ok: false,
        kind: "http",
        httpStatus: listRes.status,
        message: `tempo weekly-recap: ${workoutsListHttpErrorMessageForCli(
          listRes.status,
          listRes.body,
          apiKey,
        )}`,
      };
    }

    const parsedList = parseWorkoutsListBody(listRes.body);
    if (!parsedList.ok) {
      return {
        ok: false,
        kind: "invalid",
        message:
          "tempo weekly-recap: trend workout list response was not valid JSON with an items array.",
      };
    }

    const { items, totalCount } = parsedList.value;
    allItems.push(...items);

    const done =
      items.length < RECAP_WORKOUT_LIST_PAGE_SIZE ||
      (typeof totalCount === "number" &&
        Number.isFinite(totalCount) &&
        allItems.length >= totalCount);

    if (done) break;
    page += 1;
  }

  return { ok: true, items: allItems };
}
