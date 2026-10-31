import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { calls, FakeLlmProvider, toolCall } from "../../admin/onboarding/onboarding-agent-loop.spec";
import type { ResolvedIdentity } from "../../auth/identity-resolver";
import type { LocationAssetScope } from "../../auth/location-asset-scope.service";
import type { LlmMessage } from "../../llm/llm-port";
import { runToolCall } from "../../llm/tool-registry";
import { succeed, TOOL_RESULT_CUT_TAIL, TOOL_RESULT_MAX_CHARS } from "../../llm/tool-result";
import { mapRuleRow } from "../../rules/rule-mapping";
import { ruleRow } from "../../rules/rule-mapping.spec";
import type { InventoryAsset, InventoryPair, InventoryStats } from "../../rules/site-point-inventory-rows";
import { scrubToolResult } from "../copilot-secret-scrub";
import type { CopilotToolContext, CopilotToolResult } from "../copilot-read-tools";
import { COPILOT_TOOL_GUARDS } from "../copilot-turn.service";
import { harness } from "../copilot-turn.service.spec";
import { COPILOT_TOOL_BAD_CURSOR } from "./copilot-list-paging";
import type { CopilotReadServices } from "./copilot-read-tool";
import { createCopilotReadTools } from "./copilot-read-tool-set";
import { COPILOT_TOOL_LOCATION_OUT_OF_SCOPE, COPILOT_TOOL_LOCATION_OUTSIDE_GRANT } from "./copilot-tool-scope";

/**
 * `F4.288` (ADR 0099 Amendment 9 E2) — `get_site_point_inventory` over fake
 * services that log their calls. The location helper (`F4.291`, ruling P5)
 * is the containment: every refusal claim checks the inventory and rule
 * logs stay empty beside a positive call that reaches them. The page claims
 * walk the tool as the model receives it (`succeed(scrubToolResult(result))`,
 * the `list-page-budget.spec.ts` method): every page whole JSON under the
 * 8,000-character cut, and every pair once. One `it()` per claim in the
 * sibling `.test.ts` (ADR 0014).
 */

const USER = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "22222222-2222-4222-8222-222222222222";
const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const ORG_Y = "00000000-0000-4000-8000-0000000000bb";
const SITE = "40000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-29T06:00:00.000Z");
const DAY = 86_400_000;

const uuid = (prefix: string, i: number) => `${prefix}-4b4b-4c4c-8d8d-${String(i).padStart(12, "0")}`;

const GLOBAL_ADMIN = { id: USER, email: "u@x.test", displayName: "U", role: "admin", organizationId: null, oidcSubject: null, disabledAt: null } as ResolvedIdentity;
const JWT = { sub: USER, email: "u@x.test", role: "admin" } as JwtPayload;

function ctx(allowed: readonly string[] = [ORG_X, ORG_Y]): CopilotToolContext {
  return { identity: GLOBAL_ADMIN, user: JWT, conversationId: CONVERSATION, conversationOrganizationId: null, allowedOrganizationIds: allowed, turnKind: "user", now: NOW };
}

/** A site of `assets` PHE-like gateways with `points` keys each, live-length codes, names and keys. */
type Site = { assets: InventoryAsset[]; keys: (asset: number) => string[]; unit: string; rulesPerPoint: number; archivedPerPoint?: number };

function phe(assetCount = 10, pointCount = 12): Site {
  return {
    assets: Array.from({ length: assetCount }, (_, i) => ({
      id: uuid("8c733274", i),
      code: `PHE-AIRSP${1050 + i}M`,
      name: `PHE Kolkata air sampling gateway ${i}`,
      domain: "environment",
    })),
    keys: () => ["battery_charge_pct", "signal_strength_dbm", "temperature_c", "humidity_pct", ...Array.from({ length: pointCount - 4 }, (_, k) => `pm25_sensor_${k}_ugm3`)],
    unit: "%",
    rulesPerPoint: 1,
  };
}

