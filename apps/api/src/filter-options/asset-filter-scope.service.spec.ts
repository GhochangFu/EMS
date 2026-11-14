import type { JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import { recordingDb, dbOps, type Timeline } from "../testing/recording-db";
import { AssetFilterScopeService, type AssetScopeFilter } from "./asset-filter-scope.service";

/**
 * `F4.361` U2 (ADR 0132 decision 5, build notes 1 and 4) —
 * `AssetFilterScopeService.narrow` with no database: a recording fleet handle
 * and a hand-rolled `AccessControlService`. What this file proves is the
 * short-circuits — an empty filter reads nothing and hands back the readable
 * value untouched, and every out-of-scope key answers `[]` (never `null`,
 * which would mean every row) before the assets read. The real-database
 * claims (the readable predicate, the group rule, combined filters) are in
 * `asset-filter-scope.integration.spec.ts`. `asset-filter-scope.service.test.ts`
 * is the Vitest entry point (ADR 0014).
 */

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const USER: JwtPayload = { sub: "u1", email: "op@bms.local", name: "Operator", role: "viewer" };
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const FOREIGN = "33333333-3333-4333-8333-333333333333";
const SITE = "44444444-4444-4444-8444-444444444444";
const OTHER_SITE = "55555555-5555-4555-8555-555555555555";
const ORG = "66666666-6666-4666-8666-666666666666";
const GROUP = "77777777-7777-4777-8777-777777777777";

function harness(readable: string[] | null, rows: Record<string, unknown[]> = {}) {
  const timeline: Timeline = [];
  const fleetDb = recordingDb("fleet", timeline, (op) => rows[op.table ?? ""] ?? []);
  const accessControl = {
    readableAssetIds: async () => readable,
    readableLocationIds: async () => (readable === null ? null : [SITE]),
    readableOrganizationIds: async () => (readable === null ? null : [ORG]),
    currentUser: async () => ({ scope: { kind: "location", locations: [{ id: SITE }], assetGroups: [], assetIds: readable ?? [] } }),
  } as unknown as AccessControlService;
  const svc = new AssetFilterScopeService(fleetDb, accessControl);
  return { svc, ops: () => dbOps(timeline) };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** An empty filter is the caller's readable set as `readableAssetIds` gave it, with no read. */
export async function assertAnEmptyFilterReturnsTheReadableSetUnread(): Promise<void> {
  const h = harness([A, B]);
  const empty: AssetScopeFilter = { organizationId: undefined, locationId: undefined, assetGroupId: undefined, assetId: undefined };
  const narrowed = await h.svc.narrow(USER, empty);
  assert(same(narrowed, [A, B]), `an empty filter answered ${JSON.stringify(narrowed)}, not the readable set`);
  assert(h.ops().length === 0, `an empty filter ran ${h.ops().length} queries`);
  const admin = harness(null);
  const unrestricted = await admin.svc.narrow(USER, {});
  assert(unrestricted === null, `the admin's empty filter answered ${JSON.stringify(unrestricted)}, not null`);
  assert(admin.ops().length === 0, "the admin's empty filter ran a query");
}

/** An asset outside the readable set is `[]`, before any read. */
export async function assertAForeignAssetIsEmptyUnread(): Promise<void> {
  const h = harness([A, B]);
  const narrowed = await h.svc.narrow(USER, { assetId: FOREIGN });
  assert(Array.isArray(narrowed) && narrowed.length === 0, `a foreign asset answered ${JSON.stringify(narrowed)}, not []`);
  assert(h.ops().length === 0, "a foreign asset ran a query");
}

/** A location the caller cannot read is `[]` before any walk (owner ruling P2). */
export async function assertAnUnreadableLocationIsEmptyUnread(): Promise<void> {
  const h = harness([A, B]);
  const narrowed = await h.svc.narrow(USER, { locationId: OTHER_SITE });
  assert(Array.isArray(narrowed) && narrowed.length === 0, `an unreadable location answered ${JSON.stringify(narrowed)}, not []`);
  assert(h.ops().length === 0, `an unreadable location ran ${h.ops().length} queries`);
}

/** A group the caller does not read is `[]`, and the assets are never read (build note 4). */
export async function assertAnUnreadableGroupIsEmptyBeforeTheAssetsRead(): Promise<void> {
  const h = harness([A, B], { asset_groups: [], assets: [{ id: A }] });
  const narrowed = await h.svc.narrow(USER, { assetGroupId: GROUP });
  assert(Array.isArray(narrowed) && narrowed.length === 0, `an unreadable group answered ${JSON.stringify(narrowed)}, not []`);
  const tables = h.ops().map((op) => op.table);
  assert(same(tables, ["asset_groups"]), `an unreadable group read ${JSON.stringify(tables)}, not the group check alone`);
}

/** A caller who reads no asset gets `[]` for any filter — never `null`. */
export async function assertAnEmptyReadableSetStaysEmpty(): Promise<void> {
  const h = harness([], { assets: [{ id: A }] });
  const narrowed = await h.svc.narrow(USER, { organizationId: ORG });
  assert(Array.isArray(narrowed) && narrowed.length === 0, `an empty scope answered ${JSON.stringify(narrowed)}, not []`);
  assert(h.ops().length === 0, "an empty scope ran a query");
}

/** A set key is never `null`, even for the admin: the read's rows are the answer. */
export async function assertASetKeyIsNeverNull(): Promise<void> {
  const h = harness(null, { assets: [] });
  const narrowed = await h.svc.narrow(USER, { organizationId: ORG });
  assert(Array.isArray(narrowed) && narrowed.length === 0, `the admin's organization filter answered ${JSON.stringify(narrowed)}, not []`);
  const withRows = harness(null, { assets: [{ id: A }] });
  const listed = await withRows.svc.narrow(USER, { organizationId: ORG });
  assert(same(listed, [A]), `the admin's organization filter answered ${JSON.stringify(listed)}, not the read's rows`);
}

/** A bounded caller's assets read is ANDed onto the readable ids: they are in its parameters. */
export async function assertTheAssetsReadCarriesTheReadableIds(): Promise<void> {
  const h = harness([A, B], { assets: [{ id: A }] });
  await h.svc.narrow(USER, { organizationId: ORG });
  const read = h.ops().find((op) => op.table === "assets");
  assert(read !== undefined, "no assets read ran");
  assert(read.params.includes(ORG), `the assets read did not carry the organization: ${JSON.stringify(read.params)}`);
  assert(
    JSON.stringify(read.params).includes(A) && JSON.stringify(read.params).includes(B),
    `the assets read did not carry the readable ids: ${JSON.stringify(read.params)}`,
  );
}
