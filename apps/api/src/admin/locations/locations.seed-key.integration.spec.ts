import { expect } from "vitest";
import type pg from "pg";

import type { JwtPayload } from "@bms/shared";

import { updateLocationBodySchema } from "./locations.schema";
import type { LocationsAdminService } from "./locations.service";

/**
 * `F4.170` owner ruling 20 — `meta.seedKey` is seed-owned on the location
 * admin write path. A key an administrator could write would let them forge,
 * move or wipe the seed's identity for a canonical location (addendum 3
 * security review, Medium-1): the boot stops, a row is taken over, or the
 * DECOMM fixture deactivates a live site.
 *
 * Assertions live here; `locations.seed-key.integration.test.ts` owns the
 * pools, the service and the `afterAll` delete (ADR 0014). One claim per
 * exported function, one `it()` each.
 *
 * Every row is in phe-admin's organization (PHEWB), and every key value is
 * this run's own ({@link SeedKeyCtx.keyValue}), never a canonical slug: these
 * rows are committed, and under a mutation that removes the strip a
 * canonical value would forge a live seed identity on the shared database.
 * Read-backs run as `bms_fleet`.
 */
export type SeedKeyCtx = {
  svc: LocationsAdminService;
  fleetPool: pg.Pool;
  organizationId: string;
  jwt: JwtPayload;
  /** Called the moment a row exists — never on the return value (F4.16's lesson). */
  register: (id: string) => void;
  /** Per-run code family; every row this suite writes carries it. */
  family: string;
  /** A per-run key value, never a canonical slug. */
  keyValue: (suffix: string) => string;
  /**
   * Runs `hook` inside the service's next `assertLocationType` — after
   * `update` has read the row on the fleet pool and before its write
   * transaction opens. A PATCH that names `type` is the only way to reach it.
   */
  beforeNextTypeCheck: (hook: () => Promise<void>) => void;
};

function body(ctx: SeedKeyCtx, suffix: string) {
  return {
    organizationId: ctx.organizationId,
    code: `${ctx.family}-${suffix}`,
    slug: `${ctx.family.toLowerCase()}-${suffix.toLowerCase()}`,
    name: `F4.170 seed key ${suffix}`,
    type: "rsmoc" as const,
    latitude: 0,
    longitude: 0,
  };
}

async function storedMeta(ctx: SeedKeyCtx, id: string): Promise<Record<string, unknown> | null | undefined> {
  const { rows } = await ctx.fleetPool.query<{ meta: Record<string, unknown> | null }>(
    "SELECT meta FROM bms.locations WHERE id = $1",
    [id],
  );
  return rows[0]?.meta;
}

/** Keys a row directly, as only the seed may. */
async function keyTheRow(ctx: SeedKeyCtx, id: string, key: string): Promise<void> {
  await ctx.fleetPool.query(
    `UPDATE bms.locations SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('seedKey', $2::text)
      WHERE id = $1`,
    [id, key],
  );
}

/** A row created without a key, then keyed directly, as only the seed may. */
async function keyedRow(ctx: SeedKeyCtx, suffix: string): Promise<{ id: string; key: string }> {
  const created = await ctx.svc.create(ctx.jwt, { ...body(ctx, suffix), meta: { note: "admin" } });
  ctx.register(created.id);
  const key = ctx.keyValue(suffix);
  await keyTheRow(ctx, created.id, key);
  return { id: created.id, key };
}

/** The payload of the one audit row `action` wrote for location `id`. */
async function auditPayload(ctx: SeedKeyCtx, id: string, action: string): Promise<{ meta?: unknown }> {
  const { rows } = await ctx.fleetPool.query<{ payload: { meta?: unknown } }>(
    `SELECT payload FROM bms.audit_log WHERE entity_type = 'location' AND entity_id = $1 AND action = $2`,
    [id, action],
  );
  expect(rows.length, `one ${action} audit row for the location`).toBe(1);
  return rows[0]?.payload ?? {};
}

/** P1 — a POST whose `meta` carries `seedKey` stores no key, and keeps the other keys. */
export async function createStoresNoSeedKey(ctx: SeedKeyCtx): Promise<void> {
  const created = await ctx.svc.create(ctx.jwt, {
    ...body(ctx, "P1"),
    meta: { seedKey: ctx.keyValue("P1"), note: "kept" },
  });
  ctx.register(created.id);
  expect(await storedMeta(ctx, created.id), "no key; the other key is kept").toEqual({ note: "kept" });
}

/** P2 — a PATCH `meta: {}` on a keyed row keeps the stored key. */
export async function updateWithEmptyMetaKeepsTheKey(ctx: SeedKeyCtx): Promise<void> {
  const { id, key } = await keyedRow(ctx, "P2");
  await ctx.svc.update(ctx.jwt, id, updateLocationBodySchema.parse({ meta: {} }));
  expect(await storedMeta(ctx, id), "the admin's meta is replaced; the seed key stays").toEqual({ seedKey: key });
}