/** The worst case: 128-character keys, 32-character units, 13 rules a point (10 ids shown), long floats. */
function worst(): Site {
  return {
    assets: phe(6, 1).assets,
    keys: (a) => Array.from({ length: 8 }, (_, k) => `k${a}_${k}_`.padEnd(128, "x")),
    unit: "u".repeat(32),
    rulesPerPoint: 13,
  };
}

/**
 * `F4.288` review: 45 single-point assets whose names fill the 255-character
 * column, so a page's assets cost more than its rows and a page's worth of
 * them alone is over the budget.
 */
function longNames(): Site {
  return {
    assets: Array.from({ length: 45 }, (_, i) => ({
      id: uuid("5e1f0a77", i),
      code: `PHE-AIRSP${1050 + i}M`,
      name: `PHE Kolkata air sampling gateway ${i} `.padEnd(255, "n"),
      domain: "environment",
    })),
    keys: () => ["temperature_c"],
    unit: "%",
    rulesPerPoint: 1,
  };
}

function pairsOf(site: Site): InventoryPair[] {
  return site.assets.flatMap((asset, a) => site.keys(a).map((pointKey) => ({ assetId: asset.id, pointKey })));
}

type FakeOptions = { readonly location?: LocationAssetScope; readonly site?: Site };

function fake(options: FakeOptions = {}) {
  const site = options.site ?? phe();
  const all = pairsOf(site);
  const log = {
    location: [] as Array<{ candidates: readonly string[]; locationIds: readonly string[] }>,
    pairs: [] as Array<{ assetIds: readonly string[]; domain: string | undefined }>,
    stats: [] as Array<{ pairs: readonly InventoryPair[]; now: Date }>,
    rules: [] as Array<readonly string[]>,
  };
  let ruleSeq = 0;
  const services = {
    access: { readableAssetIdsInOrganization: async () => site.assets.map((asset) => asset.id) },
    locationScope: {
      readableAssetIdsInLocations: async (_user: JwtPayload, candidates: readonly string[], locationIds: readonly string[]) => {
        log.location.push({ candidates, locationIds });
        return options.location ?? { ok: true, organizationId: ORG_X, assetIds: site.assets.map((asset) => asset.id) };
      },
    },
    inventory: {
      pairs: async (assetIds: readonly string[], domain?: string) => {
        log.pairs.push({ assetIds, domain });
        return { assets: site.assets, pairs: all };
      },
      stats: async (pairs: readonly InventoryPair[], now: Date): Promise<InventoryStats[]> => {
        log.stats.push({ pairs, now });
        return pairs.map((_, i) => ({ unit: site.unit, min: -123.456789, avg: 26.666666666666668, max: 98_765.4321, last: 20.123456789, samples: 10_080 - i }));
      },
    },
    rules: {
      listRules: async (assetIds: string[]) => {
        log.rules.push(assetIds);
        const asked = all.filter((pair) => assetIds.includes(pair.assetId));
        const items = asked.flatMap((pair) =>
          Array.from({ length: site.rulesPerPoint }, () => {
            ruleSeq += 1;
            return mapRuleRow(ruleRow({ id: uuid("c72de634", ruleSeq), assetId: pair.assetId, pointKey: pair.pointKey }));
          }),
        );
        // Archived rules on the same pairs, listed first: they must not be named or counted.
        const archived = asked.flatMap((pair, i) =>
          Array.from({ length: site.archivedPerPoint ?? 0 }, () =>
            mapRuleRow(ruleRow({ id: uuid("a7c41fed", i), assetId: pair.assetId, pointKey: pair.pointKey, lifecycleStatus: "archived", enabled: false })),
          ),
        );
        return { items: [...archived, ...items] };
      },
    },
  } as unknown as CopilotReadServices;
  return { tools: createCopilotReadTools(services), log, all };
}

type Row = { asset: number; key: string; unit: string | null; min: number | null; avg: number | null; max: number | null; last: number | null; samples: number; ruleIds: string[]; ruleCount: number };
type Entry = { organizationId: string; from?: string; to?: string; assetCount?: number; pointCount?: number; assets?: InventoryAsset[]; items: Row[] };
type Page = { truncated: boolean; nextCursor: string | null; organizations: Entry[] };

