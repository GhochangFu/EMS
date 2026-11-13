import { randomUUID } from "node:crypto";

import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { insertAsset, insertLocationRow, insertOrganization, type Pg } from "../alarms/alarm-list-filters.integration.spec";
import type { MaintenanceWindowReadScope } from "./maintenance-window-scope";
import { TARGET_REFUSED, WINDOW_NOT_FOUND, WORK_ORDER_REFUSED, type MaintenanceWindowsService } from "./maintenance-windows.service";

/**
 * `F4.359` U3 (ADR 0131 decisions 1, 2, 13, 14; plan D1, D2, D15, D16) — the
 * maintenance-window service on the real `bms_tenant` / `bms_fleet` pair.
 * Claims (1)-(12) of the plan's U3. The fixture is two fresh organizations,
 * written as the superuser and deleted by id in `afterAll`: A with root site S,
 * its child C and a second root site T, an asset at each and a rule on C's;
 * B with site U, an asset and a work order. No claim counts a whole table:
 * every read is keyed on a window id, an organization id or a unique reason.
 *
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

function fail(message: string): never {
  throw new Error(message);
}

export type WindowsFixture = {
  readonly svc: MaintenanceWindowsService;
  readonly db: Pg;
  readonly run: string;
  readonly a: string;
  readonly b: string;
  readonly site: { readonly S: string; readonly C: string; readonly T: string; readonly U: string };
  readonly asset: { readonly S: string; readonly C: string; readonly T: string; readonly U: string };
  readonly ruleC: string;
  readonly workOrderB: string;
  readonly actor: JwtPayload;
};

export const ADMIN: MaintenanceWindowReadScope = { assetIds: null, locationIds: null, organizationIds: null };

/** A location admin of S: S and its subtree, and their assets. */
export const siteAdminOfS = (fx: WindowsFixture): MaintenanceWindowReadScope => ({
  assetIds: [fx.asset.S, fx.asset.C],
  locationIds: [fx.site.S, fx.site.C],
  organizationIds: [fx.a],
});

/** A location admin of C alone. */
const readerOfC = (fx: WindowsFixture): MaintenanceWindowReadScope => ({
  assetIds: [fx.asset.C],
  locationIds: [fx.site.C],
  organizationIds: [fx.a],
});

/** A caller who reads the asset at C and no location (an asset-group grant). */
const assetReaderOfC = (fx: WindowsFixture): MaintenanceWindowReadScope => ({
  assetIds: [fx.asset.C],
  locationIds: [],
  organizationIds: [fx.a],
});

const assetReaderOfT = (fx: WindowsFixture): MaintenanceWindowReadScope => ({
  assetIds: [fx.asset.T],
  locationIds: [],
  organizationIds: [fx.a],
});

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const fromNow = (ms: number): string => new Date(Date.now() + ms).toISOString();

