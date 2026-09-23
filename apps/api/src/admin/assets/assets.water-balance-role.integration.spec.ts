import { BadRequestException } from "@nestjs/common";
import pg from "pg";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import type { AssetsAdminService } from "./assets.service";

/**
 * `E4.3` U3 — `bms.assets.water_balance_role` on the admin asset write path (ADR 0073
 * decision 1). Assertions live here; `assets.water-balance-role.integration.test.ts` owns the
 * pools and the cleanup (ADR 0014). One exported function per claim, so a mutation reddens the
 * `it` that owns it.
 *
 * Integration rather than unit, for the reason `assets.telemetry-source.integration.spec.ts`
 * gives: the write runs inside `withTenant` on a real `bms_tenant` connection, and the claim is
 * about the row that comes back, the FK that closes the column, and the vocabulary row the
 * service checks the code against. A service call cannot be wrapped in `withRollback`, so the
 * lifecycle is prefixed codes, tracked ids and an `afterAll` delete.
 */
export type AssetsWaterBalanceRoleCtx = {
  readonly svc: AssetsAdminService;
  /** `bms_fleet` (BYPASSRLS) — read-back only. */
  readonly fixturePool: pg.Pool;
  /** Superuser — stages a stored role the service would refuse to write (a retired one). */
  readonly superuserPool: pg.Pool;
  /** A per-run `bms.water_balance_roles` row with `active = false`. */
  readonly retiredRole: string;
  readonly locationId: string;
  readonly domain: string;
  readonly createdAssetIds: string[];
};

/**
 * The sentence `VocabulariesService.assertWaterBalanceRole` answers an unknown code with (U2).
 * The codes are listed in `sort_order`, which migration `0080` seeds as intake 10, discharge 20,
 * reuse 30, internal 40.
 */
const NOPE_MESSAGE =
  'water balance role "nope" is not a live value. Expected one of: intake, discharge, reuse, internal.';

let fixtureSeq = 0;

function nextCode(): string {
  // `assets_code_charset_check` (0070) is `^[A-Za-z0-9_-]+$`: no dots.
  return `e4-3-u3-${Date.now()}-${fixtureSeq++}`;
}

async function createThroughService(
  ctx: AssetsWaterBalanceRoleCtx,
  jwt: JwtPayload,
  waterBalanceRole: string | null | undefined,
): Promise<{ id: string; waterBalanceRole: string | null }> {
  const code = nextCode();
  const dto = await ctx.svc.create(jwt, {
    code,
    name: `E4.3 U3 ${code}`,
    siteName: "E4.3 U3 site",
    locationId: ctx.locationId,
    rtuId: null,
    domain: ctx.domain,
    ...(waterBalanceRole === undefined ? {} : { waterBalanceRole }),
  });
  ctx.createdAssetIds.push(dto.id);
  return dto;
}

async function refusal(run: () => Promise<unknown>): Promise<BadRequestException> {
  try {
    await run();
  } catch (err) {
    if (err instanceof BadRequestException) return err;
    throw err;
  }
  throw new Error("expected a BadRequestException, got success");
}

async function storedRole(ctx: AssetsWaterBalanceRoleCtx, id: string): Promise<string | null> {
  const res = await ctx.fixturePool.query<{ role: string | null }>(
    "SELECT water_balance_role AS role FROM bms.assets WHERE id = $1",
    [id],
  );
  if (res.rows[0] === undefined) throw new Error(`E4.3 U3: asset ${id} not found`);
  return res.rows[0].role;
}

/** `create` with `intake` answers a DTO carrying `intake`. */
export async function assertCreateReturnsTheRole(
  ctx: AssetsWaterBalanceRoleCtx,
  jwt: JwtPayload,
): Promise<void> {
  const dto = await createThroughService(ctx, jwt, "intake");
  expect(dto.waterBalanceRole).toBe("intake");
}

/** …and the committed row reads `intake` on a separate `bms_fleet` connection. */
export async function assertCreateStoresTheRole(
  ctx: AssetsWaterBalanceRoleCtx,
  jwt: JwtPayload,
): Promise<void> {
  const dto = await createThroughService(ctx, jwt, "intake");
  expect(await storedRole(ctx, dto.id)).toBe("intake");
}

/** `create` without the field stores `NULL` — not in the balance (the default). */
export async function assertCreateWithoutTheFieldStoresNull(
  ctx: AssetsWaterBalanceRoleCtx,
  jwt: JwtPayload,
): Promise<void> {
  const dto = await createThroughService(ctx, jwt, undefined);
  expect(await storedRole(ctx, dto.id)).toBeNull();
}

/**
 * `create` with an unknown code is a 400 naming the four live codes — not the 500 the FK
 * `assets_water_balance_role_fkey` would answer with if the vocabulary check were skipped.
 */
export async function assertCreateRefusesAnUnknownRoleWith400(
  ctx: AssetsWaterBalanceRoleCtx,
  jwt: JwtPayload,
): Promise<void> {
  const err = await refusal(() => createThroughService(ctx, jwt, "nope"));
  expect(err.message).toBe(NOPE_MESSAGE);
}

/**
 * …and writes no row. Counted by the refused request's own code, never by a table-wide count:
 * the database is shared with other suites, and a global count moves under them.
 */
