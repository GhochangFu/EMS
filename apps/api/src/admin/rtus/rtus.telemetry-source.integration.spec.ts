import pg from "pg";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import type { RtusAdminService } from "./rtus.service";

/**
 * `F4.59` — the admin RTU screen must move `assets.meta.telemetrySource` with
 * `rtus.ingest_enabled`, in one transaction.
 *
 * The invariant `packages/db/src/phe-pilot-seed.ts` maintains: an RTU is `mqtt`
 * on both `rtus.source_type`/`ingest_enabled` and its assets'
 * `meta.telemetrySource`, or on neither. `apps/sim/src/index.js:397` skips
 * exactly the assets marked `mqtt`
 * (`coalesce(meta->>'telemetrySource','sim') <> 'mqtt'`), so a split state is
 * one of two silent failures — two writers on one
 * `(time, asset, point_key)` when the RTU is enabled and its assets are not, or
 * dead points when it is disabled and they are still `mqtt`.
 *
 * Integration rather than unit, for the reason `rtus.service.rls.integration`
 * gives: the write runs inside `withTenant` on a real `bms_tenant` connection,
 * and the merge this asserts is a `jsonb` expression the database evaluates.
 * A fake `tx` would assert the SQL this file happens to build, not the row that
 * comes back.
 */
export type TelemetrySourceCtx = {
  readonly svc: RtusAdminService;
  /** `bms_fleet` (BYPASSRLS) — fixture rows and read-back only. */
  readonly fixturePool: pg.Pool;
  readonly organizationId: string;
  readonly locationId: string;
  readonly createdRtuIds: string[];
  readonly createdAssetIds: string[];
};

/** `bms.assets.meta` as this suite writes and reads it. */
type AssetMeta = {
  telemetrySource?: string;
  telemetryEnabled?: string;
  phe?: { deviceId: number };
};

let fixtureSeq = 0;

/**
 * One RTU with one asset attached through `assets.rtu_id`.
 *
 * `assets.rtu_id` is the edge, not `asset_points.rtu_id`: it is what the seed
 * sets (`assetValues.rtuId`), what `RtusAdminService.deactivate` counts, and
 * what `tests/f1.7-seed-ownership.integration.test.ts` asserts the invariant
 * over.
 *
 * The caller states the starting `telemetrySource` so each direction begins in
 * the state its assertion rejects — a disable case starting at `catalog` would
 * pass without the service doing anything.
 *
 * `sourceType` defaults to `mqtt` because the move onto ingest is gated on the
 * RTU declaring what it speaks: a `catalog` RTU with no connection config
 * cannot bind, and the service leaves its assets with the simulator. The cases
 * that assert the plain `ingest_enabled` move therefore need a fixture that can
 * bind; the two that assert the gate itself state `catalog` explicitly.
 */
async function createRtuWithAsset(
  ctx: TelemetrySourceCtx,
  jwt: JwtPayload,
  start: {
    ingestEnabled: boolean;
    telemetrySource: string;
    sourceType?: "mqtt" | "catalog";
    withConnectionConfig?: boolean;
  },
): Promise<{ rtuId: string; assetId: string }> {
  const tag = `f4-59-${Date.now()}-${fixtureSeq++}`;
  const rtu = await ctx.svc.create(jwt, {
    locationId: ctx.locationId,
    code: tag,
    displayName: `F4.59 ${tag}`,
    sourceType: start.sourceType ?? "mqtt",
    ingestEnabled: start.ingestEnabled,
  });
  ctx.createdRtuIds.push(rtu.id);

  if (start.withConnectionConfig === true) {
    // Deleted by the `rtus` cascade in the wrapper's cleanup
    // (`rtu_connection_configs.rtu_id` is `ON DELETE CASCADE`).
    await ctx.fixturePool.query(
      `INSERT INTO bms.rtu_connection_configs (organization_id, rtu_id, protocol, config)
       VALUES ($1, $2, 'mqtt', '{}'::jsonb)`,
      [ctx.organizationId, rtu.id],
    );
  }

  // `telemetryEnabled` and `phe` are the sibling keys the merge must preserve.
  // Neither is decoration: `apps/sim/src/index.js` filters on
  // `meta->>'telemetryEnabled'` in the same query as `telemetrySource`, so
  // replacing the bag would re-enable simulation on an asset an operator had
  // switched off, and `phe.deviceId` is the seed's device provenance.
  const meta: AssetMeta = {
    telemetrySource: start.telemetrySource,
    telemetryEnabled: "false",
    phe: { deviceId: 4759 },
  };
  // `assets_code_charset_check` (migration 0070, ADR 0065) is
  // `^[A-Za-z0-9_-]+$` — no dots in a fixture code.
  const inserted = await ctx.fixturePool.query<{ id: string }>(
    `INSERT INTO bms.assets
       (organization_id, code, name, site_name, location_id, rtu_id, domain, meta)
     VALUES ($1, $2, $3, $4, $5, $6, 'electrical', $7::jsonb)
     RETURNING id`,
    [
      ctx.organizationId,
      `${tag}-asset`,
      `F4.59 asset ${tag}`,
      "F4.59 site",
      ctx.locationId,
      rtu.id,
      JSON.stringify(meta),
    ],
  );
  const assetId = inserted.rows[0]?.id;
  if (assetId === undefined) {
    throw new Error("F4.59: fixture asset insert returned no id");
  }
  ctx.createdAssetIds.push(assetId);
  return { rtuId: rtu.id, assetId };
}

