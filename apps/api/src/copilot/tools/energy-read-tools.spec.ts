import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { calls, FakeLlmProvider, toolCall } from "../../admin/onboarding/onboarding-agent-loop.spec";
import type { ResolvedIdentity } from "../../auth/identity-resolver";
import type { LlmMessage } from "../../llm/llm-port";
import { runToolCall } from "../../llm/tool-registry";
import { TOOL_RESULT_MAX_CHARS } from "../../llm/tool-result";
import type { CopilotToolContext, CopilotToolResult } from "../copilot-read-tools";
import { COPILOT_TOOL_GUARDS } from "../copilot-turn.service";
import { harness } from "../copilot-turn.service.spec";
import { type CopilotReadServices, readPerOrganization } from "./copilot-read-tool";
import { createCopilotReadTools } from "./copilot-read-tool-set";
import { COPILOT_TOOL_ORGANIZATION_OUT_OF_SCOPE, organizationOutOfScope } from "./copilot-tool-scope";
import { resampleSeries } from "./energy-read-helpers";
import { getDashboardKpisTool } from "./get-dashboard-kpis.tool";
import { getEnergyReportPreviewTool } from "./get-energy-report-preview.tool";

/**
 * `F4.275` (ADR 0099 decision 1, "KPIs") — the copilot's energy and portfolio
 * read tools over fake services that log their calls. Every tool reads once per
 * organization with that organization's readable asset ids and never with
 * `assetIds: null` (the services read the whole fleet then), so each refusal
 * claim checks the service log stays empty beside a positive call that reaches
 * it. One `it()` per claim in the sibling `.test.ts` (ADR 0014).
 */

const USER = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "22222222-2222-4222-8222-222222222222";
const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const ORG_Y = "00000000-0000-4000-8000-0000000000bb";
/** An organization with its own key: never in a platform-scope allowed set. */
const ORG_B = "00000000-0000-4000-8000-0000000000cc";
/** An allowed organization in which the caller reads no asset. */
const ORG_EMPTY = "00000000-0000-4000-8000-0000000000dd";
const ORG_Z = "00000000-0000-4000-8000-0000000000ee";
const ASSET_X = "30000000-0000-4000-8000-0000000000aa";
const ASSET_Y = "30000000-0000-4000-8000-0000000000bb";
const ASSET_B = "30000000-0000-4000-8000-0000000000cc";
const ASSET_Z = "30000000-0000-4000-8000-0000000000ee";
const NOW = new Date("2026-10-11T06:00:00Z");
const SERIES_START = Date.parse("2026-10-04T06:00:00Z");
const TOP_KWH = 4321.5;

const ASSETS_BY_ORG: Record<string, string[]> = {
  [ORG_X]: [ASSET_X],
  [ORG_Y]: [ASSET_Y],
  [ORG_B]: [ASSET_B],
  [ORG_EMPTY]: [],
  [ORG_Z]: [ASSET_Z],
};

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

const minute = (i: number) => new Date(SERIES_START + i * 60_000).toISOString();

/** The number of 1-minute points a load-trend window reads (`<n>h` or `<n>m`). */
function trendPointCount(window: string): number {
  const m = /^(\d+)(m|h)$/.exec(window);
  if (m === null) throw new Error(`F4.275: bad trend window ${window}`);
  return Number(m[1]) * (m[2] === "h" ? 60 : 1);
}

type Call = { window?: string; limit?: number; assetIds: readonly string[] | null | undefined };

function consumer(i: number, assetId: string) {
  return {
    assetId,
    code: `C${i}`,
    name: `Meter ${i}`,
    siteName: i === 0 ? "Site A" : "Site B",
    avgKw: 100 - i,
    estimatedKwh: i === 0 ? TOP_KWH : 1000 - i,
    internalNote: "not in the contract",
  };
}

