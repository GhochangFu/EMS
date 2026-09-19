import { expect } from "vitest";
import { ZodError } from "zod";
import type pg from "pg";

import { adminOrganizationDtoSchema } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import { createOrganizationBodySchema, updateOrganizationBodySchema } from "./organizations.schema";
import type { OrganizationsAdminService } from "./organizations.service";

/**
 * `E4.1c` / ADR 0070 decision 8 — `bms.organizations.currency` on the
 * organization admin write path, against the real database.
 *
 * The controller parses the body with `createOrganizationBodySchema.parse`
 * and turns a `ZodError` into a 400 (`organizations.controller.ts`), so the
 * refusals here drive the SCHEMA the controller uses and assert `ZodError`
 * with the message the operator reads — the service never sees a body the
 * schema refused. T1, T5 and T6 go through the service to the row.
 *
 * Assertions live here; `organizations.currency.integration.test.ts` owns the
 * pools, the service and the `afterAll` delete (ADR 0014). One exported
 * function per claim (T1–T6), one `it()` each in the wrapper.
 *
 * **Read-backs and counts run as `bms_fleet`** (the habit: `bms.organizations`
 * carries no policy today, but every other master-data table is FORCE-RLS
 * and an owner-role read returns 0 rows with the row present).
 *
 * T2's "no row inserted" is a count over this suite's code family, and T1 is
 * its positive control: a valid create moves the same count by one, so a
 * count that never moves cannot pass T2 vacuously.
 */
export type CurrencyCtx = {
  svc: OrganizationsAdminService;
  fleetPool: pg.Pool;
  jwt: JwtPayload;
  /** Called the moment a row exists — never on the return value (F4.16's lesson). */
  register: (id: string) => void;
  /** Per-run code family; every row this suite writes carries it. */
  family: string;
};

/** Three upper-case letters that are NOT an ISO 4217 code (the regex passes, the refine refuses). */
const NOT_A_CURRENCY = "XYZ";

function body(ctx: CurrencyCtx, suffix: string) {
  return {
    code: `${ctx.family}-${suffix}`,
    name: `E4.1c currency ${suffix}`,
  };
}

async function countFamily(ctx: CurrencyCtx): Promise<number> {
  const { rows } = await ctx.fleetPool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM bms.organizations WHERE code LIKE $1",
    [`${ctx.family}-%`],
  );
  return rows[0]?.n ?? -1;
}

async function readCurrency(ctx: CurrencyCtx, id: string): Promise<string | undefined> {
  const { rows } = await ctx.fleetPool.query<{ currency: string }>(
    "SELECT currency FROM bms.organizations WHERE id = $1",
    [id],
  );
  return rows[0]?.currency;
}

/** Parses a create body the way the controller does; returns the ZodError, or the parsed body. */
function parseCreate(raw: unknown): { error?: ZodError; parsed?: ReturnType<typeof createOrganizationBodySchema.parse> } {
  try {
    return { parsed: createOrganizationBodySchema.parse(raw) };
  } catch (err) {
    if (err instanceof ZodError) return { error: err };
    throw err;
  }
}

/** Every message the error carries, joined, so a claim can name the phrase the operator reads. */
function messagesOf(error: ZodError | undefined): string {
  return (error?.issues ?? []).map((i) => `${i.path.join(".")}: ${i.message}`).join(" | ");
}

/** T1 — create with `INR`: the DTO and the row carry it; the family count moves by one. */
export async function createStoresAKnownCurrency(ctx: CurrencyCtx): Promise<string> {
  const before = await countFamily(ctx);
  const parsed = createOrganizationBodySchema.parse({ ...body(ctx, "T1"), currency: "INR" });
  const created = await ctx.svc.create(ctx.jwt, parsed);
  ctx.register(created.id);
  expect(created.currency).toBe("INR");
  expect(await readCurrency(ctx, created.id)).toBe("INR");
  expect(await countFamily(ctx), "positive control for T2's count: a valid create moves it").toBe(
    before + 1,
  );
  return created.id;
}

