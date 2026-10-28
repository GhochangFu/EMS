import { expect } from "vitest";

import { encodePointRef, type JwtPayload } from "@bms/shared";

import { calls, FakeLlmProvider, toolCall } from "../../admin/onboarding/onboarding-agent-loop.spec";
import type { ResolvedIdentity } from "../../auth/identity-resolver";
import type { LlmMessage } from "../../llm/llm-port";
import { runToolCall } from "../../llm/tool-registry";
import type { CopilotToolContext, CopilotToolResult } from "../copilot-read-tools";
import { COPILOT_TOOL_GUARDS } from "../copilot-turn.service";
import { harness } from "../copilot-turn.service.spec";
import type { CopilotReadServices } from "./copilot-read-tool";
import { createCopilotReadTools } from "./copilot-read-tool-set";
import { COPILOT_TOOL_RECORD_OUT_OF_SCOPE, organizationsOfAssets } from "./copilot-tool-scope";
import { COPILOT_TOOL_INSTANT_OUT_OF_RANGE } from "./get-values-at-instant.tool";

/**
 * `F4.274` (ADR 0099 decision 1, "readings") — the copilot's telemetry read
 * tools over fake services that log their calls. `telemetry.point_values` and
 * the rollups carry no Row Level Security, so the asset placement **before**
 * the service runs is the only containment; every claim that matters checks
 * the service log stays empty beside a positive call that reaches it. One
 * `it()` per claim in the sibling `.test.ts` (ADR 0014).
 */

const USER = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "22222222-2222-4222-8222-222222222222";
const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const ORG_Y = "00000000-0000-4000-8000-0000000000bb";
/** An organization with its own key: never in a platform-scope allowed set. */
const ORG_B = "00000000-0000-4000-8000-0000000000cc";
const ASSET_X = "30000000-0000-4000-8000-0000000000aa";
const ASSET_Y = "30000000-0000-4000-8000-0000000000bb";
const ASSET_B = "30000000-0000-4000-8000-0000000000cc";
const NOW = new Date("2026-10-11T06:00:00Z");

const ASSETS_BY_ORG: Record<string, string[]> = { [ORG_X]: [ASSET_X], [ORG_Y]: [ASSET_Y], [ORG_B]: [ASSET_B] };

const GLOBAL_ADMIN = {
  id: USER,
  email: "u@x.test",
  displayName: "U",
  role: "admin",
  organizationId: null,
  oidcSubject: null,
  disabledAt: null,
} as ResolvedIdentity;
const JWT = { sub: USER, email: "u@x.test", role: "admin" } as JwtPayload;

function ctx(allowed: readonly string[]): CopilotToolContext {
  return {
    identity: GLOBAL_ADMIN,
    user: JWT,
    conversationId: CONVERSATION,
    conversationOrganizationId: null,
    allowedOrganizationIds: allowed,
    turnKind: "user",
    now: NOW,
  };
}

function pointRow(assetId: string, key: string, unit: string | null, extra: Record<string, unknown> = {}) {
  return { id: `pt-${key}`, assetId, assetName: "Chiller 2", pointKey: key, unit, ...extra };
}

/** 40 points: `kw`, `kw_total`, then `p03`…`p40`. */
function fortyPoints(assetId: string) {
  return [
    pointRow(assetId, "kw", "kW", { internalNote: "not in the contract" }),
    pointRow(assetId, "kw_total", "kWh"),
    ...Array.from({ length: 38 }, (_, i) => pointRow(assetId, `p${String(i + 3).padStart(2, "0")}`, null)),
  ];
}

type AggregateOverrides = { buckets?: unknown; extra?: Record<string, unknown> };

