import { HttpException } from "@nestjs/common";
import pg from "pg";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { updateAssetPointBodySchema } from "./asset-points.schema";
import type { AssetPointsAdminService } from "./asset-points.service";

/**
 * `F2.7` / ADR 0056 decisions 1-3 and the owner's Q-H ruling — the single-row
 * asset-point routes author the five metadata fields and the RTU wiring.
 *
 * **Why this suite is an integration one.** Every rule it covers spans two
 * rows or two tables, which is exactly what no unit test of the schema can
 * reach: the merged-pair refusal reads the *template's* `eng_max` for the same
 * point key, the RTU assertion reads `bms.rtus.location_id` against the
 * asset's own location, and `asset_points_source_ref_check` is what makes
 * "unwire a measured point" mean "become `unmapped`" rather than "keep the kind
 * and drop the id". `point-metadata.schema.spec.ts` holds the pure half.
 *
 * The services are constructed with real, non-owner role connections the way
 * `asset-points.service.rls.integration.test.ts` does, so the writes here run
 * through `withTenant` under real row-level security rather than past it.
 */
export type MetadataFixtures = {
  svc: AssetPointsAdminService;
  /** BYPASSRLS connection, for reading the stored row back column by column. */
  fleetPool: pg.Pool;
  /** A hand-created asset: no template, so nothing to inherit. */
  handAssetId: string;
  /** An asset on a template that declares `keys.measured` with `eng_max = 100`. */
  templatedAssetId: string;
  /** An active RTU in the assets' own location. */
  rtuInLocation: string;
  /** An active RTU of another location in the same organization. */
  rtuElsewhere: string;
  keys: {
    /** Created with all five metadata fields. */
    readonly withMetadata: string;
    /** Created with `rtuId` — the wiring case. */
    readonly wired: string;
    /** Created with an RTU of the wrong location — never written. */
    readonly foreignRtu: string;
    /** Declared `measured` by the template, with `eng_max = 100`. */
    readonly measured: string;
    /** Declared `derived` by the template; carries the `computed` row. */
    readonly computed: string;
    /** Declared `derived` by the template, with no row — create must refuse it. */
    readonly derivedDeclared: string;
    /** An `unmapped` row on the templated asset, for the Q-H wiring case. */
    readonly unmapped: string;
    /** A `manual` row — hand-entered, and unwiring must leave it that way. */
    readonly manual: string;
  };
  /** The `asset_points.id` of the `computed` row on `keys.computed`. */
  computedPointId: string;
  /** The `asset_points.id` of the `unmapped` row on `keys.unmapped`. */
  unmappedPointId: string;
  /** The `asset_points.id` of the `manual` row on `keys.manual`. */
  manualPointId: string;
};

type StoredRow = {
  source_kind: string;
  rtu_id: string | null;
  scale_multiplier: number | null;
  scale_offset: number | null;
  eng_min: number | null;
  eng_max: number | null;
  quality_policy: string | null;
};

async function rowOf(pool: pg.Pool, assetPointId: string): Promise<StoredRow> {
  const { rows } = await pool.query<StoredRow>(
    `SELECT source_kind, rtu_id, scale_multiplier, scale_offset, eng_min, eng_max, quality_policy
       FROM bms.asset_points WHERE id = $1`,
    [assetPointId],
  );
  const [row] = rows;
  if (!row) {
    throw new Error(`asset point ${assetPointId} is not in the database`);
  }
  return row;
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
 * (a) The create route writes all five, as stored — no coercion, no default.
 * The hand asset has no template, so what comes back is the row's own value.
 */
export async function assertCreateWritesTheFiveMetadataColumns(
  ctx: MetadataFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const created = await ctx.svc.create(jwt, {
    assetId: ctx.handAssetId,
    pointKey: ctx.keys.withMetadata,
    sourceDataKey: `${ctx.keys.withMetadata}/RAW`,
    scaleMultiplier: 0.1,
    scaleOffset: -40,
    engMin: 0,
    engMax: 100,
    qualityPolicy: "accept_bad",
  });

  expect(created.scaleMultiplier).toBe(0.1);
  expect(created.scaleOffset).toBe(-40);
  expect(created.engMin).toBe(0);
  expect(created.engMax).toBe(100);
  expect(created.qualityPolicy).toBe("accept_bad");

  const stored = await rowOf(ctx.fleetPool, created.id);
  expect(stored.scale_multiplier).toBe(0.1);
  expect(stored.scale_offset).toBe(-40);
  expect(stored.eng_min).toBe(0);
  expect(stored.eng_max).toBe(100);
  expect(stored.quality_policy).toBe("accept_bad");
  // No gateway was asked for and the asset carries none: `unmapped` is the
  // honest record, and `asset_points_source_ref_check` demands a null rtu_id
  // with it.
  expect(stored.source_kind).toBe("unmapped");
  expect(stored.rtu_id).toBeNull();
}

/**
 * (b) `rtuId` on create wires the point and makes it `measured`; an RTU of
 * another location is refused before anything is written.
 */
export async function assertCreateWiresAnRtuOfTheAssetsOwnLocation(
  ctx: MetadataFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const created = await ctx.svc.create(jwt, {
    assetId: ctx.handAssetId,
    pointKey: ctx.keys.wired,
    sourceDataKey: `${ctx.keys.wired}/RAW`,
    rtuId: ctx.rtuInLocation,
  });
  const stored = await rowOf(ctx.fleetPool, created.id);
  expect(stored.rtu_id).toBe(ctx.rtuInLocation);
  expect(stored.source_kind).toBe("measured");

  const refusal = await refusalOf(
    () =>
      ctx.svc.create(jwt, {
        assetId: ctx.handAssetId,
        pointKey: ctx.keys.foreignRtu,
        sourceDataKey: `${ctx.keys.foreignRtu}/RAW`,
        rtuId: ctx.rtuElsewhere,
      }),
    "an RTU of another location",
  );
  expect(refusal.status).toBe(400);
  expect(refusal.message).toContain("RTU must belong to the selected location");

  // The refusal is not a partial write: nothing exists for that point key.
  const { rows } = await ctx.fleetPool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM bms.asset_points WHERE asset_id = $1 AND point_key = $2",
    [ctx.handAssetId, ctx.keys.foreignRtu],
  );
  expect(rows[0]?.count).toBe("0");
}

