import { expect } from "vitest";

import type { JwtPayload, PointStatsSummaryRow } from "@bms/shared";

import { calls, FakeLlmProvider, toolCall } from "../../admin/onboarding/onboarding-agent-loop.spec";
import type { ResolvedIdentity } from "../../auth/identity-resolver";
import { runToolCall } from "../../llm/tool-registry";
import { succeed, TOOL_RESULT_CUT_TAIL } from "../../llm/tool-result";
import { mapRuleRow } from "../../rules/rule-mapping";
import { ruleRow } from "../../rules/rule-mapping.spec";
import type { InventoryAsset, InventoryPair, InventoryStats } from "../../rules/site-point-inventory-rows";
import { notePagedRead, type PagedReads, withPartialNote } from "../copilot-partial-read";
import { scrubToolResult } from "../copilot-secret-scrub";
import type { CopilotToolContext, CopilotToolResult } from "../copilot-read-tools";
import { COPILOT_SITE_SUMMARY_PROMPT_RULE, COPILOT_SYSTEM_PROMPT, COPILOT_TOOL_GUARDS } from "../copilot-turn.service";
import { harness } from "../copilot-turn.service.spec";
import type { CopilotReadServices } from "./copilot-read-tool";
import { createCopilotReadTools } from "./copilot-read-tool-set";
import { COPILOT_POINT_STATS_SUMMARY_NEEDS_LOCATION } from "./get-point-stats.tool";

/**
 * `F4.296` (ADR 0099 Amendment 10; owner rulings Q1, Q3, 2026-10-30) — a
 * site-wide read inside one turn: `get_point_stats` `summary` (F1),
 * `get_site_point_inventory` `unruled` (F2) and the server's partial sentence
 * (F3), over fake services that log their calls. The size claims measure the
 * content the model receives (`succeed(scrubToolResult(result))`, which cuts
 * through `toolResultContent`) for the row's done-means site: 52 assets and
 * 207 rule points. The site figures' SQL is in
 * `telemetry/point-stats.integration.spec.ts`. One `it()` per claim in the
 * sibling `.test.ts` (ADR 0014).
 */

const USER = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "22222222-2222-4222-8222-222222222222";
const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const SITE = "40000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-30T06:00:00.000Z");

const uuid = (prefix: string, i: number) => `${prefix}-4b4b-4c4c-8d8d-${String(i).padStart(12, "0")}`;

const GLOBAL_ADMIN = { id: USER, email: "u@x.test", displayName: "U", role: "admin", organizationId: null, oidcSubject: null, disabledAt: null } as ResolvedIdentity;
const JWT = { sub: USER, email: "u@x.test", role: "admin" } as JwtPayload;

function ctx(allowed: readonly string[] = [ORG_X]): CopilotToolContext {
  return { identity: GLOBAL_ADMIN, user: JWT, conversationId: CONVERSATION, conversationOrganizationId: null, allowedOrganizationIds: allowed, turnKind: "user", now: NOW };
}

/** The done-means site: 52 assets with live-length codes; asset `i` has `i % 3 + 3` rule points (207 in all). */
const ASSETS: InventoryAsset[] = Array.from({ length: 52 }, (_, i) => ({
  id: uuid("3a5e7c11", i),
  code: `RSMOC-WC-CH-${String(i + 1).padStart(3, "0")}`,
  name: `Western Cape chiller ${i + 1}`,
  domain: "hvac",
}));
const KEYS = ["supply_temp_c", "return_temp_c", "compressor_current_a", "condenser_pressure_kpa", "evaporator_pressure_kpa"];
const PAIRS: InventoryPair[] = ASSETS.flatMap((asset, i) => KEYS.slice(0, (i % 3) + 3).map((pointKey) => ({ assetId: asset.id, pointKey })));

/** A worst-case summary row: long floats, a 31-day minute series' sample count. */
function summaryRow(assetId: string, avg: number): PointStatsSummaryRow {
  return { assetId, min: avg - 123.45678901234567, avg, max: avg + 98_765.432109876543, sampleCount: 2_678_400 };
}