/** Builds the fixture; `created` receives each organization id as soon as it exists. */
export async function buildWindowsFixture(db: Pg, svc: MaintenanceWindowsService, created: (organizationId: string) => void): Promise<WindowsFixture> {
  const run = randomUUID().replace(/-/g, "").slice(0, 10);
  const a = await insertOrganization(db, `F4359-A-${run}`);
  created(a);
  const b = await insertOrganization(db, `F4359-B-${run}`);
  created(b);
  const S = await insertLocationRow(db, { organizationId: a, code: `F4359-${run}-S`, name: "F4.359 site S", parentId: null });
  const C = await insertLocationRow(db, { organizationId: a, code: `F4359-${run}-C`, name: "F4.359 child C", parentId: S });
  const T = await insertLocationRow(db, { organizationId: a, code: `F4359-${run}-T`, name: "F4.359 site T", parentId: null });
  const U = await insertLocationRow(db, { organizationId: b, code: `F4359-${run}-U`, name: "F4.359 site U", parentId: null });
  const asset = {
    S: await insertAsset(db, { organizationId: a, locationId: S, code: `F4359-${run}-AS`, name: "F4.359 asset S" }),
    C: await insertAsset(db, { organizationId: a, locationId: C, code: `F4359-${run}-AC`, name: "F4.359 asset C" }),
    T: await insertAsset(db, { organizationId: a, locationId: T, code: `F4359-${run}-AT`, name: "F4.359 asset T" }),
    U: await insertAsset(db, { organizationId: b, locationId: U, code: `F4359-${run}-AU`, name: "F4.359 asset U" }),
  };
  const ruleC =
    (
      await db.query<{ id: string }>(
        `INSERT INTO bms.automation_rules (organization_id, code, name, rule_type, asset_id)
         VALUES ($1, $2, 'F4.359 rule C', 'threshold', $3) RETURNING id`,
        [a, `F4359-${run}-R`, asset.C],
      )
    ).rows[0]?.id ?? fail("rule was not inserted");
  const workOrderB =
    (
      await db.query<{ id: string }>(
        `INSERT INTO bms.work_orders (organization_id, seq, reference, asset_id, title)
         VALUES ($1, 990001, $2, $3, 'F4.359 work order B') RETURNING id`,
        [b, `F4359-${run}`, asset.U],
      )
    ).rows[0]?.id ?? fail("work order was not inserted");
  const email = `f4359-${run}@bms.local`;
  const userId =
    (
      await db.query<{ id: string }>(
        `INSERT INTO bms.users (organization_id, email, password_hash, display_name, role)
         VALUES ($1, $2, 'not-a-usable-hash', 'F4.359 admin', 'organization_admin') RETURNING id`,
        [a, email],
      )
    ).rows[0]?.id ?? fail("user was not inserted");
  return {
    svc,
    db,
    run,
    a,
    b,
    site: { S, C, T, U },
    asset,
    ruleC,
    workOrderB,
    actor: { sub: userId, email, name: "F4.359 admin", role: "organization_admin" },
  };
}

/** Every row the fixture or the service wrote, by organization, children first. */
export async function dropWindowsOrganization(db: Pg, organizationId: string): Promise<void> {
  // The fixture's user also writes in the other organization (claim 12), so its audit rows go by actor too.
  await db.query(
    "DELETE FROM bms.audit_log WHERE organization_id = $1 OR actor_id IN (SELECT id FROM bms.users WHERE organization_id = $1)",
    [organizationId],
  );
  await db.query(
    "DELETE FROM bms.maintenance_windows WHERE created_by IN (SELECT id FROM bms.users WHERE organization_id = $1)",
    [organizationId],
  );
  await db.query("DELETE FROM bms.maintenance_windows WHERE organization_id = $1", [organizationId]);
  await db.query("DELETE FROM bms.work_orders WHERE organization_id = $1", [organizationId]);
  await db.query("DELETE FROM bms.automation_rules WHERE organization_id = $1", [organizationId]);
  await db.query("DELETE FROM bms.assets WHERE organization_id = $1", [organizationId]);
  await db.query("DELETE FROM bms.users WHERE organization_id = $1", [organizationId]);
  await db.query("DELETE FROM bms.locations WHERE organization_id = $1 AND parent_id IS NOT NULL", [organizationId]);
  await db.query("DELETE FROM bms.locations WHERE organization_id = $1", [organizationId]);
  await db.query("DELETE FROM bms.organizations WHERE id = $1", [organizationId]);
}

/** A window created through the service as the admin (`startsAt` absent = now). */
async function createWindow(
  fx: WindowsFixture,
  targets: Array<{ kind: "asset"; assetId: string } | { kind: "location"; locationId: string } | { kind: "rule"; ruleId: string }>,
  extra: { startsAt?: string; endsAt?: string } = {},
): Promise<string> {
  const item = await fx.svc.create(fx.actor, { reason: `F4.359 ${randomUUID()}`, endsAt: extra.endsAt ?? fromNow(HOUR), startsAt: extra.startsAt, targets }, ADMIN);
  return item.id;
}

