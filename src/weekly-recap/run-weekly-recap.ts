/**
 * Stream-free weekly-recap orchestration shared by the CLI and future MCP entry points.
 * Does not read/write process streams; progress via onProgress, soft issues via warnings.
 */

import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  expandUserHomePath,
  getDefaultPrescribedFilePath,
} from "../config/prescribed-path.js";
import { resolveRecapCacheDir } from "../config/recap-paths.js";
import {
  probeAuthMe,
  authFailedApiKeysSettingsMessage,
  authMeHttpErrorMessageForCli,
  AUTH_ME_PATH,
} from "../commands/auth-me.js";
import { atomicWriteFile } from "../commands/workout-media-download.js";
import {
  buildStatsWeeklyRecapPath,
  probeStatsWeeklyRecap,
} from "../commands/stats-weekly-recap.js";
import {
  buildStatsYearlyWeeklyPath,
  probeStatsYearlyWeekly,
} from "../commands/stats-yearly-weekly.js";
import {
  buildStatsRelativeEffortPath,
  probeStatsRelativeEffort,
} from "../commands/stats-relative-effort.js";
import { probeStatsBestEfforts } from "../commands/stats-best-efforts.js";
import {
  SETTINGS_HEART_RATE_ZONES_PATH,
  probeSettingsHeartRateZones,
  settingsHeartRateZonesHttpErrorMessageForCli,
} from "../commands/settings-heart-rate-zones.js";
import {
  SETTINGS_UNIT_PREFERENCE_PATH,
  probeSettingsUnitPreference,
  settingsUnitPreferenceHttpErrorMessageForCli,
} from "../commands/settings-unit-preference.js";
import { transportErrorMessage } from "../commands/health.js";
import {
  CLI_ERROR_HTTP,
  CLI_ERROR_INVALID_ARGUMENTS,
  CLI_ERROR_TRANSPORT,
} from "../output/error.js";

import {
  fetchRecapWorkoutData,
  fetchTrendWorkoutListItems,
  formatTransportMessageWithAttempts,
} from "./fetch-workouts.js";
import {
  computeRecapHrAnalytics,
  formatRecapHrAnalyticsHuman,
  recapHrAnalyticsToJson,
} from "./hr-analytics.js";
import { buildWeeklyRecapCompact } from "./compact-report.js";
import {
  aggregateSummaryStatsFromDetails,
  avgEasyRunHr,
  buildWeeklyRecapMarkdownCore,
} from "./markdown-report.js";
import { buildWeeklyRecapReportPayload } from "./recap-json-report.js";
import {
  buildRecapSummaryFromStats,
  findYearlyWeeklyBucketIndexForRecapMonday,
  parseYearlyWeeklyBuckets,
  parseWeeklyRecapResponse,
} from "./recap-summary-stats.js";
import {
  formatRecapZonesSummary,
  parseAndValidateHeartRateZones,
  parseRecapUnitPreference,
  RECAP_HR_ZONES_REQUIRED_MESSAGE,
  type RecapUnitPreference,
} from "./recap-settings.js";
import {
  priorIsoWeekId,
  resolveRecapWeek,
  resolveTrendWorkoutListUtcBounds,
  type RecapWeekResolved,
} from "./resolve-week.js";
import {
  buildNotableMarkdownSection,
  buildRecapNotableSnapshot,
  recapNotableSnapshotToJson,
} from "./notable.js";
import { buildLongRunSectionOutput } from "./long-run-section.js";
import { buildPrescribedQualityOutput } from "./quality-sessions.js";
import { normalizeIsoWeekId } from "./prescribed-week.js";
import {
  buildCoachPromptMarkdown,
  buildSubjectiveRecapMarkdown,
  filterRunsInRecapRange,
  subjectiveRunsToDateMap,
  type SubjectiveRunFields,
  type SubjectiveWeekDoc,
} from "./subjective-week.js";
import {
  buildTrendsMarkdownSection,
  computeRecapTrendsSnapshot,
  recapTrendsSnapshotToJson,
} from "./trends.js";

