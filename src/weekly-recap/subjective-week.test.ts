import { describe, expect, it } from "vitest";

import {
  buildCoachPromptMarkdown,
  buildSubjectiveRecapMarkdown,
  filterRunsInRecapRange,
  formatSubjectiveRunLine,
  parseSubjectiveWeek,
  subjectiveRunsToDateMap,
} from "./subjective-week.js";
import type { RecapWeekResolved } from "./resolve-week.js";

const resolvedSample: RecapWeekResolved = {
  isoWeekId: "2026-W19",
  localRange: { start: "2026-05-04", end: "2026-05-10" },
  utcStartDate: "2026-05-04T04:00:00.000Z",
  utcEndDate: "2026-05-11T03:59:59.999Z",
  timezoneOffsetMinutes: -240,
};

describe("parseSubjectiveWeek", () => {
  it("parses YAML with runs and weekly", () => {
    const raw = `
week: 2026-W19
runs:
  - date: 2026-05-09
    rpe: 4
    felt: 7
    pain: "tired"
weekly:
  sleep_avg_hrs: 7.2
  stress_level: moderate
`;
    const r = parseSubjectiveWeek(raw, "/x.yaml");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.week).toBe("2026-W19");
    expect(r.value.runs).toHaveLength(1);
    expect(r.value.runs[0]?.rpe).toBe(4);
    expect(r.value.runs[0]?.felt).toBe(7);
    expect(r.value.weekly?.sleep_avg_hrs).toBe(7.2);
  });

  it("parses JSON", () => {
    const raw = JSON.stringify({
      week: "2026-W19",
      runs: [{ date: "2026-05-09", rpe: 5, felt: 8, pain: "none" }],
    });
    const r = parseSubjectiveWeek(raw, "/x.json");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.runs[0]?.pain).toBe("none");
  });

  it("rejects invalid run date", () => {
    const raw = `
week: 2026-W19
runs:
  - date: 05/09/2026
    rpe: 4
`;
    const r = parseSubjectiveWeek(raw, "/x.yaml");
    expect(r.ok).toBe(false);
  });
});

describe("filterRunsInRecapRange / subjectiveRunsToDateMap", () => {
  it("filters runs to recap local range", () => {
    const runs = [
      { date: "2026-05-09", rpe: 4 },
      { date: "2026-05-01", rpe: 3 },
    ];
    const f = filterRunsInRecapRange(runs, resolvedSample);
    expect(f).toHaveLength(1);
    expect(f[0]?.date).toBe("2026-05-09");
  });

  it("maps multiple rows; last wins on duplicate date", () => {
    const runs = [
      { date: "2026-05-09", rpe: 4 },
      { date: "2026-05-09", rpe: 5, felt: 8 },
    ];
    const m = subjectiveRunsToDateMap(runs);
    expect(m.get("2026-05-09")?.rpe).toBe(5);
    expect(m.get("2026-05-09")?.felt).toBe(8);
  });
});

describe("formatSubjectiveRunLine / markdown builders", () => {
  it("formats RPE/Felt/Pain line", () => {
    expect(formatSubjectiveRunLine({ rpe: 4, felt: 7, pain: "ok" })).toBe(
      "RPE: 4/10  ·  Felt: 7/10  ·  Pain: ok",
    );
  });

  it("builds subjective recap and coach sections", () => {
    const md = buildSubjectiveRecapMarkdown({
      sleep_avg_hrs: 7.2,
      sleep_range_hrs: [6.5, 8],
      stress_level: "low",
    });
    expect(md).toContain("## Subjective recap");
    expect(md).toContain("Sleep avg this week: 7.2 hrs");
    expect(md).toContain("Stress level: low");

    const coach = buildCoachPromptMarkdown(["First question?", "Second?"]);
    expect(coach).toContain("## Questions for coach");
    expect(coach).toContain("1. First question?");
    expect(coach).toContain("2. Second?");
  });
});