/** Fake services with a call log each; the access fake answers per organization. Every answer carries `internalNote`. */
function fakeEnergyServices() {
  const log = {
    access: [] as string[],
    kpis: [] as Call[],
    loadTrend: [] as Call[],
    summary: [] as Call[],
    sourceMix: [] as Call[],
    topConsumers: [] as Call[],
    preview: [] as Array<Call & { query: { startDate: string; endDate: string } }>,
  };
  const summaryOf = (window: string) => ({
    window,
    totalKwh: 2400,
    peakKw: 150,
    pueEstimate: null,
    indicativeCost: 240,
    tariffPerKwh: 0.1,
    currency: "INR",
    asOf: NOW.toISOString(),
    internalNote: "not in the contract",
  });
  const services = {
    access: {
      readableAssetIdsInOrganization: async (_user: JwtPayload, organizationId: string) => {
        log.access.push(organizationId);
        return ASSETS_BY_ORG[organizationId] ?? [];
      },
    },
    portfolio: {
      kpis: async (assetIds?: string[] | null) => {
        log.kpis.push({ assetIds });
        return {
          totalKw: 120.5,
          sitesOnline: 2,
          sitesTotal: 3,
          alarmsOpen: 4,
          alarmsCritical: 1,
          pueEstimate: 1.4,
          asOf: NOW.toISOString(),
          prior: { asOf: "2026-10-10T06:00:00.000Z", totalKw: 110, alarmsOpen: 3, pueEstimate: null },
          internalNote: "not in the contract",
        };
      },
      loadTrend: async (window?: string, assetIds?: string[] | null) => {
        log.loadTrend.push({ window, assetIds });
        const n = trendPointCount(window ?? "60m");
        return { points: Array.from({ length: n }, (_, i) => ({ t: minute(i), totalKw: i, internalNote: "x" })), internalNote: "x" };
      },
      energySummary: async (window?: string, assetIds?: string[] | null) => {
        log.summary.push({ window, assetIds });
        return summaryOf(window ?? "24h");
      },
      energySourceMix: async (window?: string, assetIds?: string[] | null) => {
        log.sourceMix.push({ window, assetIds });
        return {
          points: Array.from({ length: 1440 }, (_, i) => ({
            t: minute(i),
            gridKw: 100,
            solarKw: i % 2 === 0 ? 10 : 20,
            dgKw: 5,
            internalNote: "x",
          })),
          internalNote: "x",
        };
      },
      energyTopConsumers: async (window?: string, limit = 10, assetIds?: string[] | null) => {
        log.topConsumers.push({ window, limit, assetIds });
        return { consumers: Array.from({ length: Math.min(limit, 40) }, (_, i) => consumer(i, assetIds?.[0] ?? "none")), internalNote: "x" };
      },
    },
    reports: {
      energyPreview: async (query: { startDate: string; endDate: string }, assetIds?: string[] | null) => {
        log.preview.push({ query, assetIds });
        return {
          template: { id: "energy_consumption", title: "Energy", description: "d", formats: ["csv"], active: true },
          range: { startDate: query.startDate, endDate: query.endDate, durationHours: 720 },
          generatedAt: NOW.toISOString(),
          summary: summaryOf("custom"),
          sourceTotals: { gridKwh: 9000, solarKwh: 1000, dgKwh: 50 },
          topConsumers: Array.from({ length: 10 }, (_, i) => consumer(i, assetIds?.[0] ?? "none")),
          notes: ["DG is a nominal slice."],
          internalNote: "not in the contract",
        };
      },
    },
  } as unknown as CopilotReadServices;
  return { services, log, tools: createCopilotReadTools(services) };
}

type Log = ReturnType<typeof fakeEnergyServices>["log"];

/** The logs of the data services (every one but the scope read). */
function dataCalls(log: Log): number {
  return log.kpis.length + log.loadTrend.length + log.summary.length + log.sourceMix.length + log.topConsumers.length + log.preview.length;
}

/** The one data call a case made, whichever service it was. */
function onlyDataCall(log: Log): Call | undefined {
  return [...log.kpis, ...log.loadTrend, ...log.summary, ...log.sourceMix, ...log.topConsumers, ...log.preview][0];
}

function okResult(out: CopilotToolResult): Record<string, unknown> {
  if (!out.ok) throw new Error(`F4.275: the tool refused: ${out.error}`);
  return out.result;
}

type OrganizationEntry = { organizationId: string; items: unknown[] } & Record<string, unknown>;

