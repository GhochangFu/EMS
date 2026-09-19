import { BadRequestException } from "@nestjs/common";
import { expect } from "vitest";
import type pg from "pg";

import { adminLocationDtoSchema } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import type { LocationsAdminService } from "./locations.service";

/**
 * `E4.1b` / ADR 0070 decision 6 — `bms.locations.timezone` on the location
 * admin write path, against the real database (the zone list is
 * `pg_timezone_names`, a view only Postgres can answer for).
 *
 * Assertions live here; `locations.timezone.integration.test.ts` owns the
 * pools, the service and the `afterAll` delete (ADR 0014). One exported
 * function per claim (T1–T7), one `it()` each in the wrapper.
 *
 * **Read-backs and counts run as `bms_fleet`** (`requireIntegrationDb`'s
 * default): `bms.locations` is FORCE-RLS, so an owner-role read returns 0 rows
 * with the row present and would redden T1/T4 for a reason unrelated to the
 * code under test.
 *
 * T2's "no row inserted" is a count over this suite's code family, and T1 is
 * its positive control: a valid create moves the same count by one, so a
 * count that never moves cannot pass T2 vacuously.
 */
export type TimezoneCtx = {
  svc: LocationsAdminService;
  fleetPool: pg.Pool;
  organizationId: string;
  jwt: JwtPayload;
  /** Called the moment a row exists — never on the return value (F4.16's lesson). */
  register: (id: string) => void;
  /** Per-run code family; every row this suite writes carries it. */
  family: string;
};

const NOT_A_ZONE = "Not/AZone";
const LOWERCASE_ZONE = "asia/kolkata";

function body(ctx: TimezoneCtx, suffix: string) {
  return {
    organizationId: ctx.organizationId,
    code: `${ctx.family}-${suffix}`,
    slug: `${ctx.family.toLowerCase()}-${suffix.toLowerCase()}`,
    name: `E4.1b timezone ${suffix}`,
    type: "rsmoc" as const,
    latitude: 0,
    longitude: 0,
  };
}

async function countFamily(ctx: TimezoneCtx): Promise<number> {
  const { rows } = await ctx.fleetPool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM bms.locations WHERE code LIKE $1",
    [`${ctx.family}-%`],
  );
  return rows[0]?.n ?? -1;
}

async function readTimezone(ctx: TimezoneCtx, id: string): Promise<string | null | undefined> {
  const { rows } = await ctx.fleetPool.query<{ timezone: string | null }>(
    "SELECT timezone FROM bms.locations WHERE id = $1",
    [id],
  );
  return rows[0]?.timezone;
}

/** T1 — create with `Asia/Kolkata`: the DTO and the row carry it; the family count moves by one. */
export async function createStoresAKnownZone(ctx: TimezoneCtx): Promise<string> {
  const before = await countFamily(ctx);
  const created = await ctx.svc.create(ctx.jwt, { ...body(ctx, "T1"), timezone: "Asia/Kolkata" });
  ctx.register(created.id);
  expect(created.timezone).toBe("Asia/Kolkata");
  expect(await readTimezone(ctx, created.id)).toBe("Asia/Kolkata");
  expect(await countFamily(ctx), "positive control for T2's count: a valid create moves it").toBe(
    before + 1,
  );
  return created.id;
}

/** T2 — an unknown zone is a 400 naming the example and the value, and no row is inserted. */
export async function createRefusesAnUnknownZoneAndWritesNothing(ctx: TimezoneCtx): Promise<void> {
  const before = await countFamily(ctx);
  let caught: unknown;
  try {
    const created = await ctx.svc.create(ctx.jwt, { ...body(ctx, "T2"), timezone: NOT_A_ZONE });
    ctx.register(created.id);
  } catch (err) {
    caught = err;
  }
  expect(caught, "an unknown zone must throw").toBeInstanceOf(BadRequestException);
  const message = (caught as BadRequestException).message;
  expect(message).toContain("Asia/Kolkata");
  expect(message).toContain(`"${NOT_A_ZONE}"`);
  expect(await countFamily(ctx), "the refusal happens before the write: no row inserted").toBe(before);
}

/** T3 — the match is case-sensitive (Q14): `asia/kolkata` is refused. */
export async function createRefusesALowercaseZone(ctx: TimezoneCtx): Promise<void> {
  let caught: unknown;
  try {
    const created = await ctx.svc.create(ctx.jwt, { ...body(ctx, "T3"), timezone: LOWERCASE_ZONE });
    ctx.register(created.id);
  } catch (err) {
    caught = err;
  }
  expect(caught, "a lowercase spelling is not the canonical name").toBeInstanceOf(BadRequestException);
  expect((caught as BadRequestException).message).toContain(`"${LOWERCASE_ZONE}"`);
}

/** T4 — no `timezone` key on create → the row is `NULL` and the DTO says `null`. */
export async function createWithoutTheKeyStoresNull(ctx: TimezoneCtx): Promise<void> {
  const created = await ctx.svc.create(ctx.jwt, body(ctx, "T4"));
  ctx.register(created.id);
  expect(created.timezone).toBeNull();
  expect(await readTimezone(ctx, created.id)).toBeNull();
}

/** T5 — update with `timezone: null` clears a set zone. */
export async function updateWithNullClearsTheZone(ctx: TimezoneCtx): Promise<void> {
  const created = await ctx.svc.create(ctx.jwt, {
    ...body(ctx, "T5"),
    timezone: "Africa/Johannesburg",
  });
  ctx.register(created.id);
  const updated = await ctx.svc.update(ctx.jwt, created.id, { timezone: null });
  expect(updated.timezone).toBeNull();
  expect(await readTimezone(ctx, created.id)).toBeNull();
}

/** T6 — update without the key leaves the zone as it was. */
export async function updateWithoutTheKeyKeepsTheZone(ctx: TimezoneCtx): Promise<void> {
  const created = await ctx.svc.create(ctx.jwt, {
    ...body(ctx, "T6"),
    timezone: "Africa/Johannesburg",
  });
  ctx.register(created.id);
  const updated = await ctx.svc.update(ctx.jwt, created.id, { name: "E4.1b timezone T6 renamed" });
  expect(updated.name).toBe("E4.1b timezone T6 renamed");
  expect(updated.timezone).toBe("Africa/Johannesburg");
  expect(await readTimezone(ctx, created.id)).toBe("Africa/Johannesburg");
}

/** T7 — the DTO parses with the shared contract (ADR 0030), `timezone` included. */
export async function dtoParsesWithTheSharedContract(ctx: TimezoneCtx): Promise<void> {
  const created = await ctx.svc.create(ctx.jwt, { ...body(ctx, "T7"), timezone: "Asia/Kolkata" });
  ctx.register(created.id);
  const parsed = adminLocationDtoSchema.safeParse(created);
  expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  expect(parsed.success && parsed.data.timezone).toBe("Asia/Kolkata");
}
