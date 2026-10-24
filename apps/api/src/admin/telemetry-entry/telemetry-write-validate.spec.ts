import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import type { JwtPayload, TelemetryEntryRow } from "@bms/shared";

import { TelemetryWriteService } from "./telemetry-write.service";

/**
 * `F4.283` (ADR 0099 Amendment 8) — `validateRows` is the read-only half of
 * `writeReadings`, and the copilot's proposal check runs it. This gates the
 * seam over fakes: `writeReadings` inserts exactly the rows `validateRows`
 * accepted (point it back at its own loop and the rejected row reaches the
 * insert). The write path itself is `telemetry-write.spec.ts`, against Postgres.
 * Vitest entry point: the sibling `.test.ts`.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const ASSET = "22222222-2222-4222-8222-222222222222";
const USER: JwtPayload = { sub: "u1", email: "a@bms.local", name: "A", role: "admin" };
const KEPT: TelemetryEntryRow = { assetId: ASSET, pointKey: "kw", value: 1, time: new Date().toISOString() };
const DROPPED: TelemetryEntryRow = { assetId: ASSET, pointKey: "kva", value: 2, time: new Date().toISOString() };

export async function writeReadingsInsertsExactlyTheAcceptedRows(): Promise<void> {
  const inserted: Array<{ pointKey: string }> = [];
  const tx = {
    insert: () => ({
      values: (values: Array<{ pointKey: string; time: Date; assetId: string }>) => {
        inserted.push(...values);
        const returned = values.map((v) => ({ time: v.time, assetId: v.assetId, pointKey: v.pointKey }));
        return { onConflictDoNothing: () => ({ returning: async () => returned }) };
      },
    }),
    execute: async () => undefined,
  };
  const db = { transaction: async (run: (t: typeof tx) => Promise<unknown>) => run(tx) } as unknown as BmsDb;
  const audit = { write: async () => undefined };
  const pool = { query: async () => ({ rows: [] }) };
  const service = new TelemetryWriteService(db, {} as BmsDb, pool as never, {} as never, audit as never);
  service.validateRows = async () => ({
    accepted: [{ rowNumber: 1, row: KEPT, unit: "kW", mappingNeeded: false, organizationId: ORG }],
    rejected: [{ rowNumber: 2, field: "pointKey", reason: "Unknown point key" }],
  });
  const out = await service.writeReadings(USER, {
    rows: [KEPT, DROPPED],
    sourceKind: "manual",
    conflictPolicy: "reject",
    auditAction: "telemetry.manual_entry",
  });
  expect({ inserted: inserted.map((v) => v.pointKey), written: out.result.written, rejected: out.rejected.map((r) => r.rowNumber) }).toEqual({
    inserted: ["kw"],
    written: 1,
    rejected: [2],
  });
}
