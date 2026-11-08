import { expect } from "vitest";
import type pg from "pg";

import type { OnboardingCommitResponseDto } from "@bms/shared";

/**
 * `F4.339` (ADR 0117 decisions 10 and 11) — what the commit writes for a
 * draft location's timezone and a mapping's unit.
 *
 * Assertions live here (ADR 0014); the sibling `.test.ts` owns the database
 * lifecycle. Each committed row is read back on the owner pool, so the case
 * measures the row the commit wrote, not the value it returned.
 */
export type TimezoneUnitCtx = {
  ownerPool: pg.Pool;
  /** The draft that carries `location.timezone`. */
  field?: OnboardingCommitResponseDto;
  /** The draft that carries only `meta.timezone`. */
  meta?: OnboardingCommitResponseDto;
  /** The draft that carries neither. */
  none?: OnboardingCommitResponseDto;
};

async function timezoneOf(ctx: TimezoneUnitCtx, committed: OnboardingCommitResponseDto | undefined, label: string): Promise<string | null> {
  if (!committed) {
    throw new Error(`F4.339: the ${label} draft did not commit`);
  }
  const { rows } = await ctx.ownerPool.query<{ timezone: string | null }>("SELECT timezone FROM bms.locations WHERE id = $1", [
    committed.locationId,
  ]);
  expect(rows.length, `the ${label} location id resolves to a row`).toBe(1);
  return rows[0]!.timezone;
}

/** TZ1 — `location.timezone` is written to `bms.locations.timezone`. */
export async function assertTheTimezoneFieldIsCommitted(ctx: TimezoneUnitCtx): Promise<void> {
  expect(await timezoneOf(ctx, ctx.field, "field")).toBe("Asia/Kolkata");
}

/** TZ2 — a draft from before the field, with a valid `meta.timezone`, commits the same. */
export async function assertAMetaTimezoneIsCommitted(ctx: TimezoneUnitCtx): Promise<void> {
  expect(await timezoneOf(ctx, ctx.meta, "meta")).toBe("Asia/Kolkata");
}

/** TZ3 — neither → NULL. */
export async function assertNoTimezoneCommitsNull(ctx: TimezoneUnitCtx): Promise<void> {
  expect(await timezoneOf(ctx, ctx.none, "none")).toBeNull();
}
