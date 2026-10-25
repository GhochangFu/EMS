// `reflect-metadata` first, before `AlarmsService` is imported: its decorators
// read the polyfill at import time.
import "reflect-metadata";

import type { BmsDb } from "@bms/db";

import type { AuditInput, MasterDataAuditService } from "../admin/master-data-audit.service";

import type { AlarmsGateway } from "./alarms.gateway";
import { AlarmsService } from "./alarms.service";

/**
 * `F3.28` (ADR 0074 decision 4, plan decision 4) — the `limit` clamp in
 * `AlarmsService.list`, with no database. Assertions live here;
 * `alarms.service.test.ts` is the Vitest entry point (ADR 0014).
 *
 * The schema lets every numeric `limit` through, fractional and `Infinity`
 * included, as the old `Number(limitRaw)` did; the service owns the clamp. The
 * harness reads the value the service hands the query builder's `.limit()`,
 * which is the only place a fractional page size would reach SQL.
 *
 * `assetIds: null` is the unrestricted admin read, which `withReadScope`
 * routes straight to `fleetDb.transaction(fn)` — no org resolution, so the
 * fake transaction below is the whole database this touches.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Runs `list` with `limit` and answers the argument given to `.limit()`. */
async function sqlLimitFor(limit: number): Promise<number | undefined> {
  let seen: number | undefined;
  const base = {
    orderBy: () => ({
      limit: async (n: number) => {
        seen = n;
        return [];
      },
    }),
  };
  const tx = {
    select: () => ({ from: () => ({ innerJoin: () => base }) }),
  };
  const fleetDb = {
    transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as BmsDb;
  const service = new AlarmsService({} as BmsDb, fleetDb, {} as AlarmsGateway, {} as MasterDataAuditService);
  await service.list({ limit, assetIds: null });
  return seen;
}

/**
 * A fractional `limit` inside 1..100 reaches SQL as an integer: `50.5` asks
 * for 50 rows, so `.limit()` gets 51 (one extra to detect a next page).
 */
export async function assertAFractionalLimitReachesSqlAsAnInteger(): Promise<void> {
  const n = await sqlLimitFor(50.5);
  assert(n === 51, `limit=50.5 reached .limit() as ${String(n)}, not 51`);
}

/** `Infinity` clamps to 100, as the old `Number(limitRaw)` read did: `.limit(101)`. */
export async function assertAnInfiniteLimitClampsToOneHundred(): Promise<void> {
  const n = await sqlLimitFor(Number.POSITIVE_INFINITY);
  assert(n === 101, `limit=Infinity reached .limit() as ${String(n)}, not 101`);
}

/** `0.5` clamps up to 1, as before: `.limit(2)`. */
export async function assertASubOneFractionalLimitClampsToOne(): Promise<void> {
  const n = await sqlLimitFor(0.5);
  assert(n === 2, `limit=0.5 reached .limit() as ${String(n)}, not 2`);
}

/**
 * A query-builder stand-in: every chained call returns itself, and awaiting it answers `rows`.
 * `F4.284` uses it to drive `acknowledge` with no database.
 */
function chain(rows: unknown[]): unknown {
  const target = (): unknown => proxy;
  const proxy: unknown = new Proxy(target, {
    get: (_t, key) => (key === "then" ? (resolve: (v: unknown) => void) => resolve(rows) : () => proxy),
    apply: () => proxy,
  });
  return proxy;
}

/**
 * `F4.284` (ADR 0106 decision 7): `acknowledge` audits through `MasterDataAuditService.write`, in the
 * write's own transaction, with the action, reason and payload keys it wrote before. The read-back
 * answers no row, so the call ends in "vanished" — after the audit write, which is what is asserted.
 */
export async function assertAcknowledgeAuditsThroughTheFunnel(): Promise<void> {
  const calls: Array<{ input: AuditInput; executor: unknown }> = [];
  const audit = { write: async (input: AuditInput, executor: unknown) => void calls.push({ input, executor }) };
  const tx = {
    execute: async () => undefined,
    update: () => chain([{ id: "alarm-1" }]),
    select: () => chain([]),
  };
  const db = { transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) } as unknown as BmsDb;
  const fleetDb = { select: () => chain([{ organizationId: "org-1" }]) } as unknown as BmsDb;
  const service = new AlarmsService(db, fleetDb, {} as AlarmsGateway, audit as unknown as MasterDataAuditService);
  const actor = { sub: "sub-1", email: "a@b.c" };
  await service.acknowledge("alarm-1", actor, "Panel checked", null).catch(() => undefined);
  assert(calls.length === 1, `audit.write ran ${calls.length} times, not once`);
  const [call] = calls;
  assert(call?.executor === tx, "audit.write did not run in the acknowledge transaction");
  assert(
    JSON.stringify({ ...call.input }) ===
      JSON.stringify({
        actor,
        organizationId: "org-1",
        action: "alarm_ack",
        entityType: "alarm",
        entityId: "alarm-1",
        reason: "Panel checked",
        payload: { alarmId: "alarm-1", oidcSubject: "sub-1", actorEmail: "a@b.c" },
      }),
    `audit.write got ${JSON.stringify(call.input)}`,
  );
}
