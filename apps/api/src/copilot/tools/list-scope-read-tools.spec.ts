import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { toolCall } from "../../admin/onboarding/onboarding-agent-loop.spec";
import type { ResolvedIdentity } from "../../auth/identity-resolver";
import type { LocationAssetScope } from "../../auth/location-asset-scope.service";
import { runToolCall } from "../../llm/tool-registry";
import type { CopilotToolContext, CopilotToolResult } from "../copilot-read-tools";
import { COPILOT_TOOL_GUARDS } from "../copilot-turn.service";
import { COPILOT_TOOL_BAD_CURSOR, encodeListCursor, offsetKeySchema, offsetPage } from "./copilot-list-paging";
import { type CopilotReadServices, readPerOrganization } from "./copilot-read-tool";
import { createCopilotReadTools } from "./copilot-read-tool-set";
import { COPILOT_TOOL_LOCATION_OUT_OF_SCOPE, COPILOT_TOOL_LOCATION_OUTSIDE_GRANT } from "./copilot-tool-scope";
import { COPILOT_ALARMS_ASSET_OR_LOCATION } from "./list-alarms.tool";

/**
 * `F4.291` (ADR 0099 Amendment 9 E5) — `readPerOrganization`'s location and
 * cursor, and the lists on it: `list_assets`, `list_alarms`, and
 * `list_locations`' search and cursor (owner ruling P6). Fake services log
 * their calls; the fake location helper answers what
 * `LocationAssetScopeService` would (its own claims are in `auth/`). One
 * `it()` per claim in the sibling `.test.ts` (ADR 0014).
 */

const USER = "11111111-1111-4111-8111-111111111111";
const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const ORG_Y = "00000000-0000-4000-8000-0000000000bb";
const SITE = "40000000-0000-4000-8000-000000000001";
const ASSET_X = "30000000-0000-4000-8000-0000000000aa";
const ASSET_X2 = "30000000-0000-4000-8000-0000000000a2";
const ASSET_Y = "30000000-0000-4000-8000-0000000000bb";
const NOW = new Date("2026-10-28T06:00:00Z");

const assetId = (i: number) => `30000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`;

function ctx(allowed: readonly string[], role: ResolvedIdentity["role"] = "admin"): CopilotToolContext {
  return {
    identity: { id: USER, role, organizationId: null } as ResolvedIdentity,
    user: { sub: USER, role } as JwtPayload,
    conversationId: "22222222-2222-4222-8222-222222222222",
    conversationOrganizationId: null,
    allowedOrganizationIds: allowed,
    turnKind: "user",
    now: NOW,
  };
}

/** The location helper answers `SITE` in `ORG_X` with `[ASSET_X2]`, or `not_found` when `ORG_X` is not a candidate. */
function locationAnswer(candidates: readonly string[], answer: LocationAssetScope): LocationAssetScope {
  return candidates.includes(ORG_X) ? answer : { ok: false, reason: "not_found" };
}

type FakeOptions = {
  readable?: Record<string, string[]>;
  location?: LocationAssetScope;
  /** Alarms per organization; the fake pages them by `limit` with a keyset cursor of its own. */
  alarmCount?: number;
  locationRows?: number;
};

function alarmRow(i: number, asset: string) {
  return {
    id: `50000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`,
    assetId: asset,
    ruleKey: null,
    ruleId: null,
    severity: "high",
    message: `Alarm ${i}`,
    raisedAt: new Date(Date.parse("2026-10-28T05:00:00Z") - i * 60_000).toISOString(),
    acknowledgedAt: null,
    acknowledgedBy: null,
    clearedAt: null,
    assetCode: "AHU-7",
    assetName: "AHU 7",
    siteName: "Site",
  };
}

/** The keyset cursor `AlarmsService` encodes (`{ t, id }`, base64url). */
const alarmKeyset = (row: { raisedAt: string; id: string }) =>
  Buffer.from(JSON.stringify({ t: row.raisedAt, id: row.id }), "utf-8").toString("base64url");

