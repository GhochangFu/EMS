import { expect } from "vitest";

import type { AlarmStats, JwtPayload } from "@bms/shared";

import { toolCall } from "../../admin/onboarding/onboarding-agent-loop.spec";
import type { ResolvedIdentity } from "../../auth/identity-resolver";
import type { LocationAssetScope } from "../../auth/location-asset-scope.service";
import { runToolCall } from "../../llm/tool-registry";
import { TOOL_RESULT_MAX_CHARS } from "../../llm/tool-result";
import type { CopilotToolContext, CopilotToolResult } from "../copilot-read-tools";
import { COPILOT_TOOL_GUARDS } from "../copilot-turn.service";
import type { CopilotReadServices } from "./copilot-read-tool";
import { createCopilotReadTools } from "./copilot-read-tool-set";
import { COPILOT_RANGE_BOTH, COPILOT_RANGE_ORDER, COPILOT_RANGE_OUT_OF_CLOCK, copilotRangeTooLong } from "./copilot-time-range";

/**
 * `F4.291` PR 2 (ADR 0099 Amendment 9 E5(b); owner ruling P3) —
 * `list_alarms`' severity and raised range, and the `get_alarm_stats` read,
 * over fake services that log their calls. The fake location helper answers
 * what `LocationAssetScopeService` would (its own claims are in `auth/`);
 * `AlarmStatsService`'s SQL is in `alarms/alarm-stats.integration.spec.ts`.
 * Each refusal claim checks the data log beside a positive call that reaches
 * it. One `it()` per claim in the sibling `.test.ts` (ADR 0014).
 */

const USER = "11111111-1111-4111-8111-111111111111";
const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const ORG_Y = "00000000-0000-4000-8000-0000000000bb";
/** An allowed organization in which the caller reads no asset. */
const ORG_EMPTY = "00000000-0000-4000-8000-0000000000dd";
const SITE = "40000000-0000-4000-8000-000000000001";
const ASSET_X = "30000000-0000-4000-8000-0000000000aa";
const ASSET_X2 = "30000000-0000-4000-8000-0000000000a2";
const ASSET_Y = "30000000-0000-4000-8000-0000000000bb";
const NOW = new Date("2026-10-28T06:00:00.000Z");
const DAY = 86_400_000;
const FROM = "2026-10-01T00:00:00.000Z";
const TO = "2026-10-08T00:00:00.000Z";

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

/** A realistic answer: `locations` rows with long names, ten long-named top assets. */
function statsAnswer(from: Date, to: Date, locations = 2): AlarmStats & Record<string, unknown> {
  const n = (i: number) => String(i).padStart(2, "0");
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    raised: 1_234,
    open: 56,
    bySeverity: [
      { severity: "critical", raised: 234, open: 12 },
      { severity: "warning", raised: 1_000, open: 44 },
    ],
    byLocation: Array.from({ length: locations }, (_, i) => ({
      locationId: `40000000-0000-4000-8000-0000000003${n(i)}`,
      locationName: `Pune Effluent Treatment Plant Block ${n(i)} North Wing`,
      raised: 1_000 - i,
      open: 40,
    })),
    moreLocations: locations > 25,
    topAssets: Array.from({ length: 10 }, (_, i) => ({
      assetId: `30000000-0000-4000-8000-0000000003${n(i)}`,
      assetCode: `PHE-ETP-BLK${n(i)}-AHU-${n(i)}`,
      assetName: `Air Handling Unit ${n(i)} Clarifier Building East`,
      raised: 500 - i,
    })),
    mttaSeconds: 600,
    mttrSeconds: 1_800,
    acknowledgedCount: 300,
    clearedCount: 1_178,
    /** A key the contract does not name: the tool's parse strips it. */
    internalNote: "must not reach the model",
  };
}

type FakeOptions = {
  readonly readable?: Record<string, string[]>;
  readonly location?: LocationAssetScope;
  readonly stats?: (from: Date, to: Date) => unknown;
};

function fake(options: FakeOptions = {}) {
  const readable = options.readable ?? { [ORG_X]: [ASSET_X, ASSET_X2], [ORG_Y]: [ASSET_Y] };
  const log = {
    alarms: [] as Array<Record<string, unknown>>,
    stats: [] as Array<{ assetIds: string[]; from: Date; to: Date }>,
    location: [] as Array<readonly string[]>,
  };
  const services = {
    access: {
      readableAssetIdsInOrganization: async (_user: JwtPayload, organizationId: string) => readable[organizationId] ?? [],
    },
    locationScope: {
      readableAssetIdsInLocations: async (_user: JwtPayload, candidates: readonly string[], _ids: readonly string[]) => {
        log.location.push(candidates);
        const answer = options.location ?? { ok: true, organizationId: ORG_X, assetIds: [ASSET_X2] };
        return candidates.includes(ORG_X) ? answer : { ok: false, reason: "not_found" };
      },
    },
    alarms: {
      list: async (opts: Record<string, unknown>) => {
        log.alarms.push(opts);
        return { items: [], nextCursor: null };
      },
    },
    alarmStats: {
      range: async (assetIds: string[], from: Date, to: Date) => {
        log.stats.push({ assetIds, from, to });
        return (options.stats ?? ((f: Date, t: Date) => statsAnswer(f, t)))(from, to);
      },
    },
  } as unknown as CopilotReadServices;
  return { services, log, tools: createCopilotReadTools(services) };
}

