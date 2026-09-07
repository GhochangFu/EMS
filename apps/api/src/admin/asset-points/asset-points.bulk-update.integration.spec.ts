import { HttpException } from "@nestjs/common";
import pg from "pg";
import { expect } from "vitest";

import { assetPointsListResponseSchema } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import type { AssetPointsAdminService } from "./asset-points.service";

/**
 * `F2.7` Unit I / ADR 0056 decision 8 — `POST /admin/asset-points/bulk-update`,
 * which edits a selection of asset points **all or nothing**.
 *
 * **Why this suite is an integration one.** All-or-nothing is not a property of
 * a function, it is a property of a transaction: the only way to show that a
 * refused selection wrote nothing is to read every row back afterwards and find
 * it as it was — including the audit rows, because a service that validated
 * correctly and audited outside the transaction would pass a rows-only check.
 * Two of the four refusals also span rows the request never names: the merged
 * band is this row's `eng_min` beside its *template's* `eng_max`, and the
 * organization check is over the `assets` of every selected point.
 * `asset-points.schema.spec.ts` holds the pure half — the cap, the empty patch
 * and the within-row rules.
 *
 * The service is constructed with real, non-owner role connections the way
 * `asset-points.metadata.integration.test.ts` does, so every write here runs
 * through `withTenant` under real row-level security rather than past it.
 */
export type BulkUpdateFixtures = {
  svc: AssetPointsAdminService;
  /** BYPASSRLS connection, for reading the stored rows back column by column. */
  fleetPool: pg.Pool;
  /** The templated asset every target row belongs to. */
  assetCode: string;
  /** The three `measured` rows the patch is applied to. */
  targetIds: readonly string[];
  /** The `asset_points.id` of the `computed` row on the same asset. */
  computedPointId: string;
  keys: {
    /** A plain measured key; its template point sets no metadata at all. */
    readonly plain: string;
    /** The key whose template point declares `eng_max = 100`. */
    readonly banded: string;
    /** A third measured key, so "every row" is more than a pair. */
    readonly third: string;
    /** Declared `derived` by the template; carries the `computed` row. */
    readonly computed: string;
  };
  /** A **seeded** asset point of another organization. Read, never written. */
  foreignPointId: string;
  /** A well-formed uuid no `asset_points` row carries. */
  missingId: string;
};

type StoredRow = {
  id: string;
  unit: string | null;
  active: boolean;
  scale_multiplier: number | null;
  scale_offset: number | null;
  eng_min: number | null;
  eng_max: number | null;
  quality_policy: string | null;
};

const BULK_ACTION = "master.asset_point.bulk_update";

/** Every named row, ordered by id, as the exact values the database holds. */
async function rowsOf(pool: pg.Pool, ids: readonly string[]): Promise<StoredRow[]> {
  const { rows } = await pool.query<StoredRow>(
    `SELECT id, unit, active, scale_multiplier, scale_offset, eng_min, eng_max, quality_policy
       FROM bms.asset_points WHERE id = ANY($1::uuid[]) ORDER BY id`,
    [[...ids]],
  );
  return rows;
}