export type SubjectiveSource =
  | { kind: "skipped" }
  | {
      kind: "absent";
      path: string;
      parseError?: string;
    }
  | {
      kind: "provided";
      path: string;
      doc: SubjectiveWeekDoc;
      loadedFromFile: boolean;
      interactiveSaved: boolean;
      savePath?: string;
      source: "file" | "interactive" | "unknown";
      parseError?: string;
    };

/** Deferred TTY/file resolution after workouts are fetched (CLI supplies collect). */
export type SubjectiveCollect = {
  kind: "collect";
  path: string;
  parseError?: string;
  collect: (ctx: {
    isoWeekId: string;
    workoutDetails: readonly { id: string; body: string }[];
    timeZoneId: string;
    unit: RecapUnitPreference;
  }) => Promise<SubjectiveSource>;
};

export type RunWeeklyRecapInput = {
  baseUrl: string;
  apiKey: string;
  weekSpec: string;
  timeZoneId: string;
  format: "markdown" | "json" | "compact";
  includeTrends: boolean;
  prescribedFile?: string;
  prescribedDir?: string;
  cacheDirFlag?: string;
  cacheDirConfig?: string;
  now?: Date;
  subjective: SubjectiveSource | SubjectiveCollect;
  onProgress?: (line: string) => void;
};

export type RunWeeklyRecapOk = {
  ok: true;
  humanSuccessBody: string;
  jsonBody: Record<string, unknown>;
  warnings: string[];
  resolved: RecapWeekResolved;
  timeZoneId: string;
  subjectiveState: "skipped" | "present" | "missing";
};

export type RunWeeklyRecapErr = {
  ok: false;
  code: string;
  message: string;
  exit: "usage" | { httpStatus: number } | { transport: unknown };
};

export type RunWeeklyRecapResult = RunWeeklyRecapOk | RunWeeklyRecapErr;

function usageErr(message: string): RunWeeklyRecapErr {
  return {
    ok: false,
    code: CLI_ERROR_INVALID_ARGUMENTS,
    message,
    exit: "usage",
  };
}

function httpErr(message: string, httpStatus: number): RunWeeklyRecapErr {
  return {
    ok: false,
    code: CLI_ERROR_HTTP,
    message,
    exit: { httpStatus },
  };
}

function transportErr(message: string, transport: unknown): RunWeeklyRecapErr {
  return {
    ok: false,
    code: CLI_ERROR_TRANSPORT,
    message,
    exit: { transport },
  };
}

/**
 * Run the weekly recap pipeline. Never touches process streams.
 */