/**
 * (c) The merged pair, on the API layer — the case ADR 0056 decision 2 says no
 * row `CHECK` can see. The template declares `eng_max = 100`; an override of
 * `eng_min = 150` alone leaves both rows valid and the resolved band empty.
 *
 * **Non-vacuity**: the refusal has to carry `100`, which exists nowhere in the
 * request. A message without it would prove the template row was never read.
 */
export async function assertTheMergedPairRefusalNamesTheInheritedBound(
  ctx: MetadataFixtures,
  jwt: JwtPayload,
): Promise<void> {
  // The fixture's own premise, asserted rather than assumed.
  const { rows } = await ctx.fleetPool.query<{ eng_max: number | null }>(
    `SELECT tp.eng_max FROM bms.template_points tp
       JOIN bms.assets a ON a.template_id = tp.template_id
      WHERE a.id = $1 AND tp.point_key = $2`,
    [ctx.templatedAssetId, ctx.keys.measured],
  );
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0]?.eng_max).toBe(100);

  const created = await ctx.svc.create(jwt, {
    assetId: ctx.templatedAssetId,
    pointKey: ctx.keys.measured,
    sourceDataKey: `${ctx.keys.measured}/RAW`,
  });

  const refusal = await refusalOf(
    () => ctx.svc.update(jwt, created.id, { engMin: 150 }),
    "an overridden eng_min beside the template's eng_max",
  );
  expect(refusal.status).toBe(400);
  expect(refusal.message).toContain("150");
  expect(refusal.message).toContain("100");
  expect(refusal.message).toContain("(inherited from the template)");

  // Nothing was written by the refusal.
  expect((await rowOf(ctx.fleetPool, created.id)).eng_min).toBeNull();

  // Stating both bounds replaces the inherited pair, and is accepted.
  const updated = await ctx.svc.update(jwt, created.id, { engMin: 150, engMax: 200 });
  expect(updated.engMin).toBe(150);
  expect(updated.engMax).toBe(200);

  // And `null` clears the override back to inheriting the template's 100.
  const cleared = await ctx.svc.update(jwt, created.id, { engMin: null, engMax: null });
  expect(cleared.engMin).toBeNull();
  expect(cleared.engMax).toBeNull();
}

/**
 * (d) A `computed` row is calc configuration, not a telemetry mapping: it has
 * no instrument to scale and no gateway to wire. Both refusals are 409, the
 * status the existing re-key refusal on the same row already uses.
 */
export async function assertAComputedRowRefusesMetadataAndWiring(
  ctx: MetadataFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const metadata = await refusalOf(
    () => ctx.svc.update(jwt, ctx.computedPointId, { scaleMultiplier: 0.5 }),
    "metadata on a computed row",
  );
  expect(metadata.status).toBe(409);
  expect(metadata.message).toContain("computed point");

  const wiring = await refusalOf(
    () => ctx.svc.update(jwt, ctx.computedPointId, { rtuId: ctx.rtuInLocation }),
    "an RTU on a computed row",
  );
  expect(wiring.status).toBe(409);

  // Unwiring is refused too: there is nothing to unwire, and answering 200
  // would report a change that never happened.
  const unwiring = await refusalOf(
    () => ctx.svc.update(jwt, ctx.computedPointId, { rtuId: null }),
    "rtuId: null on a computed row",
  );
  expect(unwiring.status).toBe(409);

  const stored = await rowOf(ctx.fleetPool, ctx.computedPointId);
  expect(stored.scale_multiplier).toBeNull();
  expect(stored.source_kind).toBe("computed");
}

