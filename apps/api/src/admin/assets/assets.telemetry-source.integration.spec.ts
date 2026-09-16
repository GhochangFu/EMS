import pg from "pg";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import type { AssetsAdminService } from "./assets.service";

/**
 * `F4.139` — every `AssetsAdminService` path that sets `assets.rtu_id` also
 * sets `assets.meta.telemetrySource` from the RTU it attaches.
 *
 * The invariant and the two silent failures a split row causes are recorded
 * once, in `admin/telemetry-source.ts`. This file asserts that the two asset
 * writers apply it: before `F4.139` an asset attached through the admin screen
 * to an enabled, `mqtt`-declaring RTU arrived on `catalog` and stayed there
 * until someone next edited the RTU, with `apps/sim` and the ingest host both
 * writing its points.
 *
 * Integration rather than unit, for the reason
 * `assets.service.rls.integration.spec.ts` gives: the write runs inside
 * `withTenant` on a real `bms_tenant` connection, and the derivation reads
 * `bms.rtu_connection_configs` on that same transaction. A fake `tx` would
 * assert the SQL this service happens to build, not the row that comes back.
 *
 * A service call cannot be wrapped in `withRollback` — `withTenant` opens its
 * own transaction on `tenantDb`. The lifecycle is therefore the `F4.59` suite's:
 * prefixed codes, tracked ids, `afterAll` deletes.
 */
export type AssetsTelemetrySourceCtx = {
  readonly svc: AssetsAdminService;
  /** `bms_fleet` (BYPASSRLS) — fixture rows and read-back only. */
  readonly fixturePool: pg.Pool;
  readonly organizationId: string;
  readonly locationId: string;
  readonly domain: string;
  readonly createdAssetIds: string[];
  readonly createdRtuIds: string[];
};

/** `bms.assets.meta` as this suite writes and reads it. */
type AssetMeta = {
  telemetrySource?: string;
  telemetryEnabled?: string;
  foo?: string;
  x?: number;
};

let fixtureSeq = 0;

function nextTag(): string {
  // `assets_code_charset_check` (migration 0070, ADR 0065) is
  // `^[A-Za-z0-9_-]+$` — no dots in a fixture code.
  return `f4-139-${Date.now()}-${fixtureSeq++}`;
}

/**
 * One RTU, inserted directly on the fixture pool.
 *
 * `organization_id` is the location's organization, not an arbitrary one:
 * `assertRtuLocation` reads `bms.rtus` inside the tenant GUC, so an RTU stamped
 * with another organization is invisible there and the service answers
 * `RTU not found` — a fixture bug wearing a 404.
 */