/** Fake services with a call log each; the access fake answers per organization. */
function fakeTelemetryServices(aggregate: AggregateOverrides = {}) {
  const log = {
    access: [] as string[],
    listPoints: [] as string[],
    latest: [] as Array<{ assetIds: readonly string[]; pointKeys: readonly string[]; windowMinutes: number }>,
    at: [] as Array<{ points: readonly { assetId: string; pointKey: string }[]; at: Date }>,
    recent: [] as Array<{ pointRef: string; window: string | undefined; limit: number | undefined }>,
    aggregate: [] as Array<{ point: { assetId: string; pointKey: string }; opts: Record<string, unknown> }>,
  };
  const services = {
    access: {
      readableAssetIdsInOrganization: async (_user: JwtPayload, organizationId: string) => {
        log.access.push(organizationId);
        return ASSETS_BY_ORG[organizationId] ?? [];
      },
    },
    assets: {
      listPoints: async (assetId: string) => {
        log.listPoints.push(assetId);
        return { items: fortyPoints(assetId) };
      },
    },
    telemetry: {
      latestPointValues: async (assetIds: readonly string[], pointKeys: readonly string[], windowMinutes: number) => {
        log.latest.push({ assetIds, pointKeys, windowMinutes });
        return assetIds.flatMap((assetId) =>
          pointKeys.map((pointKey) => ({ time: "2026-10-11T05:59:00.000Z", assetId, pointKey, value: 42, unit: "kW", extra: 1 })),
        );
      },
      pointValuesAt: async (points: readonly { assetId: string; pointKey: string }[], at: Date) => {
        log.at.push({ points, at });
        return points.map((_, i) =>
          i === 0 ? { time: "2026-10-11T02:59:00.000Z", value: 7, unit: "kW" } : { time: null, value: null, unit: null },
        );
      },
      recentForPoint: async (pointRef: string, window?: string, limit?: number) => {
        log.recent.push({ pointRef, window, limit });
        return Array.from({ length: Math.min(40, limit ?? 5000) }, (_, i) => ({
          time: new Date(NOW.getTime() - i * 10_000).toISOString(),
          assetId: ASSET_X,
          pointKey: "kw",
          value: 100 - i,
          unit: "kW",
        }));
      },
      pointAggregate: async (point: { assetId: string; pointKey: string }, opts: Record<string, unknown>) => {
        log.aggregate.push({ point, opts });
        const stats = { sum: 18_000, average: 12.5, min: 3, max: 20, peakAt: "2026-10-11T01:00:00.000Z", sampleCount: 1440 };
        return {
          pointRef: encodePointRef(point.assetId, point.pointKey),
          from: "2026-10-10T06:00:00.000Z",
          to: NOW.toISOString(),
          bucketSeconds: 60,
          stats,
          compare: opts.compare === true ? { from: "2026-10-09T06:00:00.000Z", to: "2026-10-10T06:00:00.000Z", stats: { ...stats, average: 10 } } : null,
          buckets: aggregate.buckets ?? null,
          ...aggregate.extra,
        };
      },
    },
  } as unknown as CopilotReadServices;
  return { services, log, tools: createCopilotReadTools(services) };
}

type Log = ReturnType<typeof fakeTelemetryServices>["log"];

/** The logs of the data services (every one but the placement read). */
function dataCalls(log: Log): number {
  return log.listPoints.length + log.latest.length + log.at.length + log.recent.length + log.aggregate.length;
}

function okResult(out: CopilotToolResult): Record<string, unknown> {
  if (!out.ok) throw new Error(`F4.274: the tool refused: ${out.error}`);
  return out.result;
}

function toolMessages(llm: FakeLlmProvider): string[] {
  return llm.seen.flat().flatMap((m: LlmMessage) => (m.role === "tool" ? [m.content] : []));
}

const AT = "2026-10-11T05:00:00+02:00";

/** One call per tool, naming `assetId`. */
function callsFor(assetId: string): Array<[string, Record<string, unknown>]> {
  return [
    ["list_asset_points", { assetId }],
    ["get_latest_values", { assetIds: [assetId], pointKeys: ["kw"] }],
    ["get_values_at_instant", { assetId, pointKeys: ["kw"], at: AT }],
    ["get_recent_values", { assetId, pointKey: "kw" }],
    ["get_point_aggregate", { assetId, pointKey: "kw" }],
  ];
}

// --- task 3: the scope helper ---------------------------------------------------

/** Several assets are placed with one access read per candidate organization; one unplaced asset fails the whole set. */
export async function assertOrganizationsOfAssetsPlacesEveryAssetOrNone(): Promise<void> {
  const { services, log } = fakeTelemetryServices();
  const placed = await organizationsOfAssets(services.access, JWT, [ORG_X, ORG_Y], [ASSET_X, ASSET_Y]);
  expect(placed === null ? null : [...placed.entries()]).toEqual([
    [ASSET_X, ORG_X],
    [ASSET_Y, ORG_Y],
  ]);
  expect(log.access).toEqual([ORG_X, ORG_Y]);

  expect(await organizationsOfAssets(services.access, JWT, [ORG_X, ORG_Y], [ASSET_X, ASSET_B])).toBeNull();

  log.access.length = 0;
  expect(await organizationsOfAssets(services.access, JWT, [], [ASSET_X])).toBeNull();
  expect(log.access).toEqual([]);
}

// --- task 4: the row's refusal, list_asset_points, get_latest_values ----------------