/**
 * T2 — no `currency` key on create is refused by the body schema (a 400 at
 * the controller) and inserts NO row: the count over the family is unchanged.
 * `currency` is required on create (plan Q12) because the column is NOT NULL
 * with no default — a create without it would otherwise be a 500 off 23502.
 */
export async function createWithoutTheKeyIsRefusedAndInsertsNoRow(ctx: CurrencyCtx): Promise<void> {
  const before = await countFamily(ctx);
  const { error, parsed } = parseCreate(body(ctx, "T2"));
  if (parsed) {
    // The schema let it through — the service must not be reached with it,
    // but if it is, register whatever lands so the run cleans up after itself.
    const created = await ctx.svc.create(ctx.jwt, parsed).catch(() => undefined);
    if (created) ctx.register(created.id);
  }
  expect(error, "a create without currency must be a ZodError (400)").toBeInstanceOf(ZodError);
  expect(error?.issues.map((i) => i.path.join("."))).toContain("currency");
  expect(await countFamily(ctx), "the refusal happens before the write: no row inserted").toBe(before);
}

/**
 * T3 — `XYZ` passes the shape regex and is refused by the ISO 4217 refine,
 * with a message that names the standard. Dropping the `.refine` makes this
 * the one that reddens (the plan's mutation).
 */
export async function createRefusesAnUnknownCurrency(ctx: CurrencyCtx): Promise<void> {
  const { error, parsed } = parseCreate({ ...body(ctx, "T3"), currency: NOT_A_CURRENCY });
  if (parsed) {
    const created = await ctx.svc.create(ctx.jwt, parsed).catch(() => undefined);
    if (created) ctx.register(created.id);
  }
  expect(error, `${NOT_A_CURRENCY} is not an ISO 4217 code and must be a ZodError (400)`).toBeInstanceOf(
    ZodError,
  );
  expect(messagesOf(error)).toContain("ISO 4217");
}

/** T4 — `zar` is refused: the shape is three UPPER-case letters, and the form uppercases, not the API. */
export async function createRefusesALowercaseCurrency(ctx: CurrencyCtx): Promise<void> {
  const { error, parsed } = parseCreate({ ...body(ctx, "T4"), currency: "zar" });
  if (parsed) {
    const created = await ctx.svc.create(ctx.jwt, parsed).catch(() => undefined);
    if (created) ctx.register(created.id);
  }
  expect(error, "a lowercase spelling is not the ISO 4217 shape").toBeInstanceOf(ZodError);
  expect(error?.issues.map((i) => i.path.join("."))).toContain("currency");
}

/** T5 — update to `USD` changes the row; an update WITHOUT the key keeps the value. */
export async function updateChangesAndAbsentKeeps(ctx: CurrencyCtx): Promise<void> {
  const created = await ctx.svc.create(
    ctx.jwt,
    createOrganizationBodySchema.parse({ ...body(ctx, "T5"), currency: "ZAR" }),
  );
  ctx.register(created.id);
  const updated = await ctx.svc.update(ctx.jwt, created.id, updateOrganizationBodySchema.parse({ currency: "USD" }));
  expect(updated.currency).toBe("USD");
  expect(await readCurrency(ctx, created.id)).toBe("USD");
  const renamed = await ctx.svc.update(
    ctx.jwt,
    created.id,
    updateOrganizationBodySchema.parse({ name: "E4.1c currency T5 renamed" }),
  );
  expect(renamed.name).toBe("E4.1c currency T5 renamed");
  expect(renamed.currency, "an update without the key leaves the currency as it was").toBe("USD");
  expect(await readCurrency(ctx, created.id)).toBe("USD");
}

/** T6 — the DTO parses with the shared contract (ADR 0030), `currency` included. */
export async function dtoParsesWithTheSharedContract(ctx: CurrencyCtx): Promise<void> {
  const created = await ctx.svc.create(
    ctx.jwt,
    createOrganizationBodySchema.parse({ ...body(ctx, "T6"), currency: "INR" }),
  );
  ctx.register(created.id);
  const parsed = adminOrganizationDtoSchema.safeParse(created);
  expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  expect(parsed.success && parsed.data.currency).toBe("INR");
}