function organizationsOf(result: Record<string, unknown>): OrganizationEntry[] {
  return result.organizations as OrganizationEntry[];
}

function toolMessages(llm: FakeLlmProvider): string[] {
  return llm.seen.flat().flatMap((m: LlmMessage) => (m.role === "tool" ? [m.content] : []));
}

/** Runs one call the way the turn does: guards, the schema, then dispatch. */
async function viaRegistry(tools: ReturnType<typeof fakeEnergyServices>["tools"], name: string, args: Record<string, unknown>, allowed = [ORG_X]) {
  return runToolCall(tools.registry, toolCall(name, args), (n, a) => tools.dispatch(n, a, ctx(allowed)).then(asOutcome), COPILOT_TOOL_GUARDS);
}

function asOutcome(out: CopilotToolResult) {
  return out.ok ? { ok: true as const, content: JSON.stringify(out.result) } : { ok: false as const, content: out.error };
}

async function refusedByTheSchema(tools: ReturnType<typeof fakeEnergyServices>["tools"], name: string, args: Record<string, unknown>) {
  return runToolCall(tools.registry, toolCall(name, args), () => Promise.reject(new Error("must not dispatch")), COPILOT_TOOL_GUARDS);
}

const MONTH = { startDate: "2026-09-01", endDate: "2026-09-30" };

/** One call per tool. */
const ENERGY_CALLS: ReadonlyArray<[string, Record<string, unknown>]> = [
  ["get_dashboard_kpis", {}],
  ["get_load_trend", {}],
  ["get_energy_summary", {}],
  ["get_energy_source_mix", {}],
  ["get_energy_top_consumers", {}],
  ["get_energy_report_preview", MONTH],
];

// --- task 1: the per-organization read mechanic ---------------------------------

/** An organization outside the allowed set is refused before any scope read or data read. */
export async function assertReadPerOrganizationRefusesAnOrganizationOutsideTheAllowedSet(): Promise<void> {
  const { services, log } = fakeEnergyServices();
  const reads: string[] = [];
  const out = await readPerOrganization(services.access, ctx([ORG_X, ORG_Y]), ORG_B, async (id) => {
    reads.push(id);
    return { items: [1] };
  });
  expect(out).toEqual({ ok: false, error: organizationOutOfScope([ORG_X, ORG_Y]) });
  expect(log.access).toEqual([]);
  expect(reads).toEqual([]);
}

/** An allowed organization with no readable asset is listed empty, and the read never runs with `null` or `[]`. */
export async function assertReadPerOrganizationSkipsAnOrganizationWithNoReadableAsset(): Promise<void> {
  const { services } = fakeEnergyServices();
  const reads: Array<{ id: string; assetIds: readonly string[] | null }> = [];
  const out = await readPerOrganization(services.access, ctx([ORG_X, ORG_EMPTY]), undefined, async (id, assetIds) => {
    reads.push({ id, assetIds });
    return { items: ["a"] };
  });
  expect(reads).toEqual([{ id: ORG_X, assetIds: [ASSET_X] }]);
  for (const read of reads) {
    expect(read.assetIds).not.toBeNull();
    expect(read.assetIds).not.toEqual([]);
  }
  const result = okResult(out);
  expect(organizationsOf(result)).toEqual([
    { organizationId: ORG_X, items: ["a"] },
    { organizationId: ORG_EMPTY, items: [] },
  ]);
  expect(result.truncated).toBe(false);
  expect(out.ok && out.organizationIds).toEqual([ORG_X, ORG_EMPTY]);
}

/** 20 items per organization over three: 20 + 5, `truncated`, and the third is not read. */
export async function assertReadPerOrganizationCapsItemsAndFlagsTruncated(): Promise<void> {
  const { services } = fakeEnergyServices();
  const reads: string[] = [];
  const out = await readPerOrganization(services.access, ctx([ORG_X, ORG_Y, ORG_Z]), undefined, async (id) => {
    reads.push(id);
    return { items: Array.from({ length: 20 }, (_, i) => i), extra: { note: id } };
  });
  const result = okResult(out);
  expect(reads).toEqual([ORG_X, ORG_Y]);
  expect(organizationsOf(result).map((o) => [o.organizationId, o.items.length, o.note])).toEqual([
    [ORG_X, 20, ORG_X],
    [ORG_Y, 5, ORG_Y],
  ]);
  expect(result.truncated).toBe(true);
  expect(out.ok && out.organizationIds).toEqual([ORG_X, ORG_Y]);
}