/**
 * The row's own case: each tool named an own-key organization's asset fails
 * and no data service runs. The adjacent positive: the same call with an
 * allowed asset reaches its service once.
 */
export async function assertEveryTelemetryToolRefusesAnAssetOutsideTheAllowedSet(): Promise<void> {
  for (const [name, args] of callsFor(ASSET_B)) {
    const { tools, log } = fakeTelemetryServices();
    expect(await tools.dispatch(name, args, ctx([ORG_X, ORG_Y])), name).toEqual({ ok: false, error: COPILOT_TOOL_RECORD_OUT_OF_SCOPE });
    expect(dataCalls(log), name).toBe(0);
  }
  for (const [name, args] of callsFor(ASSET_X)) {
    const { tools, log } = fakeTelemetryServices();
    const out = await tools.dispatch(name, args, ctx([ORG_X, ORG_Y]));
    expect(out.ok, name).toBe(true);
    expect(out.ok && out.organizationIds, name).toEqual([ORG_X]);
    expect(dataCalls(log), name).toBe(1);
  }
}

/** `get_latest_values` with one allowed and one own-key asset is refused whole: the controller's 403-for-the-request rule. */
export async function assertLatestValuesRefusesTheWholeCallForOneUnplacedAsset(): Promise<void> {
  const { tools, log } = fakeTelemetryServices();
  const out = await tools.dispatch("get_latest_values", { assetIds: [ASSET_X, ASSET_B], pointKeys: ["kw"] }, ctx([ORG_X, ORG_Y]));
  expect(out).toEqual({ ok: false, error: COPILOT_TOOL_RECORD_OUT_OF_SCOPE });
  expect(log.latest).toEqual([]);
}

/** 40 points are cut to 25 with `truncated`; `search` matches case-insensitively; the contract strips an extra key. */
export async function assertListAssetPointsIsBoundedAndSearchable(): Promise<void> {
  const { tools, log } = fakeTelemetryServices();
  const all = okResult(await tools.dispatch("list_asset_points", { assetId: ASSET_X }, ctx([ORG_X])));
  expect(log.listPoints).toEqual([ASSET_X]);
  expect((all.points as unknown[]).length).toBe(25);
  expect(all.truncated).toBe(true);
  expect(all.assetName).toBe("Chiller 2");
  expect((all.points as unknown[])[0]).toEqual({ pointKey: "kw", unit: "kW" });
  expect(JSON.stringify(all)).not.toContain("internalNote");

  const found = okResult(await tools.dispatch("list_asset_points", { assetId: ASSET_X, search: "KW" }, ctx([ORG_X])));
  expect(found.points).toEqual([
    { pointKey: "kw", unit: "kW" },
    { pointKey: "kw_total", unit: "kWh" },
  ]);
  expect(found.truncated).toBe(false);
}

/** The default window is 15 minutes; the organizations are each one placed; a sixth asset or key is refused by the schema. */
export async function assertLatestValuesDefaultsAndBounds(): Promise<void> {
  const { tools, log } = fakeTelemetryServices();
  const out = await tools.dispatch("get_latest_values", { assetIds: [ASSET_X, ASSET_Y], pointKeys: ["kw", "kva"] }, ctx([ORG_X, ORG_Y]));
  expect(log.latest).toEqual([{ assetIds: [ASSET_X, ASSET_Y], pointKeys: ["kw", "kva"], windowMinutes: 15 }]);
  expect(out.ok && out.organizationIds).toEqual([ORG_X, ORG_Y]);
  const result = okResult(out);
  expect((result.items as unknown[]).length).toBe(4);
  expect(JSON.stringify(result)).not.toContain("extra");

  const six = (prefix: string) => Array.from({ length: 6 }, (_, i) => `${prefix}${i}`);
  const assets = Array.from({ length: 6 }, (_, i) => `30000000-0000-4000-8000-00000000000${i}`);
  for (const [field, args] of [
    ["assetIds", { assetIds: assets, pointKeys: ["kw"] }],
    ["pointKeys", { assetIds: [ASSET_X], pointKeys: six("k") }],
    ["windowMinutes", { assetIds: [ASSET_X], pointKeys: ["kw"], windowMinutes: 61 }],
  ] as const) {
    const refused = await runToolCall(
      tools.registry,
      toolCall("get_latest_values", args),
      () => Promise.reject(new Error("must not dispatch")),
      COPILOT_TOOL_GUARDS,
    );
    expect(refused.ok, field).toBe(false);
    expect(refused.content, field).toContain(field);
  }
  expect(log.latest).toHaveLength(1);
}