/**
 * Create refuses a point key the pinned template declares `derived`. The row
 * that key needs is the calc-override surface's own, and creating a mapping
 * row for it here would collide with `asset_points_asset_id_point_key_unique`
 * the moment an override is set — after telling the caller it had mapped it.
 */
export async function assertCreateRefusesATemplateDerivedKey(
  ctx: MetadataFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const refusal = await refusalOf(
    () =>
      ctx.svc.create(jwt, {
        assetId: ctx.templatedAssetId,
        pointKey: ctx.keys.derivedDeclared,
        sourceDataKey: `${ctx.keys.derivedDeclared}/RAW`,
      }),
    "a create on a template-derived point key",
  );
  expect(refusal.status).toBe(409);
  expect(refusal.message).toContain("computed point");

  const { rows } = await ctx.fleetPool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM bms.asset_points WHERE asset_id = $1 AND point_key = $2",
    [ctx.templatedAssetId, ctx.keys.derivedDeclared],
  );
  expect(rows[0]?.count).toBe("0");
}

/**
 * (e) The database CHECK is reachable by no valid API path: a zero multiplier
 * is a 400 from the body contract, never a 500 carrying
 * `asset_points_scale_multiplier_check`.
 *
 * Asserted on the schema rather than through the service because the service
 * receives an already-parsed body — the controller is where `.parse` runs, and
 * this is the same object it runs.
 */
export function assertAZeroMultiplierIsRefusedByTheBodyNotTheDatabase(): void {
  expect(updateAssetPointBodySchema.safeParse({ scaleMultiplier: 0 }).success).toBe(false);
  expect(updateAssetPointBodySchema.safeParse({ engMin: 5, engMax: 5 }).success).toBe(false);
  expect(updateAssetPointBodySchema.safeParse({ qualityPolicy: "clamp" }).success).toBe(false);
  expect(updateAssetPointBodySchema.safeParse({ scaleMultiplier: 0.5 }).success).toBe(true);
}

/**
 * (f) The owner's Q-H ruling, end to end: a uuid wires, `null` unwires, and the
 * kind follows because `asset_points_source_ref_check` gives it no choice — a
 * `measured` row with a null `rtu_id` is not a row this database will hold.
 * A `manual` row is hand-entered rather than wired, so unwiring leaves it alone.
 */
export async function assertRtuIdWiresAndUnwiresOnUpdate(
  ctx: MetadataFixtures,
  jwt: JwtPayload,
): Promise<void> {
  expect((await rowOf(ctx.fleetPool, ctx.unmappedPointId)).source_kind).toBe("unmapped");

  await ctx.svc.update(jwt, ctx.unmappedPointId, { rtuId: ctx.rtuInLocation });
  const wired = await rowOf(ctx.fleetPool, ctx.unmappedPointId);
  expect(wired.rtu_id).toBe(ctx.rtuInLocation);
  expect(wired.source_kind).toBe("measured");

  await ctx.svc.update(jwt, ctx.unmappedPointId, { rtuId: null });
  const unwired = await rowOf(ctx.fleetPool, ctx.unmappedPointId);
  expect(unwired.rtu_id).toBeNull();
  expect(unwired.source_kind).toBe("unmapped");

  // An omitted `rtuId` leaves the wiring alone — the third spelling.
  await ctx.svc.update(jwt, ctx.unmappedPointId, { rtuId: ctx.rtuInLocation });
  await ctx.svc.update(jwt, ctx.unmappedPointId, { sensorCode: "F27-SENSOR" });
  const untouched = await rowOf(ctx.fleetPool, ctx.unmappedPointId);
  expect(untouched.rtu_id).toBe(ctx.rtuInLocation);
  expect(untouched.source_kind).toBe("measured");

  await ctx.svc.update(jwt, ctx.manualPointId, { rtuId: null });
  const manual = await rowOf(ctx.fleetPool, ctx.manualPointId);
  expect(manual.source_kind).toBe("manual");
  expect(manual.rtu_id).toBeNull();

  const refusal = await refusalOf(
    () => ctx.svc.update(jwt, ctx.unmappedPointId, { rtuId: ctx.rtuElsewhere }),
    "wiring a point to an RTU of another location",
  );
  expect(refusal.status).toBe(400);
  expect(refusal.message).toContain("RTU must belong to the selected location");
}
