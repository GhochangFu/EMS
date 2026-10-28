import { expect } from "vitest";

import type { JwtPayload, PointStatsRow } from "@bms/shared";

import { toolCall } from "../../admin/onboarding/onboarding-agent-loop.spec";
import type { ResolvedIdentity } from "../../auth/identity-resolver";
import type { LocationAssetScope } from "../../auth/location-asset-scope.service";
import { runToolCall } from "../../llm/tool-registry";
import { succeed, TOOL_RESULT_CUT_TAIL } from "../../llm/tool-result";
import { scrubToolResult } from "../copilot-secret-scrub";
import type { CopilotToolContext, CopilotToolResult } from "../copilot-read-tools";
import { COPILOT_TOOL_GUARDS } from "../copilot-turn.service";
import type { CopilotReadServices } from "./copilot-read-tool";
import { createCopilotReadTools } from "./copilot-read-tool-set";
import { copilotRangeTooLong } from "./copilot-time-range";
import { COPILOT_TOOL_RECORD_OUT_OF_SCOPE } from "./copilot-tool-scope";
import { COPILOT_POINT_STATS_CURSOR_NEEDS_LOCATION, COPILOT_POINT_STATS_ONE_SOURCE } from "./get-point-stats.tool";

/**
 * `F4.291` PR 3 (ADR 0099 Amendment 9 E5(c); owner rulings P3, P6) — the
 * `get_point_stats` read over fake services that log their calls. The fake
 * location helper answers what `LocationAssetScopeService` would (its own
 * claims are in `auth/`); `TelemetryService.pointStatsByAsset`'s SQL is in
 * `telemetry/point-stats.integration.spec.ts`. `telemetry.*` has no Row Level
 * Security, so every refusal claim checks the service log stays empty beside
 * a positive call that reaches it. One `it()` per claim in the sibling
 * `.test.ts` (ADR 0014).
 */

const USER = "11111111-1111-4111-8111-111111111111";
const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const ORG_Y = "00000000-0000-4000-8000-0000000000bb";
/** An organization with its own key: never in a platform-scope allowed set. */
const ORG_B = "00000000-0000-4000-8000-0000000000cc";
const SITE = "40000000-0000-4000-8000-000000000001";
const ASSET_X = "30000000-0000-4000-8000-0000000000aa";
const ASSET_X2 = "30000000-0000-4000-8000-0000000000a2";
const ASSET_Y = "30000000-0000-4000-8000-0000000000bb";
const ASSET_B = "30000000-0000-4000-8000-0000000000cc";
/** An asset the service answers for though no call asked it: the tool must drop it. */
const OUTSIDER = "30000000-0000-4000-8000-0000000000ee";
const NOW = new Date("2026-10-28T06:00:00.000Z");
const DAY = 86_400_000;
const FROM = "2026-10-01T00:00:00.000Z";
const TO = "2026-10-08T00:00:00.000Z";

/** 30 sorted asset ids in one site's subtree, so a location read takes two pages. */
const SUBTREE = Array.from({ length: 30 }, (_, i) => `30000000-0000-4000-8000-0000000004${String(i).padStart(2, "0")}`);

function ctx(allowed: readonly string[]): CopilotToolContext {
  return {
    identity: { id: USER, role: "admin", organizationId: null } as ResolvedIdentity,
    user: { sub: USER, role: "admin" } as JwtPayload,
    conversationId: "22222222-2222-4222-8222-222222222222",
    conversationOrganizationId: null,
    allowedOrganizationIds: allowed,
    turnKind: "user",
    now: NOW,
  };
}

/** A worst-case row: every statistic a long float, a sample count of a 31-day minute series. */
function longRow(assetId: string): PointStatsRow & Record<string, unknown> {
  return {
    assetId,
    min: -123_456.78901234567,
    avg: 98_765.432109876543,
    max: 123_456.78901234567,
    last: 99_999.999999999985,
    lastAt: "2026-10-28T05:59:00.000Z",
    sampleCount: 2_678_400,
  };
}

type Call = { assetIds: readonly string[]; pointKey: string; from: Date; to: Date; now?: Date };

type FakeOptions = {
  readonly location?: LocationAssetScope;
  /** The service's rows for one call; the default answers every asked id but the second, plus {@link OUTSIDER}. */
  readonly rows?: (call: Call) => unknown[];
  readonly extra?: Record<string, unknown>;
};

function defaultRows(call: Call): unknown[] {
  return [...call.assetIds.filter((_, i) => i !== 1).map((assetId) => ({ ...longRow(assetId), internalNote: "x" })), longRow(OUTSIDER)];
}