type FakeOptions = {
  /** The summary's per-asset rows; the default answers every asked id but the last 3, each mean `1000 + index`. */
  readonly summaryRows?: (assetIds: readonly string[]) => PointStatsSummaryRow[];
  /** Pairs a rule watches; the default: the first key of every asset. */
  readonly watched?: (pair: InventoryPair) => boolean;
  readonly unit?: string | null;
};

function fake(options: FakeOptions = {}) {
  const log = {
    summary: [] as Array<{ assetIds: readonly string[]; pointKey: string; from: Date; to: Date }>,
    listAll: [] as Array<readonly string[]>,
    stats: [] as Array<readonly InventoryPair[]>,
    rules: [] as Array<readonly string[]>,
  };
  const watched = options.watched ?? ((pair: InventoryPair) => pair.pointKey === KEYS[0]);
  const services = {
    access: { readableAssetIdsInOrganization: async () => ASSETS.map((asset) => asset.id) },
    locationScope: { readableAssetIdsInLocations: async () => ({ ok: true, organizationId: ORG_X, assetIds: ASSETS.map((asset) => asset.id) }) },
    assets: {
      listAll: async (assetIds: string[]) => {
        log.listAll.push(assetIds);
        return ASSETS.filter((asset) => assetIds.includes(asset.id)).map((asset) => ({ id: asset.id, code: asset.code, name: asset.name }));
      },
    },
    telemetry: {
      pointStatsSummary: async (call: { assetIds: readonly string[]; pointKey: string; from: Date; to: Date }) => {
        log.summary.push(call);
        const rows = options.summaryRows?.(call.assetIds) ?? call.assetIds.slice(0, -3).map((assetId, i) => summaryRow(assetId, 1000 + i));
        return {
          pointKey: call.pointKey,
          from: call.from.toISOString(),
          to: call.to.toISOString(),
          coveredFrom: call.from.toISOString(),
          coveredTo: call.to.toISOString(),
          bucketSeconds: 3_600,
          site: { min: -1.5, avg: 1024.5, max: 99_999.25, sampleCount: 131_000_000 },
          rows: [...rows, summaryRow(uuid("eeeeeeee", 0), 5_000)],
        };
      },
    },
    inventory: {
      pairs: async () => ({ assets: ASSETS, pairs: PAIRS }),
      stats: async (pairs: readonly InventoryPair[]): Promise<InventoryStats[]> => {
        log.stats.push(pairs);
        return pairs.map(() => ({ unit: options.unit === undefined ? "kPa" : options.unit, min: 1, avg: 2, max: 3, last: 2, samples: 10_080 }));
      },
    },
    rules: {
      listRules: async (assetIds: string[]) => {
        log.rules.push(assetIds);
        const items = PAIRS.filter((pair) => assetIds.includes(pair.assetId) && watched(pair)).map((pair, i) =>
          mapRuleRow(ruleRow({ id: uuid("c72de634", i), assetId: pair.assetId, pointKey: pair.pointKey })),
        );
        // An archived rule on an unwatched pair watches nothing.
        const archived = mapRuleRow(
          ruleRow({ id: uuid("a7c41fed", 0), assetId: ASSETS[0]!.id, pointKey: KEYS[1]!, lifecycleStatus: "archived", enabled: false }),
        );
        return { items: [archived, ...items] };
      },
    },
  } as unknown as CopilotReadServices;
  return { tools: createCopilotReadTools(services), log };
}

function result(out: CopilotToolResult): Record<string, unknown> & { organizations: Array<Record<string, unknown>> } {
  if (!out.ok) throw new Error(`F4.296: refused: ${out.error}`);
  return out.result as Record<string, unknown> & { organizations: Array<Record<string, unknown>> };
}

/** The content the model receives, as the turn service builds it. */
function asTheModelSeesIt(out: CopilotToolResult): string {
  if (!out.ok) throw new Error(`F4.296: refused: ${out.error}`);
  return succeed(scrubToolResult(out.result)).content;
}