/** No upsampling, an empty series stays empty, and 10,080 points become 24 contiguous groups. */
export function assertResampleSeriesBoundsTheBucketCount(): void {
  const mean = (group: readonly { t: string; totalKw: number }[]) => ({
    t: group[0]!.t,
    totalKw: group.reduce((s, p) => s + p.totalKw, 0) / group.length,
  });
  expect(resampleSeries([], 24, mean)).toEqual([]);
  const five = Array.from({ length: 5 }, (_, i) => ({ t: minute(i), totalKw: i }));
  expect(resampleSeries(five, 24, mean)).toEqual(five);
  const week = Array.from({ length: 10_080 }, (_, i) => ({ t: minute(i), totalKw: i }));
  const out = resampleSeries(week, 24, mean);
  expect(out).toHaveLength(24);
  // 420 points per group: group 1 is points 420..839, mean (420 + 839) / 2.
  expect(out[1]).toEqual({ t: minute(420), totalKw: 629.5 });
  expect(out[23]?.t).toBe(minute(23 * 420));
}

// --- task 2: the refusal table, get_dashboard_kpis, get_energy_summary ------------

/**
 * The row's own case: each tool named an own-key organization is refused and
 * no data service runs. The adjacent positive: the same call naming an allowed
 * organization reaches its service once, with that organization's assets.
 */
export async function assertEveryEnergyToolRefusesAnOwnKeyOrganizationAndReadsAnAllowedOne(): Promise<void> {
  for (const [name, args] of ENERGY_CALLS) {
    const { tools, log } = fakeEnergyServices();
    expect(await tools.dispatch(name, { ...args, organizationId: ORG_B }, ctx([ORG_X, ORG_Y])), name).toEqual({
      ok: false,
      error: organizationOutOfScope([ORG_X, ORG_Y]),
    });
    expect(dataCalls(log), name).toBe(0);
  }
  for (const [name, args] of ENERGY_CALLS) {
    const { tools, log } = fakeEnergyServices();
    const out = await tools.dispatch(name, { ...args, organizationId: ORG_X }, ctx([ORG_X, ORG_Y]));
    expect(out.ok, name).toBe(true);
    expect(out.ok && out.organizationIds, name).toEqual([ORG_X]);
    expect(dataCalls(log), name).toBe(1);
    expect(onlyDataCall(log)?.assetIds, name).not.toBeNull();
    expect(onlyDataCall(log)?.assetIds, name).toEqual([ASSET_X]);
  }
}

/** One KPI read per organization, the contract strips an extra key, and the description names the socket. */
export async function assertDashboardKpisReturnsTheContractPerOrganizationAndNamesTheSocketCaveat(): Promise<void> {
  const { tools, log } = fakeEnergyServices();
  const result = okResult(await tools.dispatch("get_dashboard_kpis", {}, ctx([ORG_X, ORG_Y])));
  expect(log.kpis).toEqual([{ assetIds: [ASSET_X] }, { assetIds: [ASSET_Y] }]);
  const organizations = organizationsOf(result);
  expect(organizations.map((o) => o.organizationId)).toEqual([ORG_X, ORG_Y]);
  for (const organization of organizations) {
    expect(organization.items).toHaveLength(1);
    expect(organization.items[0]).toEqual(expect.objectContaining({ totalKw: 120.5, prior: expect.objectContaining({ totalKw: 110 }) }));
  }
  expect(JSON.stringify(result)).not.toContain("internalNote");
  expect(getDashboardKpisTool.description).toMatch(/socket/i);
}