async function createFixtureRtu(
  ctx: AssetsTelemetrySourceCtx,
  rtu: { sourceType: string; ingestEnabled: boolean },
): Promise<string> {
  const tag = nextTag();
  const res = await ctx.fixturePool.query<{ id: string }>(
    `INSERT INTO bms.rtus
       (organization_id, location_id, code, display_name, source_type, ingest_enabled)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      ctx.organizationId,
      ctx.locationId,
      `${tag}-rtu`,
      `F4.139 ${tag}`,
      rtu.sourceType,
      rtu.ingestEnabled,
    ],
  );
  const id = res.rows[0]?.id;
  if (id === undefined) {
    throw new Error("F4.139: fixture RTU insert returned no id");
  }
  ctx.createdRtuIds.push(id);
  return id;
}

/** An RTU whose assets the `F4.59` predicate hands to the ingest host. */
async function createIngestRtu(ctx: AssetsTelemetrySourceCtx): Promise<string> {
  return createFixtureRtu(ctx, { sourceType: "mqtt", ingestEnabled: true });
}

/** Asset through the service under test, so the create path is the one asserted. */
async function createAssetThroughService(
  ctx: AssetsTelemetrySourceCtx,
  jwt: JwtPayload,
  body: { rtuId?: string | null; meta?: Record<string, unknown> },
): Promise<string> {
  const tag = nextTag();
  const dto = await ctx.svc.create(jwt, {
    code: `${tag}-a`,
    name: `F4.139 asset ${tag}`,
    siteName: "F4.139 site",
    locationId: ctx.locationId,
    rtuId: body.rtuId ?? null,
    domain: ctx.domain,
    ...(body.meta === undefined ? {} : { meta: body.meta }),
  });
  ctx.createdAssetIds.push(dto.id);
  return dto.id;
}

/** Asset by direct SQL — the only way to stage a state the service refuses to write. */
async function insertFixtureAsset(
  ctx: AssetsTelemetrySourceCtx,
  row: { rtuId: string | null; meta: AssetMeta },
): Promise<string> {
  const tag = nextTag();
  const res = await ctx.fixturePool.query<{ id: string }>(
    `INSERT INTO bms.assets
       (organization_id, code, name, site_name, location_id, rtu_id, domain, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING id`,
    [
      ctx.organizationId,
      `${tag}-a`,
      `F4.139 asset ${tag}`,
      "F4.139 site",
      ctx.locationId,
      row.rtuId,
      ctx.domain,
      JSON.stringify(row.meta),
    ],
  );
  const id = res.rows[0]?.id;
  if (id === undefined) {
    throw new Error("F4.139: fixture asset insert returned no id");
  }
  ctx.createdAssetIds.push(id);
  return id;
}

/** Read-back on `bms_fleet`, never the returned DTO: the row is the claim. */
async function readMeta(ctx: AssetsTelemetrySourceCtx, assetId: string): Promise<AssetMeta> {
  const res = await ctx.fixturePool.query<{ meta: AssetMeta | null }>(
    "SELECT meta FROM bms.assets WHERE id = $1",
    [assetId],
  );
  const row = res.rows[0];
  if (row === undefined) {
    throw new Error(`F4.139: no bms.assets row for ${assetId}`);
  }
  return row.meta ?? {};
}

async function readName(ctx: AssetsTelemetrySourceCtx, assetId: string): Promise<string> {
  const res = await ctx.fixturePool.query<{ name: string }>(
    "SELECT name FROM bms.assets WHERE id = $1",
    [assetId],
  );
  const row = res.rows[0];
  if (row === undefined) {
    throw new Error(`F4.139: no bms.assets row for ${assetId}`);
  }
  return row.name;
}

/**
 * A1 — `create` with an RTU attached derives the key the operator never sends.
 *
 * The row this whole item exists for: the admin asset screen has no
 * `telemetrySource` field, so every asset it attached to an enabled RTU was a
 * split row from the moment it was written.
 */
export async function assertCreateDerivesMqttFromTheAttachedRtu(
  ctx: AssetsTelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const rtuId = await createIngestRtu(ctx);
  const assetId = await createAssetThroughService(ctx, jwt, {
    rtuId,
    meta: { telemetryEnabled: "false" },
  });

  const meta = await readMeta(ctx, assetId);
  expect(meta.telemetrySource).toBe("mqtt");
}

/**
 * A2 — and it merges the caller's bag rather than replacing it.
 *
 * `telemetryEnabled` is not decoration: `apps/sim/src/index.js` filters on it
 * in the same query as `telemetrySource`, so replacing the object would
 * re-enable simulation on an asset an operator had switched off.
 *
 * The same act as A1 on its own fixture row, and it deliberately does **not**
 * re-assert A1's key: `expect` throws, so one claim per case.
 */
export async function assertCreateKeepsTheCallersOtherMetaKeys(
  ctx: AssetsTelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const rtuId = await createIngestRtu(ctx);
  const assetId = await createAssetThroughService(ctx, jwt, {
    rtuId,
    meta: { telemetryEnabled: "false" },
  });

  const meta = await readMeta(ctx, assetId);
  expect(meta.telemetryEnabled).toBe("false");
}

/**
 * A3 — a caller that sends its own `telemetrySource` is overridden.
 *
 * The RTU is authoritative for this key. A caller-supplied value would
 * otherwise be a way to write a split row through the API on purpose.
 */
export async function assertCreateOverridesACallerSuppliedTelemetrySource(
  ctx: AssetsTelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const rtuId = await createIngestRtu(ctx);
  const assetId = await createAssetThroughService(ctx, jwt, {
    rtuId,
    meta: { telemetrySource: "catalog" },
  });

  const meta = await readMeta(ctx, assetId);
  expect(meta.telemetrySource).toBe("mqtt");
}

/**
 * A4 — a `simulator` RTU's new asset stays on `catalog`.
 *
 * The `F4.59` first-draft defect, asserted at this caller too: a predicate
 * written as `!== 'catalog'` hands every simulator RTU's assets to a host that
 * will never bind them, and the points just stop.
 */
export async function assertCreateLeavesASimulatorRtusAssetOnCatalog(
  ctx: AssetsTelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const rtuId = await createFixtureRtu(ctx, { sourceType: "simulator", ingestEnabled: true });
  const assetId = await createAssetThroughService(ctx, jwt, { rtuId });

  const meta = await readMeta(ctx, assetId);
  expect(meta.telemetrySource).toBe("catalog");
}

/**
 * A5 — with no RTU the bag is stored exactly as sent.
 *
 * ADR 0018's hand-entered or computed asset. There is no RTU to derive from,
 * and inventing `catalog` here would claim an answer the operator never gave.
 */
export async function assertCreateWithoutAnRtuLeavesTheMetaAlone(
  ctx: AssetsTelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const assetId = await createAssetThroughService(ctx, jwt, { meta: { foo: "bar" } });

  const meta = await readMeta(ctx, assetId);
  expect(meta).toEqual({ foo: "bar" });
}

/** A6 — `update` attaching an RTU to an unattached asset derives the key. */
export async function assertUpdateDerivesOnAttach(
  ctx: AssetsTelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const assetId = await createAssetThroughService(ctx, jwt, {});
  const rtuId = await createIngestRtu(ctx);

  await ctx.svc.update(jwt, assetId, { rtuId });

  const meta = await readMeta(ctx, assetId);
  expect(meta.telemetrySource).toBe("mqtt");
}

/**
 * A7 — moving an asset from an ingest RTU to a simulator one moves the key too.
 *
 * The derivation is over the **next** RTU, not the stored one: an asset left on
 * `mqtt` behind a simulator RTU is skipped by `apps/sim` and read by nobody.
 */
export async function assertUpdateDerivesFromTheNewRtuOnAChange(
  ctx: AssetsTelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const ingestRtuId = await createIngestRtu(ctx);
  const simulatorRtuId = await createFixtureRtu(ctx, {
    sourceType: "simulator",
    ingestEnabled: true,
  });
  const assetId = await createAssetThroughService(ctx, jwt, { rtuId: ingestRtuId });

  await ctx.svc.update(jwt, assetId, { rtuId: simulatorRtuId });

  const meta = await readMeta(ctx, assetId);
  expect(meta.telemetrySource).toBe("catalog");
}

/**
 * A8 — a PATCH of `meta` cannot drop the key by omission.
 *
 * `updateAssetBodySchema` is a partial and `meta` is replaced wholesale, so a
 * caller editing one sibling key sent a bag with no `telemetrySource` in it.
 * Before `F4.139` that silently unwired the asset from the ingest host.
 */
export async function assertUpdateReappliesTheKeyWhenMetaIsPatched(
  ctx: AssetsTelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const rtuId = await createIngestRtu(ctx);
  const assetId = await createAssetThroughService(ctx, jwt, { rtuId });

  await ctx.svc.update(jwt, assetId, { meta: { telemetryEnabled: "true" } });

  const meta = await readMeta(ctx, assetId);
  expect(meta.telemetrySource).toBe("mqtt");
}

/**
 * A9 — an unrelated PATCH repairs a row that is already split.
 *
 * The invariant is a postcondition of every write that touches an attached
 * asset, not a delta rule keyed on `body.rtuId` (`F4.59`,
 * `rtus.service.ts` — a rename repairs a split row there for the same reason).
 */
export async function assertARenameRepairsASplitRow(
  ctx: AssetsTelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const rtuId = await createIngestRtu(ctx);
  const assetId = await insertFixtureAsset(ctx, {
    rtuId,
    meta: { telemetrySource: "catalog" },
  });

  await ctx.svc.update(jwt, assetId, { name: "F4.139 renamed" });

  const meta = await readMeta(ctx, assetId);
  expect(meta.telemetrySource).toBe("mqtt");
}

/**
 * A10 — detaching the RTU leaves `meta` exactly as it was (owner ruling 1).
 *
 * The invariant is over RTU-attached assets; `f1.7` counts `a.rtu_id = r.id`.
 * Forcing `catalog` here would take an asset off a host whose points may still
 * name that RTU through `asset_points.rtu_id` — dead beats nothing, and alive
 * beats dead.
 *
 * The `name` change is the positive control: without it a service that wrote
 * nothing at all would pass this case.
 */
export async function assertDetachLeavesTheStoredTelemetrySource(
  ctx: AssetsTelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const rtuId = await createIngestRtu(ctx);
  const assetId = await createAssetThroughService(ctx, jwt, { rtuId });

  await ctx.svc.update(jwt, assetId, { rtuId: null, name: "F4.139 detached" });

  expect(await readName(ctx, assetId)).toBe("F4.139 detached");
  const meta = await readMeta(ctx, assetId);
  expect(meta.telemetrySource).toBe("mqtt");
}

/**
 * A11 — the audit payload carries the derived value (owner ruling 2).
 *
 * The response DTO is unchanged, so `audit_log.payload` is the only API-side
 * evidence of what the write decided. A value, not an id (ADR 0021).
 */
export async function assertTheCreateAuditRecordsTheDerivedSource(
  ctx: AssetsTelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const rtuId = await createIngestRtu(ctx);
  const assetId = await createAssetThroughService(ctx, jwt, {
    rtuId,
    meta: { telemetryEnabled: "false" },
  });

  const res = await ctx.fixturePool.query<{ telemetrySource: string | null }>(
    `SELECT payload->>'telemetrySource' AS "telemetrySource"
       FROM bms.audit_log
      WHERE entity_id = $1 AND action = 'master.asset.create'
      LIMIT 1`,
    [assetId],
  );
  if (res.rows[0] === undefined) {
    throw new Error(`F4.139: no master.asset.create audit row for ${assetId}`);
  }
  expect(res.rows[0].telemetrySource).toBe("mqtt");
}

/**
 * A12 — and so does the `update` payload (owner ruling 2, second half).
 *
 * Added on review: A11 gated `create` only, so reverting `update`'s payload to
 * the bare `body` left no case red. `update` is the path that *changes* an
 * asset's producer, which makes its audit row the more load-bearing of the two.
 */
export async function assertTheUpdateAuditRecordsTheDerivedSource(
  ctx: AssetsTelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const rtuId = await createIngestRtu(ctx);
  const assetId = await createAssetThroughService(ctx, jwt, {});

  await ctx.svc.update(jwt, assetId, { rtuId });

  const res = await ctx.fixturePool.query<{ telemetrySource: string | null }>(
    `SELECT payload->>'telemetrySource' AS "telemetrySource"
       FROM bms.audit_log
      WHERE entity_id = $1 AND action = 'master.asset.update'
      LIMIT 1`,
    [assetId],
  );
  if (res.rows[0] === undefined) {
    throw new Error(`F4.139: no master.asset.update audit row for ${assetId}`);
  }
  expect(res.rows[0].telemetrySource).toBe("mqtt");
}

/**
 * A13 — `create` with no RTU refuses a caller-supplied `telemetrySource`.
 *
 * The security half of the review. A5 proves the rest of the bag is stored as
 * sent; this proves the one key the RTU owns is not. Without an RTU there is
 * nothing to override the caller with, so the key is dropped rather than
 * replaced: inventing `catalog` would claim an answer the operator never gave
 * (ADR 0018), and honouring `mqtt` would hand the asset to a host that has no
 * binding for it.
 */
export async function assertCreateWithoutAnRtuDropsACallerSuppliedSource(
  ctx: AssetsTelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const assetId = await createAssetThroughService(ctx, jwt, {
    meta: { telemetrySource: "mqtt", foo: "bar" },
  });

  const meta = await readMeta(ctx, assetId);
  expect(meta).toEqual({ foo: "bar" });
}

/**
 * A14 — nor can an `update` on a detached asset overwrite the stored value.
 *
 * Owner ruling 1 says a detach leaves the stored `telemetrySource` alone. That
 * ruling and the security fix meet here: the caller's key never lands, and the
 * value the last attached write derived survives the PATCH that tried to
 * replace it.
 *
 * `x` is the positive control — without it a service that ignored `body.meta`
 * entirely would pass. It is asserted in its own `it()`; `expect` throws.
 */
export async function assertADetachedUpdateKeepsTheCallersOtherMetaKeys(
  ctx: AssetsTelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const assetId = await insertFixtureAsset(ctx, {
    rtuId: null,
    meta: { telemetrySource: "mqtt" },
  });

  await ctx.svc.update(jwt, assetId, { meta: { telemetrySource: "catalog", x: 1 } });

  const meta = await readMeta(ctx, assetId);
  expect(meta.x).toBe(1);
}

/**
 * A15 — a detached asset that stores **no bag at all** takes the caller's.
 *
 * The other side of A14, and the branch A13 and A14 between them leave open: an
 * asset created with no RTU and no `meta` stores SQL `NULL`, and the next PATCH
 * of `meta` on it — still detached — is the one input where "put the stored
 * value back" has no stored value to read. Without this case a guard written as
 * `"telemetrySource" in existingMeta` alone passes every other case here and
 * throws `TypeError: Cannot use 'in' operator` on the first operator who edits
 * a hand-entered asset.
 */
export async function assertADetachedUpdateAcceptsAMetaBagOverNull(
  ctx: AssetsTelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const assetId = await createAssetThroughService(ctx, jwt, {});

  await ctx.svc.update(jwt, assetId, { meta: { foo: "bar" } });

  const meta = await readMeta(ctx, assetId);
  expect(meta).toEqual({ foo: "bar" });
}

/** A14's claim: the stored value survives, the caller's is discarded. */
export async function assertADetachedUpdateKeepsTheStoredTelemetrySource(
  ctx: AssetsTelemetrySourceCtx,
  jwt: JwtPayload,
): Promise<void> {
  const assetId = await insertFixtureAsset(ctx, {
    rtuId: null,
    meta: { telemetrySource: "mqtt" },
  });

  await ctx.svc.update(jwt, assetId, { meta: { telemetrySource: "catalog", x: 1 } });

  const meta = await readMeta(ctx, assetId);
  expect(meta.telemetrySource).toBe("mqtt");
}
