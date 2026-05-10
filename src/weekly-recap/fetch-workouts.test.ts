import { afterEach, describe, expect, it, vi } from "vitest";

import * as shoesList from "../commands/shoes-list.js";
import * as workoutGet from "../commands/workout-get.js";
import * as workoutSimilarRoutes from "../commands/workout-similar-routes.js";
import * as workoutTimeSeries from "../commands/workout-time-series.js";
import * as workoutsList from "../commands/workouts-list.js";
import {
  dedupeWorkoutIds,
  fetchRecapWorkoutData,
  parseWorkoutsListBody,
  RECAP_SIMILAR_ROUTES_MAX_RESULTS,
  RECAP_WORKOUT_GET_CONCURRENCY,
  RECAP_WORKOUT_LIST_MAX_PAGES,
  RECAP_WORKOUT_LIST_PAGE_SIZE,
  runPool,
  workoutDetailHasLikelyRoute,
} from "./fetch-workouts.js";

const W1 = "550e8400-e29b-41d4-a716-446655440001";
const W2 = "650e8400-e29b-41d4-a716-446655440002";

describe("parseWorkoutsListBody", () => {
  it("parses root array", () => {
    const r = parseWorkoutsListBody(
      JSON.stringify([{ id: W1 }, { id: W2 }]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items).toHaveLength(2);
  });

  it("parses object with items and totalCount", () => {
    const r = parseWorkoutsListBody(
      JSON.stringify({
        items: [{ id: W1 }],
        totalCount: 42,
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items).toHaveLength(1);
    expect(r.value.totalCount).toBe(42);
  });

  it("rejects invalid JSON", () => {
    expect(parseWorkoutsListBody("not json").ok).toBe(false);
  });
});

describe("dedupeWorkoutIds", () => {
  it("keeps first occurrence order", () => {
    expect(
      dedupeWorkoutIds([
        { id: W2 },
        { id: W1 },
        { id: W2 },
      ] as Record<string, unknown>[]),
    ).toEqual([W2, W1]);
  });
});

describe("runPool", () => {
  it("respects concurrency ceiling", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = [0, 1, 2, 3, 4, 5];
    await runPool(items, RECAP_WORKOUT_GET_CONCURRENCY, async (x) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 15);
      });
      inFlight--;
      return x * 2;
    });
    expect(maxInFlight).toBeLessThanOrEqual(RECAP_WORKOUT_GET_CONCURRENCY);
    expect(maxInFlight).toBeGreaterThan(1);
  });
});

describe("workoutDetailHasLikelyRoute", () => {
  it("is false for empty body without route fields", () => {
    expect(workoutDetailHasLikelyRoute("{}")).toBe(false);
  });

  it("is true when routeId or polyline present", () => {
    expect(
      workoutDetailHasLikelyRoute(JSON.stringify({ routeId: "x" })),
    ).toBe(true);
    expect(
      workoutDetailHasLikelyRoute(JSON.stringify({ polyline: "abc" })),
    ).toBe(true);
  });
});