// --- task 5: get_values_at_instant, get_recent_values ----------------------------------

/** An instant past now + 1 day or before 1970 is refused before any read; one in range reaches the service in request order. */
export async function assertValuesAtInstantBoundsTheInstantAndZipsByPosition(): Promise<void> {
  const { tools, log } = fakeTelemetryServices();
  const late = new Date(NOW.getTime() + 86_400_000 + 60_000).toISOString();
  for (const at of [late, "1969-12-31T23:59:59Z"]) {
    expect(await tools.dispatch("get_values_at_instant", { assetId: ASSET_X, pointKeys: ["kw"], at }, ctx([ORG_X])), at).toEqual({
      ok: false,
      error: COPILOT_TOOL_INSTANT_OUT_OF_RANGE,
    });
  }
  expect(log.at).toEqual([]);

  const result = okResult(await tools.dispatch("get_values_at_instant", { assetId: ASSET_X, pointKeys: ["kw", "kva"], at: AT }, ctx([ORG_X])));
  expect(log.at).toEqual([
    {
      points: [
        { assetId: ASSET_X, pointKey: "kw" },
        { assetId: ASSET_X, pointKey: "kva" },
      ],
      at: new Date(AT),
    },
  ]);
  expect(result.items).toEqual([
    { pointKey: "kw", time: "2026-10-11T02:59:00.000Z", value: 7, unit: "kW" },
    { pointKey: "kva", time: null, value: null, unit: null },
  ]);

  const noOffset = await runToolCall(
    tools.registry,
    toolCall("get_values_at_instant", { assetId: ASSET_X, pointKeys: ["kw"], at: "2026-10-11T05:00:00" }),
    () => Promise.reject(new Error("must not dispatch")),
    COPILOT_TOOL_GUARDS,
  );
  expect(noOffset.ok).toBe(false);
  expect(noOffset.content).toContain("at");
}

/** 40 recent rows come back as 10 by default with `truncated`; the window string is `<n>m`; the service reads `limit + 1` rows; 169 minutes and 26 rows are refused. */
export async function assertRecentValuesIsBounded(): Promise<void> {
  const { tools, log } = fakeTelemetryServices();
  const result = okResult(await tools.dispatch("get_recent_values", { assetId: ASSET_X, pointKey: "kw" }, ctx([ORG_X])));
  expect((result.readings as unknown[]).length).toBe(10);
  expect(result.truncated).toBe(true);
  expect((result.readings as unknown[])[0]).toEqual({ time: NOW.toISOString(), value: 100, unit: "kW" });

  const max = okResult(await tools.dispatch("get_recent_values", { assetId: ASSET_X, pointKey: "kw", windowMinutes: 168, limit: 25 }, ctx([ORG_X])));
  expect((max.readings as unknown[]).length).toBe(25);
  expect(log.recent).toEqual([
    { pointRef: encodePointRef(ASSET_X, "kw"), window: "15m", limit: 11 },
    { pointRef: encodePointRef(ASSET_X, "kw"), window: "168m", limit: 26 },
  ]);

  for (const [field, args] of [
    ["windowMinutes", { assetId: ASSET_X, pointKey: "kw", windowMinutes: 169 }],
    ["limit", { assetId: ASSET_X, pointKey: "kw", limit: 26 }],
  ] as const) {
    const refused = await runToolCall(
      tools.registry,
      toolCall("get_recent_values", args),
      () => Promise.reject(new Error("must not dispatch")),
      COPILOT_TOOL_GUARDS,
    );
    expect(refused.ok, field).toBe(false);
    expect(refused.content, field).toContain(field);
  }
}

// --- task 6: get_point_aggregate, the turn, the budget -----------------------------------

/** Stats only: the tool never names `bucketFunction`, passes `compare`, and returns no bucket series even when one comes back. */
export async function assertPointAggregateReadsStatsOnly(): Promise<void> {
  const { tools, log } = fakeTelemetryServices({ buckets: [{ t: "2026-10-10T06:00:00.000Z", v: 999.25 }], extra: { internalNote: "x" } });
  const result = okResult(await tools.dispatch("get_point_aggregate", { assetId: ASSET_X, pointKey: "kw" }, ctx([ORG_X])));
  expect(log.aggregate[0]).toEqual({ point: { assetId: ASSET_X, pointKey: "kw" }, opts: { windowMinutes: 1440, compare: false, now: NOW } });
  expect(log.aggregate[0]?.opts).not.toHaveProperty("bucketFunction");
  expect(result.stats).toEqual(expect.objectContaining({ average: 12.5, min: 3, max: 20 }));
  const text = JSON.stringify(result);
  expect(text).not.toContain("999.25");
  expect(text).not.toContain("internalNote");

  const compared = okResult(await tools.dispatch("get_point_aggregate", { assetId: ASSET_X, pointKey: "kw", compare: true }, ctx([ORG_X])));
  expect(log.aggregate[1]?.opts).toEqual({ windowMinutes: 1440, compare: true, now: NOW });
  expect(compared.compare).toEqual(expect.objectContaining({ stats: expect.objectContaining({ average: 10 }) }));
}

