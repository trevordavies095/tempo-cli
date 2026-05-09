import { createHttpClient } from "../http/client.js";
import { humanLinesFromApiBody } from "../output/human-api-body.js";
import { redactApiKeyInText } from "./auth-me.js";

export const WORKOUTS_LIST_PATH = "/workouts";

const BODY_SNIP_LEN = 500;

/** Query params for GET /workouts (OpenAPI names); omit unset fields so the server applies defaults. */
export type WorkoutsListQuery = {
  page?: number;
  pageSize?: number;
  startDate?: string;
  endDate?: string;
  minDistanceM?: number;
  maxDistanceM?: number;
  keyword?: string;
  runType?: string;
  sortBy?: string;
  sortOrder?: string;
};

export type WorkoutsListOk = {
  kind: "ok";
  status: number;
  body: string;
};

export type WorkoutsListHttpError = {
  kind: "http";
  status: number;
  body: string;
};

export type WorkoutsListTransport = {
  kind: "transport";
  error: unknown;
};

export type WorkoutsListResult =
  | WorkoutsListOk
  | WorkoutsListHttpError
  | WorkoutsListTransport;

function truncateForMessage(body: string): string {
  const t = body.trim();
  if (t.length <= BODY_SNIP_LEN) return t;
  return `${t.slice(0, BODY_SNIP_LEN)}…`;
}

export function buildWorkoutsListPath(params: WorkoutsListQuery): string {
  const q = new URLSearchParams();
  if (params.page !== undefined) q.set("page", String(params.page));
  if (params.pageSize !== undefined) q.set("pageSize", String(params.pageSize));
  if (params.startDate !== undefined) q.set("startDate", params.startDate);
  if (params.endDate !== undefined) q.set("endDate", params.endDate);
  if (params.minDistanceM !== undefined) {
    q.set("minDistanceM", String(params.minDistanceM));
  }
  if (params.maxDistanceM !== undefined) {
    q.set("maxDistanceM", String(params.maxDistanceM));
  }
  if (params.keyword !== undefined) q.set("keyword", params.keyword);
  if (params.runType !== undefined) q.set("runType", params.runType);
  if (params.sortBy !== undefined) q.set("sortBy", params.sortBy);
  if (params.sortOrder !== undefined) q.set("sortOrder", params.sortOrder);
  const qs = q.toString();
  return qs ? `${WORKOUTS_LIST_PATH}?${qs}` : WORKOUTS_LIST_PATH;
}

/** GET /workouts with Bearer apiKey (caller must pass non-empty key). */
export async function probeWorkoutsList(
  baseUrl: string,
  apiKey: string,
  params: WorkoutsListQuery,
): Promise<WorkoutsListResult> {
  const client = createHttpClient({ baseUrl, apiKey });
  const path = buildWorkoutsListPath(params);
  try {
    const response = await client.get(path);
    const body = await response.text();
    if (response.ok) {
      return { kind: "ok", status: response.status, body };
    }
    return { kind: "http", status: response.status, body };
  } catch (error) {
    return { kind: "transport", error };
  }
}

export function workoutsListHttpErrorMessage(
  status: number,
  body: string,
): string {
  const snip = truncateForMessage(body);
  const suffix = snip ? `: ${snip}` : "";
  return `GET ${WORKOUTS_LIST_PATH} returned ${status}${suffix}`;
}

export function workoutsListHttpErrorMessageForCli(
  status: number,
  body: string,
  apiKey: string,
): string {
  return workoutsListHttpErrorMessage(
    status,
    redactApiKeyInText(body, apiKey),
  );
}

export function workoutsListHumanSuccessLine(
  status: number,
  body: string,
): string {
  const block = humanLinesFromApiBody(body);
  if (!block) return `OK (HTTP ${status})`;
  return `OK (HTTP ${status})\n${block}`;
}

export type WorkoutsListCliRawOpts = {
  page?: string;
  pageSize?: string;
  startDate?: string;
  endDate?: string;
  minDistanceM?: string;
  maxDistanceM?: string;
  keyword?: string;
  runType?: string;
  sortBy?: string;
  sortOrder?: string;
};

const PAGE_SIZE_MAX = 100;

function parseOptionalPositiveInt(
  label: string,
  raw: string | undefined,
): { value: number | undefined } | { error: string } {
  if (raw === undefined || raw.trim() === "") return { value: undefined };
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return {
      error: `tempo workouts list: ${label} must be a positive integer`,
    };
  }
  const n = Number.parseInt(trimmed, 10);
  if (n < 1) {
    return {
      error: `tempo workouts list: ${label} must be a positive integer`,
    };
  }
  return { value: n };
}

function parseOptionalPageSize(
  raw: string | undefined,
): { value: number | undefined } | { error: string } {
  const r = parseOptionalPositiveInt("pageSize", raw);
  if ("error" in r) return r;
  if (r.value !== undefined && r.value > PAGE_SIZE_MAX) {
    return {
      error: `tempo workouts list: pageSize must be between 1 and ${PAGE_SIZE_MAX} (API max)`,
    };
  }
  return r;
}

function parseOptionalFiniteNumber(
  label: string,
  raw: string | undefined,
): { value: number | undefined } | { error: string } {
  if (raw === undefined || raw.trim() === "") return { value: undefined };
  const n = Number(raw.trim());
  if (!Number.isFinite(n)) {
    return {
      error: `tempo workouts list: ${label} must be a finite number`,
    };
  }
  return { value: n };
}

/**
 * Validates CLI flag strings and builds {@link WorkoutsListQuery} for the API.
 */
export function workoutsListQueryFromCli(
  opts: WorkoutsListCliRawOpts,
): { ok: WorkoutsListQuery } | { error: string } {
  const query: WorkoutsListQuery = {};

  const page = parseOptionalPositiveInt("page", opts.page);
  if ("error" in page) return page;
  if (page.value !== undefined) query.page = page.value;

  const pageSize = parseOptionalPageSize(opts.pageSize);
  if ("error" in pageSize) return pageSize;
  if (pageSize.value !== undefined) query.pageSize = pageSize.value;

  if (opts.startDate !== undefined && opts.startDate.trim() !== "") {
    query.startDate = opts.startDate.trim();
  }
  if (opts.endDate !== undefined && opts.endDate.trim() !== "") {
    query.endDate = opts.endDate.trim();
  }

  const minD = parseOptionalFiniteNumber("min-distance-m", opts.minDistanceM);
  if ("error" in minD) return minD;
  if (minD.value !== undefined) query.minDistanceM = minD.value;

  const maxD = parseOptionalFiniteNumber("max-distance-m", opts.maxDistanceM);
  if ("error" in maxD) return maxD;
  if (maxD.value !== undefined) query.maxDistanceM = maxD.value;

  if (opts.keyword !== undefined && opts.keyword !== "") {
    query.keyword = opts.keyword;
  }
  if (opts.runType !== undefined && opts.runType.trim() !== "") {
    query.runType = opts.runType.trim();
  }
  if (opts.sortBy !== undefined && opts.sortBy.trim() !== "") {
    query.sortBy = opts.sortBy.trim();
  }
  if (opts.sortOrder !== undefined && opts.sortOrder.trim() !== "") {
    query.sortOrder = opts.sortOrder.trim();
  }

  return { ok: query };
}