async function schemaRefusal(name: string, args: Record<string, unknown>): Promise<string> {
  const { tools } = fake();
  const out = await runToolCall(tools.registry, toolCall(name, args), () => Promise.reject(new Error("must not dispatch")), COPILOT_TOOL_GUARDS);
  expect(out.ok).toBe(false);
  return out.content;
}

const summary = (tools: ReturnType<typeof fake>["tools"], args: Record<string, unknown> = {}) =>
  tools.dispatch("get_point_stats", { pointKey: "kw", locationId: SITE, lastDays: 7, summary: true, ...args }, ctx());

const unruled = (tools: ReturnType<typeof fake>["tools"], args: Record<string, unknown> = {}) =>
  tools.dispatch("get_site_point_inventory", { locationId: SITE, unruled: true, ...args }, ctx());

// --- F1: get_point_stats summary --------------------------------------------------------------

/** One service call with all 52 subtree ids (no 25-id page), no cursor, the site row as the service gave it. */
export async function aSummaryReadsTheWholeSiteInOneCall(): Promise<void> {
  const { tools, log } = fake();
  const out = result(await summary(tools));
  expect(log.summary.map((call) => call.assetIds)).toEqual([ASSETS.map((asset) => asset.id)]);
  expect([out.truncated, "nextCursor" in out]).toEqual([false, false]);
  expect(out.organizations[0]?.site).toEqual({ min: -1.5, avg: 1024.5, max: 99_999.25, sampleCount: 131_000_000 });
  expect([out.organizations[0]?.assetCount, out.organizations[0]?.assetsWithNoData]).toEqual([52, 3]);
}

/** The 5 highest and the 5 lowest assets by mean, by code, highest first and lowest first; no asset in both. */
export async function aSummaryNamesTheHighestAndLowestAssets(): Promise<void> {
  const { tools } = fake();
  const entry = result(await summary(tools)).organizations[0]!;
  const codes = (key: string) => (entry[key] as Array<{ code: string }>).map((row) => row.code);
  // Asset i has mean 1000 + i for i < 49, so 48..44 are highest and 0..4 lowest.
  expect(codes("highest")).toEqual([48, 47, 46, 45, 44].map((i) => ASSETS[i]!.code));
  expect(codes("lowest")).toEqual([0, 1, 2, 3, 4].map((i) => ASSETS[i]!.code));
}

/** A site of 7 assets with data: the 5 highest, then the other 2 as the lowest, never one twice. */
export async function aSmallSiteNamesEachAssetOnce(): Promise<void> {
  const { tools } = fake({ summaryRows: (ids) => ids.slice(0, 7).map((assetId, i) => summaryRow(assetId, i)) });
  const entry = result(await summary(tools)).organizations[0]!;
  const codes = (key: string) => (entry[key] as Array<{ code: string }>).map((row) => row.code);
  expect([codes("highest"), codes("lowest")]).toEqual([[6, 5, 4, 3, 2].map((i) => ASSETS[i]!.code), [0, 1].map((i) => ASSETS[i]!.code)]);
}

/** The assets with no sample: their count, and the codes of at most 10; `listAll` is asked only the named ids. */
export async function aSummaryNamesTheAssetsWithNoData(): Promise<void> {
  const { tools, log } = fake({ summaryRows: (ids) => ids.slice(0, 30).map((assetId, i) => summaryRow(assetId, i)) });
  const entry = result(await summary(tools)).organizations[0]!;
  expect(entry.assetsWithNoData).toBe(22);
  expect(entry.noData).toEqual(ASSETS.slice(30, 40).map((asset) => asset.code));
  expect(log.listAll).toHaveLength(1);
  expect(log.listAll[0]).toHaveLength(20);
}

/** A row the service answers for an asset not asked is never named. */
export async function aSummaryDropsARowNotAsked(): Promise<void> {
  const { tools } = fake();
  expect(JSON.stringify(result(await summary(tools)))).not.toContain(uuid("eeeeeeee", 0));
}

