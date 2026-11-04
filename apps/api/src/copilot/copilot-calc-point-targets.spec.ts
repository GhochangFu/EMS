import { expect } from "vitest";

import type { BmsDb } from "@bms/db";

import { assetKindAdmits, findCalcPointBatch } from "./copilot-calc-point-targets";

/**
 * `F4.311` PR 3 (ADR 0099 Amendment 11 G2, G3) — the calc-point targets'
 * checks that need no database. The fake counts every transaction it is asked
 * to open and answers every read with the asked assets, so a refusal that read
 * anyway shows as a non-zero count, beside the accepted twin that does read.
 * The organization and template reads are
 * `copilot-calc-point-targets.integration.spec.ts`. Vitest entry point: the
 * sibling `.test.ts` (ADR 0014).
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const ids = (n: number) => Array.from({ length: n }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);

function countingDb(found: readonly string[]): { db: BmsDb; reads: () => number } {
  let reads = 0;
  let call = 0;
  const tx = {
    execute: async () => undefined,
    select: () => {
      const chain = {
        from: () => chain,
        // The asset read first, then the points: each asset has the one key `kw`.
        where: () => Promise.resolve(call++ === 0 ? found.map((id) => ({ id })) : found.map((id) => ({ assetId: id, pointKey: "kw" }))),
      };
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

/** A twenty-sixth asset is refused before any read. */
export async function aTwentySixthAssetIsRefusedBeforeAnyRead(): Promise<void> {
  const refused = countingDb(ids(26));
  expect(await findCalcPointBatch(refused.db, ids(26), [ORG])).toBeNull();
  expect(refused.reads()).toBe(0);
}

/** The accepted twin: twenty-five assets are read and resolve to the organization and their shared key. */
export async function twentyFiveAssetsAreRead(): Promise<void> {
  const accepted = countingDb(ids(25));
  expect(await findCalcPointBatch(accepted.db, ids(25), [ORG])).toEqual({ organizationId: ORG, assetIds: ids(25), pointKeys: ["kw"] });
  expect(accepted.reads()).toBe(1);
}

/** An id listed twice is refused before any read: the route refuses a repeated id. */
export async function aRepeatedIdIsRefusedBeforeAnyRead(): Promise<void> {
  const [one] = ids(1) as [string];
  const db = countingDb([one]);
  expect(await findCalcPointBatch(db.db, [one, one], [ORG])).toBeNull();
  expect(db.reads()).toBe(0);
}

/** A list that is empty, not an array, or holds a non-string is refused before any read. */
export async function aMalformedListIsRefusedBeforeAnyRead(): Promise<void> {
  for (const body of [[], "ids", [7], [ids(1)[0], null]]) {
    const db = countingDb(ids(1));
    expect(await findCalcPointBatch(db.db, body, [ORG]), JSON.stringify(body)).toBeNull();
    expect(db.reads(), JSON.stringify(body)).toBe(0);
  }
}

/** G2: `pinned` admits only an asset with a template, `none` only one without; no `template` admits both. */
export function anAssetTargetAdmitsOnlyItsKind(): void {
  const pinned = { kind: "asset", param: "assetId", template: "pinned" } as const;
  const none = { kind: "asset", param: "assetId", template: "none" } as const;
  const any = { kind: "asset", param: "assetId" } as const;
  const TEMPLATE = "44444444-4444-4444-8444-444444444444";
  expect([assetKindAdmits(pinned, TEMPLATE), assetKindAdmits(pinned, null)]).toEqual([true, false]);
  expect([assetKindAdmits(none, TEMPLATE), assetKindAdmits(none, null)]).toEqual([false, true]);
  expect([assetKindAdmits(any, TEMPLATE), assetKindAdmits(any, null)]).toEqual([true, true]);
}