async function readMeta(ctx: TelemetrySourceCtx, assetId: string): Promise<AssetMeta> {
  const res = await ctx.fixturePool.query<{ meta: AssetMeta | null }>(
    "SELECT meta FROM bms.assets WHERE id = $1",
    [assetId],
  );
  const row = res.rows[0];
  if (row === undefined) {
    throw new Error(`F4.59: no bms.assets row for ${assetId}`);
  }
  return row.meta ?? {};
}

/**
 * Enabling ingest hands the RTU's assets to the ingest host.
 *
 * Without this the simulator keeps writing points the MQTT host is also
 * writing, and the value stored for a `(time, asset, point_key)` is whichever
 * upsert lands second.
 *
 * The fixture's `source_type` is `mqtt`, so this is also the control for the
 * first disjunct of the protocol gate below: a non-`catalog` RTU moves its
 * assets with no connection config row at all.
 */
export async function assertEnablingIngestMovesAssetsToMqtt(
  ctx: TelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const { rtuId, assetId } = await createRtuWithAsset(ctx, jwt, {
    ingestEnabled: false,
    telemetrySource: "catalog",
  });

  await ctx.svc.update(jwt, rtuId, { ingestEnabled: true });

  const meta = await readMeta(ctx, assetId);
  expect(meta.telemetrySource).toBe("mqtt");
}

/**
 * Disabling ingest hands them back to the simulator.
 *
 * The mirror failure, and the quieter one: the ingest host stops reading the
 * RTU the moment `ingest_enabled` goes false, and an asset left on `mqtt` is
 * skipped by `apps/sim` too, so its points simply stop.
 */
export async function assertDisablingIngestMovesAssetsOffMqtt(
  ctx: TelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const { rtuId, assetId } = await createRtuWithAsset(ctx, jwt, {
    ingestEnabled: true,
    telemetrySource: "mqtt",
  });

  await ctx.svc.update(jwt, rtuId, { ingestEnabled: false });

  const meta = await readMeta(ctx, assetId);
  expect(meta.telemetrySource).toBe("catalog");
}

/**
 * The move merges `assets.meta` rather than replacing it.
 *
 * The same discipline `update` already applies to `rtus.meta`, for the same
 * recorded reason: the column is a shared bag, and this caller knows about one
 * key in it.
 */
export async function assertTheMoveMergesTheAssetMetaBag(
  ctx: TelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const { rtuId, assetId } = await createRtuWithAsset(ctx, jwt, {
    ingestEnabled: false,
    telemetrySource: "catalog",
  });

  await ctx.svc.update(jwt, rtuId, { ingestEnabled: true });

  const meta = await readMeta(ctx, assetId);
  expect(meta).toEqual({
    telemetrySource: "mqtt",
    telemetryEnabled: "false",
    phe: { deviceId: 4759 },
  });
}

/**
 * The move is scoped to the RTU being updated.
 *
 * The first expectation is the positive control — without it a service that
 * writes nothing at all would satisfy the scoping claim. The second is the
 * claim: a `WHERE` dropped from the asset update would move every asset in the
 * organization onto `mqtt` and silence the simulator fleet-wide.
 */
export async function assertOnlyTheUpdatedRtusAssetsMove(
  ctx: TelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const target = await createRtuWithAsset(ctx, jwt, {
    ingestEnabled: false,
    telemetrySource: "catalog",
  });
  const neighbour = await createRtuWithAsset(ctx, jwt, {
    ingestEnabled: false,
    telemetrySource: "catalog",
  });

  await ctx.svc.update(jwt, target.rtuId, { ingestEnabled: true });

  expect((await readMeta(ctx, target.assetId)).telemetrySource).toBe("mqtt");
  expect((await readMeta(ctx, neighbour.assetId)).telemetrySource).toBe("catalog");
}

/**
 * An RTU that has not said what it speaks keeps its assets with the simulator.
 *
 * `planEndpoints` resolves the protocol as
 * `rtu_connection_configs.protocol ?? rtus.source_type` and skips `catalog` as
 * `unsupported-protocol` (`bindings.spec.ts`), so this RTU binds nothing
 * however its switch is set. Moving its assets onto `mqtt` would take them off
 * the simulator and hand them to a host that is not listening — simulated
 * becomes dead, which is worse than the double-write the move exists to close.
 *
 * The RTU *is* ingest-enabled here. The claim is about the protocol
 * declaration, not about the switch.
 */
export async function assertAnUndeclaredRtuKeepsItsAssetsOnCatalog(
  ctx: TelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const { rtuId, assetId } = await createRtuWithAsset(ctx, jwt, {
    ingestEnabled: false,
    telemetrySource: "catalog",
    sourceType: "catalog",
  });

  await ctx.svc.update(jwt, rtuId, { ingestEnabled: true });

  expect((await readMeta(ctx, assetId)).telemetrySource).toBe("catalog");
}

/**
 * A connection config is the other way to declare a protocol.
 *
 * The positive control for the gate above, and the disjunct that matters in
 * production: `rtu_connection_configs.protocol` is what `planEndpoints` prefers,
 * so an RTU whose `source_type` still reads `catalog` binds perfectly well once
 * a config row exists. Without this case the gate could be "never move a
 * `catalog` RTU", which would strand every configured one on the simulator.
 */
export async function assertAConnectionConfigLetsTheAssetsMove(
  ctx: TelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const { rtuId, assetId } = await createRtuWithAsset(ctx, jwt, {
    ingestEnabled: false,
    telemetrySource: "catalog",
    sourceType: "catalog",
    withConnectionConfig: true,
  });

  await ctx.svc.update(jwt, rtuId, { ingestEnabled: true });

  expect((await readMeta(ctx, assetId)).telemetrySource).toBe("mqtt");
}
