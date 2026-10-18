import { asc, eq, ne, sql } from "drizzle-orm";

import { assets, rtus } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { withConstraintsOff } from "../testing/constraints-off";
import { createFixtureAssets, fixtureLocation } from "../testing/integration-fixtures";
import { withRollback } from "../testing/with-rollback";
import { AssetsService } from "./assets.service";

/**
 * `F3.31` G3 (ADR 0068 decision 2; security review L1) — a mis-stamped
 * `rtu_id` (an RTU of another organization) reports `rtuDisplayName: null`,
 * never the foreign name. `AssetsService.listAll` reads on the fleet pool
 * (BYPASSRLS), so the organization predicate on the join is what holds this in
 * the service. Since ADR 0102 (migration `0113`) the schema holds it too —
 * `assets_rtu_id_location_id_fkey` puts a wired asset's RTU at the asset's own
 * location, and the location fixes the organization — so the mis-stamp is a
 * state only a superuser with constraints off can leave. The case plants it
 * that way (`withConstraintsOff`) to keep the predicate gated; `listAll` then
 * runs with every key on. The stamp itself is still reported — `rtuId` equals
 * what was written — so the guard measures the join, not the column.
 *
 * **Its own file, not a fourth guard in `assets.service.integration.spec.ts`.**
 * `tests/integration-fixture-isolation.test.ts` is file-scoped: a spec that
 * contains `tx.rollback()` may not read `bms.assets` anywhere, and G1/G2 in
 * the sibling read the seeded pair by code. This one writes, so it builds its
 * asset inside the rolled-back transaction (`createFixtureAssets`) and finds
 * the foreign RTU with a set read on `bms.rtus` — the seed is never named.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export async function assertListAllHidesAForeignOrganizationsRtu(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const txDb = tx as unknown as BmsDb;
    const location = await fixtureLocation(txDb);
    const [assetId] = await createFixtureAssets(txDb, 1, "F331", location);
    assert(assetId !== undefined, "createFixtureAssets returns one id for count 1");
    const [foreign] = await tx
      .select({ id: rtus.id, displayName: rtus.displayName })
      .from(rtus)
      .where(ne(rtus.organizationId, location.organizationId))
      .orderBy(asc(rtus.code))
      .limit(1);
    assert(foreign !== undefined, "control: the seed holds an RTU outside the fixture organization");

    await withConstraintsOff(
      (statement) => tx.execute(sql.raw(statement)),
      () => tx.update(assets).set({ rtuId: foreign?.id }).where(eq(assets.id, assetId as string)),
    );
    const rows = await new AssetsService(txDb).listAll([assetId as string]);
    const row = rows[0];
    assert(rows.length === 1 && row !== undefined, `the mis-stamped asset must still list, got ${rows.length} rows`);
    assert(row?.rtuId === foreign?.id, "control: the stamp is reported as written");
    assert(
      row?.rtuDisplayName === null,
      `a foreign organization's RTU must not be named, got ${JSON.stringify(row?.rtuDisplayName)}`,
    );
    tx.rollback();
  });
}