type Entry = { organizationId: string; items: unknown[] } & Record<string, unknown>;
type Listed = { organizations: Entry[]; truncated: boolean; nextCursor?: string | null };

function listed(out: CopilotToolResult): Listed {
  if (!out.ok) throw new Error(`F4.291: refused: ${out.error}`);
  return out.result as unknown as Listed;
}

const decoded = (cursor: string | null | undefined) =>
  cursor == null ? null : (JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8")) as { o: string; k?: unknown });

/** The schema's answer for a call, never dispatched. */
async function schemaRefusal(name: string, args: Record<string, unknown>): Promise<string> {
  const { tools } = fake();
  const out = await runToolCall(tools.registry, toolCall(name, args), () => Promise.reject(new Error("must not dispatch")), COPILOT_TOOL_GUARDS);
  expect(out.ok).toBe(false);
  return out.content;
}

// --- list_alarms ------------------------------------------------------------------------------

/** (a) `severity`, `from` and `to` reach `alarms.list` as `severity`, `raisedFrom`, `raisedTo`; no filter passes none. */
export async function listAlarmsPassesTheSeverityAndRange(): Promise<void> {
  const { tools, log } = fake();
  listed(await tools.dispatch("list_alarms", { state: "all" }, ctx([ORG_X])));
  expect(log.alarms[0]).not.toHaveProperty("severity");
  expect(log.alarms[0]).not.toHaveProperty("raisedFrom");
  expect(log.alarms[0]).not.toHaveProperty("raisedTo");
  listed(await tools.dispatch("list_alarms", { state: "all", severity: "critical", from: FROM, to: TO }, ctx([ORG_X])));
  expect(log.alarms[1]).toMatchObject({ severity: "critical", raisedFrom: new Date(FROM), raisedTo: new Date(TO), assetIds: [ASSET_X, ASSET_X2] });
}

/** (a) `lastDays: 7` reaches the service as `[now - 7 d, now)` on the turn's clock. */
export async function listAlarmsResolvesLastDaysOnTheTurnClock(): Promise<void> {
  const { tools, log } = fake();
  listed(await tools.dispatch("list_alarms", { state: "active", lastDays: 7 }, ctx([ORG_X])));
  expect(log.alarms[0]).toMatchObject({ raisedFrom: new Date(NOW.getTime() - 7 * DAY), raisedTo: NOW });
}

/** (b) `to` before `from` is refused by the schema, before any dispatch. */
export async function listAlarmsRefusesToBeforeFrom(): Promise<void> {
  expect(await schemaRefusal("list_alarms", { from: TO, to: FROM })).toContain(COPILOT_RANGE_ORDER);
}

/** (b) `lastDays` with `from` is refused by the schema (owner ruling P3). */
export async function listAlarmsRefusesLastDaysWithFrom(): Promise<void> {
  expect(await schemaRefusal("list_alarms", { lastDays: 7, from: FROM })).toContain(COPILOT_RANGE_BOTH);
}

/** An instant more than a day past the turn's clock is refused before any read, beside one that reads. */
export async function listAlarmsRefusesARangeOffTheClock(): Promise<void> {
  const { tools, log } = fake();
  listed(await tools.dispatch("list_alarms", { state: "all", from: FROM }, ctx([ORG_X])));
  expect(log.alarms).toHaveLength(1);
  const out = await tools.dispatch("list_alarms", { state: "all", from: "2027-01-01T00:00:00Z" }, ctx([ORG_X]));
  expect(out).toEqual({ ok: false, error: COPILOT_RANGE_OUT_OF_CLOCK });
  expect(log.alarms).toHaveLength(1);
}

// --- get_alarm_stats --------------------------------------------------------------------------

/** (c) One `range` per organization with that organization's readable ids; an organization with none is not read. */
export async function alarmStatsReadsEachOrganizationsReadableIds(): Promise<void> {
  const { tools, log } = fake({ readable: { [ORG_EMPTY]: [], [ORG_X]: [ASSET_X, ASSET_X2] } });
  const out = listed(await tools.dispatch("get_alarm_stats", { from: FROM, to: TO }, ctx([ORG_EMPTY, ORG_X])));
  expect(log.stats).toEqual([{ assetIds: [ASSET_X, ASSET_X2], from: new Date(FROM), to: new Date(TO) }]);
  expect(out.organizations.map((entry) => [entry.organizationId, entry.raised])).toEqual([
    [ORG_EMPTY, undefined],
    [ORG_X, 1_234],
  ]);
}

/** (d) With `locationId`, `range` receives the subtree's readable ids only. */
export async function alarmStatsReadsTheSubtreeOfALocation(): Promise<void> {
  const { tools, log } = fake();
  listed(await tools.dispatch("get_alarm_stats", { locationId: SITE, lastDays: 7 }, ctx([ORG_X, ORG_Y])));
  expect(log.location).toEqual([[ORG_X, ORG_Y]]);
  expect(log.stats.map((call) => call.assetIds)).toEqual([[ASSET_X2]]);
}

/** `lastDays: 7` reaches `range` as `[now - 7 d, now)` on the turn's clock (owner ruling P3). */
export async function alarmStatsResolvesLastDaysOnTheTurnClock(): Promise<void> {
  const { tools, log } = fake();
  listed(await tools.dispatch("get_alarm_stats", { lastDays: 7 }, ctx([ORG_X])));
  expect(log.stats.map((call) => [call.from, call.to])).toEqual([[new Date(NOW.getTime() - 7 * DAY), NOW]]);
}

/** (e) A 32-day range is refused by the schema before any read; 31 days is accepted. */
export async function alarmStatsRefusesARangeOver31Days(): Promise<void> {
  const { tools } = fake();
  const from = Date.parse("2026-09-01T00:00:00Z");
  const ok = await runToolCall(
    tools.registry,
    toolCall("get_alarm_stats", { from: new Date(from).toISOString(), to: new Date(from + 31 * DAY).toISOString() }),
    async () => ({ ok: true, content: "{}" }),
    COPILOT_TOOL_GUARDS,
  );
  expect(ok.ok).toBe(true);
  expect(
    await schemaRefusal("get_alarm_stats", { from: new Date(from).toISOString(), to: new Date(from + 32 * DAY).toISOString() }),
  ).toContain(copilotRangeTooLong(31));
}

/** A range is required: no `lastDays` and no `from`/`to` is refused by the schema. */
export async function alarmStatsRequiresARange(): Promise<void> {
  expect(await schemaRefusal("get_alarm_stats", {})).toContain("lastDays");
}

/** (f) Two organizations: the first is read, `nextCursor` names the second, and the cursor reads only the second. */
export async function alarmStatsReadsOneOrganizationPerCall(): Promise<void> {
  const { tools, log } = fake();
  const first = listed(await tools.dispatch("get_alarm_stats", { lastDays: 7 }, ctx([ORG_X, ORG_Y])));
  expect(log.stats.map((call) => call.assetIds)).toEqual([[ASSET_X, ASSET_X2]]);
  expect(first.organizations.map((entry) => entry.organizationId)).toEqual([ORG_X]);
  expect(first.truncated).toBe(true);
  expect(decoded(first.nextCursor)).toEqual({ o: ORG_Y });
  const second = listed(await tools.dispatch("get_alarm_stats", { lastDays: 7, cursor: first.nextCursor }, ctx([ORG_X, ORG_Y])));
  expect(log.stats.map((call) => call.assetIds)).toEqual([[ASSET_X, ASSET_X2], [ASSET_Y]]);
  expect(second.organizations.map((entry) => entry.organizationId)).toEqual([ORG_Y]);
  expect([second.truncated, second.nextCursor]).toEqual([false, null]);
}

/** (g) The answer is parsed through `alarmStatsSchema`: an extra key is stripped. */
export async function alarmStatsStripsAKeyTheContractDoesNotName(): Promise<void> {
  const { tools } = fake();
  const entry = listed(await tools.dispatch("get_alarm_stats", { lastDays: 7 }, ctx([ORG_X]))).organizations[0]!;
  expect(entry.mttaSeconds).toBe(600);
  expect(entry).not.toHaveProperty("internalNote");
}

/** (g) A bad row (a negative count) fails the call with the stored-contract error, not a reply. */
export async function alarmStatsThrowsOnABadAnswer(): Promise<void> {
  const { tools } = fake({ stats: (from, to) => ({ ...statsAnswer(from, to), raised: -1 }) });
  await expect(tools.dispatch("get_alarm_stats", { lastDays: 7 }, ctx([ORG_X]))).rejects.toThrow(/get_alarm_stats/);
}

/** (h) One organization with 25 locations and 10 assets of realistic names fits one tool result. */
export async function alarmStatsOneOrganizationFitsOneResult(): Promise<void> {
  const { tools } = fake({ stats: (from, to) => statsAnswer(from, to, 25) });
  const out = listed(await tools.dispatch("get_alarm_stats", { lastDays: 31 }, ctx([ORG_X])));
  expect((out.organizations[0]?.byLocation as unknown[]).length).toBe(25);
  expect(JSON.stringify(out).length).toBeLessThan(TOOL_RESULT_MAX_CHARS);
}