const call = (tools: ReturnType<typeof fake>["tools"], args: Record<string, unknown>, allowed?: readonly string[]) =>
  tools.dispatch("get_site_point_inventory", { locationId: SITE, ...args }, ctx(allowed));

function page(out: CopilotToolResult): Page {
  if (!out.ok) throw new Error(`F4.288: refused: ${out.error}`);
  return out.result as unknown as Page;
}

/** The content the model receives (`succeed(scrubToolResult(result))`). */
function content(out: CopilotToolResult): string {
  if (!out.ok) throw new Error(`F4.288: refused: ${out.error}`);
  return succeed(scrubToolResult(out.result)).content;
}

/** Every page from no cursor to `nextCursor: null`, as the model receives it; each must parse whole. */
async function walk(options: FakeOptions = {}) {
  const f = fake(options);
  const contents: string[] = [];
  let cursor: string | undefined;
  for (let n = 0; n < 30; n += 1) {
    const text = content(await call(f.tools, cursor === undefined ? {} : { cursor }));
    contents.push(text);
    const next = (JSON.parse(text) as Page).nextCursor;
    if (next == null) break;
    cursor = next;
  }
  const pages = contents.map((text) => JSON.parse(text) as Page);
  const rows = pages.flatMap((p) => p.organizations.flatMap((entry) => entry.items));
  return { ...f, contents, pages, rows, seen: pages.flatMap(pairsSeen) };
}

/** The (asset id, key) of every row of a page: a row names its asset by its index in the entry's `assets`. */
function pairsSeen(p: Page): Array<[string | undefined, string]> {
  return p.organizations.flatMap((entry) => entry.items.map((row): [string | undefined, string] => [entry.assets?.[row.asset]?.id, row.key]));
}

// --- placement before data -----------------------------------------------------------------------

/** A location the helper does not find in the turn's organizations is refused, and nothing is read. Beside it: a placed one reads. */
export async function aLocationOutsideTheTurnsOrganizationsIsRefusedAndNothingIsRead(): Promise<void> {
  const refused = fake({ location: { ok: false, reason: "not_found" } });
  expect(await call(refused.tools, {})).toEqual({ ok: false, error: COPILOT_TOOL_LOCATION_OUT_OF_SCOPE });
  expect([refused.log.pairs, refused.log.stats, refused.log.rules]).toEqual([[], [], []]);

  const placed = fake({ location: { ok: true, organizationId: ORG_X, assetIds: [uuid("8c733274", 0)] } });
  page(await call(placed.tools, {}));
  expect(placed.log.location).toEqual([{ candidates: [ORG_X, ORG_Y], locationIds: [SITE] }]);
  expect(placed.log.pairs.map((entry) => entry.assetIds)).toEqual([[uuid("8c733274", 0)]]);
}

/** A location in an allowed organization whose subtree the caller does not read is refused, not answered empty, and nothing is read. */
export async function aLocationOutsideTheGrantIsRefusedAndNothingIsRead(): Promise<void> {
  const { tools, log } = fake({ location: { ok: false, reason: "outside_grant" } });
  expect(await call(tools, {})).toEqual({ ok: false, error: COPILOT_TOOL_LOCATION_OUTSIDE_GRANT });
  expect([log.pairs, log.stats, log.rules]).toEqual([[], [], []]);
}

// --- arguments -----------------------------------------------------------------------------------

/** `domain` reaches the service unchanged; without it the service sees none. */
export async function theDomainReachesTheService(): Promise<void> {
  const { tools, log } = fake();
  page(await call(tools, { domain: "environment" }));
  page(await call(tools, {}));
  expect(log.pairs.map((entry) => entry.domain)).toEqual(["environment", undefined]);
}

