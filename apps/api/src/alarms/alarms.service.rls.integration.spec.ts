import { expect } from "vitest";
import pg from "pg";

import type { BmsDb } from "@bms/db";
import type { AlarmSummaryResponse, JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import { countingDb } from "../testing/counting-db";
import type { AlarmDetailsService } from "./alarm-details.service";
import type { AlarmEnrichmentService } from "./alarm-enrichment.service";
import { AlarmsController } from "./alarms.controller";
import type { AlarmsService } from "./alarms.service";

/**
 * `E7.1b` (ADR 0043 decisions 1+3) — the read-path isolation proof
 * `AlarmsService` never had. `list` reads `alarms` (a decision-1 table) through
 * `withReadScope`: a single-organization actor is served inside `withTenant`
 * (the 0047 FORCE policy scopes the read — decision 1), an admin or
 * multi-organization actor falls back to `fleetDb` at run time (decisions 2/3),
 * where the `assetIds` `WHERE` filter is the isolation control. That routing was
 * asserted by a comment and by nothing else before this pair.
 *
 * Four things this proves against real, non-owner roles that the owner
 * connection would pass regardless:
 *
 *  1. `assertAlarmListScopedByAssetIds` — a single-org caller scoped to org A's
 *     asset sees org A's alarm and not org B's; the same read scoped to org B's
 *     asset returns org B's alarm. Each runs under its own org's GUC.
 *  2. `assertAlarmListReturnsBothOrgsForTwoOrgActor` — decision 3: ONE list call
 *     whose `assetIds` span two organizations returns BOTH orgs' alarms. A
 *     wrongful `withTenant(one org)` would silently drop the other org's rows —
 *     which is why the per-org loop was rejected and the fallback is fleet.
 *  3. `assertSingleOrgListRunsOnTenantTransaction` — the mechanism seam: a
 *     single-org list opens exactly one **tenant** transaction and zero fleet
 *     transactions (`withReadScope` → `withTenant`; org resolution uses
 *     `fleetDb.select`, not `.transaction`). A revert to `this.fleetDb.select`
 *     in `list` drops the tenant count to zero. This is what gates the read pool
 *     — `database/fleet-read-wiring.test.ts` no longer does, now that `list`
 *     injects both tokens.
 *  4. `assertAcknowledgeRefusesForeignAlarmButAllowsInScope` — `resolveAlarmOrg`
 *     refuses a foreign alarm behind the caller's scope with the same
 *     non-disclosure wording a nonexistent id gets, and the in-scope
 *     acknowledge runs under org A's GUC, resolves the actor on `fleetDb`
 *     (`acknowledged_by`, not NULL), and leaves the org intact.
 *
 * `F3.10` / ADR 0057 decision 1 adds the lifecycle stamp to 1 and 4: every list
 * item reports `clearedAt`, and acknowledging leaves `bms.alarms.cleared_at`
 * NULL — acknowledgement annotates an alarm, only the sweep closes it.
 */
export type AlarmsRlsFixtures = {
  /** Fleet-backed service: `db` = `bms_tenant`, `fleetDb` = `bms_fleet`. */
  svc: AlarmsService;
  /** The real `bms_tenant` handle — for building a counting-wrapped service. */
  tenantDb: BmsDb;
  /** The real `bms_fleet` handle — for building a counting-wrapped service. */
  fleetDb: BmsDb;
  /** Rebuilds the service under test with swapped db handles (counter probe). */
  makeService: (tenantDb: BmsDb, fleetDb: BmsDb) => AlarmsService;
  /** `bms_fleet` (BYPASSRLS) — verification reads that must span both orgs. */
  ownerPool: pg.Pool;
  /** Org A — the acting user's organization. */
  organizationId: string;
  /** An asset in org A; the caller's `assetIds` scope. */
  inScopeAssetId: string;
  /** An alarm on `inScopeAssetId`. */
  inScopeAlarmId: string;
  /** An asset in org B, outside the caller's scope. */
  foreignAssetId: string;
  /** An alarm on `foreignAssetId`. */
  foreignAlarmId: string;
  /** The acting user's `bms.users.id` — `acknowledged_by` must resolve to it. */
  actorUserId: string;
  /**
   * `F3.28` — a second org-A asset carrying the discriminating pair below and
   * nothing else, so the `state` and summary assertions never read the alarm
   * `assertAcknowledgeRefusesForeignAlarmButAllowsInScope` mutates.
   */
  pairAssetId: string;
  /** On `pairAssetId`: acknowledged, never cleared — ACTIVE (ADR 0057). */
  ackedUnclearedAlarmId: string;
  /** `ackedUnclearedAlarmId`'s severity. */
  ackedUnclearedSeverity: string;
  /** On `pairAssetId`: cleared, never acknowledged — NOT active. */
  clearedUnackedAlarmId: string;
  /** `clearedUnackedAlarmId`'s severity — deliberately not `ackedUnclearedSeverity`. */
  clearedUnackedSeverity: string;
  /** An org-B asset with no alarm — puts a scope on the fleet path without adding a row. */
  foreignQuietAssetId: string;
};

/**
 * `F3.28` — the real controller over the real service, with only
 * `readableAssetIds` stubbed, so the foreign-asset proof covers the
 * controller's parse → `intersectReadable` wiring against real RLS. The two
 * services `list` never touches are empty stubs.
 */
function controllerFor(ctx: AlarmsRlsFixtures, readable: string[] | null): AlarmsController {
  return new AlarmsController(
    ctx.svc,
    { readableAssetIds: async () => readable } as unknown as AccessControlService,
    {} as unknown as AlarmDetailsService,
    {} as unknown as AlarmEnrichmentService,
  );
}

async function listIds(
  ctx: AlarmsRlsFixtures,
  readable: string[] | null,
  query: Record<string, unknown>,
): Promise<string[]> {
  const page = await controllerFor(ctx, readable).list(ACTOR_PAYLOAD, { limit: "100", ...query });
  return page.items.map((i) => i.id);
}

const ACTOR_PAYLOAD: JwtPayload = {
  sub: "00000000-0000-4000-8000-000000000009",
  email: "phe-admin@bms.local",
  name: "F3.28 rls",
  role: "viewer",
};

async function alarmRow(
  pool: pg.Pool,
  id: string,
): Promise<
  | {
      organization_id: string;
      acknowledged_at: Date | null;
      acknowledged_by: string | null;
      cleared_at: Date | null;
    }
  | undefined
> {
  const { rows } = await pool.query<{
    organization_id: string;
    acknowledged_at: Date | null;
    acknowledged_by: string | null;
    cleared_at: Date | null;
  }>(
    "SELECT organization_id, acknowledged_at, acknowledged_by, cleared_at FROM bms.alarms WHERE id = $1",
    [id],
  );
  return rows[0];
}

/**
 * The `assetIds` filter isolates, and it isolates by resolving across
 * organizations — not by a tenant GUC. Org A's caller sees only org A's alarm;
 * the same fleet read scoped to org B's asset returns org B's alarm.
 */
export async function assertAlarmListScopedByAssetIds(ctx: AlarmsRlsFixtures): Promise<void> {
  const { svc, inScopeAssetId, inScopeAlarmId, foreignAssetId, foreignAlarmId } = ctx;

  const scoped = await svc.list({ limit: 100, assetIds: [inScopeAssetId] });
  const scopedIds = scoped.items.map((i) => i.id);
  expect(scopedIds, "the in-scope alarm is listed").toContain(inScopeAlarmId);
  // `F3.10` / ADR 0057 decision 1: `cleared_at` is what makes an alarm inactive,
  // so every list item reports it. The fixture alarm has never been swept, so
  // the column is NULL and the item must say so rather than omit the key —
  // `alarmListItemSchema` requires it and `checkResponse` throws in dev on a
  // missing one.
  expect(
    scoped.items.find((i) => i.id === inScopeAlarmId)?.clearedAt,
    "a freshly raised alarm is active: the list item carries clearedAt: null",
  ).toBeNull();
  expect(
    scopedIds,
    "a foreign-org alarm is filtered out by the assetIds WHERE clause",
  ).not.toContain(foreignAlarmId);

  const foreignScoped = await svc.list({ limit: 100, assetIds: [foreignAssetId] });
  const foreignIds = foreignScoped.items.map((i) => i.id);
  expect(
    foreignIds,
    "the fleet read resolves the other org's alarm behind its own assetIds",
  ).toContain(foreignAlarmId);
  expect(foreignIds).not.toContain(inScopeAlarmId);
}

/**
 * Decision 3: a single list call whose `assetIds` span two organizations returns
 * BOTH orgs' alarms — the run-time fleet fallback resolves across organizations.
 * The mandated test: a `withTenant(one org)` regression would drop the other
 * org's rows, so this fails exactly when the multi-org fallback is wrong.
 */
export async function assertAlarmListReturnsBothOrgsForTwoOrgActor(
  ctx: AlarmsRlsFixtures,
): Promise<void> {
  const { svc, inScopeAssetId, inScopeAlarmId, foreignAssetId, foreignAlarmId } = ctx;
  const both = await svc.list({ limit: 100, assetIds: [inScopeAssetId, foreignAssetId] });
  const ids = both.items.map((i) => i.id);
  expect(ids, "org A's alarm is returned on the two-org path").toContain(inScopeAlarmId);
  expect(ids, "org B's alarm is returned on the same read (fleet fallback)").toContain(
    foreignAlarmId,
  );
  // Exactly the rows the filter allows (ADR 0043 ruling 3): the fleet path has no
  // GUC, so the assetIds WHERE is the ONLY isolation control. The seed carries
  // alarms on other assets, so dropping that WHERE would surface them here.
  expect(
    both.items.every((i) => [inScopeAssetId, foreignAssetId].includes(i.assetId)),
    "the fleet read returns no alarm outside the passed assetIds",
  ).toBe(true);
}

/**
 * The mechanism seam. A single-organization list runs through `withReadScope` →
 * `withTenant`, so it opens exactly one **tenant** transaction and zero fleet
 * transactions (org resolution uses `fleetDb.select`, not `.transaction`). A
 * revert of `list` back to `this.fleetDb.select(...)` drops the tenant count to
 * zero — this is what now gates the read pool.
 */
export async function assertSingleOrgListRunsOnTenantTransaction(
  ctx: AlarmsRlsFixtures,
): Promise<void> {
  const tenant = countingDb(ctx.tenantDb);
  const fleet = countingDb(ctx.fleetDb);
  const svc = ctx.makeService(tenant.db, fleet.db);
  await svc.list({ limit: 100, assetIds: [ctx.inScopeAssetId] });
  expect(tenant.transactions(), "a single-org list opens one tenant transaction").toBe(1);
  expect(fleet.transactions(), "a single-org list opens no fleet transaction").toBe(0);
}

/**
 * `resolveAlarmOrg` refuses a foreign alarm behind the caller's scope, and the
 * in-scope acknowledge writes under org A's GUC with the fleet-resolved actor.
 */
export async function assertAcknowledgeRefusesForeignAlarmButAllowsInScope(
  ctx: AlarmsRlsFixtures,
  actor: Pick<JwtPayload, "sub" | "email">,
): Promise<void> {
  const { svc, ownerPool, organizationId, inScopeAlarmId, foreignAlarmId, inScopeAssetId, actorUserId } =
    ctx;

  await expect(
    svc.acknowledge(foreignAlarmId, actor, "must not acknowledge across orgs", [inScopeAssetId]),
  ).rejects.toThrow(/not found or outside your access scope/i);
  const foreign = await alarmRow(ownerPool, foreignAlarmId);
  expect(foreign?.acknowledged_at, "the foreign alarm stays unacknowledged").toBeNull();

  const acked = await svc.acknowledge(inScopeAlarmId, actor, "acknowledged in scope", [
    inScopeAssetId,
  ]);
  expect(acked.acknowledgedAt).not.toBeNull();
  // `F3.10` / ADR 0057 decision 1: acknowledgement is an annotation, not a
  // closure. `POST /alarms/:id/ack` never writes `cleared_at` — only the
  // lifecycle sweep does — so the alarm this call returns is still active.
  expect(acked.clearedAt, "acknowledging does not clear: the item stays active").toBeNull();

  const row = await alarmRow(ownerPool, inScopeAlarmId);
  expect(row?.acknowledged_at, "the in-scope alarm is acknowledged").not.toBeNull();
  expect(row?.cleared_at, "the acknowledge write leaves cleared_at NULL").toBeNull();
  expect(row?.acknowledged_by, "the actor resolves under bms_fleet, not NULL").toBe(actorUserId);
  expect(row?.organization_id, "acknowledge leaves the org untouched").toBe(organizationId);
}

/* -------------------------------------------------------------------------- */
/* F3.28 — `state` and `assetIds` on GET /alarms (ADR 0074 decision 4)         */
/* -------------------------------------------------------------------------- */

/**
 * `state=active` keeps an acknowledged, uncleared alarm: ADR 0057 decision 1
 * makes `cleared_at IS NULL` the active predicate, and acknowledgement is an
 * annotation. A predicate on `acknowledged_at` drops this row.
 */
export async function assertActiveStateKeepsAcknowledgedUncleared(
  ctx: AlarmsRlsFixtures,
): Promise<void> {
  const ids = await listIds(ctx, [ctx.pairAssetId], { state: "active" });
  expect(ids, "the acknowledged, uncleared alarm is still active").toContain(
    ctx.ackedUnclearedAlarmId,
  );
}

/** `state=active` drops a cleared, unacknowledged alarm — it is closed by the sweep, not by a press. */
export async function assertActiveStateExcludesClearedUnacknowledged(
  ctx: AlarmsRlsFixtures,
): Promise<void> {
  const ids = await listIds(ctx, [ctx.pairAssetId], { state: "active" });
  expect(ids, "the cleared, unacknowledged alarm is not active").not.toContain(
    ctx.clearedUnackedAlarmId,
  );
  expect(ids, "positive control: the same read returns the active row").toContain(
    ctx.ackedUnclearedAlarmId,
  );
}

/** No `state` is `all`: today's read, both rows of the pair. */
export async function assertDefaultStateReturnsBothRows(ctx: AlarmsRlsFixtures): Promise<void> {
  const ids = await listIds(ctx, [ctx.pairAssetId], {});
  expect(ids, "the default state lists the cleared row too").toContain(ctx.clearedUnackedAlarmId);
  expect(ids, "the default state lists the uncleared row").toContain(ctx.ackedUnclearedAlarmId);
}

/** A requested `assetIds` inside the readable set narrows the read to it. */
export async function assertRequestedAssetIdsNarrowWithinScope(
  ctx: AlarmsRlsFixtures,
): Promise<void> {
  const ids = await listIds(ctx, [ctx.inScopeAssetId, ctx.pairAssetId], {
    assetIds: ctx.pairAssetId,
  });
  expect(ids, "an alarm on a readable asset that was not requested is dropped").not.toContain(
    ctx.inScopeAlarmId,
  );
  expect(ids, "positive control: the requested asset's alarm is listed").toContain(
    ctx.ackedUnclearedAlarmId,
  );
}

/**
 * A requested asset in another organization returns nothing — the request
 * never widens the caller's scope. Through the controller: the service alone
 * trusts its `assetIds`, so only the controller's intersection holds this.
 */
export async function assertRequestedForeignAssetReturnsNothing(
  ctx: AlarmsRlsFixtures,
): Promise<void> {
  const ids = await listIds(ctx, [ctx.pairAssetId], { assetIds: ctx.foreignAssetId });
  expect(ids, "a foreign org's asset, requested, lists nothing").toEqual([]);
  const control = await listIds(ctx, [ctx.pairAssetId], {});
  expect(control, "positive control: the same caller, unfiltered, lists their own alarm").toContain(
    ctx.ackedUnclearedAlarmId,
  );
}

/* -------------------------------------------------------------------------- */
/* F3.28 — active alarm counts by severity (plan decision 7)                   */
/* -------------------------------------------------------------------------- */

function countOf(summary: AlarmSummaryResponse, code: string): number | undefined {
  return summary.items.find((i) => i.code === code)?.count;
}

async function activeSeverityCodes(ctx: AlarmsRlsFixtures): Promise<string[]> {
  const { rows } = await ctx.ownerPool.query<{ code: string }>(
    "SELECT code FROM bms.alarm_severities WHERE active = true ORDER BY rank",
  );
  return rows.map((r) => r.code);
}

/** The acknowledged, uncleared alarm is counted: active is `cleared_at IS NULL`. */
export async function assertSummaryCountsAcknowledgedUncleared(ctx: AlarmsRlsFixtures): Promise<void> {
  const summary = await ctx.svc.activeCountsBySeverity([ctx.pairAssetId]);
  expect(
    countOf(summary, ctx.ackedUnclearedSeverity),
    "the acknowledged, uncleared alarm counts at its severity",
  ).toBe(1);
}

/** The cleared, unacknowledged alarm is not counted. */
export async function assertSummaryIgnoresClearedUnacknowledged(ctx: AlarmsRlsFixtures): Promise<void> {
  const summary = await ctx.svc.activeCountsBySeverity([ctx.pairAssetId]);
  expect(
    countOf(summary, ctx.clearedUnackedSeverity),
    "the cleared, unacknowledged alarm's severity counts 0",
  ).toBe(0);
  expect(
    countOf(summary, ctx.ackedUnclearedSeverity),
    "positive control: the active alarm on the same asset is counted",
  ).toBe(1);
}

/** Every active severity, in ascending rank — the `GET /vocabularies` order. */
export async function assertSummaryIsInRankOrder(ctx: AlarmsRlsFixtures): Promise<void> {
  const summary = await ctx.svc.activeCountsBySeverity([ctx.pairAssetId]);
  expect(
    summary.items.map((i) => i.code),
    "the items are the active severities in ascending rank order",
  ).toEqual(await activeSeverityCodes(ctx));
}

/** A severity with no alarm at all in scope still has its row, at 0. */
export async function assertSummaryReportsZeroForASeverityWithNoAlarm(
  ctx: AlarmsRlsFixtures,
): Promise<void> {
  const quiet = (await activeSeverityCodes(ctx)).find(
    (c) => c !== ctx.ackedUnclearedSeverity && c !== ctx.clearedUnackedSeverity,
  );
  if (!quiet) {
    throw new Error("F3.28: need a third active alarm_severities row — run pnpm db:seed.");
  }
  const summary = await ctx.svc.activeCountsBySeverity([ctx.pairAssetId]);
  expect(countOf(summary, quiet), `severity ${quiet} has no alarm and reports count 0`).toBe(0);
  expect(
    countOf(summary, ctx.ackedUnclearedSeverity),
    "positive control: the same read counts the active alarm",
  ).toBe(1);
}

/** `total` is the sum of the counts — here exactly the one active alarm. */
export async function assertSummaryTotalIsTheSum(ctx: AlarmsRlsFixtures): Promise<void> {
  const summary = await ctx.svc.activeCountsBySeverity([ctx.pairAssetId]);
  expect(summary.total, "total equals the sum of the per-severity counts").toBe(
    summary.items.reduce((s, i) => s + i.count, 0),
  );
  expect(summary.total, "positive control: the sum is the one active alarm, not 0").toBe(1);
}

/**
 * The foreign org's active alarm is not counted. The scope spans two orgs
 * (the pair asset and an alarm-less org-B asset), so `withReadScope` takes the
 * fleet path — `bms_fleet` bypasses RLS and the `assetIds` predicate is the
 * only isolation control, which is the path a dropped predicate would leak on.
 */
export async function assertSummaryIgnoresForeignOrgAlarm(ctx: AlarmsRlsFixtures): Promise<void> {
  const foreign = await alarmRow(ctx.ownerPool, ctx.foreignAlarmId);
  expect(foreign?.cleared_at, "precondition: the foreign alarm is active").toBeNull();
  const summary = await ctx.svc.activeCountsBySeverity([ctx.pairAssetId, ctx.foreignQuietAssetId]);
  expect(summary.total, "only the in-scope active alarm is counted, not the foreign org's").toBe(1);
  expect(
    countOf(summary, ctx.ackedUnclearedSeverity),
    "positive control: the in-scope active alarm is counted on the fleet path",
  ).toBe(1);
}

/**
 * Through the controller: a requested foreign asset leaves an empty scope,
 * which counts nothing — every active severity at 0, never the whole fleet.
 */
export async function assertSummaryForRequestedForeignAssetCountsNothing(
  ctx: AlarmsRlsFixtures,
): Promise<void> {
  const summary = await controllerFor(ctx, [ctx.pairAssetId]).summary(ACTOR_PAYLOAD, {
    assetIds: ctx.foreignAssetId,
  });
  expect(summary.total, "a requested foreign asset counts nothing").toBe(0);
  expect(
    summary.items.map((i) => i.code),
    "positive control: every active severity is still listed, at 0",
  ).toEqual(await activeSeverityCodes(ctx));
}