/** How many `bulk_update` audit rows name any of these points. */
async function auditRowCount(pool: pg.Pool, ids: readonly string[]): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM bms.audit_log
      WHERE action = $1 AND entity_id = ANY($2::uuid[])`,
    [BULK_ACTION, [...ids]],
  );
  return Number(rows[0]?.count ?? "0");
}

/**
 * The whole observable state of this suite's rows: the four rows' columns and
 * the audit count over them.
 *
 * Taken before and after every refusal case and compared whole. Asserting only
 * "the field I patched is unchanged" would pass for a partial write that landed
 * on two of three rows, which is the exact failure all-or-nothing forbids.
 */
async function stateOf(ctx: BulkUpdateFixtures): Promise<string> {
  const ids = [...ctx.targetIds, ctx.computedPointId];
  const rows = await rowsOf(ctx.fleetPool, ids);
  const audits = await auditRowCount(ctx.fleetPool, ids);
  return JSON.stringify({ rows, audits });
}

/** The status and message of a refusal, or a throw naming what was expected. */
async function refusalOf(
  run: () => Promise<unknown>,
  what: string,
): Promise<{ status: number; message: string }> {
  try {
    await run();
  } catch (err) {
    if (err instanceof HttpException) {
      return { status: err.getStatus(), message: err.message };
    }
    throw err;
  }
  throw new Error(`${what}: expected a refusal, but the call succeeded`);
}

/**
 * A refusal changes **nothing** — not a column, not an audit row.
 *
 * @returns the refusal, so the caller can assert on its status and message
 */
async function refusesAndWritesNothing(
  ctx: BulkUpdateFixtures,
  run: () => Promise<unknown>,
  what: string,
): Promise<{ status: number; message: string }> {
  const before = await stateOf(ctx);
  const refusal = await refusalOf(run, what);
  const after = await stateOf(ctx);
  expect(after, `${what}: the refusal left a change behind`).toBe(before);
  return refusal;
}

/**
 * One patch, every selected row, one audit row each.
 *
 * The response is parsed through `assetPointsListResponseSchema` because that
 * is the contract the web reads it as (ADR 0030): a service returning rows the
 * shared schema refuses is a 500 in the browser and a green suite here.
 */
export async function assertOnePatchLandsOnEverySelectedRow(
  ctx: BulkUpdateFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const auditsBefore = await auditRowCount(ctx.fleetPool, ctx.targetIds);

  const result = await ctx.svc.bulkUpdate(jwt, {
    ids: [...ctx.targetIds],
    patch: { scaleMultiplier: 0.1, unit: "kW" },
  });

  const parsed = assetPointsListResponseSchema.safeParse(result);
  expect(parsed.success, `the response must satisfy assetPointsListResponseSchema`).toBe(true);
  expect(result.items).toHaveLength(ctx.targetIds.length);
  expect(result.items.length, "the fixture must have rows, or this suite is vacuous").toBeGreaterThan(0);
  for (const item of result.items) {
    expect(item.scaleMultiplier).toBe(0.1);
    expect(item.unit).toBe("kW");
    // Untouched by this patch, and still readable: the response is the row, not
    // an echo of the request.
    expect(item.assetCode).toBe(ctx.assetCode);
  }

  const stored = await rowsOf(ctx.fleetPool, ctx.targetIds);
  expect(stored).toHaveLength(ctx.targetIds.length);
  for (const row of stored) {
    expect(row.scale_multiplier).toBe(0.1);
    expect(row.unit).toBe("kW");
    // Stated nowhere in the patch, so untouched — an UPDATE that wrote all
    // seven columns from a pre-transaction read would have nulled these.
    expect(row.scale_offset).toBeNull();
    expect(row.eng_min).toBeNull();
    expect(row.active).toBe(true);
  }

  expect(
    await auditRowCount(ctx.fleetPool, ctx.targetIds),
    "one audit row per written point (Q-G), through writeMany",
  ).toBe(auditsBefore + ctx.targetIds.length);

  const { rows: payloads } = await ctx.fleetPool.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM bms.audit_log
      WHERE action = $1 AND entity_id = ANY($2::uuid[]) ORDER BY created_at DESC LIMIT 1`,
    [BULK_ACTION, [...ctx.targetIds]],
  );
  expect(payloads[0]?.payload).toEqual({ patch: { scaleMultiplier: 0.1, unit: "kW" } });
}

/**
 * The merged band, per row, against that row's own template default — and the
 * refusal names the row, because a selection is not a place to say "one of
 * these is wrong".
 */
export async function assertAnInvertedMergedBandRefusesTheWholeSelection(
  ctx: BulkUpdateFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const refusal = await refusesAndWritesNothing(
    ctx,
    () => ctx.svc.bulkUpdate(jwt, { ids: [...ctx.targetIds], patch: { engMin: 150 } }),
    "an eng_min of 150 beside a template eng_max of 100",
  );

  expect(refusal.status).toBe(400);
  // The template default was read: nothing in the request carries 100.
  expect(refusal.message).toContain("100");
  expect(refusal.message).toContain("(inherited from the template)");
  expect(refusal.message).toContain(`${ctx.assetCode}/${ctx.keys.banded}`);
  // The two rows whose template says nothing about a band are not named — the
  // patch is legal for them, and the refusal is about the one row it is not.
  expect(refusal.message).not.toContain(`${ctx.assetCode}/${ctx.keys.plain}`);
}

