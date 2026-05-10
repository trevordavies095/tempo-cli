/**
 * When §2.2 summary columns show "—" for prev / 3-wk / Δ, the CLI may be on the
 * yearly-weekly + relative-effort fallback (GET /stats/weekly-recap missing, non-OK, or unparsed).
 *
 * Verify locally:
 * - `tempo weekly-recap --verbose` — look for GET /stats/weekly-recap OK vs yearly-weekly fallback.
 * - `tempo --output json weekly-recap` — inspect `stats.weeklyRecap` (`ok`, `httpStatus`, `parsed`) and
 *   `recapSummary.weeklyRecapOk` (or `report.summary.weeklyRecapOk`). When `parsed` is true and
 *   `weeklyRecapOk` is true, comparison columns come from the weekly-recap API.
 */
import { describe, expect, it } from "vitest";

import {
  buildRecapSummaryFromStats,
  parseWeeklyRecapResponse,
} from "./recap-summary-stats.js";
import type { RecapWeekResolved } from "./resolve-week.js";

const resolved: RecapWeekResolved = {
  isoWeekId: "2026-W19",
  localRange: { start: "2026-05-04", end: "2026-05-10" },
  utcStartDate: "2026-05-04T04:00:00.000Z",
  utcEndDate: "2026-05-11T03:59:59.999Z",
  timezoneOffsetMinutes: -240,
};

describe("weekly-recap JSON diagnostics contract", () => {
  it("parseWeeklyRecapResponse defined iff stats.weeklyRecap.parsed would be true", () => {
    const okBody = JSON.stringify({
      metrics: { runs: { current: 1, previous: 1, trailingAvg: 1 } },
    });
    expect(parseWeeklyRecapResponse(okBody)).toBeDefined();
    expect(parseWeeklyRecapResponse(JSON.stringify({}))).toBeUndefined();
  });

  it("buildRecapSummaryFromStats sets weeklyRecapOk when weeklyRecapParsed is provided", () => {
    const parsed = parseWeeklyRecapResponse(
      JSON.stringify({
        metrics: {
          runs: { previous: 3, trailingAvg: 3.5, current: 4 },
          relativeEffortSum: { previous: 100, trailingAvg: 110, current: 120 },
        },
      }),
    );
    expect(parsed).toBeDefined();
    const s = buildRecapSummaryFromStats({
      resolved,
      weeklyRecapParsed: parsed,
      yearlyWeeklyOk: false,
      relativeEffortOk: false,
      workoutDistanceM: 0,
      workoutDurationS: 0,
      workoutElevM: 0,
      workoutReSum: 120,
      runCount: 4,
    });
    expect(s.weeklyRecapOk).toBe(true);
    expect(s.yearlyWeeklyOk).toBe(false);
    expect(s.runs.prev).toBe(3);
  });
});