/** The shared fields are at the top once; the entry has no `items`. */
export async function aSummaryHasTheSharedFieldsAtTheTop(): Promise<void> {
  const { tools } = fake();
  const out = result(await summary(tools));
  expect([out.pointKey, out.bucketSeconds]).toEqual(["kw", 3_600]);
  expect(Object.keys(out.organizations[0]!).sort()).toEqual(["assetCount", "assetsWithNoData", "highest", "lowest", "noData", "organizationId", "site"]);
}

/** Done means (size): a 52-asset worst-case summary reaches the model whole, in one result. Measured in the message. */
export async function aFiftyTwoAssetSummaryReachesTheModelWhole(): Promise<void> {
  const { tools } = fake();
  const content = asTheModelSeesIt(await summary(tools, { lastDays: 31 }));
  expect(content.endsWith(TOOL_RESULT_CUT_TAIL), `${content.length} characters`).toBe(false);
  expect(content.length, `${content.length} characters`).toBeLessThan(3_000);
  JSON.parse(content);
}

/** `summary` with `assetIds` is refused by the schema before dispatch. */
export async function aSummaryWithAssetIdsIsRefused(): Promise<void> {
  expect(await schemaRefusal("get_point_stats", { pointKey: "kw", assetIds: [ASSETS[0]!.id], lastDays: 7, summary: true })).toContain(
    COPILOT_POINT_STATS_SUMMARY_NEEDS_LOCATION,
  );
}

/** `summary` with a `cursor` is refused by the schema before dispatch. */
export async function aSummaryWithACursorIsRefused(): Promise<void> {
  const cursor = Buffer.from(JSON.stringify({ o: ORG_X, k: 25 }), "utf-8").toString("base64url");
  expect(await schemaRefusal("get_point_stats", { pointKey: "kw", locationId: SITE, lastDays: 7, summary: true, cursor })).toContain(
    COPILOT_POINT_STATS_SUMMARY_NEEDS_LOCATION,
  );
}

/** A location page (no summary) now reports its subtree's asset count, the total the partial sentence names. */
export async function aLocationPageReportsTheAssetCount(): Promise<void> {
  // The per-asset page reads `pointStatsByAsset`; this fake answers it with no rows.
  const out = await createCopilotReadTools({
    access: { readableAssetIdsInOrganization: async () => [] },
    locationScope: { readableAssetIdsInLocations: async () => ({ ok: true, organizationId: ORG_X, assetIds: ASSETS.map((asset) => asset.id) }) },
    telemetry: {
      pointStatsByAsset: async (call: { assetIds: readonly string[]; pointKey: string; from: Date; to: Date }) => ({
        pointKey: call.pointKey,
        from: call.from.toISOString(),
        to: call.to.toISOString(),
        coveredFrom: call.from.toISOString(),
        coveredTo: call.to.toISOString(),
        bucketSeconds: 3_600,
        rows: [],
      }),
    },
  } as unknown as CopilotReadServices).dispatch("get_point_stats", { pointKey: "kw", locationId: SITE, lastDays: 7 }, ctx());
  expect(result(out).assetCount).toBe(52);
}

// --- F2: get_site_point_inventory unruled -----------------------------------------------------

/** Only the unwatched points, grouped by asset as key → unit, with the whole subtree's counts; an archived rule watches nothing. */
export async function unruledListsOnlyTheUnwatchedPoints(): Promise<void> {
  const { tools } = fake();
  const entry = result(await unruled(tools)).organizations[0]!;
  expect([entry.assetCount, entry.pointCount, entry.watchedCount, entry.unwatchedCount]).toEqual([52, 207, 52, 155]);
  const items = entry.items as Array<{ assetId: string; code: string; points: Record<string, string | null> }>;
  expect(items[0]).toEqual({ assetId: ASSETS[0]!.id, code: ASSETS[0]!.code, points: { return_temp_c: "kPa", compressor_current_a: "kPa" } });
  expect(items.flatMap((item) => Object.keys(item.points))).not.toContain(KEYS[0]);
}