/** A window already over, written as the superuser (the service refuses a start in the past). */
async function insertPastWindow(fx: WindowsFixture, locationId: string): Promise<string> {
  const id =
    (
      await fx.db.query<{ id: string }>(
        `INSERT INTO bms.maintenance_windows (organization_id, reason, starts_at, ends_at, created_by)
         VALUES ($1, 'F4.359 past window', now() - interval '3 hours', now() - interval '1 hour', $2) RETURNING id`,
        [fx.a, fx.actor.sub],
      )
    ).rows[0]?.id ?? fail("past window was not inserted");
  await fx.db.query(`INSERT INTO bms.maintenance_window_targets (window_id, organization_id, location_id) VALUES ($1, $2, $3)`, [id, fx.a, locationId]);
  return id;
}

async function listIds(fx: WindowsFixture, scope: MaintenanceWindowReadScope, query: Record<string, unknown> = {}): Promise<string[]> {
  const page = await fx.svc.list({ limit: 100, ...query }, scope);
  return page.items.map((item) => item.id);
}

async function expectRefused(promise: Promise<unknown>, type: new (...args: never[]) => Error, message?: string): Promise<void> {
  const err = await promise.then(
    () => fail("expected a refusal, got a result"),
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(type);
  if (message !== undefined) expect((err as Error).message).toBe(message);
}

async function windowsWithReason(fx: WindowsFixture, reason: string): Promise<number> {
  const { rows } = await fx.db.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM bms.maintenance_windows WHERE organization_id = ANY($1::uuid[]) AND reason = $2",
    [[fx.a, fx.b], reason],
  );
  return Number(rows[0]?.n ?? "0");
}

/** (1) An asset, a location and a rule target write one window, three targets and one audit row with the reason. */
export async function assertCreateWritesWindowTargetsAndAudit(fx: WindowsFixture): Promise<void> {
  const reason = `F4.359 create ${fx.run}`;
  const item = await fx.svc.create(
    fx.actor,
    {
      reason,
      endsAt: fromNow(2 * HOUR),
      targets: [
        { kind: "asset", assetId: fx.asset.T },
        { kind: "location", locationId: fx.site.S },
        { kind: "rule", ruleId: fx.ruleC },
      ],
    },
    ADMIN,
  );
  expect(item.organizationId).toBe(fx.a);
  expect(item.state).toBe("active");
  expect(item.createdByName).toBe("F4.359 admin");
  expect(item.targets.map((t) => `${t.kind}:${t.id}`).sort()).toEqual(
    [`asset:${fx.asset.T}`, `location:${fx.site.S}`, `rule:${fx.ruleC}`].sort(),
  );
  expect(await windowsWithReason(fx, reason)).toBe(1);
  const window = await fx.db.query<{ created_by: string; organization_id: string }>(
    "SELECT created_by, organization_id FROM bms.maintenance_windows WHERE id = $1",
    [item.id],
  );
  expect(window.rows).toEqual([{ created_by: fx.actor.sub, organization_id: fx.a }]);
  const targets = await fx.db.query("SELECT 1 FROM bms.maintenance_window_targets WHERE window_id = $1", [item.id]);
  expect(targets.rows).toHaveLength(3);
  const audit = await fx.db.query<{ action: string; reason: string; organization_id: string; actor_id: string }>(
    "SELECT action, reason, organization_id, actor_id FROM bms.audit_log WHERE entity_id = $1 AND entity_type = 'maintenance_window'",
    [item.id],
  );
  expect(audit.rows).toEqual([{ action: "maintenance_window_create", reason, organization_id: fx.a, actor_id: fx.actor.sub }]);
}

