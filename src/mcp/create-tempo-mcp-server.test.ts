import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as authMe from "../commands/auth-me.js";
import * as settingsHr from "../commands/settings-heart-rate-zones.js";
import * as settingsUnit from "../commands/settings-unit-preference.js";
import * as statsBestEfforts from "../commands/stats-best-efforts.js";
import * as statsRelativeEffort from "../commands/stats-relative-effort.js";
import * as statsWeeklyRecap from "../commands/stats-weekly-recap.js";
import * as statsYearlyWeekly from "../commands/stats-yearly-weekly.js";
import * as fetchWorkouts from "../weekly-recap/fetch-workouts.js";
import { parseSubjectiveWeek } from "../weekly-recap/subjective-week.js";
import {
  CHECK_CONNECTION_TOOL_DESCRIPTION,
  CHECK_CONNECTION_TOOL_NAME,
  createTempoMcpServer,
} from "./create-tempo-mcp-server.js";
import {
  GENERATE_WEEKLY_RECAP_TOOL_DESCRIPTION,
  GENERATE_WEEKLY_RECAP_TOOL_NAME,
} from "./generate-weekly-recap.js";
import {
  SAVE_SUBJECTIVE_RESPONSES_TOOL_DESCRIPTION,
  SAVE_SUBJECTIVE_RESPONSES_TOOL_NAME,
} from "./save-subjective-responses.js";

const originalFetch = globalThis.fetch;
const SECRET_KEY = "tmp_protocol_secret_key";
const BASE = "http://localhost:5001";

const fiveZones = [
  { zone: 1, minBpm: 100, maxBpm: 120 },
  { zone: 2, minBpm: 121, maxBpm: 140 },
  { zone: 3, minBpm: 141, maxBpm: 160 },
  { zone: 4, minBpm: 161, maxBpm: 175 },
  { zone: 5, minBpm: 176, maxBpm: 195 },
];

function zonesBody(): string {
  return JSON.stringify({
    calculationMethod: "AgeBased",
    age: 40,
    zones: fiveZones,
  });
}

function mockHappyPathProbes(
  workoutDetails: { id: string; status: number; body: string }[] = [],
) {
  vi.spyOn(authMe, "probeAuthMe").mockResolvedValue({
    kind: "ok",
    status: 200,
    body: JSON.stringify({ id: "u1", name: "Ada" }),
  });
  vi.spyOn(settingsHr, "probeSettingsHeartRateZones").mockResolvedValue({
    kind: "ok",
    status: 200,
    body: zonesBody(),
  });
  vi.spyOn(settingsUnit, "probeSettingsUnitPreference").mockResolvedValue({
    kind: "ok",
    status: 200,
    body: JSON.stringify({ unit: "imperial" }),
  });
  vi.spyOn(fetchWorkouts, "fetchRecapWorkoutData").mockResolvedValue({
    ok: true,
    listItemCount: workoutDetails.length,
    workoutIds: workoutDetails.map((d) => d.id),
    workoutDetails,
    timeSeriesByWorkoutId: {},
    shoesStatus: 200,
    shoesBody: "[]",
    similarRoutesByWorkoutId: {},
  });
  vi.spyOn(fetchWorkouts, "fetchTrendWorkoutListItems").mockResolvedValue({
    ok: true,
    items: [],
  });
  vi.spyOn(statsWeeklyRecap, "probeStatsWeeklyRecap").mockResolvedValue({
    kind: "ok",
    status: 200,
    body: JSON.stringify({}),
  });
  vi.spyOn(statsRelativeEffort, "probeStatsRelativeEffort").mockResolvedValue({
    kind: "ok",
    status: 200,
    body: JSON.stringify({}),
  });
  vi.spyOn(statsBestEfforts, "probeStatsBestEfforts").mockResolvedValue({
    kind: "ok",
    status: 200,
    body: JSON.stringify({}),
  });
  vi.spyOn(statsYearlyWeekly, "probeStatsYearlyWeekly").mockResolvedValue({
    kind: "ok",
    status: 200,
    body: JSON.stringify([]),
  });
}