/** The rules are read once for every subtree asset; statistics (the unit) for the page's unwatched pairs only. */
export async function unruledReadsTheRulesOnceAndStatsForThePage(): Promise<void> {
  const { tools, log } = fake();
  await unruled(tools);
  expect(log.rules).toEqual([ASSETS.map((asset) => asset.id)]);
  expect(log.stats).toHaveLength(1);
  expect(log.stats[0]?.every((pair) => pair.pointKey !== KEYS[0])).toBe(true);
}

/** A point with no unit is `null`, never a missing key. */
export async function unruledKeepsAPointWithNoUnit(): Promise<void> {
  const { tools } = fake({ unit: null });
  const items = result(await unruled(tools)).organizations[0]!.items as Array<{ points: Record<string, string | null> }>;
  expect(items[0]?.points).toEqual({ return_temp_c: null, compressor_current_a: null });
}

/**
 * Done means (size): the 52-asset, 207-point site with no rule at all — every
 * point unwatched — and the same site with one rule per asset (155
 * unwatched) each reach the model whole in at most two pages, every point
 * once, each page whole JSON: with `list_locations`, three calls. Each asset
 * costs its id and code (~95 characters), so 52 assets alone are ~5,000 of
 * the 7,500 budget.
 */
export async function aTwoHundredPointUnruledReadFitsInTwoPages(): Promise<void> {
  for (const [watched, maxPages] of [[() => false, 2], [undefined, 2]] as const) {
    const { tools } = fake({ watched });
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const content = asTheModelSeesIt(await unruled(tools, cursor === undefined ? {} : { cursor }));
      expect(content.endsWith(TOOL_RESULT_CUT_TAIL), `${content.length} characters`).toBe(false);
      const parsed = JSON.parse(content) as { nextCursor: string | null; organizations: Array<{ items: Array<{ assetId: string; points: Record<string, unknown> }> }> };
      for (const item of parsed.organizations[0]!.items) for (const key of Object.keys(item.points)) seen.push(`${item.assetId}/${key}`);
      cursor = parsed.nextCursor ?? undefined;
      pages += 1;
    } while (cursor !== undefined && pages < 10);
    const expected = PAIRS.filter((pair) => !(watched ?? ((p: InventoryPair) => p.pointKey === KEYS[0]))(pair)).map((pair) => `${pair.assetId}/${pair.pointKey}`);
    expect(pages, `${expected.length} points`).toBeLessThanOrEqual(maxPages);
    expect(seen).toEqual(expected);
  }
}

// --- F3: the partial sentence -----------------------------------------------------------------

const page = (items: unknown[], nextCursor: string | null, extra: Record<string, unknown> = {}) => ({ truncated: nextCursor !== null, nextCursor, organizations: [{ organizationId: ORG_X, items, ...extra }] });

/** A page left open names the rows read and the tool's total; the reply is kept, the sentence appended. */
export async function anOpenPageAppendsThePartialSentence(): Promise<void> {
  const reads: PagedReads = new Map();
  notePagedRead(reads, "get_point_stats", {}, { ...page(Array(25).fill({}), "c1"), assetCount: 52 });
  expect(withPartialNote("The mean is 41 kW.", reads)).toBe("The mean is 41 kW. This answer is partial: it read 25 of 52 assets.");
}

/** A later page that ends the list closes it: no sentence. */
export async function aFinalPageClosesTheRead(): Promise<void> {
  const reads: PagedReads = new Map();
  notePagedRead(reads, "list_alarms", {}, page(Array(25).fill({}), "c1"));
  notePagedRead(reads, "list_alarms", { cursor: "c1" }, page(Array(3).fill({}), null));
  expect(withPartialNote("28 alarms.", reads)).toBe("28 alarms.");
}