/** (2) Targets of A and B are a 400, and nothing is written. */
export async function assertTargetsOfTwoOrganizationsAreRefused(fx: WindowsFixture): Promise<void> {
  const reason = `F4.359 two orgs ${fx.run}`;
  await expectRefused(
    fx.svc.create(fx.actor, { reason, endsAt: fromNow(HOUR), targets: [{ kind: "asset", assetId: fx.asset.C }, { kind: "asset", assetId: fx.asset.U }] }, ADMIN),
    BadRequestException,
  );
  expect(await windowsWithReason(fx, reason)).toBe(0);
  // Positive neighbour: the same body with A's asset alone writes.
  await fx.svc.create(fx.actor, { reason, endsAt: fromNow(HOUR), targets: [{ kind: "asset", assetId: fx.asset.C }] }, ADMIN);
  expect(await windowsWithReason(fx, reason)).toBe(1);
}

/** (3) A location admin of S cannot target T, and gets the same 400 text for a random uuid. */
export async function assertOutOfScopeAndMissingTargetsShareOneText(fx: WindowsFixture): Promise<void> {
  const scope = siteAdminOfS(fx);
  const body = (locationId: string) => ({ reason: `F4.359 scope ${fx.run}`, endsAt: fromNow(HOUR), targets: [{ kind: "location" as const, locationId }] });
  await expectRefused(fx.svc.create(fx.actor, body(fx.site.T), scope), BadRequestException, TARGET_REFUSED);
  await expectRefused(fx.svc.create(fx.actor, body(randomUUID()), scope), BadRequestException, TARGET_REFUSED);
  await expectRefused(
    fx.svc.create(fx.actor, { ...body(fx.site.S), targets: [{ kind: "asset", assetId: fx.asset.T }] }, scope),
    BadRequestException,
    TARGET_REFUSED,
  );
  // Positive neighbour: S itself is in scope.
  const item = await fx.svc.create(fx.actor, body(fx.site.S), scope);
  expect(item.targets.map((t) => t.id)).toEqual([fx.site.S]);
}

/** (4) A caller who reads C (and its asset) may not target S above it: P2. */
export async function assertALocationAboveTheGrantIsRefused(fx: WindowsFixture): Promise<void> {
  const body = (locationId: string) => ({ reason: `F4.359 P2 ${fx.run}`, endsAt: fromNow(HOUR), targets: [{ kind: "location" as const, locationId }] });
  await expectRefused(fx.svc.create(fx.actor, body(fx.site.S), readerOfC(fx)), BadRequestException, TARGET_REFUSED);
  await fx.svc.create(fx.actor, body(fx.site.C), readerOfC(fx));
}

/** (5) A caller who reads only the asset at C sees a window on S, not one on T, not B's. */
export async function assertTheListShowsWindowsAboveAReadableAsset(fx: WindowsFixture): Promise<void> {
  const onS = await createWindow(fx, [{ kind: "location", locationId: fx.site.S }]);
  const onT = await createWindow(fx, [{ kind: "location", locationId: fx.site.T }]);
  const onB = await createWindow(fx, [{ kind: "location", locationId: fx.site.U }]);
  const seen = await listIds(fx, assetReaderOfC(fx));
  expect(seen).toContain(onS);
  expect(seen).not.toContain(onT);
  expect(seen).not.toContain(onB);
  // Positive neighbour: the admin sees all three.
  const all = await listIds(fx, ADMIN);
  expect(all).toEqual(expect.arrayContaining([onS, onT, onB]));
}

/** (6) `state` splits active, future and past; a cancelled future window is past. */
export async function assertStateSplitsTheList(fx: WindowsFixture): Promise<void> {
  const active = await createWindow(fx, [{ kind: "location", locationId: fx.site.T }]);
  const future = await createWindow(fx, [{ kind: "location", locationId: fx.site.T }], { startsAt: fromNow(HOUR), endsAt: fromNow(2 * HOUR) });
  const cancelled = await createWindow(fx, [{ kind: "location", locationId: fx.site.T }], { startsAt: fromNow(HOUR), endsAt: fromNow(2 * HOUR) });
  const past = await insertPastWindow(fx, fx.site.T);
  const item = await fx.svc.cancel(fx.actor, cancelled, {}, ADMIN);
  expect(item.state).toBe("past");
  expect(item.endedByName).toBe("F4.359 admin");
  const by = async (state: string) => listIds(fx, ADMIN, { organizationId: fx.a, state });
  const [a, f, p] = [await by("active"), await by("future"), await by("past")];
  expect(a).toContain(active);
  expect(f).toContain(future);
  expect(p).toEqual(expect.arrayContaining([past, cancelled]));
  for (const id of [active, future, cancelled, past]) {
    expect([a, f, p].filter((ids) => ids.includes(id)), id).toHaveLength(1);
  }
}