/**
 * Done means, through the turn service: "What was chiller 2's kW over the last
 * 24 hours?" reaches the provider as the aggregate's numbers, with the turn's
 * organization; the same turn naming an own-key organization's asset reads
 * nothing and the provider sees the refusal.
 */
export async function assertTheTurnAnswersTheLast24HoursFromATool(): Promise<void> {
  const question = "What was chiller 2's kW over the last 24 hours?";
  const { tools, log } = fakeTelemetryServices();
  const llm = new FakeLlmProvider([
    calls(toolCall("get_point_aggregate", { assetId: ASSET_X, pointKey: "kw", windowMinutes: 1440 })),
    { kind: "final", text: "Average 12.5 kW" },
  ]);
  const h = harness(llm, { conversationOrg: null, platform: { kind: "ready", allowed: [ORG_X] }, readTools: tools });
  h.service.clock = () => NOW;
  const response = await h.service.turn({ identity: GLOBAL_ADMIN, user: JWT }, CONVERSATION, question, "user", [], []);
  expect(log.aggregate).toHaveLength(1);
  const content = toolMessages(llm).join("\n");
  expect(content).toContain('"average":12.5');
  expect(content).toContain('"kw"');
  expect(response.messages.find((m) => m.role === "assistant")?.organizationIds).toEqual([ORG_X]);

  const refused = fakeTelemetryServices();
  const llm2 = new FakeLlmProvider([
    calls(toolCall("get_point_aggregate", { assetId: ASSET_B, pointKey: "kw", windowMinutes: 1440 })),
    { kind: "final", text: "Not in scope." },
  ]);
  const h2 = harness(llm2, { conversationOrg: null, platform: { kind: "ready", allowed: [ORG_X] }, readTools: refused.tools });
  await h2.service.turn({ identity: GLOBAL_ADMIN, user: JWT }, CONVERSATION, question, "user", [], []);
  expect(refused.log.aggregate).toEqual([]);
  expect(toolMessages(llm2).join("\n")).toContain(COPILOT_TOOL_RECORD_OUT_OF_SCOPE);
}

/**
 * The read registry's own budget. The F4.266 gate (`copilot-propose-budget.spec.ts`,
 * 52,000) measures the propose registry only; the turn sends this one beside
 * it. Measured 2026-10-23: 4,040 characters before F4.274 (11 tools), 6,630
 * after (16 tools); 9,028 after F4.275 (22 tools); 10,384 after F4.277 (24
 * tools); 11,342 after F4.276 (26 tools); 12,119 after F4.278 (27 tools,
 * still under the bound, so it is unchanged). The bound is the latest
 * measurement rounded up to the next thousand plus one thousand of headroom.
 * Owner ruling 2026-10-23 (release 4): F4.279 measured 13,135
 * Owner ruling 2026-10-23 (release 4): F4.281 measured 14,262 (31 tools, under the bound, so it is unchanged)
 * Owner ruling 2026-10-23 (release 4): F4.284 measured 15,207 (33 tools)
 * Owner ruling 2026-10-25 (release 4): F4.284 alarm skills measured 15,452 (34 tools, under the bound, so it is unchanged)
 * Owner ruling P4 2026-10-27 (release 5, the release-4 rule per PR): F4.291 PR 1 measured 17,623 (34 tools; locationId
 * and cursor on the lists, locationId on the six energy reads, search on list_locations), so the bound is 19,000
 * Owner ruling P4 2026-10-27 (release 5, the release-4 rule per PR): F4.291 PR 2 measured 18,665 (35 tools; severity and
 * lastDays/from/to on list_alarms, get_alarm_stats), so the bound is 20,000. The propose registry is unchanged (82,991).
 */
export function assertTheReadRegistryStaysInItsBudget(): void {
  const { tools } = fakeTelemetryServices();
  expect(JSON.stringify(tools.registry.definitions).length).toBeLessThan(20_000);
}