/** The schema is strict and needs `locationId`: an extra key and a missing location are refused before dispatch. */
export async function theSchemaIsStrictAndNeedsALocation(): Promise<void> {
  const { tools } = fake();
  const refuse = (args: Record<string, unknown>) =>
    runToolCall(tools.registry, toolCall("get_site_point_inventory", args), () => Promise.reject(new Error("must not dispatch")), COPILOT_TOOL_GUARDS);
  const extra = await refuse({ locationId: SITE, includeAll: true });
  const missing = await refuse({ domain: "environment" });
  expect([extra.ok, missing.ok]).toEqual([false, false]);
  expect(extra.content).toContain("includeAll");
}

/** A cursor of another organization is refused with the paging sentence, and no inventory is read. */
export async function aForeignCursorIsRefused(): Promise<void> {
  const { tools, log } = fake();
  const foreign = Buffer.from(JSON.stringify({ o: ORG_Y, k: 5 }), "utf-8").toString("base64url");
  expect(await call(tools, { cursor: foreign })).toEqual({ ok: false, error: COPILOT_TOOL_BAD_CURSOR });
  expect(log.pairs).toEqual([]);
}

// --- rows ----------------------------------------------------------------------------------------

/**
 * A row carries its own pair's statistics (rounded), the 7-day window on the
 * turn clock, and the rules on that pair only: an archived rule on the same
 * pair is neither named nor counted (ruling P6).
 */
export async function aRowJoinsItsStatsAndItsOwnRules(): Promise<void> {
  const { tools, log, all } = fake({ site: { ...phe(2, 4), archivedPerPoint: 1 } });
  const entry = page(await call(tools, {})).organizations[0]!;
  const first = entry.items[0]!;
  expect(entry.assets?.[0]?.id).toBe(all[0]!.assetId);
  expect(first).toEqual({
    asset: 0,
    key: all[0]!.pointKey,
    unit: "%",
    min: -123.457,
    avg: 26.6667,
    max: 98_765.4,
    last: 20.1235,
    samples: 10_080,
    ruleIds: [uuid("c72de634", 1)],
    ruleCount: 1,
  });
  expect(entry.items.map((row) => [row.samples, row.ruleIds, row.ruleCount])).toEqual(all.map((_, i) => [10_080 - i, [uuid("c72de634", i + 1)], 1]));
  expect([entry.from, entry.to, log.stats[0]?.now]).toEqual([new Date(NOW.getTime() - 7 * DAY).toISOString(), NOW.toISOString(), NOW]);
}

/** Statistics and rules are read for the page's pairs and assets only, never the whole subtree's. */
export async function statsAndRulesReadThePageOnly(): Promise<void> {
  const { tools, log, all } = fake();
  const first = page(await call(tools, {}));
  const rows = first.organizations[0]!.items;
  expect(log.stats[0]?.pairs).toEqual(all.slice(0, log.stats[0]!.pairs.length));
  expect(log.stats[0]!.pairs.length).toBeLessThan(all.length);
  expect(log.rules[0]).toEqual([...new Set(log.stats[0]!.pairs.map((pair) => pair.assetId))]);
  expect(rows.length).toBeGreaterThan(0);
}

// --- pages ---------------------------------------------------------------------------------------

/**
 * A realistic site (10 PHE gateways, 12 points each, one rule a point): every
 * page reaches the model whole, under the cut, and the walk lists every pair
 * once, in order. Measured 2026-10-29 after the `F4.288` review (a row names
 * its asset by index, the page is sized with its assets): ~188 characters a
 * row, four pages of 35, 34, 34 and 17 rows (7,304, 7,252, 7,254 and 3,720
 * characters as the model receives them), so four calls of the turn's eight
 * (before the review: ~227 characters, five pages of ~29).
 */
export async function aRealisticSiteWalksWholeAndComplete(): Promise<void> {
  const { contents, pages, seen, all } = await walk();
  for (const text of contents) {
    expect(text.endsWith(TOOL_RESULT_CUT_TAIL)).toBe(false);
    expect(text.length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS);
  }
  expect(seen).toEqual(all.map((pair) => [pair.assetId, pair.pointKey]));
  expect(pages.length).toBeLessThanOrEqual(4);
}

