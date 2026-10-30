import { expect } from "vitest";

import type { BmsDb } from "@bms/db";

import { findRuleBatch } from "./copilot-rule-targets";

/**
 * `F4.289` (ADR 0099 Amendment 9 E3) — the `ruleBatch` target's shape checks,
 * which refuse a body before any read. The database fake counts every
 * transaction it is asked to open and answers one asset row per call, so a
 * refusal that read anyway shows as a non-zero count, and each refusal sits
 * beside the accepted twin that does read. The organization reads themselves
 * are `copilot-rule-targets.integration.spec.ts`. Vitest entry point: the
 * sibling `.test.ts` (ADR 0014).
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const ASSET = "33333333-3333-4333-8333-333333333333";

function countingDb(): { db: BmsDb; reads: () => number } {
  let reads = 0;
  const tx = {
    execute: async () => undefined,
    select: () => {
      const chain = { from: () => chain, where: () => Promise.resolve([{ id: ASSET }]) };
      return chain;
    },
  };
  const db = {
    transaction: async (fn: (t: unknown) => Promise<unknown>) => {
      reads += 1;
      return fn(tx);
    },
  };
  return { db: db as unknown as BmsDb, reads: () => reads };
}

const rows = (n: number) => Array.from({ length: n }, () => ({ assetId: ASSET }));

/** A twenty-sixth row is refused before any read; twenty-five rows are read. */
export async function aTwentySixthRowIsRefusedBeforeAnyRead(): Promise<void> {
  const refused = countingDb();
  expect(await findRuleBatch(refused.db, rows(26), [ORG])).toBeNull();
  expect(refused.reads()).toBe(0);
}

/** The accepted twin: twenty-five rows on one asset are read and resolve to the organization. */
export async function twentyFiveRowsAreRead(): Promise<void> {
  const accepted = countingDb();
  expect(await findRuleBatch(accepted.db, rows(25), [ORG])).toEqual({ organizationId: ORG, assetIds: [ASSET] });
  expect(accepted.reads()).toBe(1);
}

/** A row that is not an object, or one without a string `assetId`, is refused before any read. */
export async function aNonObjectRowIsRefused(): Promise<void> {
  for (const body of [["x"], [{ assetId: ASSET }, null], [{ assetId: 7 }], [], "rules"]) {
    const db = countingDb();
    expect(await findRuleBatch(db.db, body, [ORG]), JSON.stringify(body)).toBeNull();
    expect(db.reads(), JSON.stringify(body)).toBe(0);
  }
}