/** (7) `assetId=` finds a window through its location target above the asset. */
export async function assertAssetIdFindsAWindowThroughItsLocation(fx: WindowsFixture): Promise<void> {
  const onS = await createWindow(fx, [{ kind: "location", locationId: fx.site.S }]);
  const onT = await createWindow(fx, [{ kind: "location", locationId: fx.site.T }]);
  const found = await listIds(fx, ADMIN, { assetId: fx.asset.C });
  expect(found).toContain(onS);
  expect(found).not.toContain(onT);
  expect(await listIds(fx, ADMIN, { assetId: fx.asset.T })).toContain(onT);
  // P2: a caller who cannot read the asset gets nothing.
  expect(await listIds(fx, assetReaderOfT(fx), { assetId: fx.asset.C })).toEqual([]);
}

/** (8) An active item's `assetIds` holds the C asset for a caller who reads it and not for one who does not. */
export async function assertAssetIdsFollowTheReader(fx: WindowsFixture): Promise<void> {
  const id = await createWindow(fx, [{ kind: "location", locationId: fx.site.S }, { kind: "asset", assetId: fx.asset.T }]);
  const itemFor = async (scope: MaintenanceWindowReadScope) =>
    (await fx.svc.list({ limit: 100, organizationId: fx.a }, scope)).items.find((item) => item.id === id) ?? fail(`window ${id} not listed`);
  expect((await itemFor(ADMIN)).assetIds).toEqual([fx.asset.S, fx.asset.C, fx.asset.T].sort());
  expect((await itemFor(assetReaderOfC(fx))).assetIds).toEqual([fx.asset.C]);
  const forT = await itemFor(assetReaderOfT(fx));
  expect(forT.assetIds).toEqual([fx.asset.T]);
  expect(forT.assetIds).not.toContain(fx.asset.C);
  // Inside the request's filter: `locationId=C` keeps C's asset only.
  const filtered = (await fx.svc.list({ limit: 100, locationId: fx.site.C }, ADMIN)).items.find((item) => item.id === id);
  expect(filtered?.assetIds).toEqual([fx.asset.C]);
}

/** (9) Extend past now + 7 d is a 400; extend of a future, a past or an ended window is a 409. */
export async function assertExtendIsBoundedAndActiveOnly(fx: WindowsFixture): Promise<void> {
  const active = await createWindow(fx, [{ kind: "asset", assetId: fx.asset.T }]);
  await expectRefused(fx.svc.extend(fx.actor, active, { endsAt: fromNow(7 * DAY + HOUR) }, ADMIN), BadRequestException);
  const extended = await fx.svc.extend(fx.actor, active, { endsAt: fromNow(6 * DAY), reason: "Parts are late" }, ADMIN);
  expect(new Date(extended.endsAt).getTime()).toBeGreaterThan(Date.now() + 5 * DAY);
  const future = await createWindow(fx, [{ kind: "asset", assetId: fx.asset.T }], { startsAt: fromNow(HOUR), endsAt: fromNow(2 * HOUR) });
  await expectRefused(fx.svc.extend(fx.actor, future, { endsAt: fromNow(3 * HOUR) }, ADMIN), ConflictException);
  const past = await insertPastWindow(fx, fx.site.T);
  await expectRefused(fx.svc.extend(fx.actor, past, { endsAt: fromNow(HOUR) }, ADMIN), ConflictException);
  // An ended window whose clock is still running: only `ended_at IS NULL` refuses it.
  const ended = await createWindow(fx, [{ kind: "asset", assetId: fx.asset.T }], { endsAt: fromNow(2 * HOUR) });
  await fx.svc.end(fx.actor, ended, {}, ADMIN);
  await expectRefused(fx.svc.extend(fx.actor, ended, { endsAt: fromNow(3 * HOUR) }, ADMIN), ConflictException);
}

