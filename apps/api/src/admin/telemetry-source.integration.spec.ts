import { expect } from "vitest";

import { rtuConnectionConfigs, rtus } from "@bms/db";
import type { BmsDb } from "@bms/db";

import type { BmsTx } from "../database/tenant-context";
import { withRollback } from "../testing/with-rollback";
import { resolveTelemetrySource } from "./telemetry-source";

/**
 * `F4.139` — `resolveTelemetrySource`, the `F4.59` predicate, case by case.
 *
 * Integration rather than unit: the second disjunct is a real read of
 * `bms.rtu_connection_configs` on the caller's transaction, and a fake `tx`
 * would assert the query this file happens to build rather than the row that
 * comes back. Each case builds its own RTU inside its own `withRollback`, so no
 * case can pass on a fixture another case's shape provided — a single shared
 * RTU carrying a connection-config row would, for instance, keep `P3` green
 * under the `!== "catalog"` mutation it exists to kill.
 *
 * Every case ends in `tx.rollback()`. A body that simply returns **commits**,
 * and its fixture becomes permanent — the `F3.60` defect that left 298 rows in
 * the shared development database. `tests/f3.60-withrollback-cases-roll-back.test.ts`
 * gates it mechanically.
 */
export type PredicateCtx = {
  /** `bms_fleet` (BYPASSRLS, migration 0039) — fixture inserts and the read alike. */
  readonly fleetDb: BmsDb;
  readonly organizationId: string;
  readonly locationId: string;
};

let fixtureSeq = 0;

/**
 * One RTU, inserted inside the caller's rolled-back transaction.
 *
 * `f4-139-pred-` codes: this database is shared with other suites and other
 * worktrees, so a row that escapes the rollback names its author. The returned
 * shape is exactly the argument `resolveTelemetrySource` takes.
 */
async function insertRtu(
  tx: BmsTx,
  ctx: PredicateCtx,
  declared: { sourceType: string; ingestEnabled: boolean },
): Promise<{ id: string; ingestEnabled: boolean; sourceType: string }> {
  const tag = `f4-139-pred-${Date.now()}-${fixtureSeq++}`;
  const [row] = await tx
    .insert(rtus)
    .values({
      organizationId: ctx.organizationId,
      locationId: ctx.locationId,
      code: tag,
      displayName: `F4.139 ${tag}`,
      sourceType: declared.sourceType,
      ingestEnabled: declared.ingestEnabled,
      active: true,
    })
    .returning({ id: rtus.id });
  return { id: row.id, ingestEnabled: declared.ingestEnabled, sourceType: declared.sourceType };
}

async function insertConnectionConfig(
  tx: BmsTx,
  ctx: PredicateCtx,
  rtuId: string,
): Promise<void> {
  await tx.insert(rtuConnectionConfigs).values({
    organizationId: ctx.organizationId,
    rtuId,
    protocol: "mqtt",
    config: {},
  });
}

/** P1 — an enabled RTU that declares `mqtt` hands its assets over. Kills a constant `"catalog"`. */
export async function assertAnEnabledMqttRtuResolvesToMqtt(ctx: PredicateCtx): Promise<void> {
  await withRollback(ctx.fleetDb, async (tx) => {
    const rtu = await insertRtu(tx, ctx, { sourceType: "mqtt", ingestEnabled: true });
    expect(await resolveTelemetrySource(tx, rtu)).toBe("mqtt");
    tx.rollback();
  });
}

/**
 * P2 — an enabled `catalog` RTU with no connection config stays on `catalog`.
 *
 * Kills a constant `"mqtt"`, and it is the "alive beats dead" case: nothing can
 * bind this RTU, so its assets stay with the simulator.
 */
export async function assertAnEnabledCatalogRtuWithNoConfigResolvesToCatalog(
  ctx: PredicateCtx,
): Promise<void> {
  await withRollback(ctx.fleetDb, async (tx) => {
    const rtu = await insertRtu(tx, ctx, { sourceType: "catalog", ingestEnabled: true });
    expect(await resolveTelemetrySource(tx, rtu)).toBe("catalog");
    tx.rollback();
  });
}

/**
 * P3 — an enabled `simulator` RTU stays on `catalog`. **No connection config.**
 *
 * The `F4.59` first-draft defect: a predicate written as
 * `declaredSource !== "catalog"` handed every `simulator` RTU's assets to a
 * host that will never bind them. This is the case that reddens under it, and
 * it only does so while this fixture has no config row of its own.
 */
export async function assertAnEnabledSimulatorRtuResolvesToCatalog(
  ctx: PredicateCtx,
): Promise<void> {
  await withRollback(ctx.fleetDb, async (tx) => {
    const rtu = await insertRtu(tx, ctx, { sourceType: "simulator", ingestEnabled: true });
    expect(await resolveTelemetrySource(tx, rtu)).toBe("catalog");
    tx.rollback();
  });
}

/**
 * P4 — a connection config for **this** RTU carries the second disjunct.
 *
 * Kills deleting that disjunct. The row is inserted in the same uncommitted
 * transaction as the read, which is the onboarding shape: a `fleetDb` read
 * instead of `tx` would not see it.
 */
export async function assertAConnectionConfigForThisRtuResolvesToMqtt(
  ctx: PredicateCtx,
): Promise<void> {
  await withRollback(ctx.fleetDb, async (tx) => {
    const rtu = await insertRtu(tx, ctx, { sourceType: "catalog", ingestEnabled: true });
    await insertConnectionConfig(tx, ctx, rtu.id);
    expect(await resolveTelemetrySource(tx, rtu)).toBe("mqtt");
    tx.rollback();
  });
}

/**
 * P5 — a disabled `mqtt` RTU resolves to `catalog`.
 *
 * Kills deleting `ingestEnabled &&`. The disable direction is unconditional: no
 * declared protocol and no config row can override an operator's switch.
 */
export async function assertADisabledMqttRtuResolvesToCatalog(ctx: PredicateCtx): Promise<void> {
  await withRollback(ctx.fleetDb, async (tx) => {
    const rtu = await insertRtu(tx, ctx, { sourceType: "mqtt", ingestEnabled: false });
    expect(await resolveTelemetrySource(tx, rtu)).toBe("catalog");
    tx.rollback();
  });
}

/**
 * P6 — another RTU's connection config does not count.
 *
 * Kills dropping `where(eq(rtuConnectionConfigs.rtuId, id))` from the config
 * read: without it the very first config row in the table answers for every
 * RTU, and the whole fleet moves to `mqtt` the moment one RTU is configured.
 * The positive control is P4 — the same fixture with the config row on the
 * subject RTU is `mqtt`, so this `catalog` is an absence the read can observe.
 */
export async function assertAnotherRtusConnectionConfigDoesNotCount(
  ctx: PredicateCtx,
): Promise<void> {
  await withRollback(ctx.fleetDb, async (tx) => {
    const subject = await insertRtu(tx, ctx, { sourceType: "catalog", ingestEnabled: true });
    const neighbour = await insertRtu(tx, ctx, { sourceType: "catalog", ingestEnabled: true });
    await insertConnectionConfig(tx, ctx, neighbour.id);
    expect(await resolveTelemetrySource(tx, subject)).toBe("catalog");
    tx.rollback();
  });
}
