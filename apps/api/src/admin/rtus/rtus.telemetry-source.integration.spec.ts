import pg from "pg";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import type { CreateRtuBody } from "./rtus.schema";
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
  /**
   * The same service with a `BYPASSRLS` connection as its tenant channel.
   *
   * The organization term in the asset update is **defence in depth**, and a
   * second layer is unobservable while the first one holds: under `bms_tenant`
   * the `tenant_isolation` policy on `assets` (migration `0047`, `FORCE`) hides
   * a foreign-organization row from the `UPDATE` whatever its `WHERE` says, so
   * dropping the term changes nothing that a test can see. That is precisely
   * why the coordinator's own mutation left all seven cases green.
   *
   * Running the identical code path on `bms_fleet` removes the first layer and
   * leaves the predicate as the only thing standing. It is not the production
   * wiring, and it is not pretending to be: it is the only way to make the
   * second layer fail when it is broken.
   */
  readonly svcOnABypassingTenantChannel: RtusAdminService;
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
    /**
     * The whole vocabulary, not a two-value convenience type. It was
     * `"mqtt" | "catalog"` for one commit, and the case that would have caught
     * the `simulator` defect could not even be written down.
     */
    sourceType?: CreateRtuBody["sourceType"];
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
 *
 * **The fixture starts at `mqtt`, so the assertion needs a write.** Starting it
 * at `catalog` — as the first draft did — let the case pass against a service
 * that did nothing at all, which is the one thing a guard's test must not do.
 */
export async function assertAnUndeclaredRtuKeepsItsAssetsOnCatalog(
  ctx: TelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const { rtuId, assetId } = await createRtuWithAsset(ctx, jwt, {
    ingestEnabled: true,
    telemetrySource: "mqtt",
    sourceType: "catalog",
  });

  await ctx.svc.update(jwt, rtuId, { ingestEnabled: true });

  expect((await readMeta(ctx, assetId)).telemetrySource).toBe("catalog");
}

/**
 * A `simulator` RTU is not an ingest source either.
 *
 * `rtus.source_type` has three values and `INGEST_PROTOCOLS`
 * (`packages/shared/src/ingest.ts`) holds neither `simulator` nor `catalog` —
 * they are onboarding sources with no adapter, as that file says in as many
 * words. A predicate written as `!== 'catalog'` passes this RTU, and the seeded
 * fleet's simulator RTUs own the majority of its RTU-attached assets, so the
 * blast radius of getting it wrong is most of the plant going dark.
 *
 * Same shape as the case above: the asset starts on `mqtt` and the switch is
 * already on, so only a write can satisfy the assertion.
 */
export async function assertASimulatorRtuKeepsItsAssetsOnCatalog(
  ctx: TelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const { rtuId, assetId } = await createRtuWithAsset(ctx, jwt, {
    ingestEnabled: true,
    telemetrySource: "mqtt",
    sourceType: "simulator",
  });

  await ctx.svc.update(jwt, rtuId, { ingestEnabled: true });

  expect((await readMeta(ctx, assetId)).telemetrySource).toBe("catalog");
}

/**
 * A PATCH that says nothing about ingest still repairs a split row.
 *
 * The service comment claims the write is a postcondition of `update` rather
 * than a delta rule, and that an already-split row — one left behind by a
 * switch thrown before this fix — is repaired by the next edit of its RTU.
 * Nothing asserted that: every other case sends `ingestEnabled` explicitly.
 * This one renames the RTU and nothing else.
 */