describe("fetchRecapWorkoutData", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists, fetches details at bounded concurrency, and loads shoes", async () => {
    vi.spyOn(workoutsList, "probeWorkoutsList").mockResolvedValue({
      kind: "ok",
      status: 200,
      body: JSON.stringify([{ id: W1 }, { id: W2 }]),
    });
    vi.spyOn(workoutGet, "probeWorkoutGet").mockResolvedValue({
      kind: "ok",
      status: 200,
      body: "{}",
    });
    vi.spyOn(workoutTimeSeries, "probeWorkoutTimeSeries").mockResolvedValue({
      kind: "ok",
      status: 200,
      body: JSON.stringify({ items: [] }),
    });
    vi.spyOn(shoesList, "probeShoesList").mockResolvedValue({
      kind: "ok",
      status: 200,
      body: "[]",
    });
    vi.spyOn(workoutSimilarRoutes, "probeWorkoutSimilarRoutes").mockResolvedValue(
      {
        kind: "ok",
        status: 200,
        body: "[]",
      },
    );

    const r = await fetchRecapWorkoutData({
      baseUrl: "http://localhost:5001",
      apiKey: "tmp_test_key",
      startDate: "2026-05-04T00:00:00.000Z",
      endDate: "2026-05-10T23:59:59.999Z",
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.listItemCount).toBe(2);
    expect(r.workoutIds).toEqual([W1, W2]);
    expect(r.workoutDetails).toHaveLength(2);
    expect(workoutGet.probeWorkoutGet).toHaveBeenCalledTimes(2);
    expect(workoutTimeSeries.probeWorkoutTimeSeries).toHaveBeenCalledTimes(2);
    expect(workoutSimilarRoutes.probeWorkoutSimilarRoutes).not.toHaveBeenCalled();
    expect(r.similarRoutesByWorkoutId[W1]?.ok).toBe(false);
    if (!r.similarRoutesByWorkoutId[W1] || r.similarRoutesByWorkoutId[W1].ok) {
      throw new Error("expected skipped similar routes");
    }
    expect(
      "skipped" in r.similarRoutesByWorkoutId[W1] &&
        r.similarRoutesByWorkoutId[W1].skipped,
    ).toBe(true);

    const wl = vi.mocked(workoutsList.probeWorkoutsList).mock.calls[0]?.[2];
    expect(wl?.pageSize).toBe(RECAP_WORKOUT_LIST_PAGE_SIZE);
    expect(wl?.sortBy).toBe("startedAt");
    expect(wl?.sortOrder).toBe("asc");
  });

  it("returns invalid when list exceeds max pages", async () => {
    const row = { id: W1 };
    const body = JSON.stringify({
      items: Array.from({ length: RECAP_WORKOUT_LIST_PAGE_SIZE }, () => ({
        ...row,
      })),
    });

    vi.spyOn(workoutsList, "probeWorkoutsList").mockResolvedValue({
      kind: "ok",
      status: 200,
      body,
    });

    const r = await fetchRecapWorkoutData({
      baseUrl: "http://localhost:5001",
      apiKey: "tmp_test_key",
      startDate: "2026-05-04T00:00:00.000Z",
      endDate: "2026-05-10T23:59:59.999Z",
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe("invalid");
    expect(r.message).toContain(String(RECAP_WORKOUT_LIST_MAX_PAGES));
    expect(workoutsList.probeWorkoutsList).toHaveBeenCalledTimes(
      RECAP_WORKOUT_LIST_MAX_PAGES,
    );
  });

  it("skips workout GETs when list is empty but still loads shoes", async () => {
    vi.spyOn(workoutsList, "probeWorkoutsList").mockResolvedValue({
      kind: "ok",
      status: 200,
      body: "[]",
    });
    vi.spyOn(workoutGet, "probeWorkoutGet");
    vi.spyOn(workoutTimeSeries, "probeWorkoutTimeSeries");
    vi.spyOn(shoesList, "probeShoesList").mockResolvedValue({
      kind: "ok",
      status: 200,
      body: "[]",
    });

    const r = await fetchRecapWorkoutData({
      baseUrl: "http://localhost:5001",
      apiKey: "tmp_test_key",
      startDate: "2026-05-04T00:00:00.000Z",
      endDate: "2026-05-10T23:59:59.999Z",
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.workoutIds).toHaveLength(0);
    expect(workoutGet.probeWorkoutGet).not.toHaveBeenCalled();
    expect(workoutTimeSeries.probeWorkoutTimeSeries).not.toHaveBeenCalled();
    expect(shoesList.probeShoesList).toHaveBeenCalledTimes(1);
    expect(r.similarRoutesByWorkoutId).toEqual({});
  });

  it("calls similar-routes with maxResults=3 when detail has routeId", async () => {
    vi.spyOn(workoutsList, "probeWorkoutsList").mockResolvedValue({
      kind: "ok",
      status: 200,
      body: JSON.stringify([{ id: W1 }]),
    });
    vi.spyOn(workoutGet, "probeWorkoutGet").mockResolvedValue({
      kind: "ok",
      status: 200,
      body: JSON.stringify({
        id: W1,
        routeId: "route-1",
        startedAt: "2026-05-09T12:00:00Z",
      }),
    });
    vi.spyOn(workoutTimeSeries, "probeWorkoutTimeSeries").mockResolvedValue({
      kind: "ok",
      status: 200,
      body: JSON.stringify({ items: [] }),
    });
    vi.spyOn(shoesList, "probeShoesList").mockResolvedValue({
      kind: "ok",
      status: 200,
      body: "[]",
    });
    const similarSpy = vi
      .spyOn(workoutSimilarRoutes, "probeWorkoutSimilarRoutes")
      .mockResolvedValue({
        kind: "ok",
        status: 200,
        body: "[]",
      });

    const r = await fetchRecapWorkoutData({
      baseUrl: "http://localhost:5001",
      apiKey: "tmp_test_key",
      startDate: "2026-05-04T00:00:00.000Z",
      endDate: "2026-05-10T23:59:59.999Z",
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(similarSpy).toHaveBeenCalledTimes(1);
    expect(similarSpy.mock.calls[0]?.[3]).toEqual({
      maxResults: RECAP_SIMILAR_ROUTES_MAX_RESULTS,
    });
    expect(r.similarRoutesByWorkoutId[W1]?.ok).toBe(true);
  });
});