/** The window defaults to `24h`; another grammar is refused by the schema; the item is the contract DTO. */
export async function assertEnergySummaryDefaultsTheWindowAndRefusesAnotherGrammar(): Promise<void> {
  const { tools, log } = fakeEnergyServices();
  const result = okResult(await tools.dispatch("get_energy_summary", {}, ctx([ORG_X])));
  expect(log.summary).toEqual([{ window: "24h", assetIds: [ASSET_X] }]);
  const [item] = organizationsOf(result)[0]!.items as Array<Record<string, unknown>>;
  expect(item).toEqual(expect.objectContaining({ totalKwh: 2400, indicativeCost: 240, currency: "INR" }));
  expect(JSON.stringify(result)).not.toContain("internalNote");

  const week = await viaRegistry(tools, "get_energy_summary", { window: "7d" });
  expect(week.ok).toBe(true);
  expect(log.summary[1]?.window).toBe("7d");

  const refused = await refusedByTheSchema(tools, "get_energy_summary", { window: "3d" });
  expect(refused.ok).toBe(false);
  expect(refused.content).toContain("window");
  expect(log.summary).toHaveLength(2);
}

// --- task 3: get_load_trend, get_energy_source_mix ---------------------------------

/** One hour by default; 168 hours is 10,080 points cut to 24 buckets with stats over all of them; 0 and 169 are refused. */
export async function assertLoadTrendIsResampledAndBoundedWithStats(): Promise<void> {
  const { tools, log } = fakeEnergyServices();
  await tools.dispatch("get_load_trend", {}, ctx([ORG_X]));
  expect(log.loadTrend[0]).toEqual({ window: "1h", assetIds: [ASSET_X] });

  const result = okResult(await tools.dispatch("get_load_trend", { windowHours: 168 }, ctx([ORG_X])));
  expect(log.loadTrend[1]).toEqual({ window: "168h", assetIds: [ASSET_X] });
  const [entry] = organizationsOf(result);
  expect(entry?.items).toHaveLength(24);
  expect(entry?.items[0]).toEqual({ t: minute(0), totalKw: 209.5 });
  expect(entry).toEqual(
    expect.objectContaining({ peakKw: 10_079, peakAt: minute(10_079), minKw: 0, avgKw: 5039.5, pointCount: 10_080 }),
  );
  expect(JSON.stringify(result)).not.toContain("internalNote");

  for (const windowHours of [0, 169]) {
    const refused = await refusedByTheSchema(tools, "get_load_trend", { windowHours });
    expect(refused.ok, String(windowHours)).toBe(false);
    expect(refused.content, String(windowHours)).toContain("windowHours");
  }
  expect(log.loadTrend).toHaveLength(2);
}

/** 1,440 points become 24 buckets; `averageKw` is over every point; two organizations split the 25-item room. */
export async function assertSourceMixIsResampledWithAverageKwPerSource(): Promise<void> {
  const { tools, log } = fakeEnergyServices();
  const result = okResult(await tools.dispatch("get_energy_source_mix", {}, ctx([ORG_X, ORG_Y])));
  expect(log.sourceMix).toEqual([
    { window: "24h", assetIds: [ASSET_X] },
    { window: "24h", assetIds: [ASSET_Y] },
  ]);
  const [x, y] = organizationsOf(result);
  expect(x?.items).toHaveLength(24);
  expect(x?.items[0]).toEqual({ t: minute(0), gridKw: 100, solarKw: 15, dgKw: 5 });
  expect(x?.averageKw).toEqual({ grid: 100, solar: 15, dg: 5 });
  expect(y?.items).toHaveLength(1);
  expect(result.truncated).toBe(true);
  expect(JSON.stringify(result)).not.toContain("internalNote");
}

// --- task 4: get_energy_top_consumers, get_energy_report_preview ------------------

/** Ten by default; 26 is refused; 25 fills the room, so the next organization is not read. */
export async function assertTopConsumersDefaultsToTenAndSharesTheRoom(): Promise<void> {
  const { tools, log } = fakeEnergyServices();
  const ten = okResult(await tools.dispatch("get_energy_top_consumers", {}, ctx([ORG_X])));
  expect(log.topConsumers[0]).toEqual({ window: "24h", limit: 10, assetIds: [ASSET_X] });
  expect(organizationsOf(ten)[0]?.items).toHaveLength(10);
  expect(JSON.stringify(ten)).not.toContain("internalNote");

  const refused = await refusedByTheSchema(tools, "get_energy_top_consumers", { limit: 26 });
  expect(refused.ok).toBe(false);
  expect(refused.content).toContain("limit");

  const full = fakeEnergyServices();
  const out = await full.tools.dispatch("get_energy_top_consumers", { limit: 25 }, ctx([ORG_X, ORG_Y, ORG_Z]));
  const result = okResult(out);
  expect(full.log.topConsumers).toEqual([{ window: "24h", limit: 25, assetIds: [ASSET_X] }]);
  expect(organizationsOf(result).map((o) => o.items.length)).toEqual([25]);
  expect(result.truncated).toBe(true);
  expect(out.ok && out.organizationIds).toEqual([ORG_X]);
}

