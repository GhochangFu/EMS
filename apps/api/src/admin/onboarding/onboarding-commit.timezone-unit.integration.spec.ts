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
  /** The seeded catalog key the "field" and "meta" drafts map (decision 11). */
  catalogKey?: { code: string; unit: string; domain: string };
};

async function unitsOf(ctx: TimezoneUnitCtx, committed: OnboardingCommitResponseDto | undefined, label: string): Promise<Map<string, string | null>> {
  if (!committed) {
    throw new Error(`F4.339: the ${label} draft did not commit`);
  }
  const { rows } = await ctx.ownerPool.query<{ point_key: string; unit: string | null }>(
    "SELECT point_key, unit FROM bms.asset_points WHERE id = ANY($1)",
    [committed.assetPointIds],
  );
  return new Map(rows.map((row) => [row.point_key, row.unit]));
}

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

/** U1 (decision 11) — a mapping with no unit to a catalog key commits the catalog's unit. */
export async function assertACatalogMappingTakesTheCatalogUnit(ctx: TimezoneUnitCtx): Promise<void> {
  const key = ctx.catalogKey;
  if (!key) throw new Error("F4.339: no catalog key was read");
  expect((await unitsOf(ctx, ctx.field, "field")).get(key.code)).toBe(key.unit);
}

/** U2 — a mapping's own unit is kept. */
export async function assertAMappingKeepsItsOwnUnit(ctx: TimezoneUnitCtx): Promise<void> {
  const key = ctx.catalogKey;
  if (!key) throw new Error("F4.339: no catalog key was read");
  expect((await unitsOf(ctx, ctx.meta, "meta")).get(key.code)).toBe("m3/h");
}

/** U3 — a declared new key's unit is used for its mapping with none. */
export async function assertADeclaredKeyUnitWins(ctx: TimezoneUnitCtx): Promise<void> {
  const units = await unitsOf(ctx, ctx.none, "none");
  expect([...units.values()]).toEqual(["kW"]);
}
