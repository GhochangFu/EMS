import { randomUUID } from "node:crypto";

import type pg from "pg";
import { expect } from "vitest";

import { createDb } from "@bms/db";

import { createFixtureAssets, fixtureLocation } from "../testing/integration-fixtures";
import { DashboardService } from "./dashboard.service";

/**
 * `F3.10` U12 — the dashboard's open-alarm counts follow `cleared_at`, not
 * `acknowledged_at` (ADR 0057 decision 1, owner ruling Q1). Assertions live
 * here; the sibling `.integration.test` owns the pool (ADR 0014).
 *
 * **Why a database.** The predicate is SQL inside `kpis` and `locationKpis`;
 * a unit spec with a fake pool would assert the fake. And the change fails the
 * way U12's diff would: silently, with a plausible number — a KPI tile that
 * says `0 open` while the alarm centre shows the same alarm as *acknowledged,
 * still breaching* throws nothing.
 *
 * **The fixture discriminates the two predicates.** One acknowledged-but-
 * uncleared `critical` alarm and two cleared-but-unacknowledged `warning`
 * ones on one asset. Under `cleared_at IS NULL` the counts are 1 open, 1
 * critical; under the old `acknowledged_at IS NULL` they would be 2 open, 0
 * critical. A fixture with one of each would count 1 open either way and
 * prove nothing.
 *
 * **One connection, one transaction, rolled back.** The location, the asset,
 * the rule and the alarms are inserted on a single `PoolClient` inside
 * `BEGIN`, and the service is constructed over that same client — it calls
 * nothing on its `Pool` but `.query`, so the client stands in honestly. The
 * rows are visible to the service and to nobody else, a parallel suite's
 * alarms cannot move the numbers (`F4.66`), and `ROLLBACK` in `finally`
 * leaves nothing to restore however the case ends.
 */

/** Runs `run` inside one transaction on one connection, and rolls it back whatever happens. */
async function withRolledBackClient<T>(
  pool: pg.Pool,
  run: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    return await run(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

type Fixture = { organizationId: string; locationId: string; assetId: string };

/**
 * A location of its own (`locationKpis` groups per location and filters
 * `active = true`, which the row's default gives it), one fixture asset on it,
 * a disabled fixture rule, and the three alarms the header describes — all
 * with a real `rule_id`, so `alarms_open_per_rule_uidx` sees exactly one
 * uncleared row per `(asset, rule)` and the H2 invariant in
 * `tests/f3.10-alarm-lifecycle-schema.integration.test.ts` is not even
 * transiently false.
 */
async function insertFixture(client: pg.PoolClient, run: string): Promise<Fixture> {
  const db = createDb(client as unknown as pg.Pool);
  const { organizationId } = await fixtureLocation(db);
  // `type`, `latitude` and `longitude` are NOT NULL with no default; `csmoc`
  // reuses an existing vocabulary value (`metric-catalog.integration.test.ts`).
  const location = await client.query<{ id: string }>(
    `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
     VALUES ($1, $2, $3, $4, 'csmoc', 0, 0) RETURNING id`,
    [organizationId, `F310D-${run}`, `f310d-${run}`, `F3.10 dashboard fixture ${run}`],
  );
  const locationId = location.rows[0]?.id as string;
  const [assetId] = await createFixtureAssets(db, 1, "F310D", { locationId, organizationId });
  if (!assetId) throw new Error("F3.10: no fixture asset");

  const rule = await client.query<{ id: string }>(
    `INSERT INTO bms.automation_rules (organization_id, code, name, rule_type, asset_id, enabled)
     VALUES ($1, $2, $3, 'threshold', $4, false) RETURNING id`,
    [organizationId, `F310D_${run}`, `F3.10 dashboard fixture rule ${run}`, assetId],
  );
  const ruleId = rule.rows[0]?.id as string;

  await client.query(
    `INSERT INTO bms.alarms
       (organization_id, asset_id, rule_id, severity, message, raised_at, acknowledged_at, cleared_at)
     VALUES ($1, $2, $3, 'critical', $4, now(), now(), NULL),
            ($1, $2, $3, 'warning',  $5, now(), NULL,  now()),
            ($1, $2, $3, 'warning',  $6, now(), NULL,  now())`,
    [
      organizationId,
      assetId,
      ruleId,
      `F3.10 acknowledged, uncleared ${run}`,
      `F3.10 cleared, unacknowledged A ${run}`,
      `F3.10 cleared, unacknowledged B ${run}`,
    ],
  );
  return { organizationId, locationId, assetId };
}

/** `kpis` and `locationKpis` count the acknowledged-uncleared alarm and exclude the cleared-unacknowledged ones. */
export async function assertOpenAlarmCountsFollowClearedAt(pool: pg.Pool): Promise<void> {
  await withRolledBackClient(pool, async (client) => {
    const run = randomUUID().slice(0, 8);
    const { locationId, assetId } = await insertFixture(client, run);
    const service = new DashboardService(client as unknown as pg.Pool);

    const kpis = await service.kpis([assetId]);
    expect(
      kpis.alarmsOpen,
      "kpis.alarmsOpen: an acknowledged, uncleared alarm is still open (ADR 0057 decision 1) — " +
        "2 here means the count follows acknowledged_at and counts the two cleared rows instead",
    ).toBe(1);
    expect(
      kpis.alarmsCritical,
      "kpis.alarmsCritical: the acknowledged critical alarm counts; 0 means acknowledgement closed it",
    ).toBe(1);

    const { items } = await service.locationKpis({ locationIds: [locationId], assetIds: [assetId] });
    expect(items, "one KPI card for the fixture location").toHaveLength(1);
    expect(
      items[0]?.openAlarms,
      "locationKpis.openAlarms: the same predicate as kpis — 1 open, not the 2 cleared rows",
    ).toBe(1);
    expect(
      items[0]?.criticalAlarms,
      "locationKpis.criticalAlarms: the acknowledged critical alarm counts",
    ).toBe(1);
  });
}
