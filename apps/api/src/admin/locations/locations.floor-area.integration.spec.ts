import { expect } from "vitest";
import type pg from "pg";

import { adminLocationDtoSchema } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import { createLocationBodySchema, updateLocationBodySchema } from "./locations.schema";
import type { LocationsAdminService } from "./locations.service";

/**
 * `F4.304` (ADR 0108 Amendment 5 item 4) — `bms.locations.floor_area_m2` on the
 * location admin write path, against the real database. The body is parsed with
 * the schema first (`unit` carries a `.default()`, so the parsed body always
 * has it). Read-backs run as `bms_fleet`: the table is FORCE-RLS.
 *
 * Assertions live here; `locations.floor-area.integration.test.ts` owns the
 * pools, the service and the `afterAll` delete (ADR 0014). One claim per `it()`.
 */
export type FloorAreaCtx = {
  svc: LocationsAdminService;
  fleetPool: pg.Pool;
  organizationId: string;
  jwt: JwtPayload;
  /** Called the moment a row exists — never on the return value. */
  register: (id: string) => void;
  family: string;
};

function base(ctx: FloorAreaCtx, suffix: string) {
  return {
    organizationId: ctx.organizationId,
    code: `${ctx.family}-${suffix}`,
    slug: `${ctx.family.toLowerCase()}-${suffix.toLowerCase()}`,
    name: `F4.304 floor area ${suffix}`,
    type: "rsmoc" as const,
    latitude: 0,
    longitude: 0,
  };
}

async function createWith(ctx: FloorAreaCtx, suffix: string, extra: Record<string, unknown>) {
  const created = await ctx.svc.create(
    ctx.jwt,
    createLocationBodySchema.parse({ ...base(ctx, suffix), ...extra }),
  );
  ctx.register(created.id);
  return created;
}

async function storedText(ctx: FloorAreaCtx, id: string): Promise<string | null | undefined> {
  const { rows } = await ctx.fleetPool.query<{ t: string | null }>(
    "SELECT floor_area_m2::text AS t FROM bms.locations WHERE id = $1",
    [id],
  );
  return rows[0]?.t;
}

/** A1 — 1000 ft² is stored as 92.90 m² and the DTO reads 92.9. */
export async function createConvertsSquareFeet(ctx: FloorAreaCtx): Promise<void> {
  const created = await createWith(ctx, "A1", { floorArea: { value: 1000, unit: "ft2" } });
  expect(created.floorAreaM2).toBe(92.9);
  expect(await storedText(ctx, created.id)).toBe("92.90");
}

/** A2 — a value in m² is stored as typed. */
export async function createStoresSquareMetres(ctx: FloorAreaCtx): Promise<void> {
  const created = await createWith(ctx, "A2", { floorArea: { value: 120 } });
  expect(created.floorAreaM2).toBe(120);
  expect(await storedText(ctx, created.id)).toBe("120.00");
}

/** A3 — no key on create → NULL and `null`. */
export async function createWithoutTheKeyStoresNull(ctx: FloorAreaCtx): Promise<void> {
  const created = await createWith(ctx, "A3", {});
  expect(created.floorAreaM2).toBeNull();
  expect(await storedText(ctx, created.id)).toBeNull();
}

/** A4 — update with `floorArea: null` clears a set area. */
export async function updateWithNullClears(ctx: FloorAreaCtx): Promise<void> {
  const created = await createWith(ctx, "A4", { floorArea: { value: 120 } });
  expect(await storedText(ctx, created.id), "positive control: the area is set").toBe("120.00");
  const updated = await ctx.svc.update(
    ctx.jwt,
    created.id,
    updateLocationBodySchema.parse({ floorArea: null }),
  );
  expect(updated.floorAreaM2).toBeNull();
  expect(await storedText(ctx, created.id)).toBeNull();
}

/** A5 — update without the key keeps the stored area. */
export async function updateWithoutTheKeyKeeps(ctx: FloorAreaCtx): Promise<void> {
  const created = await createWith(ctx, "A5", { floorArea: { value: 1000, unit: "ft2" } });
  expect(await storedText(ctx, created.id), "positive control: the area is set").toBe("92.90");
  const updated = await ctx.svc.update(
    ctx.jwt,
    created.id,
    updateLocationBodySchema.parse({ name: "F4.304 A5 renamed" }),
  );
  expect(updated.name).toBe("F4.304 A5 renamed");
  expect(updated.floorAreaM2).toBe(92.9);
  expect(await storedText(ctx, created.id)).toBe("92.90");
}

/** A6 — update with a new value replaces it. */
export async function updateReplaces(ctx: FloorAreaCtx): Promise<void> {
  const created = await createWith(ctx, "A6", { floorArea: { value: 120 } });
  const updated = await ctx.svc.update(
    ctx.jwt,
    created.id,
    updateLocationBodySchema.parse({ floorArea: { value: 1, unit: "m2" } }),
  );
  expect(updated.floorAreaM2).toBe(1);
  expect(await storedText(ctx, created.id)).toBe("1.00");
}

/** A7 — the DTO parses with the shared contract with and without an area. */
export async function dtoParsesWithAndWithoutAnArea(ctx: FloorAreaCtx): Promise<void> {
  const withArea = await createWith(ctx, "A7A", { floorArea: { value: 120 } });
  const without = await createWith(ctx, "A7B", {});
  for (const dto of [withArea, without]) {
    const parsed = adminLocationDtoSchema.safeParse(dto);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  }
}

/** A8 — the create audit payload carries the body as sent, value and unit. */
export async function createAuditCarriesTheBody(ctx: FloorAreaCtx): Promise<void> {
  const created = await createWith(ctx, "A8", { floorArea: { value: 1000, unit: "ft2" } });
  const { rows } = await ctx.fleetPool.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM bms.audit_log WHERE action = 'master.location.create' AND entity_id = $1`,
    [created.id],
  );
  expect(rows.length).toBe(1);
  expect(rows[0]?.payload.floorArea).toEqual({ value: 1000, unit: "ft2" });
}