/** A bad date, a reversed range and a 32-day span are refused before any read; a month reads once. */
export async function assertReportPreviewValidatesTheRangeBeforeAnyRead(): Promise<void> {
  const { tools, log } = fakeEnergyServices();
  for (const [field, args] of [
    ["startDate", { startDate: "2026-13-01", endDate: "2026-12-31" }],
    ["endDate", { startDate: "2026-09-30", endDate: "2026-09-01" }],
    ["endDate", { startDate: "2026-09-01", endDate: "2026-10-02" }],
  ] as const) {
    const refused = await refusedByTheSchema(tools, "get_energy_report_preview", args);
    expect(refused.ok, `${args.startDate}..${args.endDate}`).toBe(false);
    expect(refused.content, `${args.startDate}..${args.endDate}`).toContain(field);
  }
  expect(log.preview).toEqual([]);

  const ok = await viaRegistry(tools, "get_energy_report_preview", { startDate: "2026-08-01", endDate: "2026-08-31" });
  expect(ok.ok).toBe(true);

  const result = okResult(await tools.dispatch("get_energy_report_preview", MONTH, ctx([ORG_X])));
  expect(log.preview.map((c) => c.assetIds)).toEqual([[ASSET_X], [ASSET_X]]);
  expect(log.preview[1]?.query).toEqual(MONTH);
  const [entry] = organizationsOf(result);
  expect(entry?.items).toHaveLength(10);
  expect(entry?.items[0]).toEqual(expect.objectContaining({ siteName: "Site A", estimatedKwh: TOP_KWH }));
  expect(entry).toEqual(
    expect.objectContaining({
      range: expect.objectContaining(MONTH),
      summary: expect.objectContaining({ totalKwh: 2400 }),
      sourceTotals: { gridKwh: 9000, solarKwh: 1000, dgKwh: 50 },
    }),
  );
  const text = JSON.stringify(result);
  expect(text).not.toContain("template");
  expect(text).not.toContain("internalNote");
}

/**
 * Done means, through the turn service: "Which site used the most kWh last
 * month?" reaches the provider as the preview's top consumer, with the turn's
 * organization; the same turn naming an own-key organization reads nothing and
 * the provider sees the refusal.
 */
export async function assertTheTurnAnswersWhichSiteUsedTheMostKwhLastMonth(): Promise<void> {
  const question = "Which site used the most kWh last month?";
  const { tools, log } = fakeEnergyServices();
  const llm = new FakeLlmProvider([calls(toolCall("get_energy_report_preview", MONTH)), { kind: "final", text: `Site A, ${TOP_KWH} kWh` }]);
  const h = harness(llm, { conversationOrg: null, platform: { kind: "ready", allowed: [ORG_X] }, readTools: tools });
  h.service.clock = () => NOW;
  const response = await h.service.turn({ identity: GLOBAL_ADMIN, user: JWT }, CONVERSATION, question, "user", [], []);
  expect(log.preview.map((c) => c.assetIds)).toEqual([[ASSET_X]]);
  const content = toolMessages(llm).join("\n");
  expect(content).toContain('"siteName":"Site A"');
  expect(content).toContain(`"estimatedKwh":${TOP_KWH}`);
  expect(response.messages.find((m) => m.role === "assistant")?.organizationIds).toEqual([ORG_X]);

  const refused = fakeEnergyServices();
  const llm2 = new FakeLlmProvider([
    calls(toolCall("get_energy_report_preview", { ...MONTH, organizationId: ORG_B })),
    { kind: "final", text: "Not in scope." },
  ]);
  const h2 = harness(llm2, { conversationOrg: null, platform: { kind: "ready", allowed: [ORG_X] }, readTools: refused.tools });
  await h2.service.turn({ identity: GLOBAL_ADMIN, user: JWT }, CONVERSATION, question, "user", [], []);
  expect(refused.log.preview).toEqual([]);
  expect(toolMessages(llm2).join("\n")).toContain(COPILOT_TOOL_ORGANIZATION_OUT_OF_SCOPE);
}