/** (10) End of a future window and cancel of an active one are 409; so is a second end or cancel. */
export async function assertEndAndCancelKeepToTheirState(fx: WindowsFixture): Promise<void> {
  const future = await createWindow(fx, [{ kind: "asset", assetId: fx.asset.T }], { startsAt: fromNow(HOUR), endsAt: fromNow(2 * HOUR) });
  const active = await createWindow(fx, [{ kind: "asset", assetId: fx.asset.T }]);
  await expectRefused(fx.svc.end(fx.actor, future, {}, ADMIN), ConflictException);
  await expectRefused(fx.svc.cancel(fx.actor, active, {}, ADMIN), ConflictException);
  const ended = await fx.svc.end(fx.actor, active, { reason: "Work finished early" }, ADMIN);
  expect(ended.state).toBe("past");
  await fx.svc.cancel(fx.actor, future, {}, ADMIN);
  await expectRefused(fx.svc.end(fx.actor, active, {}, ADMIN), ConflictException);
  await expectRefused(fx.svc.cancel(fx.actor, future, {}, ADMIN), ConflictException);
  const audit = await fx.db.query<{ action: string; reason: string | null }>(
    "SELECT action, reason FROM bms.audit_log WHERE entity_id = $1 AND action <> 'maintenance_window_create'",
    [active],
  );
  expect(audit.rows).toEqual([{ action: "maintenance_window_end", reason: "Work finished early" }]);
}

/** (11) D15: a site admin of S cannot end a window that also targets T; one on S alone it can. */
export async function assertEveryTargetMustBeInScopeToChange(fx: WindowsFixture): Promise<void> {
  const both = await createWindow(fx, [{ kind: "location", locationId: fx.site.S }, { kind: "location", locationId: fx.site.T }]);
  await expectRefused(fx.svc.end(fx.actor, both, {}, siteAdminOfS(fx)), NotFoundException, WINDOW_NOT_FOUND);
  await expectRefused(fx.svc.extend(fx.actor, both, { endsAt: fromNow(3 * HOUR) }, siteAdminOfS(fx)), NotFoundException, WINDOW_NOT_FOUND);
  expect(await listIds(fx, siteAdminOfS(fx))).toContain(both);
  const onS = await createWindow(fx, [{ kind: "location", locationId: fx.site.S }]);
  expect((await fx.svc.end(fx.actor, onS, {}, siteAdminOfS(fx))).state).toBe("past");
  // A random id answers the same 404.
  await expectRefused(fx.svc.end(fx.actor, randomUUID(), {}, siteAdminOfS(fx)), NotFoundException, WINDOW_NOT_FOUND);
}

/** (12) A work order of B as the link of a window in A is a 400, not the composite FK's 500. */
export async function assertALinkOutsideTheOrganizationIsRefused(fx: WindowsFixture): Promise<void> {
  const reason = `F4.359 link ${fx.run}`;
  await expectRefused(
    fx.svc.create(fx.actor, { reason, endsAt: fromNow(HOUR), targets: [{ kind: "asset", assetId: fx.asset.C }], workOrderId: fx.workOrderB }, ADMIN),
    BadRequestException,
    WORK_ORDER_REFUSED,
  );
  expect(await windowsWithReason(fx, reason)).toBe(0);
  // Positive neighbour: the same work order on a window in B links.
  const item = await fx.svc.create(fx.actor, { reason, endsAt: fromNow(HOUR), targets: [{ kind: "asset", assetId: fx.asset.U }], workOrderId: fx.workOrderB }, ADMIN);
  expect(item.workOrder).toEqual({ id: fx.workOrderB, reference: `F4359-${fx.run}` });
}