export async function runWeeklyRecap(
  input: RunWeeklyRecapInput,
): Promise<RunWeeklyRecapResult> {
  const warnings: string[] = [];
  const progress = (line: string) => {
    input.onProgress?.(line);
  };

  const now = input.now ?? new Date();
  const tz = input.timeZoneId;
  const key = input.apiKey;
  const baseUrl = input.baseUrl;

  const resolved = resolveRecapWeek({
    weekSpec: input.weekSpec,
    timeZoneId: tz,
    now,
  });
  if (!resolved.ok) {
    return usageErr(`tempo weekly-recap: ${resolved.message}`);
  }

  const authResult = await probeAuthMe(baseUrl, key);
  if (authResult.kind === "http") {
    if (authResult.status === 401) {
      return httpErr(authFailedApiKeysSettingsMessage(baseUrl), 401);
    }
    return httpErr(
      `tempo weekly-recap: ${authMeHttpErrorMessageForCli(
        authResult.status,
        authResult.body,
        key,
      )}`,
      authResult.status,
    );
  }
  if (authResult.kind === "transport") {
    return transportErr(
      formatTransportMessageWithAttempts(
        `tempo weekly-recap: ${transportErrorMessage(authResult.error)}`,
        [`GET ${AUTH_ME_PATH}`],
      ),
      authResult.error,
    );
  }

  progress(
    `tempo weekly-recap: GET ${AUTH_ME_PATH} OK (HTTP ${authResult.status})`,
  );

  const [hrRes, unitRes] = await Promise.all([
    probeSettingsHeartRateZones(baseUrl, key),
    probeSettingsUnitPreference(baseUrl, key),
  ]);

  if (hrRes.kind === "transport") {
    return transportErr(
      formatTransportMessageWithAttempts(
        `tempo weekly-recap: ${transportErrorMessage(hrRes.error)}`,
        [`GET ${SETTINGS_HEART_RATE_ZONES_PATH}`],
      ),
      hrRes.error,
    );
  }
  if (unitRes.kind === "transport") {
    return transportErr(
      formatTransportMessageWithAttempts(
        `tempo weekly-recap: ${transportErrorMessage(unitRes.error)}`,
        [`GET ${SETTINGS_UNIT_PREFERENCE_PATH}`],
      ),
      unitRes.error,
    );
  }
  if (hrRes.kind === "http") {
    return httpErr(
      `tempo weekly-recap: ${settingsHeartRateZonesHttpErrorMessageForCli(
        hrRes.status,
        hrRes.body,
        key,
      )}`,
      hrRes.status,
    );
  }
  if (unitRes.kind === "http") {
    return httpErr(
      `tempo weekly-recap: ${settingsUnitPreferenceHttpErrorMessageForCli(
        unitRes.status,
        unitRes.body,
        key,
      )}`,
      unitRes.status,
    );
  }

  const zonesParsed = parseAndValidateHeartRateZones(hrRes.body);
  if (!zonesParsed.ok) {
    return usageErr(`tempo weekly-recap: ${RECAP_HR_ZONES_REQUIRED_MESSAGE}`);
  }

  const unitParsed = parseRecapUnitPreference(unitRes.body);
  if (!unitParsed.ok) {
    return usageErr(
      "tempo weekly-recap: could not parse unit preference (expected metric or imperial).",
    );
  }

  const v = resolved.value;

  progress(
    `tempo weekly-recap: week ${v.isoWeekId} (${v.localRange.start}–${v.localRange.end})`,
  );

  const trendUtc = resolveTrendWorkoutListUtcBounds(v, tz);

  const [fetchData, trendListRes, wrRes, reRes, beRes] = await Promise.all([
    fetchRecapWorkoutData({
      baseUrl,
      apiKey: key,
      startDate: v.utcStartDate,
      endDate: v.utcEndDate,
    }),
    input.includeTrends
      ? fetchTrendWorkoutListItems({
          baseUrl,
          apiKey: key,
          utcStartDate: trendUtc.utcStartDate,
          utcEndDate: trendUtc.utcEndDate,
        })
      : Promise.resolve({
          ok: true as const,
          items: [] as Record<string, unknown>[],
        }),
    probeStatsWeeklyRecap(baseUrl, key, {
      timezoneOffsetMinutes: v.timezoneOffsetMinutes,
      referenceDate: v.localRange.start,
    }),
    probeStatsRelativeEffort(baseUrl, key, {
      timezoneOffsetMinutes: v.timezoneOffsetMinutes,
    }),
    probeStatsBestEfforts(baseUrl, key),
  ]);

  if (!fetchData.ok) {
    if (fetchData.kind === "invalid") {
      return usageErr(fetchData.message);
    }
    if (fetchData.kind === "http") {
      return httpErr(fetchData.message, fetchData.httpStatus ?? 400);
    }
    return transportErr(
      formatTransportMessageWithAttempts(
        `tempo weekly-recap: ${fetchData.message}`,
        fetchData.attemptedEndpoints,
      ),
      fetchData.transportError ?? new Error(fetchData.message),
    );
  }

  const weeklyRecapParsed =
    wrRes.kind === "ok" ? parseWeeklyRecapResponse(wrRes.body) : undefined;

  let yearlyWeeklyBody: string | undefined;
  let yearlyWeeklyOk = false;
  if (weeklyRecapParsed === undefined) {
    const yw = await probeStatsYearlyWeekly(baseUrl, key, {
      periodEndDate: v.localRange.end,
      timezoneOffsetMinutes: v.timezoneOffsetMinutes,
    });
    if (yw.kind === "ok") {
      yearlyWeeklyOk = true;
      yearlyWeeklyBody = yw.body;
    }
  }

  progress(
    `tempo weekly-recap: workouts list rows=${fetchData.listItemCount}, detail bodies=${fetchData.workoutDetails.length}`,
  );

  const zoneSummary = formatRecapZonesSummary(zonesParsed.zones);

  let shoesHuman = `Shoes: OK (HTTP ${fetchData.shoesStatus})`;
  try {
    const sp = JSON.parse(fetchData.shoesBody.trim()) as unknown;
    if (Array.isArray(sp)) {
      shoesHuman = `Shoes: OK (${sp.length} shoe(s), HTTP ${fetchData.shoesStatus})`;
    }
  } catch {
    /* ignore */
  }

  const hrAnalytics = computeRecapHrAnalytics({
    zones: zonesParsed.zones,
    heartRateZonesBody: hrRes.body,
    workoutDetails: fetchData.workoutDetails.map((d) => ({
      id: d.id,
      body: d.body,
    })),
    timeSeriesByWorkoutId: fetchData.timeSeriesByWorkoutId,
  });

  const workoutDetailSlice = fetchData.workoutDetails.map((d) => ({
    id: d.id,
    body: d.body,
  }));

  const prescribedPathResolved = expandUserHomePath(
    input.prescribedFile?.trim() ||
      getDefaultPrescribedFilePath(v.isoWeekId, input.prescribedDir),
  );
  progress(`tempo weekly-recap: prescribed file ${prescribedPathResolved}`);
  let prescribedRaw: string | undefined;
  try {
    prescribedRaw = await readFile(prescribedPathResolved, "utf8");
  } catch {
    prescribedRaw = undefined;
  }

  const qualityOut = buildPrescribedQualityOutput({
    fileContent: prescribedRaw,
    resolvedPath: prescribedPathResolved,
    resolvedIsoWeekId: v.isoWeekId,
    timeZoneId: tz,
    workoutDetails: workoutDetailSlice,
    timeSeriesByWorkoutId: fetchData.timeSeriesByWorkoutId,
  });

  const longRunOut = buildLongRunSectionOutput({
    prescribedRaw,
    workoutDetails: workoutDetailSlice,
    hrAnalytics,
    timeZoneId: tz,
    unit: unitParsed.unit,
    resolvedIsoWeekId: v.isoWeekId,
  });

  const relativeEffortOk = reRes.kind === "ok";
  const relativeEffortBody = relativeEffortOk ? reRes.body : undefined;

  {
    const wrPath = buildStatsWeeklyRecapPath({
      timezoneOffsetMinutes: v.timezoneOffsetMinutes,
      referenceDate: v.localRange.start,
    });
    if (wrRes.kind === "ok") {
      progress(
        `tempo weekly-recap: GET ${wrPath} OK (HTTP ${wrRes.status})`,
      );
    } else if (wrRes.kind === "http") {
      progress(`tempo weekly-recap: GET ${wrPath} HTTP ${wrRes.status}`);
    } else {
      progress(
        `tempo weekly-recap: GET ${wrPath} transport: ${transportErrorMessage(wrRes.error)}`,
      );
    }

    if (weeklyRecapParsed === undefined) {
      const ywQuery = {
        periodEndDate: v.localRange.end,
        timezoneOffsetMinutes: v.timezoneOffsetMinutes,
      };
      const ywPath = buildStatsYearlyWeeklyPath(ywQuery);
      progress(
        `tempo weekly-recap: GET ${ywPath} (fallback: weekly-recap unavailable or unparseable)`,
      );
      if (yearlyWeeklyOk && yearlyWeeklyBody !== undefined) {
        const buckets = parseYearlyWeeklyBuckets(yearlyWeeklyBody);
        const idx = findYearlyWeeklyBucketIndexForRecapMonday(
          v.localRange.start,
          buckets,
        );
        const first = buckets[0]?.weekStartYmd;
        const last = buckets[buckets.length - 1]?.weekStartYmd;
        progress(
          `tempo weekly-recap: yearly-weekly rollup: buckets=${buckets.length} span ${first ?? "n/a"}…${last ?? "n/a"}; recapMonday=${v.localRange.start} matchedIndex=${idx}`,
        );
      }
    }

    const rePath = buildStatsRelativeEffortPath({
      timezoneOffsetMinutes: v.timezoneOffsetMinutes,
    });
    if (reRes.kind === "ok") {
      progress(
        `tempo weekly-recap: GET ${rePath} OK (HTTP ${reRes.status})`,
      );
    } else if (reRes.kind === "http") {
      progress(`tempo weekly-recap: GET ${rePath} HTTP ${reRes.status}`);
    } else {
      progress(
        `tempo weekly-recap: GET ${rePath} transport: ${transportErrorMessage(reRes.error)}`,
      );
    }
  }

  const agg = aggregateSummaryStatsFromDetails(fetchData.workoutDetails);
  const summaryFromStats = buildRecapSummaryFromStats({
    resolved: v,
    weeklyRecapParsed,
    yearlyWeeklyBody,
    yearlyWeeklyOk,
    relativeEffortBody,
    relativeEffortOk,
    workoutDistanceM: agg.totalDistanceM,
    workoutDurationS: agg.totalDurationS,
    workoutElevM: agg.totalElevM,
    workoutReSum: agg.totalRe,
    runCount: fetchData.workoutDetails.length,
    easyAvgThisWeek: avgEasyRunHr(hrAnalytics),
  });

  const cacheDir = resolveRecapCacheDir({
    cacheDirFlag: input.cacheDirFlag,
    reportCacheDir: input.cacheDirConfig,
  });
  progress(`tempo weekly-recap: cache dir ${cacheDir}`);
  const priorWeekId = priorIsoWeekId(v, tz);
  let priorBestEffortsBody: string | undefined;
  let hadPriorCache = false;
  try {
    const priorPath = join(cacheDir, `best-efforts-${priorWeekId}.json`);
    priorBestEffortsBody = await readFile(priorPath, "utf8");
    hadPriorCache = priorBestEffortsBody.trim().length > 0;
  } catch {
    priorBestEffortsBody = undefined;
    hadPriorCache = false;
  }
  progress(
    `tempo weekly-recap: prior best-efforts cache ${hadPriorCache ? "read" : "missing"} (${join(cacheDir, `best-efforts-${priorWeekId}.json`)})`,
  );

  const beOk = beRes.kind === "ok";
  const currentBestEffortsBody = beOk ? beRes.body : undefined;

  const notableSnapshot = buildRecapNotableSnapshot({
    bestEffortsFetchOk: beOk,
    currentBestEffortsBody,
    priorBestEffortsBody,
    hadPriorCache,
    shoesBody: fetchData.shoesBody,
    workoutDetails: workoutDetailSlice,
    workoutReSum: agg.totalRe,
    summaryFromStats,
  });

  const notableMarkdown = buildNotableMarkdownSection(notableSnapshot);

  if (beOk && currentBestEffortsBody?.trim()) {
    try {
      await mkdir(cacheDir, { recursive: true });
      const bePath = join(cacheDir, `best-efforts-${v.isoWeekId}.json`);
      await atomicWriteFile(
        bePath,
        new TextEncoder().encode(currentBestEffortsBody),
      );
      progress(`tempo weekly-recap: wrote best-efforts cache ${bePath}`);
    } catch {
      /* best-efforts cache write is non-fatal */
    }
  }

  let trendsFetchReason: string | undefined;
  let trendItems: Record<string, unknown>[] = [];
  if (input.includeTrends) {
    if (trendListRes.ok) {
      trendItems = trendListRes.items;
    } else {
      trendsFetchReason =
        trendListRes.kind === "transport" &&
        trendListRes.attemptedEndpoints?.length
          ? formatTransportMessageWithAttempts(
              `tempo weekly-recap: ${trendListRes.message}`,
              trendListRes.attemptedEndpoints,
            )
          : trendListRes.kind === "transport"
            ? `tempo weekly-recap: ${trendListRes.message}`
            : trendListRes.message;
    }
  }

  const trendsSnapshot = computeRecapTrendsSnapshot({
    resolved: v,
    timeZoneId: tz,
    zones: zonesParsed.zones,
    trendListItems: trendItems,
    recapWorkoutDetails: workoutDetailSlice,
    included: input.includeTrends,
    fetchFailedReason: trendsFetchReason,
  });

  const trendsMarkdown = buildTrendsMarkdownSection(
    trendsSnapshot,
    unitParsed.unit,
  );

  let subjectiveRecapMd = "";
  let coachPromptMd = "";
  let subjectiveByRunDate = new Map<string, SubjectiveRunFields>();
  let subjectivePayload: Record<string, unknown>;
  let subjectiveState: "skipped" | "present" | "missing";

  let subjectiveResolved: SubjectiveSource;
  if (input.subjective.kind === "collect") {
    progress(`tempo weekly-recap: subjective file ${input.subjective.path}`);
    subjectiveResolved = await input.subjective.collect({
      isoWeekId: v.isoWeekId,
      workoutDetails: workoutDetailSlice,
      timeZoneId: tz,
      unit: unitParsed.unit,
    });
  } else {
    subjectiveResolved = input.subjective;
    if (subjectiveResolved.kind !== "skipped") {
      progress(`tempo weekly-recap: subjective file ${subjectiveResolved.path}`);
    }
  }

  if (subjectiveResolved.kind === "skipped") {
    subjectivePayload = { skipped: true };
    subjectiveState = "skipped";
  } else if (subjectiveResolved.kind === "absent") {
    subjectivePayload = {
      skipped: false,
      reason: "no_subjective_data",
      path: subjectiveResolved.path,
      parseError: subjectiveResolved.parseError,
    };
    subjectiveState = "missing";
  } else {
    const subjectiveDoc = subjectiveResolved.doc;
    const runsInWeek = filterRunsInRecapRange(subjectiveDoc.runs, v);
    if (subjectiveResolved.loadedFromFile) {
      const fileWeekNorm = normalizeIsoWeekId(subjectiveDoc.week);
      const recapWeekNorm = normalizeIsoWeekId(v.isoWeekId);
      if (fileWeekNorm !== recapWeekNorm) {
        warnings.push(
          `tempo weekly-recap: subjective file week (\`${subjectiveDoc.week}\`) does not match recap week (\`${v.isoWeekId}\`); check ${subjectiveResolved.path}`,
        );
      }
      if (runsInWeek.length === 0 && workoutDetailSlice.length > 0) {
        warnings.push(
          `tempo weekly-recap: subjective file has no runs for ${v.isoWeekId}; per-run fields omitted. Delete the file or pass --refresh-subjective to re-prompt.`,
        );
      }
    }
    subjectiveByRunDate = subjectiveRunsToDateMap(runsInWeek);
    subjectiveRecapMd = buildSubjectiveRecapMarkdown(subjectiveDoc.weekly);
    coachPromptMd = buildCoachPromptMarkdown(
      subjectiveDoc.weekly?.questions_for_coach,
    );
    subjectivePayload = {
      skipped: false,
      path: subjectiveResolved.path,
      loadedFromFile: subjectiveResolved.loadedFromFile,
      parseError: subjectiveResolved.parseError,
      interactiveSaved: subjectiveResolved.interactiveSaved,
      savePath: subjectiveResolved.interactiveSaved
        ? subjectiveResolved.savePath
        : undefined,
      week: subjectiveDoc.week,
      runs: runsInWeek,
      weekly: subjectiveDoc.weekly ?? null,
      source: subjectiveResolved.source,
    };
    subjectiveState = "present";
  }

  const reportMarkdown = buildWeeklyRecapMarkdownCore({
    resolved: v,
    timeZoneId: tz,
    unit: unitParsed.unit,
    hrAnalytics,
    workoutDetails: workoutDetailSlice,
    shoesBody: fetchData.shoesBody,
    summaryFromStats,
    similarRoutesByWorkoutId: fetchData.similarRoutesByWorkoutId,
    qualitySessionsMarkdown: qualityOut.markdown,
    longRunMarkdown: longRunOut.markdown,
    trendsMarkdown,
    notableMarkdown,
    subjectiveRecapMarkdown: subjectiveRecapMd,
    coachPromptMarkdown: coachPromptMd,
    subjectiveByRunDate,
  });

  const diagnosticHumanLines = [
    `Week ${v.isoWeekId} (${v.localRange.start} → ${v.localRange.end}, ${tz})`,
    `UTC startDate: ${v.utcStartDate}`,
    `UTC endDate: ${v.utcEndDate}`,
    `timezoneOffsetMinutes: ${v.timezoneOffsetMinutes}`,
    `Unit preference: ${unitParsed.unit}`,
    `Heart rate zones: OK (5 zones) — ${zoneSummary}`,
    `Workouts in range (list rows): ${fetchData.listItemCount}`,
    `Unique workout IDs: ${fetchData.workoutIds.length}`,
    `Detail bodies fetched: ${fetchData.workoutDetails.length}`,
    shoesHuman,
    "",
    formatRecapHrAnalyticsHuman(hrAnalytics),
  ].join("\n");

  const compactText =
    input.format === "compact"
      ? buildWeeklyRecapCompact({
          resolved: v,
          timeZoneId: tz,
          unit: unitParsed.unit,
          hrAnalytics,
          workoutDetails: workoutDetailSlice,
          summaryFromStats,
          notableSnapshot,
        })
      : undefined;

  const humanSuccessBody =
    input.format === "markdown"
      ? reportMarkdown
      : input.format === "compact"
        ? (compactText ?? "")
        : diagnosticHumanLines;

  const trendsJson = recapTrendsSnapshotToJson(trendsSnapshot);

  const jsonBody: Record<string, unknown> = {
    ok: true,
    isoWeekId: v.isoWeekId,
    localRange: v.localRange,
    utcStartDate: v.utcStartDate,
    utcEndDate: v.utcEndDate,
    timezone: tz,
    timezoneOffsetMinutes: v.timezoneOffsetMinutes,
    recapFormat: input.format,
    settings: {
      unitPreference: unitParsed.unit,
      heartRateZones: {
        zones: zonesParsed.zones,
      },
    },
    workouts: {
      count: fetchData.workoutIds.length,
      ids: fetchData.workoutIds,
      details: fetchData.workoutDetails.map((d) => ({
        id: d.id,
        status: d.status,
        body: d.body,
        similarRoutes: fetchData.similarRoutesByWorkoutId[d.id],
      })),
    },
    shoes: {
      status: fetchData.shoesStatus,
      body: fetchData.shoesBody,
    },
    hrAnalytics: recapHrAnalyticsToJson(hrAnalytics),
    stats: {
      weeklyRecap: {
        ok: wrRes.kind === "ok",
        parsed: weeklyRecapParsed !== undefined,
        ...(wrRes.kind === "ok" || wrRes.kind === "http"
          ? { httpStatus: wrRes.status }
          : {}),
        ...(wrRes.kind === "transport" ? { transportError: true } : {}),
      },
      relativeEffort: {
        ok: relativeEffortOk,
        ...(reRes.kind === "ok" || reRes.kind === "http"
          ? { httpStatus: reRes.status }
          : {}),
        ...(reRes.kind === "transport" ? { transportError: true } : {}),
      },
      recapSummary: summaryFromStats,
    },
    trends: trendsJson,
    notable: recapNotableSnapshotToJson(notableSnapshot),
    prescribed: qualityOut.json,
    longRun: longRunOut.json,
    subjective: subjectivePayload,
    report: buildWeeklyRecapReportPayload({
      resolved: v,
      hrAnalytics,
      workoutDetails: workoutDetailSlice,
      summaryFromStats,
      trendsJson,
      subjective: subjectivePayload,
    }),
  };

  if (input.format === "markdown") {
    jsonBody.reportMarkdown = reportMarkdown;
  }
  if (input.format === "compact" && compactText !== undefined) {
    jsonBody.compactText = compactText;
  }

  return {
    ok: true,
    humanSuccessBody,
    jsonBody,
    warnings,
    resolved: v,
    timeZoneId: tz,
    subjectiveState,
  };
}
