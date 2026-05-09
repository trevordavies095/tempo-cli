import { describe, expect, it } from "vitest";

import {
  formatRecapZonesSummary,
  parseAndValidateHeartRateZones,
  parseRecapUnitPreference,
  RECAP_HR_ZONES_REQUIRED_MESSAGE,
} from "./recap-settings.js";

describe("parseRecapUnitPreference", () => {
  it('accepts {"unit":"metric"}', () => {
    expect(parseRecapUnitPreference('{"unit":"metric"}')).toEqual({
      ok: true,
      unit: "metric",
    });
  });

  it("accepts unitPreference imperial", () => {
    expect(
      parseRecapUnitPreference('{"unitPreference":"imperial"}'),
    ).toEqual({
      ok: true,
      unit: "imperial",
    });
  });

  it("rejects unknown unit string", () => {
    expect(parseRecapUnitPreference('{"unit":"nautical"}')).toEqual({
      ok: false,
    });
  });

  it("rejects empty body", () => {
    expect(parseRecapUnitPreference("")).toEqual({ ok: false });
  });
});

describe("parseAndValidateHeartRateZones", () => {
  const fiveZones = [
    { zone: 1, minBpm: 100, maxBpm: 120 },
    { zone: 2, minBpm: 121, maxBpm: 140 },
    { zone: 3, minBpm: 141, maxBpm: 160 },
    { zone: 4, minBpm: 161, maxBpm: 175 },
    { zone: 5, minBpm: 176, maxBpm: 195 },
  ];

  it("accepts root array of 5 zones", () => {
    const r = parseAndValidateHeartRateZones(JSON.stringify(fiveZones));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.zones).toHaveLength(5);
  });

  it("accepts { zones: [...] }", () => {
    const r = parseAndValidateHeartRateZones(
      JSON.stringify({ zones: fiveZones }),
    );
    expect(r.ok).toBe(true);
  });

  it("rejects fewer than 5 zones", () => {
    expect(
      parseAndValidateHeartRateZones(JSON.stringify(fiveZones.slice(0, 4))),
    ).toEqual({ ok: false });
  });

  it("rejects more than 5 zones in array", () => {
    const six = [...fiveZones, { zone: 6, minBpm: 196, maxBpm: 200 }];
    expect(parseAndValidateHeartRateZones(JSON.stringify(six))).toEqual({
      ok: false,
    });
  });

  it("rejects overlapping ranges after sort", () => {
    const bad = [
      { zone: 1, minBpm: 100, maxBpm: 130 },
      { zone: 2, minBpm: 125, maxBpm: 140 },
      { zone: 3, minBpm: 141, maxBpm: 160 },
      { zone: 4, minBpm: 161, maxBpm: 175 },
      { zone: 5, minBpm: 176, maxBpm: 195 },
    ];
    expect(parseAndValidateHeartRateZones(JSON.stringify(bad))).toEqual({
      ok: false,
    });
  });

  it("rejects min >= max", () => {
    const bad = fiveZones.map((z, i) =>
      i === 0 ? { ...z, minBpm: 120, maxBpm: 120 } : z,
    );
    expect(parseAndValidateHeartRateZones(JSON.stringify(bad))).toEqual({
      ok: false,
    });
  });
});

describe("formatRecapZonesSummary", () => {
  it("joins zone ranges", () => {
    const s = formatRecapZonesSummary([
      { zone: 2, minBpm: 121, maxBpm: 140 },
      { zone: 1, minBpm: 100, maxBpm: 120 },
    ]);
    expect(s).toContain("Z1 100–120");
    expect(s).toContain("Z2 121–140");
  });
});

describe("RECAP_HR_ZONES_REQUIRED_MESSAGE", () => {
  it("mentions heart-rate-zones and web UI", () => {
    expect(RECAP_HR_ZONES_REQUIRED_MESSAGE).toContain(
      "tempo settings heart-rate-zones",
    );
    expect(RECAP_HR_ZONES_REQUIRED_MESSAGE).toContain("web UI");
  });
});