function locationRow(i: number, organizationId: string) {
  const n = String(i).padStart(2, "0");
  return {
    id: `40000000-0000-4000-8000-0000000002${n}`,
    organizationId,
    organizationCode: "ORG",
    organizationName: "Org",
    code: `SITE-${n}`,
    slug: `site-${n}`,
    name: `Site ${n}`,
    type: "smoc_campus",
    typeLabel: "Campus",
    parentId: null,
    province: null,
    capital: null,
    timezone: null,
    latitude: 0,
    longitude: 0,
    active: true,
    meta: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function fake(options: FakeOptions = {}) {
  const readable = options.readable ?? { [ORG_X]: [ASSET_X, ASSET_X2], [ORG_Y]: [ASSET_Y] };
  const log = {
    access: [] as string[],
    location: [] as Array<{ candidates: readonly string[]; locationIds: readonly string[] }>,
    assets: [] as Array<{ assetIds: unknown; organizationId: unknown }>,
    alarms: [] as Array<Record<string, unknown>>,
    locations: [] as string[],
  };
  const alarms = Array.from({ length: options.alarmCount ?? 1 }, (_, i) => alarmRow(i, ASSET_X));
  const services = {
    access: {
      readableAssetIdsInOrganization: async (_user: JwtPayload, organizationId: string) => {
        log.access.push(organizationId);
        return readable[organizationId] ?? [];
      },
    },
    locationScope: {
      readableAssetIdsInLocations: async (_user: JwtPayload, candidates: readonly string[], locationIds: readonly string[]) => {
        log.location.push({ candidates, locationIds });
        return locationAnswer(candidates, options.location ?? { ok: true, organizationId: ORG_X, assetIds: [ASSET_X2] });
      },
    },
    assets: {
      listAll: async (assetIds: string[], organizationId: string) => {
        log.assets.push({ assetIds, organizationId });
        return assetIds.map((id, i) => ({
          id,
          code: `C-${String(i).padStart(2, "0")}`,
          name: `Pump ${i}`,
          siteName: "Site",
          domain: "electrical",
          locationId: SITE,
          locationName: "Plant",
          rtuId: null,
          rtuDisplayName: null,
          telemetrySource: null,
          active: true,
          templateId: null,
        }));
      },
    },
    alarms: {
      list: async (opts: { limit: number; cursor?: string }) => {
        log.alarms.push(opts);
        const start = opts.cursor === undefined ? 0 : alarms.findIndex((row) => alarmKeyset(row) === opts.cursor) + 1;
        const page = alarms.slice(start, start + opts.limit);
        const last = page[page.length - 1];
        const more = start + opts.limit < alarms.length;
        return { items: page, nextCursor: more && last ? alarmKeyset(last) : null };
      },
    },
    locations: {
      list: async (_jwt: JwtPayload, organizationId: string) => {
        log.locations.push(organizationId);
        return { items: Array.from({ length: options.locationRows ?? 1 }, (_, i) => locationRow(i, organizationId)) };
      },
    },
    portfolio: {
      energyTopConsumers: async (_window: string, limit: number, ids: string[]) => ({
        consumers: Array.from({ length: limit }, (_, i) => ({
          assetId: ids[0],
          code: `C${i}`,
          name: `Meter ${i}`,
          siteName: "Site",
          avgKw: 10,
          estimatedKwh: 100,
        })),
      }),
    },
  } as unknown as CopilotReadServices;
  return { services, log, tools: createCopilotReadTools(services) };
}

type Entry = { organizationId: string; items: unknown[] };
type Listed = { organizations: Entry[]; truncated: boolean; nextCursor?: string | null };

function listed(out: CopilotToolResult): Listed {
  if (!out.ok) throw new Error(`F4.291: refused: ${out.error}`);
  return out.result as unknown as Listed;
}

const decoded = (cursor: string | null | undefined) =>
  cursor == null ? null : (JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8")) as { o: string; k?: unknown });

const offsets = { cursor: undefined, key: offsetKeySchema };

/** A numbered list per organization, paged by offset. */
function numbered(counts: Record<string, number>) {
  const reads: Array<{ organizationId: string; resume: number | undefined }> = [];
  const read = async (organizationId: string, _ids: readonly string[], room: number, resume: number | undefined) => {
    reads.push({ organizationId, resume });
    const rows = Array.from({ length: counts[organizationId] ?? 0 }, (_, i) => `${organizationId.slice(-2)}-${i + 1}`);
    return offsetPage(rows, resume, room);
  };
  return { reads, read };
}

// --- readPerOrganization: the location ---------------------------------------------

/** (a) With a location, only its organization is read, with exactly the helper's ids; the organization's own ids are never asked. */
export async function aLocationReadsItsOrganizationWithTheSubtreeIds(): Promise<void> {
  const { services, log } = fake();
  const reads: Array<{ organizationId: string; assetIds: readonly string[] }> = [];
  const out = await readPerOrganization(services, ctx([ORG_X, ORG_Y]), { locationId: SITE }, async (organizationId, assetIds) => {
    reads.push({ organizationId, assetIds });
    return { items: ["a"] };
  });
  expect(reads).toEqual([{ organizationId: ORG_X, assetIds: [ASSET_X2] }]);
  expect(log.access).toEqual([]);
  expect(log.location).toEqual([{ candidates: [ORG_X, ORG_Y], locationIds: [SITE] }]);
  expect(out.ok && out.organizationIds).toEqual([ORG_X]);
}

/** (b) A location the helper does not find is refused, and no read runs. */
export async function aLocationNotFoundIsRefusedBeforeAnyRead(): Promise<void> {
  const { services } = fake({ location: { ok: false, reason: "not_found" } });
  const reads: string[] = [];
  const out = await readPerOrganization(services, ctx([ORG_X]), { locationId: SITE }, async (id) => {
    reads.push(id);
    return { items: [] };
  });
  expect(out).toEqual({ ok: false, error: COPILOT_TOOL_LOCATION_OUT_OF_SCOPE });
  expect(reads).toEqual([]);
}

/** (b2) A location outside the caller's grant is refused with its own sentence, and no read runs. */
export async function aLocationOutsideTheGrantIsRefused(): Promise<void> {
  const { services } = fake({ location: { ok: false, reason: "outside_grant" } });
  const reads: string[] = [];
  const out = await readPerOrganization(services, ctx([ORG_X]), { locationId: SITE }, async (id) => {
    reads.push(id);
    return { items: [] };
  });
  expect(out).toEqual({ ok: false, error: COPILOT_TOOL_LOCATION_OUTSIDE_GRANT });
  expect(reads).toEqual([]);
}

/** (c) A named organization is the helper's only candidate, so a location of another organization is refused. */
export async function aNamedOrganizationBoundsTheLocation(): Promise<void> {
  const { services, log } = fake();
  const out = await readPerOrganization(services, ctx([ORG_X, ORG_Y]), { organizationId: ORG_Y, locationId: SITE }, async () => ({ items: [] }));
  expect(log.location.map((call) => call.candidates)).toEqual([[ORG_Y]]);
  expect(out).toEqual({ ok: false, error: COPILOT_TOOL_LOCATION_OUT_OF_SCOPE });
}

/** (d) An empty subtree lists the organization empty and calls no service. */
export async function anEmptySubtreeIsListedEmptyAndUnread(): Promise<void> {
  const { services } = fake({ location: { ok: true, organizationId: ORG_X, assetIds: [] } });
  const reads: string[] = [];
  const out = await readPerOrganization(services, ctx([ORG_X]), { locationId: SITE }, async (id) => {
    reads.push(id);
    return { items: ["a"] };
  });
  expect(reads).toEqual([]);
  expect(listed(out).organizations).toEqual([{ organizationId: ORG_X, items: [] }]);
}

// --- readPerOrganization: the cursor -----------------------------------------------

/** (e) 40 rows in X and 10 in Y: page 1 is X 1–25 with `{o: X, k: 25}`; page 2 is X 26–40 and all of Y, then `null`. */
export async function aCursorResumesWhereThePageStopped(): Promise<void> {
  const { services } = fake();
  const list = numbered({ [ORG_X]: 40, [ORG_Y]: 10 });
  const one = listed(await readPerOrganization(services, ctx([ORG_X, ORG_Y]), { paging: offsets }, list.read));
  expect(one.organizations.map((o) => [o.organizationId, o.items.length])).toEqual([[ORG_X, 25]]);
  expect(one.truncated).toBe(true);
  expect(decoded(one.nextCursor)).toEqual({ o: ORG_X, k: 25 });
  const two = listed(
    await readPerOrganization(services, ctx([ORG_X, ORG_Y]), { paging: { ...offsets, cursor: one.nextCursor ?? undefined } }, list.read),
  );
  expect(two.organizations.map((o) => [o.organizationId, o.items[0], o.items.length])).toEqual([
    [ORG_X, "aa-26", 15],
    [ORG_Y, "bb-1", 10],
  ]);
  expect(two.nextCursor).toBeNull();
}

/** (e2) X fills the room exactly: the cursor names Y with no key, and page 2 reads Y from its first row. */
export async function aFullRoomBetweenOrganizationsNamesTheNext(): Promise<void> {
  const { services } = fake();
  const list = numbered({ [ORG_X]: 25, [ORG_Y]: 3 });
  const one = listed(await readPerOrganization(services, ctx([ORG_X, ORG_Y]), { paging: offsets }, list.read));
  expect(decoded(one.nextCursor)).toEqual({ o: ORG_Y });
  list.reads.length = 0;
  const two = listed(
    await readPerOrganization(services, ctx([ORG_X, ORG_Y]), { paging: { ...offsets, cursor: one.nextCursor ?? undefined } }, list.read),
  );
  expect(list.reads).toEqual([{ organizationId: ORG_Y, resume: undefined }]);
  expect(two.organizations.map((o) => o.items.length)).toEqual([3]);
}

/** (h) A paged loop stops at the first organization that is cut, even with room left: Y is reached by the cursor only. */
export async function aPagedLoopStopsAtTheFirstCutOrganization(): Promise<void> {
  const { services } = fake();
  const reads: string[] = [];
  const out = listed(
    await readPerOrganization(services, ctx([ORG_X, ORG_Y]), { paging: offsets }, async (id) => {
      reads.push(id);
      return { items: [1, 2, 3, 4, 5], more: true, nextKey: 5 };
    }),
  );
  expect(reads).toEqual([ORG_X]);
  expect(decoded(out.nextCursor)).toEqual({ o: ORG_X, k: 5 });
}

/** (f) A cursor that does not decode is refused before any read. */
export async function aCursorThatDoesNotDecodeIsRefused(): Promise<void> {
  const { services } = fake();
  const list = numbered({ [ORG_X]: 3 });
  const out = await readPerOrganization(services, ctx([ORG_X]), { paging: { ...offsets, cursor: "not a cursor" } }, list.read);
  expect(out).toEqual({ ok: false, error: COPILOT_TOOL_BAD_CURSOR });
  expect(list.reads).toEqual([]);
}

/** (f2) An offset tool refuses a string key (`"10"` would slice as `"1025"`); the numeric key beside it is read. */
export async function anOffsetToolRefusesAStringKey(): Promise<void> {
  const { services } = fake();
  const list = numbered({ [ORG_X]: 30 });
  const bad = encodeListCursor({ o: ORG_X, k: "10" });
  expect(await readPerOrganization(services, ctx([ORG_X]), { paging: { ...offsets, cursor: bad } }, list.read)).toEqual({
    ok: false,
    error: COPILOT_TOOL_BAD_CURSOR,
  });
  const good = encodeListCursor({ o: ORG_X, k: 10 });
  const out = listed(await readPerOrganization(services, ctx([ORG_X]), { paging: { ...offsets, cursor: good } }, list.read));
  expect(out.organizations[0]?.items[0]).toBe("aa-11");
}

/** (f3) A cursor naming an organization the call does not read is refused, not answered with an empty page. */
export async function aCursorOfAnotherOrganizationIsRefused(): Promise<void> {
  const { services } = fake();
  const list = numbered({ [ORG_X]: 3, [ORG_Y]: 3 });
  const cursor = encodeListCursor({ o: ORG_Y, k: 0 });
  const out = await readPerOrganization(services, ctx([ORG_X, ORG_Y]), { organizationId: ORG_X, paging: { ...offsets, cursor } }, list.read);
  expect(out).toEqual({ ok: false, error: COPILOT_TOOL_BAD_CURSOR });
  expect(list.reads).toEqual([]);
}

/** (g) A tool without paging returns no `nextCursor` even when cut; a paged list beside it does. */
export async function anUnpagedToolReturnsNoNextCursor(): Promise<void> {
  const { tools } = fake();
  const top = listed(await tools.dispatch("get_energy_top_consumers", {}, ctx([ORG_X])));
  expect(top.truncated).toBe(true);
  expect(Object.keys(top)).not.toContain("nextCursor");
  const assets = listed(await tools.dispatch("list_assets", {}, ctx([ORG_X])));
  expect(Object.keys(assets)).toContain("nextCursor");
}

// --- list_assets ---------------------------------------------------------------------------------

/** (3a) `list_assets` with a location calls `listAll` with the subtree ids only, and asks no organization's ids. */
export async function listAssetsWithALocationReadsTheSubtree(): Promise<void> {
  const { tools, log } = fake();
  const out = listed(await tools.dispatch("list_assets", { locationId: SITE }, ctx([ORG_X, ORG_Y])));
  expect(log.assets).toEqual([{ assetIds: [ASSET_X2], organizationId: ORG_X }]);
  expect(log.access).toEqual([]);
  expect(out.organizations.map((o) => o.organizationId)).toEqual([ORG_X]);
}

/** (3c) Page 2 of `list_assets` starts at the 26th row that matches the search. */
export async function listAssetsPageTwoStartsAtThe26thMatch(): Promise<void> {
  const ids = Array.from({ length: 40 }, (_, i) => assetId(i));
  const { tools } = fake({ readable: { [ORG_X]: ids } });
  const one = listed(await tools.dispatch("list_assets", { search: "pump" }, ctx([ORG_X])));
  const two = listed(await tools.dispatch("list_assets", { search: "pump", cursor: one.nextCursor }, ctx([ORG_X])));
  const codes = (page: Listed) => page.organizations.flatMap((o) => (o.items as Array<{ code: string }>).map((a) => a.code));
  expect(codes(one)).toHaveLength(25);
  expect(codes(two)[0]).toBe("C-25");
  expect(codes(two)).toHaveLength(15);
  expect(two.nextCursor).toBeNull();
}

// --- list_alarms ----------------------------------------------------------------------------------

/** (3d) `list_alarms` with a location calls `alarms.list` with the subtree ids. */
export async function listAlarmsWithALocationReadsTheSubtree(): Promise<void> {
  const { tools, log } = fake();
  await tools.dispatch("list_alarms", { locationId: SITE }, ctx([ORG_X, ORG_Y]));
  expect(log.alarms.map((call) => [call.organizationId, call.assetIds])).toEqual([[ORG_X, [ASSET_X2]]]);
}

/**
 * (3e) `list_alarms` wraps the service's keyset cursor of the last alarm page 1
 * lists and hands it back to the service on the next call. (Page 1 is fitted
 * to the result budget, `F4.291` live check, so its last alarm may be before the 25th.)
 */
export async function listAlarmsPassesTheServiceCursorThrough(): Promise<void> {
  const { tools, log } = fake({ alarmCount: 30, readable: { [ORG_X]: [ASSET_X] } });
  const one = listed(await tools.dispatch("list_alarms", { state: "all" }, ctx([ORG_X])));
  const first = one.organizations[0]?.items.length ?? 0;
  const serviceCursor = alarmKeyset(alarmRow(first - 1, ASSET_X));
  expect(decoded(one.nextCursor)).toEqual({ o: ORG_X, k: serviceCursor });
  const two = listed(await tools.dispatch("list_alarms", { state: "all", cursor: one.nextCursor }, ctx([ORG_X])));
  expect(log.alarms[1]?.cursor).toBe(serviceCursor);
  expect((two.organizations[0]?.items[0] as { message: string }).message).toBe(`Alarm ${first}`);
  expect(two.nextCursor).toBeNull();
}

/** (3f) A cursor whose key is not a keyset the service encodes is refused, and the service is not called. */
export async function listAlarmsRefusesAMangledServiceCursor(): Promise<void> {
  const { tools, log } = fake();
  const cursor = encodeListCursor({ o: ORG_X, k: Buffer.from("{not json", "utf-8").toString("base64url") });
  expect(await tools.dispatch("list_alarms", { cursor }, ctx([ORG_X]))).toEqual({ ok: false, error: COPILOT_TOOL_BAD_CURSOR });
  expect(log.alarms).toEqual([]);
}

/** (3g) `assetId` and `locationId` together are refused by the schema before dispatch. */
export async function listAlarmsRefusesAnAssetAndALocationTogether(): Promise<void> {
  const { tools } = fake();
  const out = await runToolCall(
    tools.registry,
    toolCall("list_alarms", { assetId: ASSET_X, locationId: SITE }),
    () => Promise.reject(new Error("must not dispatch")),
    COPILOT_TOOL_GUARDS,
  );
  expect(out.ok).toBe(false);
  expect(out.content).toContain(COPILOT_ALARMS_ASSET_OR_LOCATION);
}

// --- list_locations (owner ruling P6) -----------------------------------------------------------

/** (3h) `list_locations` search finds a site past the 25th node. */
export async function listLocationsSearchFindsASitePastTheCap(): Promise<void> {
  const { tools } = fake({ locationRows: 40 });
  const out = listed(await tools.dispatch("list_locations", { search: "site-39" }, ctx([ORG_X])));
  expect(out.organizations.flatMap((o) => (o.items as Array<{ code: string }>).map((l) => l.code))).toEqual(["SITE-39"]);
  expect(out.truncated).toBe(false);
}

/**
 * (3i) `list_locations` pages by cursor: each page starts at the node after the
 * last one before it, and the last ends the list. (Each page is fitted to the
 * result budget, `F4.291` live check, so 40 nodes take three pages, not two.)
 */
export async function listLocationsPagesByCursor(): Promise<void> {
  const { tools } = fake({ locationRows: 40 });
  const codes = (page: Listed) => page.organizations.flatMap((o) => (o.items as Array<{ code: string }>).map((l) => l.code));
  const all: string[] = [];
  let page = listed(await tools.dispatch("list_locations", {}, ctx([ORG_X])));
  all.push(...codes(page));
  for (let i = 0; i < 10 && page.nextCursor; i += 1) {
    page = listed(await tools.dispatch("list_locations", { cursor: page.nextCursor }, ctx([ORG_X])));
    all.push(...codes(page));
  }
  expect([all, page.nextCursor]).toEqual([Array.from({ length: 40 }, (_, i) => `SITE-${String(i).padStart(2, "0")}`), null]);
}