export async function assertARenameRepairsASplitRow(
  ctx: TelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const { rtuId, assetId } = await createRtuWithAsset(ctx, jwt, {
    ingestEnabled: true,
    telemetrySource: "catalog",
  });

  await ctx.svc.update(jwt, rtuId, { displayName: "F4.59 renamed, ingest untouched" });

  expect((await readMeta(ctx, assetId)).telemetrySource).toBe("mqtt");
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
/**
 * An RTU in one organization with an asset from another hung off it.
 *
 * **The row has to be inserted directly.** `AssetsAdminService` will not create
 * it: `assertRtuLocation` refuses an RTU outside the asset's location, so the
 * shape cannot be reached through the API at all. Nothing in the schema forbids
 * it today either — `assets.rtu_id` and `assets.organization_id` are
 * independent foreign keys, and the composite key that would make the state
 * impossible is a schema change with its own row. So the fixture writes what a
 * migration, an import or a future bug could write, which is the only way to
 * find out what this service does when it meets one.
 */
async function attachAForeignOrgAsset(
  ctx: TelemetrySourceCtx,
  rtuId: string,
): Promise<string> {
  const foreign = await ctx.fixturePool.query<{
    organization_id: string;
    location_id: string;
  }>(
    `SELECT l.organization_id, l.id AS location_id
       FROM bms.locations l
      WHERE l.organization_id <> $1 AND l.active = true
      ORDER BY l.organization_id, l.created_at, l.code
      LIMIT 1`,
    [ctx.organizationId],
  );
  const row = foreign.rows[0];
  if (row === undefined) {
    throw new Error(
      "F4.59: the database has only one organization with an active location — " +
        "the cross-organization case cannot be built. Run pnpm db:seed.",
    );
  }

  const tag = `f4-59-foreign-${Date.now()}-${fixtureSeq++}`;
  const inserted = await ctx.fixturePool.query<{ id: string }>(
    `INSERT INTO bms.assets
       (organization_id, code, name, site_name, location_id, rtu_id, domain, meta)
     VALUES ($1, $2, $3, 'F4.59 foreign site', $4, $5, 'electrical',
             '{"telemetrySource":"catalog"}'::jsonb)
     RETURNING id`,
    [row.organization_id, tag, `F4.59 foreign asset ${tag}`, row.location_id, rtuId],
  );
  const assetId = inserted.rows[0]?.id;
  if (assetId === undefined) {
    throw new Error("F4.59: foreign-organization fixture asset insert returned no id");
  }
  ctx.createdAssetIds.push(assetId);
  return assetId;
}

/**
 * The organization term in the asset update, gated where it can be seen.
 *
 * The first expectation is the positive control: the caller's own asset still
 * moves, so a service that wrote nothing could not satisfy the claim. The
 * second is the claim — the foreign row stays where it is because the `WHERE`
 * says so, not because row-level security is holding.
 *
 * Read `svcOnABypassingTenantChannel`'s docblock before changing this: under
 * the production tenant role the policy makes the predicate invisible, and this
 * case would pass with the term deleted.
 */
export async function assertAForeignOrgAssetIsNotMovedByThePredicate(
  ctx: TelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const own = await createRtuWithAsset(ctx, jwt, {
    ingestEnabled: false,
    telemetrySource: "catalog",
  });
  const foreignAssetId = await attachAForeignOrgAsset(ctx, own.rtuId);

  await ctx.svcOnABypassingTenantChannel.update(jwt, own.rtuId, { ingestEnabled: true });

  expect((await readMeta(ctx, own.assetId)).telemetrySource).toBe("mqtt");
  expect((await readMeta(ctx, foreignAssetId)).telemetrySource).toBe("catalog");
}

/**
 * The audit row counts the assets the statement actually moved.
 *
 * The same mutation from the other side, and the one an operator would see:
 * with the organization term dropped this reads 2, and the record of the
 * request would claim it moved an asset in an organization the caller cannot
 * even name. The count only — never the ids (ADR 0021, AGENTS.md §9.6).
 */
export async function assertTheAuditCountsOnlyTheAssetsItMoved(
  ctx: TelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const own = await createRtuWithAsset(ctx, jwt, {
    ingestEnabled: false,
    telemetrySource: "catalog",
  });
  await attachAForeignOrgAsset(ctx, own.rtuId);

  await ctx.svcOnABypassingTenantChannel.update(jwt, own.rtuId, { ingestEnabled: true });

  const audit = await ctx.fixturePool.query<{ assets_moved: number | null }>(
    `SELECT (payload->>'assetsMoved')::int AS assets_moved
       FROM bms.audit_log
      WHERE action = 'master.rtu.update' AND entity_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [own.rtuId],
  );
  expect(audit.rows[0]?.assets_moved).toBe(1);
}

/**
 * The endpoint answers rather than throwing when it meets such a row.
 *
 * Production wiring this time, so row-level security is the control and the
 * foreign row is invisible to the statement. **This case passes with or without
 * the organization term** — it is not a gate on the predicate, and it is not
 * offered as one. What it fixes is the behaviour the service comment describes:
 * the request succeeds and the foreign asset is silently left behind. A future
 * change that decided to refuse instead would have to come past this
 * assertion.
 */
export async function assertACrossOrgAssetDoesNotBreakTheUpdate(
  ctx: TelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const own = await createRtuWithAsset(ctx, jwt, {
    ingestEnabled: false,
    telemetrySource: "catalog",
  });
  await attachAForeignOrgAsset(ctx, own.rtuId);

  const updated = await ctx.svc.update(jwt, own.rtuId, { ingestEnabled: true });

  expect(updated.ingestEnabled).toBe(true);
}

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
