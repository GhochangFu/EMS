import { expect } from "vitest";
import type pg from "pg";

import type { OnboardingCommitResponseDto } from "@bms/shared";

/**
 * `F4.170` owner ruling 20 — the onboarding commit never writes
 * `meta.seedKey` from a draft. The draft's `location.meta` is operator text
 * (typed in chat or read from a sheet), and a key there would forge the
 * seed's identity for a canonical location, as a location POST could.
 *
 * Assertions live here (ADR 0014); the sibling `.test.ts` owns the database
 * lifecycle. The committed location is read back as `bms_fleet`, so the case
 * measures the row the commit wrote, not the value it returned.
 */
export type OnboardingSeedKeyCtx = {
  ownerPool: pg.Pool;
  committed?: OnboardingCommitResponseDto;
};

/** OK1 — the committed location carries no `seedKey`, and keeps the draft's other meta key. */
export async function assertCommittedLocationHasNoSeedKey(ctx: OnboardingSeedKeyCtx): Promise<void> {
  const committed = ctx.committed;
  if (!committed) {
    throw new Error("F4.170: the seed-key draft did not commit");
  }
  const { rows } = await ctx.ownerPool.query<{ meta: Record<string, unknown> | null }>(
    "SELECT meta FROM bms.locations WHERE id = $1",
    [committed.locationId],
  );
  expect(rows.length, "the committed location id resolves to a row").toBe(1);
  expect(rows[0]?.meta, "no key; the other key is kept").toEqual({ note: "kept" });
}