/**
 * A `computed` row in the selection refuses a patch that **sets** metadata, and
 * the whole selection goes with it (decision 8: all or nothing).
 */
export async function assertAComputedRowRefusesAMetadataPatch(
  ctx: BulkUpdateFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const ids = [...ctx.targetIds, ctx.computedPointId];
  const refusal = await refusesAndWritesNothing(
    ctx,
    () => ctx.svc.bulkUpdate(jwt, { ids, patch: { engMax: 5 } }),
    "a computed row under a metadata patch",
  );

  expect(refusal.status).toBe(409);
  expect(refusal.message).toContain(`${ctx.assetCode}/${ctx.keys.computed}`);
}

/**
 * The state flip alone is accepted on the same selection, and it reaches the
 * `computed` row too: a calc row has no instrument to scale, but it is as
 * deactivatable as any other mapping.
 */
export async function assertTheStateFlipAloneIsAccepted(
  ctx: BulkUpdateFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const ids = [...ctx.targetIds, ctx.computedPointId];

  const off = await ctx.svc.bulkUpdate(jwt, { ids, patch: { active: false } });
  expect(off.items).toHaveLength(ids.length);
  expect((await rowsOf(ctx.fleetPool, ids)).every((row) => row.active === false)).toBe(true);

  const on = await ctx.svc.bulkUpdate(jwt, { ids, patch: { active: true } });
  expect(on.items.every((item) => item.active)).toBe(true);
  expect((await rowsOf(ctx.fleetPool, ids)).every((row) => row.active === true)).toBe(true);
}

/**
 * A selection spanning two organizations is refused before anything is written.
 *
 * The page filters by location so the UI cannot build one; the API caller can,
 * and one `withTenant` transaction can only stamp one organization — a mixed
 * selection would either write half the rows or refuse the second half at
 * `0048`'s `WITH CHECK` with the first half already written.
 */
export async function assertASelectionSpanningTwoOrganizationsIsRefused(
  ctx: BulkUpdateFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const refusal = await refusesAndWritesNothing(
    ctx,
    () =>
      ctx.svc.bulkUpdate(jwt, {
        ids: [...ctx.targetIds, ctx.foreignPointId],
        patch: { scaleOffset: 3 },
      }),
    "a selection spanning two organizations",
  );

  expect(refusal.status).toBe(400);
  expect(refusal.message.toLowerCase()).toContain("organization");

  // The other organization's row is untouched as well — the assertion above
  // only covers this suite's own rows.
  const [foreign] = await rowsOf(ctx.fleetPool, [ctx.foreignPointId]);
  expect(foreign?.scale_offset ?? null).toBeNull();
}

/** An id that names no row is reported by id, and nothing is written. */
export async function assertAnUnknownIdIsNamedAndNothingIsWritten(
  ctx: BulkUpdateFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const refusal = await refusesAndWritesNothing(
    ctx,
    () =>
      ctx.svc.bulkUpdate(jwt, {
        ids: [...ctx.targetIds, ctx.missingId],
        patch: { scaleOffset: 3 },
      }),
    "an id no row carries",
  );

  expect(refusal.status).toBe(404);
  expect(refusal.message).toContain(ctx.missingId);
}

/**
 * A caller who may not manage the rows' location is refused, and the refusal is
 * a 403 rather than a partial write of the rows they *can* reach.
 */
export async function assertACallerOutsideTheLocationIsRefused(
  ctx: BulkUpdateFixtures,
  outOfScope: JwtPayload,
): Promise<void> {
  const refusal = await refusesAndWritesNothing(
    ctx,
    () => ctx.svc.bulkUpdate(outOfScope, { ids: [...ctx.targetIds], patch: { active: false } }),
    "a location_admin of another location",
  );

  expect(refusal.status).toBe(403);
}