/** P3 — a PATCH `meta: { seedKey: "x" }` on a keyed row leaves the stored key unchanged. */
export async function updateCannotMoveTheKey(ctx: SeedKeyCtx): Promise<void> {
  const { id, key } = await keyedRow(ctx, "P3");
  await ctx.svc.update(ctx.jwt, id, updateLocationBodySchema.parse({ meta: { seedKey: ctx.keyValue("P3-X") } }));
  expect((await storedMeta(ctx, id))?.seedKey, "the stored key").toBe(key);
}

/**
 * P4 — a PATCH `meta: { seedKey: "x" }` on an unkeyed row stores no key. P3
 * cannot catch an update that forgets the strip when the stored key is
 * written back last; this one can.
 */
export async function updateCannotForgeAKey(ctx: SeedKeyCtx): Promise<void> {
  const created = await ctx.svc.create(ctx.jwt, body(ctx, "P4"));
  ctx.register(created.id);
  await ctx.svc.update(
    ctx.jwt,
    created.id,
    updateLocationBodySchema.parse({ meta: { seedKey: ctx.keyValue("P4"), note: "n" } }),
  );
  expect(await storedMeta(ctx, created.id), "no key; the other key is kept").toEqual({ note: "n" });
}

/** P5 — a PATCH without `meta` on a keyed row keeps the key (the pre-existing behaviour). */
export async function updateWithoutMetaKeepsTheKey(ctx: SeedKeyCtx): Promise<void> {
  const { id, key } = await keyedRow(ctx, "P5");
  await ctx.svc.update(ctx.jwt, id, { name: "F4.170 seed key P5 renamed" });
  expect(await storedMeta(ctx, id), "meta unchanged").toEqual({ note: "admin", seedKey: key });
}

/**
 * P6 — the stored key an update carries over is the row's at write time, not
 * the one `update` read before its transaction (security review Low-B). The
 * key lands between that read and the write, as a first keyed boot can: a
 * PATCH that replaces `meta` must keep it.
 */
export async function updateWithMetaKeepsAKeyWrittenAfterTheRead(ctx: SeedKeyCtx): Promise<void> {
  const created = await ctx.svc.create(ctx.jwt, { ...body(ctx, "P6"), meta: { note: "admin" } });
  ctx.register(created.id);
  const key = ctx.keyValue("P6");
  ctx.beforeNextTypeCheck(() => keyTheRow(ctx, created.id, key));
  await ctx.svc.update(ctx.jwt, created.id, updateLocationBodySchema.parse({ type: "rsmoc", meta: { note: "n" } }));
  expect(await storedMeta(ctx, created.id), "the admin's meta, plus the key written after the read").toEqual({
    note: "n",
    seedKey: key,
  });
}

/** P7 — as P6, for a PATCH without `meta`: the key written after the read survives. */
export async function updateWithoutMetaKeepsAKeyWrittenAfterTheRead(ctx: SeedKeyCtx): Promise<void> {
  const created = await ctx.svc.create(ctx.jwt, { ...body(ctx, "P7"), meta: { note: "admin" } });
  ctx.register(created.id);
  const key = ctx.keyValue("P7");
  ctx.beforeNextTypeCheck(() => keyTheRow(ctx, created.id, key));
  await ctx.svc.update(
    ctx.jwt,
    created.id,
    updateLocationBodySchema.parse({ type: "rsmoc", name: "F4.170 seed key P7 renamed" }),
  );
  expect(await storedMeta(ctx, created.id), "meta unchanged, with the key").toEqual({ note: "admin", seedKey: key });
}

/**
 * A1 — the create's audit row records the `meta` stored, never the request's
 * `seedKey` (compliance review B2; the `assets.service.ts` `F4.139` rule: the
 * payload records what is in the table, not what was asked for).
 */
export async function createAuditRecordsTheStoredMeta(ctx: SeedKeyCtx): Promise<void> {
  const created = await ctx.svc.create(ctx.jwt, {
    ...body(ctx, "A1"),
    meta: { seedKey: ctx.keyValue("A1"), note: "kept" },
  });
  ctx.register(created.id);
  const payload = await auditPayload(ctx, created.id, "master.location.create");
  expect(payload.meta, "the stored meta").toEqual({ note: "kept" });
}

/**
 * A2 — the update's audit row records the `meta` stored: the row's own key,
 * which is what `bms.locations` holds, and never the key the request sent.
 */
export async function updateAuditRecordsTheStoredMeta(ctx: SeedKeyCtx): Promise<void> {
  const { id, key } = await keyedRow(ctx, "A2");
  await ctx.svc.update(
    ctx.jwt,
    id,
    updateLocationBodySchema.parse({ meta: { seedKey: ctx.keyValue("A2-X"), note: "n" } }),
  );
  const payload = await auditPayload(ctx, id, "master.location.update");
  expect(payload.meta, "the stored meta, with the row's own key").toEqual({ note: "n", seedKey: key });
}