function connRefused(): TypeError {
  const err = new TypeError("fetch failed");
  (err as Error & { cause: { code: string } }).cause = {
    code: "ECONNREFUSED",
  };
  return err;
}

async function connectPair(config: {
  baseUrl: string;
  apiKey?: string;
  subjectiveDir?: string;
  cacheDir?: string;
  timezone?: string;
}): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = createTempoMcpServer({
    ...config,
    name: "tempo-cli-test",
    version: "0.0.0-test",
    includeTrendsDefault: false,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function toolText(result: {
  content: unknown;
}): string {
  return (result.content as { type: string; text: string }[])
    .map((c) => c.text)
    .join("\n");
}

describe("createTempoMcpServer (protocol)", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("tools/list returns three tools with stable schema snapshot", async () => {
    const { client, close } = await connectPair({
      baseUrl: BASE,
      apiKey: SECRET_KEY,
    });
    try {
      const listed = await client.listTools();
      expect(listed.tools).toHaveLength(3);
      const byName = Object.fromEntries(
        listed.tools.map((t) => [t.name, t]),
      );
      expect(byName[CHECK_CONNECTION_TOOL_NAME]?.description).toBe(
        CHECK_CONNECTION_TOOL_DESCRIPTION,
      );
      expect(byName[GENERATE_WEEKLY_RECAP_TOOL_NAME]?.description).toBe(
        GENERATE_WEEKLY_RECAP_TOOL_DESCRIPTION,
      );
      expect(byName[SAVE_SUBJECTIVE_RESPONSES_TOOL_NAME]?.description).toBe(
        SAVE_SUBJECTIVE_RESPONSES_TOOL_DESCRIPTION,
      );
      expect(
        listed.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      ).toMatchSnapshot();
    } finally {
      await close();
    }
  });

  it("check_connection: healthy + authenticated", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ name: "Ada" }), { status: 200 }),
      ) as typeof fetch;

    const { client, close } = await connectPair({
      baseUrl: BASE,
      apiKey: SECRET_KEY,
    });
    try {
      const result = await client.callTool({
        name: CHECK_CONNECTION_TOOL_NAME,
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      const text = toolText(result);
      expect(text).toMatch(/authenticated/);
      expect(text).toContain("name=Ada");
      expect(text).not.toContain(SECRET_KEY);
    } finally {
      await close();
    }
  });

  it("check_connection: reachable but key rejected", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(`nope ${SECRET_KEY}`, { status: 401 }),
      ) as typeof fetch;

    const { client, close } = await connectPair({
      baseUrl: BASE,
      apiKey: SECRET_KEY,
    });
    try {
      const result = await client.callTool({
        name: CHECK_CONNECTION_TOOL_NAME,
        arguments: {},
      });
      expect(result.isError).toBe(true);
      const text = toolText(result);
      expect(text).toMatch(/rejected|Auth failed/i);
      expect(text).not.toContain(SECRET_KEY);
    } finally {
      await close();
    }
  });

  it("check_connection: unreachable", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(connRefused()) as typeof fetch;

    const { client, close } = await connectPair({
      baseUrl: BASE,
      apiKey: SECRET_KEY,
    });
    try {
      const result = await client.callTool({
        name: CHECK_CONNECTION_TOOL_NAME,
        arguments: {},
      });
      expect(result.isError).toBe(true);
      const text = toolText(result);
      expect(text).toMatch(/Unreachable/);
      expect(text).not.toContain(SECRET_KEY);
    } finally {
      await close();
    }
  });

  it("generate_weekly_recap: skip_subjective returns markdown envelope", async () => {
    mockHappyPathProbes();
    const root = await mkdtemp(join(tmpdir(), "tempo-mcp-proto-"));
    const subjectiveDir = join(root, "subjective");
    const cacheDir = join(root, "cache");
    await mkdir(subjectiveDir, { recursive: true });
    await mkdir(cacheDir, { recursive: true });

    const { client, close } = await connectPair({
      baseUrl: BASE,
      apiKey: SECRET_KEY,
      subjectiveDir,
      cacheDir,
    });
    try {
      const result = await client.callTool({
        name: GENERATE_WEEKLY_RECAP_TOOL_NAME,
        arguments: {
          week: "2026-W19",
          timezone: "America/New_York",
          skip_subjective: true,
          include_trends: false,
        },
      });
      expect(result.isError).toBeFalsy();
      const text = toolText(result);
      expect(text).not.toContain(SECRET_KEY);
      const envelope = JSON.parse(text) as {
        status: string;
        week: string;
        subjective: string;
        reportMarkdown: string;
      };
      expect(envelope.status).toBe("report");
      expect(envelope.week).toBe("2026-W19");
      expect(envelope.subjective).toBe("skipped");
      expect(envelope.reportMarkdown).toContain("Weekly Recap");
      expect(envelope.reportMarkdown).toContain("No runs recorded this week.");
    } finally {
      await close();
    }
  });

  it("flagship: needs_subjective → save → complete report with subjective", async () => {
    mockHappyPathProbes([
      {
        id: "w1",
        status: 200,
        body: JSON.stringify({
          startedAt: "2026-05-05T12:00:00-04:00",
          runType: "Easy",
          distanceM: 8000,
          durationS: 2400,
          rpe: 4,
        }),
      },
    ]);
    const root = await mkdtemp(join(tmpdir(), "tempo-mcp-flagship-"));
    const subjectiveDir = join(root, "subjective");
    const cacheDir = join(root, "cache");
    await mkdir(subjectiveDir, { recursive: true });
    await mkdir(cacheDir, { recursive: true });

    const { client, close } = await connectPair({
      baseUrl: BASE,
      apiKey: SECRET_KEY,
      subjectiveDir,
      cacheDir,
      timezone: "America/New_York",
    });
    try {
      const gateResult = await client.callTool({
        name: GENERATE_WEEKLY_RECAP_TOOL_NAME,
        arguments: {
          week: "2026-W19",
          timezone: "America/New_York",
          include_trends: false,
        },
      });
      expect(gateResult.isError).toBeFalsy();
      const gate = JSON.parse(toolText(gateResult)) as {
        status: string;
        week: string;
        runs: { date: string | null; apiRpe: number | null }[];
        questionnaire: { all_fields_optional: boolean };
      };
      expect(gate.status).toBe("needs_subjective");
      expect(gate.week).toBe("2026-W19");
      expect(gate.runs).toHaveLength(1);
      expect(gate.runs[0]!.apiRpe).toBe(4);
      expect(gate.questionnaire.all_fields_optional).toBe(true);

      const saveResult = await client.callTool({
        name: SAVE_SUBJECTIVE_RESPONSES_TOOL_NAME,
        arguments: {
          week: "2026-W19",
          timezone: "America/New_York",
          runs: [{ date: "2026-05-05", rpe: 4, felt: 8, pain: "none" }],
          weekly: {
            stress_level: "low",
            feeling_into_next_week: "ready",
            questions_for_coach: ["Keep volume?"],
          },
        },
      });
      expect(saveResult.isError).toBeFalsy();
      const saved = JSON.parse(toolText(saveResult)) as {
        ok: boolean;
        path: string;
      };
      expect(saved.ok).toBe(true);
      const yamlRaw = await readFile(saved.path, "utf8");
      const parsedYaml = parseSubjectiveWeek(yamlRaw, saved.path);
      expect(parsedYaml.ok).toBe(true);

      // Re-mock for second generate (spies were already set; still valid).
      const reportResult = await client.callTool({
        name: GENERATE_WEEKLY_RECAP_TOOL_NAME,
        arguments: {
          week: "2026-W19",
          timezone: "America/New_York",
          include_trends: false,
        },
      });
      expect(reportResult.isError).toBeFalsy();
      const report = JSON.parse(toolText(reportResult)) as {
        status: string;
        subjective: string;
        reportMarkdown: string;
      };
      expect(report.status).toBe("report");
      expect(report.subjective).toBe("present");
      expect(report.reportMarkdown).toContain("Weekly Recap");
      expect(report.reportMarkdown).toMatch(/Subjective|Felt: 8|RPE: 4|Questions for coach/i);
    } finally {
      await close();
    }
  });
});