function fake(options: FakeOptions = {}) {
  const readable: Record<string, string[]> = { [ORG_X]: [ASSET_X, ASSET_X2], [ORG_Y]: [ASSET_Y], [ORG_B]: [ASSET_B] };
  const log = { stats: [] as Call[], location: [] as Array<readonly string[]> };
  const services = {
    access: {
      readableAssetIdsInOrganization: async (_user: JwtPayload, organizationId: string) => readable[organizationId] ?? [],
    },
    locationScope: {
      readableAssetIdsInLocations: async (_user: JwtPayload, candidates: readonly string[]) => {
        log.location.push(candidates);
        const answer = options.location ?? { ok: true, organizationId: ORG_X, assetIds: SUBTREE };
        return candidates.includes(ORG_X) ? answer : { ok: false, reason: "not_found" };
      },
    },
    telemetry: {
      pointStatsByAsset: async (call: Call) => {
        log.stats.push(call);
        return {
          pointKey: call.pointKey,
          from: call.from.toISOString(),
          to: call.to.toISOString(),
          bucketSeconds: 3_600,
          rows: (options.rows ?? defaultRows)(call),
          ...options.extra,
        };
      },
    },
  } as unknown as CopilotReadServices;
  return { services, log, tools: createCopilotReadTools(services) };
}

type Entry = { organizationId: string; items: Array<Record<string, unknown>> } & Record<string, unknown>;
type Listed = { organizations: Entry[]; truncated: boolean; nextCursor?: string | null };

function listed(out: CopilotToolResult): Listed {
  if (!out.ok) throw new Error(`F4.291: refused: ${out.error}`);
  return out.result as unknown as Listed;
}

