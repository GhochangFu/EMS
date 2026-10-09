import { ConflictException, NotFoundException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type pg from "pg";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";

import type { BmsTx } from "../../database/tenant-context";
import { withRollback } from "../../testing/with-rollback";
import { assertLocationActive } from "./assert-location-active";
import {
  expectLocationInactive,
  thrown,
  type InactiveFixture,
} from "../../testing/location-inactive-fixture";

/**
 * `F2.10` Unit E — `assertLocationActive` (ADR 0098 ruling 15, Amendment 1 A4
 * and A5). Assertions live here (§4.6); `assert-location-active.integration.test.ts`
 * owns the pools, and `testing/location-inactive-fixture.ts` the per-run
 * organization.
 */

/** Opens the tenant GUC on `tx`, as `withTenant` does. */
async function enterTenant(tx: BmsTx, organizationId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.current_organization', ${organizationId}, true)`);
}

export type HelperCtx = {
  readonly tenantDb: BmsDb;
  readonly superPool: pg.Pool;
  readonly fx: InactiveFixture;
};

/** E-T1a — an active location passes; an inactive one is 409 `location_inactive`; an absent one is 404. */
export async function assertTheHelperAnswersEachState({ tenantDb, fx }: HelperCtx): Promise<void> {
  const active = await fx.node("T1a-active");
  const inactive = await fx.node("T1a-inactive", { active: false });
  const outcomes: unknown[] = [];
  await withRollback(tenantDb, async (tx) => {
    await enterTenant(tx, fx.organizationId);
    await assertLocationActive(tx, active);
    outcomes.push(await thrown(() => assertLocationActive(tx, inactive)));
    outcomes.push(await thrown(() => assertLocationActive(tx, "00000000-0000-4000-8000-000000000000")));
    tx.rollback();
  });
  expectLocationInactive(outcomes[0]);
  expect(outcomes[0]).toBeInstanceOf(ConflictException);
  expect(outcomes[1]).toBeInstanceOf(NotFoundException);
  expect((outcomes[1] as NotFoundException).message).toBe("Location not found");
}

/**
 * E-T1b — the helper's read holds the row `FOR SHARE` for the rest of the
 * tenant transaction: a superuser `UPDATE … SET active = false` on the same row
 * times out with `55P03` while it is open, and succeeds once it has rolled
 * back (the positive control). Without `FOR SHARE` the UPDATE does not wait.
 */
export async function assertTheHelperHoldsTheRowForShare({ tenantDb, superPool, fx }: HelperCtx): Promise<void> {
  const L = await fx.node("T1b-L");
  const deactivateWithTimeout = async (): Promise<string | undefined> => {
    const client = await superPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '500ms'");
      await client.query("UPDATE bms.locations SET active = false WHERE id = $1", [L]);
      return undefined;
    } catch (err) {
      return (err as { code?: string }).code ?? String(err);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  };

  let whileHeld: string | undefined = "not run";
  await withRollback(tenantDb, async (tx) => {
    await enterTenant(tx, fx.organizationId);
    await assertLocationActive(tx, L);
    whileHeld = await deactivateWithTimeout();
    tx.rollback();
  });
  expect(whileHeld, "the UPDATE did not wait on the helper's row lock").toBe("55P03");

  const afterRelease = await deactivateWithTimeout();
  expect(afterRelease, "the UPDATE failed with nothing holding the row").toBeUndefined();
}