/** A resumed read adds its rows; a tool with no total names itself and says more were not read. */
export async function aResumedReadAddsItsRows(): Promise<void> {
  const reads: PagedReads = new Map();
  notePagedRead(reads, "list_alarms", {}, page(Array(25).fill({}), "c1"));
  notePagedRead(reads, "list_alarms", { cursor: "c1" }, page(Array(3).fill({}), "c2"));
  expect(withPartialNote("The site has 28.", reads)).toBe("The site has 28. This answer is partial: it read 28 rows from list_alarms, and more were not read.");
}

/** A call with no cursor starts the count again; an unruled page counts its points, against `unwatchedCount`. */
export async function aFirstPageStartsTheCountAgain(): Promise<void> {
  const reads: PagedReads = new Map();
  const items = [{ points: { a: null, b: null } }, { points: { c: null } }];
  notePagedRead(reads, "get_site_point_inventory", {}, page(items, "c1", { unwatchedCount: 9, pointCount: 20 }));
  notePagedRead(reads, "get_site_point_inventory", {}, page(items, "c1", { unwatchedCount: 9, pointCount: 20 }));
  expect(withPartialNote("x", reads)).toBe("x This answer is partial: it read 3 of 9 points.");
}

/** A result with no `nextCursor` key (an unpaged read, a summary) is not noted. */
export async function anUnpagedResultIsNotNoted(): Promise<void> {
  const reads: PagedReads = new Map();
  notePagedRead(reads, "get_point_stats", {}, { truncated: false, organizations: [{ organizationId: ORG_X, site: {} }] });
  expect(reads.size).toBe(0);
}

/**
 * Through the turn service: a turn that reads one page of a location's
 * `get_point_stats` and answers stores the reply with the partial sentence;
 * the provider never sees the sentence.
 */
export async function aTurnThatLeftAPageUnreadSaysSo(): Promise<void> {
  const tools = createCopilotReadTools({
    access: { readableAssetIdsInOrganization: async () => [] },
    locationScope: { readableAssetIdsInLocations: async () => ({ ok: true, organizationId: ORG_X, assetIds: ASSETS.map((asset) => asset.id) }) },
    telemetry: {
      pointStatsByAsset: async (call: { assetIds: readonly string[]; pointKey: string; from: Date; to: Date }) => ({
        pointKey: call.pointKey,
        from: call.from.toISOString(),
        to: call.to.toISOString(),
        coveredFrom: call.from.toISOString(),
        coveredTo: call.to.toISOString(),
        bucketSeconds: 3_600,
        rows: call.assetIds.map((assetId) => ({ assetId, min: 1, avg: 2, max: 3, last: 2, lastAt: null, sampleCount: 60 })),
      }),
    },
  } as unknown as CopilotReadServices);
  const llm = new FakeLlmProvider([
    calls(toolCall("get_point_stats", { pointKey: "kw", locationId: SITE, lastDays: 7 })),
    { kind: "final", text: "The mean is 2 kW." },
  ]);
  const h = harness(llm, { conversationOrg: null, platform: { kind: "ready", allowed: [ORG_X] }, readTools: tools });
  h.service.clock = () => NOW;
  const response = await h.service.turn({ identity: GLOBAL_ADMIN, user: JWT }, CONVERSATION, "Mean kw at the site this week", "user", [], []);
  const reply = response.messages.find((m) => m.role === "assistant");
  expect(reply?.content).toBe("The mean is 2 kW. This answer is partial: it read 25 of 52 assets.");
  expect(llm.seen.flat().some((m) => typeof m.content === "string" && m.content.includes("This answer is partial"))).toBe(false);
}

/** F4: the system prompt carries the summary line. */
export async function theSystemPromptNamesBothModes(): Promise<void> {
  expect(COPILOT_SYSTEM_PROMPT).toContain(COPILOT_SITE_SUMMARY_PROMPT_RULE);
  expect(COPILOT_SITE_SUMMARY_PROMPT_RULE).toContain("summary: true");
  expect(COPILOT_SITE_SUMMARY_PROMPT_RULE).toContain("unruled: true");
}