/** A realistic page holds at least 34 rows: a row names its asset by index, not by its 36-character id (`F4.288` review; measured 35). */
export async function aRealisticPageHoldsAtLeast34Rows(): Promise<void> {
  const { pages } = await walk();
  expect(pages[0]?.organizations[0]?.items.length).toBeGreaterThanOrEqual(34);
}

/** The worst-case rows (128-character keys, 10 rule ids, 32-character units): fitted pages, still whole, and every pair once. */
export async function aWorstCaseSiteWalksWholeAndComplete(): Promise<void> {
  const { contents, rows, seen, all } = await walk({ site: worst() });
  for (const text of contents) {
    expect(text.endsWith(TOOL_RESULT_CUT_TAIL)).toBe(false);
    expect(text.length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS);
  }
  expect(seen).toEqual(all.map((pair) => [pair.assetId, pair.pointKey]));
  expect(rows[0]?.ruleIds).toHaveLength(10);
  expect(rows[0]?.ruleCount).toBe(13);
}

/**
 * `F4.288` review: assets with 255-character names still walk to
 * `nextCursor: null`; every page carries at least one row and every pair is
 * listed once (a page's assets are sized with its rows, so they never crowd
 * every row out and repeat the incoming cursor). Measured: four pages of 13,
 * 13, 13 and 6 rows.
 */
export async function longAssetNamesStillWalkToTheEnd(): Promise<void> {
  const { pages, seen, all } = await walk({ site: longNames() });
  expect(pages.at(-1)?.nextCursor).toBeNull();
  expect(pages.length).toBeLessThanOrEqual(4);
  expect(pages.map((p) => p.organizations[0]?.items.length ?? 0).filter((n) => n === 0)).toEqual([]);
  expect(seen).toEqual(all.map((pair) => [pair.assetId, pair.pointKey]));
}

/** Each page's `assets` are exactly the assets its rows name (index 0 up, none unnamed), with the subtree's counts beside them. */
export async function aPageNamesOnlyItsOwnAssets(): Promise<void> {
  const { pages } = await walk();
  for (const p of pages) {
    const entry = p.organizations[0]!;
    expect([...new Set(entry.items.map((row) => row.asset))]).toEqual(entry.assets?.map((_, i) => i));
    expect([entry.assetCount, entry.pointCount]).toEqual([10, 120]);
  }
}

// --- the turn ------------------------------------------------------------------------------------

function toolMessages(llm: FakeLlmProvider): string[] {
  return llm.seen.flat().flatMap((m: LlmMessage) => (m.role === "tool" ? [m.content] : []));
}

/**
 * Done means, through the turn service: "list every rule-target point of the
 * PHE site" reaches the provider as the inventory's rows, with the turn's
 * organization as the reply's provenance.
 */
export async function theTurnAnswersASiteQuestionFromTheTool(): Promise<void> {
  const { tools, log } = fake({ site: phe(2, 4) });
  const llm = new FakeLlmProvider([calls(toolCall("get_site_point_inventory", { locationId: SITE })), { kind: "final", text: "Eight points on two gateways." }]);
  const h = harness(llm, { conversationOrg: null, platform: { kind: "ready", allowed: [ORG_X] }, readTools: tools });
  h.service.clock = () => NOW;
  const response = await h.service.turn({ identity: GLOBAL_ADMIN, user: JWT }, CONVERSATION, "List every rule-target point at the PHE site with its 7-day range", "user", [], []);
  expect(log.pairs).toHaveLength(1);
  const seen = toolMessages(llm).join("\n");
  expect(seen).toContain('"key":"battery_charge_pct"');
  expect(seen).toContain('"code":"PHE-AIRSP1050M"');
  const reply = response.messages.find((m) => m.role === "assistant");
  expect([reply?.content, reply?.organizationIds]).toEqual(["Eight points on two gateways.", [ORG_X]]);
}
