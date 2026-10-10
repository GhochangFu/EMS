import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { type ResolvedIdentity, rememberIdentity } from "../auth/identity-resolver";
import { copilotContext } from "../copilot/copilot-request-context";
import { type AuditInput, MasterDataAuditService } from "./master-data-audit.service";

/**
 * `F3.85` PR 4 / ADR 0099 decision 4.5, drafter choice 4 — the copilot mark on
 * audit rows. Inside a request that applies a confirmed copilot change, every
 * row `MasterDataAuditService` writes carries `via: "copilot"` and the change's
 * id; outside one, the payload is written exactly as given. Vitest entry
 * point: the sibling `.test.ts` (ADR 0014).
 *
 * The actor is memoised with `rememberIdentity`, which `resolveActorId` reads
 * before any query, so the fleet database is never touched.
 */
const CHANGE_ID = "11111111-1111-4111-8111-111111111111";

function harness(): { service: MasterDataAuditService; rows: Array<Record<string, unknown>>; executor: BmsDb } {
  const rows: Array<Record<string, unknown>> = [];
  const executor = {
    insert: () => ({
      values: async (value: Record<string, unknown> | Array<Record<string, unknown>>) => {
        rows.push(...(Array.isArray(value) ? value : [value]));
      },
    }),
  } as unknown as BmsDb;
  const fleet = {} as BmsDb;
  return { service: new MasterDataAuditService(executor, fleet), rows, executor };
}

function input(payload?: Record<string, unknown>): AuditInput {
  const actor = { sub: "22222222-2222-4222-8222-222222222222", email: "admin@bms.local" } as JwtPayload;
  rememberIdentity(actor, { id: actor.sub } as ResolvedIdentity);
  return { actor, action: "dashboard.create", entityType: "dashboard", entityId: null, organizationId: null, payload };
}

const asCopilot = <T>(fn: () => Promise<T>): Promise<T> =>
  copilotContext.run({ change: { via: "copilot", changeId: CHANGE_ID } }, fn);

export async function writeMarksARowInsideACopilotChange(): Promise<void> {
  const { service, rows, executor } = harness();
  await asCopilot(() => service.write(input({ slug: "ops" }), executor));
  expect(rows).toHaveLength(1);
  expect(rows[0]?.payload).toEqual({ slug: "ops", via: "copilot", changeId: CHANGE_ID });
}

export async function writeMarksANullPayloadToo(): Promise<void> {
  const { service, rows, executor } = harness();
  await asCopilot(() => service.write(input(undefined), executor));
  expect(rows[0]?.payload).toEqual({ via: "copilot", changeId: CHANGE_ID });
}

/** Outside a copilot change the payload is untouched: an object stays equal, an absent one stays `null`. */
export async function writeLeavesTheRowAloneOutsideACopilotChange(): Promise<void> {
  const { service, rows, executor } = harness();
  await copilotContext.run({ change: null }, async () => {
    await service.write(input({ slug: "ops" }), executor);
    await service.write(input(undefined), executor);
  });
  // And with no store at all (a worker, a seed).
  await service.write(input({ slug: "plain" }), executor);
  expect(rows.map((row) => row.payload)).toEqual([{ slug: "ops" }, null, { slug: "plain" }]);
}

export async function writeManyMarksEveryRow(): Promise<void> {
  const { service, rows, executor } = harness();
  await asCopilot(() => service.writeMany([input({ n: 1 }), input({ n: 2 })], executor));
  expect(rows.map((row) => row.payload)).toEqual([
    { n: 1, via: "copilot", changeId: CHANGE_ID },
    { n: 2, via: "copilot", changeId: CHANGE_ID },
  ]);
}

export async function writeManyLeavesRowsAloneOutsideACopilotChange(): Promise<void> {
  const { service, rows, executor } = harness();
  await service.writeMany([input({ n: 1 }), input(undefined)], executor);
  expect(rows.map((row) => row.payload)).toEqual([{ n: 1 }, null]);
}