export async function assertCreateWithAnUnknownRoleWritesNoRow(
  ctx: AssetsWaterBalanceRoleCtx,
  jwt: JwtPayload,
): Promise<void> {
  const code = nextCode();
  await refusal(() =>
    ctx.svc.create(jwt, {
      code,
      name: `E4.3 U3 ${code}`,
      siteName: "E4.3 U3 site",
      locationId: ctx.locationId,
      rtuId: null,
      domain: ctx.domain,
      waterBalanceRole: "nope",
    }),
  );
  const res = await ctx.fixturePool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM bms.assets WHERE code = $1",
    [code],
  );
  expect(res.rows[0]?.n).toBe("0");
}

/** `update` with `null` clears a role that was set (created `intake`, so the clear is visible). */
export async function assertUpdateWithNullClearsTheRole(
  ctx: AssetsWaterBalanceRoleCtx,
  jwt: JwtPayload,
): Promise<void> {
  const created = await createThroughService(ctx, jwt, "intake");
  const dto = await ctx.svc.update(jwt, created.id, { waterBalanceRole: null });
  expect(dto.waterBalanceRole).toBeNull();
}

/** `update` omitting the field leaves the role alone — a rename keeps `intake`. */
export async function assertARenameLeavesTheRoleAlone(
  ctx: AssetsWaterBalanceRoleCtx,
  jwt: JwtPayload,
): Promise<void> {
  const created = await createThroughService(ctx, jwt, "intake");
  await ctx.svc.update(jwt, created.id, { name: `E4.3 U3 renamed ${created.id}` });
  expect(await storedRole(ctx, created.id)).toBe("intake");
}

/** `update` with a live code sets it on an asset that had none. */
export async function assertUpdateSetsARole(
  ctx: AssetsWaterBalanceRoleCtx,
  jwt: JwtPayload,
): Promise<void> {
  const created = await createThroughService(ctx, jwt, undefined);
  await ctx.svc.update(jwt, created.id, { waterBalanceRole: "reuse" });
  expect(await storedRole(ctx, created.id)).toBe("reuse");
}

/** `update` with an unknown code is the same 400 as `create`'s. */
export async function assertUpdateRefusesAnUnknownRoleWith400(
  ctx: AssetsWaterBalanceRoleCtx,
  jwt: JwtPayload,
): Promise<void> {
  const created = await createThroughService(ctx, jwt, "intake");
  const err = await refusal(() => ctx.svc.update(jwt, created.id, { waterBalanceRole: "nope" }));
  expect(err.message).toBe(NOPE_MESSAGE);
}

/** The create audit payload records the role the write stored (it spreads `...body`). */
export async function assertTheCreateAuditRecordsTheRole(
  ctx: AssetsWaterBalanceRoleCtx,
  jwt: JwtPayload,
): Promise<void> {
  const created = await createThroughService(ctx, jwt, "intake");
  const res = await ctx.fixturePool.query<{ role: string | null }>(
    `SELECT payload->>'waterBalanceRole' AS role
       FROM bms.audit_log
      WHERE entity_id = $1 AND action = 'master.asset.create'
      LIMIT 1`,
    [created.id],
  );
  if (res.rows[0] === undefined) {
    throw new Error(`E4.3 U3: no master.asset.create audit row for ${created.id}`);
  }
  expect(res.rows[0].role).toBe("intake");
}

/** Stages an asset whose stored role is the per-run RETIRED code — only SQL can write one. */
async function assetOnTheRetiredRole(
  ctx: AssetsWaterBalanceRoleCtx,
  jwt: JwtPayload,
): Promise<string> {
  const created = await createThroughService(ctx, jwt, undefined);
  await ctx.superuserPool.query("UPDATE bms.assets SET water_balance_role = $1 WHERE id = $2", [
    ctx.retiredRole,
    created.id,
  ]);
  return created.id;
}

/**
 * Review C1 — the web form always sends `waterBalanceRole`, so a rename of an asset whose
 * stored role was retired since re-sends that same code. Re-checking a value the edit did not
 * change would refuse the rename; the update succeeds and keeps the stored code.
 */
export async function assertARenameResendingARetiredStoredRoleSucceeds(
  ctx: AssetsWaterBalanceRoleCtx,
  jwt: JwtPayload,
): Promise<void> {
  const id = await assetOnTheRetiredRole(ctx, jwt);
  const dto = await ctx.svc.update(jwt, id, {
    name: `E4.3 U3 renamed ${id}`,
    waterBalanceRole: ctx.retiredRole,
  });
  expect(dto.waterBalanceRole).toBe(ctx.retiredRole);
}

/** The control for C1: the same asset moved to a DIFFERENT code that is not live still 400s. */
export async function assertChangingARetiredRoleToAnUnknownOneIs400(
  ctx: AssetsWaterBalanceRoleCtx,
  jwt: JwtPayload,
): Promise<void> {
  const id = await assetOnTheRetiredRole(ctx, jwt);
  const err = await refusal(() => ctx.svc.update(jwt, id, { waterBalanceRole: "nope" }));
  expect(err.message).toBe(NOPE_MESSAGE);
}