const decoded = (cursor: string | null | undefined) =>
  cursor == null ? null : (JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8")) as { o: string; k?: unknown });

const encoded = (cursor: { o: string; k?: number }) => Buffer.from(JSON.stringify(cursor), "utf-8").toString("base64url");

/** The schema's answer for a call, never dispatched. */
async function schemaRefusal(args: Record<string, unknown>): Promise<string> {
  const { tools } = fake();
  const out = await runToolCall(tools.registry, toolCall("get_point_stats", args), () => Promise.reject(new Error("must not dispatch")), COPILOT_TOOL_GUARDS);
  expect(out.ok).toBe(false);
  return out.content;
}

/** The content the model receives for a result, as the turn service builds it (`succeed(scrubToolResult(result))`). */
function asTheModelSeesIt(out: CopilotToolResult): string {
  if (!out.ok) throw new Error(`F4.291: refused: ${out.error}`);
  return succeed(scrubToolResult(out.result)).content;
}

// --- the assetIds branch ----------------------------------------------------------------------

/** (a) Asset ids across two organizations: one service call each, with that organization's ids only, grouped. */
export async function assetIdsAreReadOncePerOrganization(): Promise<void> {
  const { tools, log } = fake();
  const out = await tools.dispatch("get_point_stats", { pointKey: "kw", assetIds: [ASSET_Y, ASSET_X], from: FROM, to: TO }, ctx([ORG_X, ORG_Y]));
  expect(log.stats.map((call) => call.assetIds)).toEqual([[ASSET_X], [ASSET_Y]]);
  expect(listed(out).organizations.map((entry) => [entry.organizationId, entry.items.map((row) => row.assetId)])).toEqual([
    [ORG_X, [ASSET_X]],
    [ORG_Y, [ASSET_Y]],
  ]);
  expect(out.ok && out.organizationIds).toEqual([ORG_X, ORG_Y]);
}

/** (b) One asset that is not placed in the allowed organizations refuses the whole call before any read. */
export async function anUnplacedAssetRefusesTheWholeCall(): Promise<void> {
  const { tools, log } = fake();
  listed(await tools.dispatch("get_point_stats", { pointKey: "kw", assetIds: [ASSET_X], lastDays: 7 }, ctx([ORG_X, ORG_Y])));
  expect(log.stats).toHaveLength(1);
  const out = await tools.dispatch("get_point_stats", { pointKey: "kw", assetIds: [ASSET_X, ASSET_B], lastDays: 7 }, ctx([ORG_X, ORG_Y]));
  expect(out).toEqual({ ok: false, error: COPILOT_TOOL_RECORD_OUT_OF_SCOPE });
  expect(log.stats).toHaveLength(1);
}

/** (e) An asked asset the service did not answer appears with null stats and `sampleCount: 0`, beside one it answered. */
export async function anAssetWithNoDataHasNullStats(): Promise<void> {
  const { tools } = fake();
  const out = listed(await tools.dispatch("get_point_stats", { pointKey: "kw", assetIds: [ASSET_X, ASSET_X2], lastDays: 7 }, ctx([ORG_X])));
  expect(out.organizations[0]?.items).toEqual([
    longRow(ASSET_X),
    { assetId: ASSET_X2, min: null, avg: null, max: null, last: null, lastAt: null, sampleCount: 0 },
  ]);
}

/** A row the service answers for an asset no call asked is dropped: the items are the asked ids, in order. */
export async function aRowForAnAssetNotAskedIsDropped(): Promise<void> {
  const { tools } = fake();
  const out = listed(await tools.dispatch("get_point_stats", { pointKey: "kw", assetIds: [ASSET_X], lastDays: 7 }, ctx([ORG_X])));
  expect(out.organizations[0]?.items.map((row) => row.assetId)).toEqual([ASSET_X]);
  expect(JSON.stringify(out)).not.toContain(OUTSIDER);
}

/** `lastDays: 7` reaches the service as `[now - 7 d, now)` with the turn's clock as `now` (owner ruling P3). */
export async function lastDaysResolvesOnTheTurnClock(): Promise<void> {
  const { tools, log } = fake();
  listed(await tools.dispatch("get_point_stats", { pointKey: "kw", assetIds: [ASSET_X], lastDays: 7 }, ctx([ORG_X])));
  expect(log.stats).toEqual([{ assetIds: [ASSET_X], pointKey: "kw", from: new Date(NOW.getTime() - 7 * DAY), to: NOW, now: NOW }]);
}

// --- the locationId branch --------------------------------------------------------------------

/** (c) A location's 30 subtree ids: page 1 reads the first 25, `nextCursor` resumes at 25, page 2 reads the last 5 and ends. */
export async function aLocationPagesItsSubtreeByCursor(): Promise<void> {
  const { tools, log } = fake({ rows: (call) => call.assetIds.map(longRow) });
  const first = listed(await tools.dispatch("get_point_stats", { pointKey: "kw", locationId: SITE, lastDays: 7 }, ctx([ORG_X, ORG_Y])));
  expect(log.location).toEqual([[ORG_X, ORG_Y]]);
  expect(log.stats.map((call) => call.assetIds)).toEqual([SUBTREE.slice(0, 25)]);
  expect(first.truncated).toBe(true);
  expect(decoded(first.nextCursor)).toEqual({ o: ORG_X, k: 25 });
  const second = listed(
    await tools.dispatch("get_point_stats", { pointKey: "kw", locationId: SITE, lastDays: 7, cursor: first.nextCursor }, ctx([ORG_X, ORG_Y])),
  );
  expect(log.stats.map((call) => call.assetIds)).toEqual([SUBTREE.slice(0, 25), SUBTREE.slice(25)]);
  expect(second.organizations[0]?.items.map((row) => row.assetId)).toEqual(SUBTREE.slice(25));
  expect([second.truncated, second.nextCursor]).toEqual([false, null]);
}

/** (g) The service is never called with `[]`: not for an empty subtree, not for a cursor past the subtree's end. */
export async function theServiceIsNeverCalledWithNoIds(): Promise<void> {
  const empty = fake({ location: { ok: true, organizationId: ORG_X, assetIds: [] } });
  const out = listed(await empty.tools.dispatch("get_point_stats", { pointKey: "kw", locationId: SITE, lastDays: 7 }, ctx([ORG_X])));
  expect(out.organizations).toEqual([{ organizationId: ORG_X, items: [] }]);
  expect(empty.log.stats).toEqual([]);

  const past = fake();
  listed(await past.tools.dispatch("get_point_stats", { pointKey: "kw", locationId: SITE, lastDays: 7 }, ctx([ORG_X])));
  expect(past.log.stats).toHaveLength(1);
  const beyond = listed(
    await past.tools.dispatch("get_point_stats", { pointKey: "kw", locationId: SITE, lastDays: 7, cursor: encoded({ o: ORG_X, k: 40 }) }, ctx([ORG_X])),
  );
  expect(beyond.organizations[0]?.items).toEqual([]);
  expect(past.log.stats).toHaveLength(1);
}

// --- the schema -------------------------------------------------------------------------------

/** (d) `locationId` with `assetIds` is refused by the schema before dispatch. */
export async function locationIdWithAssetIdsIsRefused(): Promise<void> {
  expect(await schemaRefusal({ pointKey: "kw", locationId: SITE, assetIds: [ASSET_X], lastDays: 7 })).toContain(COPILOT_POINT_STATS_ONE_SOURCE);
}

/** (d) Neither `locationId` nor `assetIds` is refused by the schema before dispatch. */
export async function neitherLocationIdNorAssetIdsIsRefused(): Promise<void> {
  expect(await schemaRefusal({ pointKey: "kw", lastDays: 7 })).toContain(COPILOT_POINT_STATS_ONE_SOURCE);
}

/**
 * A `cursor` with `assetIds` is refused by the schema before dispatch: that
 * branch is one page and never reads the cursor, so without the refusal the
 * same page would come back as if it were the next one.
 */
export async function aCursorWithAssetIdsIsRefused(): Promise<void> {
  expect(await schemaRefusal({ pointKey: "kw", assetIds: [ASSET_X], lastDays: 7, cursor: encoded({ o: ORG_X, k: 0 }) })).toContain(
    COPILOT_POINT_STATS_CURSOR_NEEDS_LOCATION,
  );
}

/** A 32-day range is refused by the schema; 31 days is accepted. */
export async function aRangeOver31DaysIsRefused(): Promise<void> {
  const { tools } = fake();
  const from = Date.parse("2026-09-01T00:00:00Z");
  const args = (days: number) => ({ pointKey: "kw", assetIds: [ASSET_X], from: new Date(from).toISOString(), to: new Date(from + days * DAY).toISOString() });
  const ok = await runToolCall(tools.registry, toolCall("get_point_stats", args(31)), async () => ({ ok: true, content: "{}" }), COPILOT_TOOL_GUARDS);
  expect(ok.ok).toBe(true);
  expect(await schemaRefusal(args(32))).toContain(copilotRangeTooLong(31));
}

/** A 26th asset id is refused by the schema. */
export async function a26thAssetIdIsRefused(): Promise<void> {
  const ids = Array.from({ length: 26 }, (_, i) => `30000000-0000-4000-8000-0000000005${String(i).padStart(2, "0")}`);
  expect(await schemaRefusal({ pointKey: "kw", assetIds: ids, lastDays: 7 })).toContain("assetIds");
}

// --- the contract and the result's size -------------------------------------------------------

/** (f) The answer is parsed through `pointStatsByAssetSchema`: an extra key is stripped. */
export async function anExtraKeyIsStripped(): Promise<void> {
  const { tools } = fake({ extra: { internalNote: "must not reach the model" } });
  const text = JSON.stringify(listed(await tools.dispatch("get_point_stats", { pointKey: "kw", assetIds: [ASSET_X], lastDays: 7 }, ctx([ORG_X]))));
  expect(text).toContain('"bucketSeconds":3600');
  expect(text).not.toContain("internalNote");
}

/** (f) A bad row (a negative sample count) fails the call with the stored-contract error, not a reply. */
export async function aBadAnswerThrows(): Promise<void> {
  const { tools } = fake({ rows: (call) => call.assetIds.map((assetId) => ({ ...longRow(assetId), sampleCount: -1 })) });
  await expect(tools.dispatch("get_point_stats", { pointKey: "kw", assetIds: [ASSET_X], lastDays: 7 }, ctx([ORG_X]))).rejects.toThrow(/get_point_stats/);
}

/**
 * 25 asked assets, every statistic a long float: the content the model
 * receives is whole JSON (no cut tail), holds all 25 rows and is not
 * `truncated` — for the `assetIds` branch and a location's page.
 */
export async function twentyFiveWorstCaseAssetIdsReachTheModelWhole(): Promise<void> {
  const ids = SUBTREE.slice(0, 25);
  const { services, tools } = fake({ rows: (call) => call.assetIds.map(longRow) });
  // ORG_X reads the 25 ids, so every one is placed there.
  (services.access as { readableAssetIdsInOrganization: unknown }).readableAssetIdsInOrganization = async () => ids;
  const content = asTheModelSeesIt(await tools.dispatch("get_point_stats", { pointKey: "kw", assetIds: ids, lastDays: 31 }, ctx([ORG_X])));
  expect(content.endsWith(TOOL_RESULT_CUT_TAIL)).toBe(false);
  const parsed = JSON.parse(content) as Listed;
  expect(parsed.truncated).toBe(false);
  expect(parsed.organizations[0]?.items).toHaveLength(25);
}

/** The location branch's 25-asset page of worst-case rows reaches the model whole, with its cursor. */
export async function aWorstCaseLocationPageReachesTheModelWhole(): Promise<void> {
  const { tools } = fake({ rows: (call) => call.assetIds.map(longRow) });
  const content = asTheModelSeesIt(await tools.dispatch("get_point_stats", { pointKey: "kw", locationId: SITE, lastDays: 31 }, ctx([ORG_X])));
  expect(content.endsWith(TOOL_RESULT_CUT_TAIL)).toBe(false);
  const parsed = JSON.parse(content) as Listed;
  expect(parsed.organizations[0]?.items).toHaveLength(25);
  expect(decoded(parsed.nextCursor)).toEqual({ o: ORG_X, k: 25 });
}
