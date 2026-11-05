import type pg from "pg";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";

import { MetricsService } from "../observability/metrics.service";
import { CalcWriteService, type CalcWriteInput } from "./calc-write.service";

/**
 * `F4.311` live check, 2026-11-05 — on an asset with no template the
 * `computed` row is the calculated point (ADR 0109 decision 1), so the write
 * path never creates one there. On AWS a standalone point deleted while the
 * engine's TTL cache still held it came back one tick later as an ACTIVE
 * orphan row with no formula, and the Add picker then hid its key.
 *
 * No database: `fleetDb` answers its two reads in order (the assets, then the
 * asset's `computed` rows) and records every insert; the value transaction
 * records the rows it is given. `calc-write.integration.spec.ts` holds the
 * same two claims against Postgres.
 */

const ROW: CalcWriteInput = {
  assetId: "asset-1",
  pointKey: "DERIVED",
  value: 4,
  time: new Date("2026-11-05T02:10:00.000Z"),
};

interface Outcome {
  readonly written: number;
  readonly created: number;
  readonly mappingInserts: number;
  readonly valuesSent: number;
}

async function writeOne(
  asset: { templateId: string | null },
  computedRows: { assetId: string; pointKey: string }[],
): Promise<Outcome> {
  const reads: unknown[][] = [[{ id: ROW.assetId, organizationId: "org-1", templateId: asset.templateId }], computedRows];
  let mappingInserts = 0;
  const fleetDb: Record<string, unknown> = {};
  for (const method of ["select", "from"]) {
    fleetDb[method] = () => fleetDb;
  }
  fleetDb.where = () => Promise.resolve(reads.shift() ?? []);
  fleetDb.insert = () => {
    mappingInserts += 1;
    const c = {
      values: () => c,
      onConflictDoNothing: () => c,
      returning: async () => [{ id: "created-row" }],
    };
    return c;
  };
  let valuesSent = 0;
  const tx = {
    insert: () => ({
      values: (rows: CalcWriteInput[]) => {
        valuesSent += rows.length;
        return {
          onConflictDoNothing: () => ({
            returning: async () => rows.map((r) => ({ time: r.time, assetId: r.assetId, pointKey: r.pointKey })),
          }),
        };
      },
    }),
    execute: async () => undefined,
  };
  const db = { transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) };
  const pool = {
    connect: async () => {
      throw new Error("no database in this spec");
    },
    query: async () => {
      throw new Error("no database in this spec");
    },
  };
  const service = new CalcWriteService(
    db as unknown as BmsDb,
    fleetDb as unknown as BmsDb,
    pool as unknown as pg.Pool,
    new MetricsService(),
  );
  const { written, assetPointsCreated } = await service.writeValues([ROW]);
  return { written, created: assetPointsCreated, mappingInserts, valuesSent };
}

/** A template-less asset with no `computed` row for the key: no row is created, and the value is dropped. */
export async function aDeletedStandalonePointIsNotRecreated(): Promise<void> {
  const out = await writeOne({ templateId: null }, []);
  expect(out.mappingInserts, "no asset_points insert on a template-less asset").toBe(0);
  expect(out.created).toBe(0);
  expect(out.valuesSent, "the deleted point's value is not written").toBe(0);
  expect(out.written).toBe(0);
}

/** A template-less asset whose `computed` row exists gets its value, and still no insert. */
export async function anExistingStandalonePointGetsItsValue(): Promise<void> {
  const out = await writeOne({ templateId: null }, [{ assetId: ROW.assetId, pointKey: ROW.pointKey }]);
  expect(out.mappingInserts).toBe(0);
  expect(out.valuesSent).toBe(1);
  expect(out.written).toBe(1);
}

/** A templated asset keeps the lazy create: the template version declares the point. */
export async function aTemplatedAssetStillCreatesItsMapping(): Promise<void> {
  const out = await writeOne({ templateId: "template-1" }, []);
  expect(out.mappingInserts, "the lazy create stays for a templated asset").toBe(1);
  expect(out.created).toBe(1);
  expect(out.written).toBe(1);
}