// --- review findings ---------------------------------------------------------------------

/** 20 + 20 over two organizations: the second is sliced to 5 by the room, and that slice alone sets `truncated`. */
export async function assertReadPerOrganizationFlagsTruncatedWhenTheRoomSlicesAnAnswer(): Promise<void> {
  const { services } = fakeEnergyServices();
  const out = await readPerOrganization(services.access, ctx([ORG_X, ORG_Y]), undefined, async () => ({
    items: Array.from({ length: 20 }, (_, i) => i),
  }));
  const result = okResult(out);
  expect(organizationsOf(result).map((o) => o.items.length)).toEqual([20, 5]);
  expect(result.truncated).toBe(true);
}

/** Many organizations: each preview entry counts against the room, so the JSON stays under the tool-result cut and `truncated` is set. */
export async function assertReportPreviewBoundsTheResultOverManyOrganizations(): Promise<void> {
  const orgs = Array.from({ length: 30 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  for (const consumerCount of [0, 1, 10]) {
    const reads: string[] = [];
    const services = {
      access: { readableAssetIdsInOrganization: async (_user: JwtPayload, id: string) => [`3${id.slice(1)}`] },
      reports: {
        energyPreview: async (query: { startDate: string; endDate: string }, assetIds?: string[] | null) => {
          reads.push(assetIds?.[0] ?? "none");
          return {
            template: { id: "energy_consumption", title: "Energy", description: "d", formats: ["csv"], active: true },
            range: { startDate: query.startDate, endDate: query.endDate, durationHours: 720 },
            generatedAt: NOW.toISOString(),
            summary: {
              window: "custom",
              totalKwh: 123456.789,
              peakKw: 1234.567,
              pueEstimate: 1.234567,
              indicativeCost: 98765.4321,
              tariffPerKwh: 0.123456,
              currency: "INR",
              asOf: NOW.toISOString(),
            },
            sourceTotals: { gridKwh: 123456.789, solarKwh: 12345.678, dgKwh: 1234.567 },
            topConsumers: Array.from({ length: consumerCount }, (_, i) => ({
              ...consumer(i, assetIds?.[0] ?? "none"),
              name: `Main incomer feeder ${i}`,
              siteName: `Ion Exchange plant ${i}`,
              internalNote: undefined,
            })),
            notes: ["CSV, XLSX and PDF are generated on demand.", "DG is a nominal slice because the simulator has no separate DG meter."],
          };
        },
      },
    } as unknown as CopilotReadServices;
    const result = okResult(await getEnergyReportPreviewTool.run(services, MONTH, ctx(orgs)));
    const text = JSON.stringify(result);
    expect(text.length, `${consumerCount} consumers: ${text.length} chars`).toBeLessThan(TOOL_RESULT_MAX_CHARS);
    expect(reads.length, `${consumerCount} consumers`).toBeLessThan(orgs.length);
    expect(result.truncated, `${consumerCount} consumers`).toBe(true);
    expect(text).not.toContain("notes");
  }
}

/** The descriptions say what the data is: assets with a site name (not a per-site total), and only three KPIs 24 h earlier. */
export function assertTheDescriptionsMatchTheContracts(): void {
  expect(getEnergyReportPreviewTool.description).toMatch(/top 10 assets/);
  expect(getEnergyReportPreviewTool.description).toMatch(/not a per-site total/);
  expect(getEnergyReportPreviewTool.description).toMatch(/DG/);
  expect(getDashboardKpisTool.description).toContain("total kW, open alarms and PUE also 24 h earlier");
  expect(getDashboardKpisTool.description).not.toMatch(/each with its value 24 h earlier/);
}
