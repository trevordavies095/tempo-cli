import { describe, expect, it } from "vitest";

import type { RecapSummaryFromStats } from "./recap-summary-stats.js";
import {
  NOTABLE_SHOE_MILEAGE_WARN_MI,
  buildNotableMarkdownSection,
  buildRecapNotableSnapshot,
  diffBestEfforts,
  evaluateRelativeEffortOverload,
  parseBestEffortsBody,
  parseEffortSeconds,
} from "./notable.js";

describe("parseEffortSeconds", () => {
  it("parses MM:SS", () => {
    expect(parseEffortSeconds("21:45")).toBe(21 * 60 + 45);
  });

  it("parses H:MM:SS", () => {
    expect(parseEffortSeconds("1:21:03")).toBe(3600 + 21 * 60 + 3);
  });
});

describe("diffBestEfforts", () => {
  it("detects strictly faster time for same normalized key", () => {
    const prior = JSON.stringify({
      "5 km": { distance: "5 km", time: "22:10" },
    });
    const cur = JSON.stringify({
      "5 km": { distance: "5 km", time: "21:45" },
    });
    const prs = diffBestEfforts(cur, prior);
    expect(prs).toHaveLength(1);
    expect(prs[0]!.label).toContain("5");
  });

  it("returns empty when not improved", () => {
    const body = JSON.stringify({
      "5 km": { distance: "5 km", time: "22:10" },
    });
    expect(diffBestEfforts(body, body)).toHaveLength(0);
  });
});

describe("evaluateRelativeEffortOverload", () => {
  it("flags when week RE >= 1.3x three-week average", () => {
    const summary = {
      yearlyWeeklyOk: true,
      relativeEffortOk: true,
      mileage: {},
      runs: {},
      time: {},
      elevation: {},
      relativeEffort: { threeWkAvg: 100 },
    } as RecapSummaryFromStats;
    const r = evaluateRelativeEffortOverload({
      workoutReSum: 130,
      summaryFromStats: summary,
    });
    expect(r.flagged).toBe(true);
  });

  it("does not flag below threshold", () => {
    const summary = {
      yearlyWeeklyOk: true,
      relativeEffortOk: true,
      mileage: {},
      runs: {},
      time: {},
      elevation: {},
      relativeEffort: { threeWkAvg: 100 },
    } as RecapSummaryFromStats;
    const r = evaluateRelativeEffortOverload({
      workoutReSum: 129,
      summaryFromStats: summary,
    });
    expect(r.flagged).toBe(false);
  });
});

describe("buildRecapNotableSnapshot", () => {
  it("includes shoe bullet when mileage exceeds threshold", () => {
    const shoesBody = JSON.stringify([
      {
        id: "11111111-2222-3333-4444-555555555555",
        brand: "Test",
        model: "Shoe",
        mileageMi: 412,
      },
    ]);
    const workoutDetails = [
      {
        id: "aaaa",
        body: JSON.stringify({
          shoeId: "11111111-2222-3333-4444-555555555555",
        }),
      },
    ];
    const snap = buildRecapNotableSnapshot({
      bestEffortsFetchOk: false,
      shoesBody,
      workoutDetails,
      workoutReSum: 0,
      summaryFromStats: undefined,
      hadPriorCache: false,
    });
    expect(snap.bullets.some((b) => b.includes("412"))).toBe(true);
    expect(snap.shoesOverThreshold[0]!.mileageMi).toBeGreaterThan(
      NOTABLE_SHOE_MILEAGE_WARN_MI,
    );
  });

  it("renders markdown section when bullets exist", () => {
    const md = buildNotableMarkdownSection({
      bullets: ["No PRs"],
      bestEfforts: { fetchOk: true, hadPriorCache: true, prs: [] },
      shoesOverThreshold: [],
      overload: { flagged: false },
    });
    expect(md).toContain("## Notable");
    expect(md).toContain("- No PRs");
  });

  it("returns empty markdown when no bullets", () => {
    expect(
      buildNotableMarkdownSection({
        bullets: [],
        bestEfforts: { fetchOk: false, hadPriorCache: false, prs: [] },
        shoesOverThreshold: [],
        overload: { flagged: false },
      }),
    ).toBe("");
  });
});

describe("parseBestEffortsBody", () => {
  it("parses object map shape", () => {
    const m = parseBestEffortsBody(
      JSON.stringify({ Half: { distance: "Half", time: "1:30:00" } }),
    );
    expect(m.size).toBeGreaterThan(0);
    const first = [...m.values()][0]!;
    expect(first.seconds).toBe(5400);
  });
});
