import { ConflictException } from "@nestjs/common";
import pg from "pg";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import { RTU_CODE_TAKEN_MESSAGE } from "./rtus-conflict";
import type { RtusAdminService } from "./rtus.service";

/**
 * `F4.60` — a duplicate `rtu_code` is answered 409, not 500, on both write
 * paths.
 *
 * Migration `0071` adds `rtus_rtu_code_idx`, unique on `rtu_code` fleet-wide
 * where the column is neither `NULL` nor `''`. `RtusAdminService` carries no
 * `onConflict`, so before this the driver's `23505` reached Nest's default
 * handler and became a 500.
 *
 * **Integration rather than unit, and the reason is not ceremony.** The unit
 * spec (`rtus-conflict.spec.ts`) proves the translation given an error of a
 * stated shape. It cannot prove that the database *raises* that shape — that a
 * duplicate yields `23505` with `constraint = 'rtus_rtu_code_idx'` and not some
 * other name, that Drizzle's rollback re-throws the driver's own object with
 * those fields intact, or that the `.catch` is attached to a promise the error
 * actually travels along. Those are the three ways the wiring can be dead while
 * every unit claim stays green.
 *
 * It also holds the one claim no unit test can express: an `update` that
 * restates an RTU's existing `rtu_code` must **not** collide with itself.
 *
 * The suite runs on the production role wiring — `bms_tenant` for writes,
 * `bms_fleet` for the fixture rows and read-back. Counting as `bms_fleet`
 * matters: under `FORCE ROW LEVEL SECURITY` a count as `bms_owner` returns 0
 * with the rows present.
 */
export type RtuCodeConflictCtx = {
  readonly svc: RtusAdminService;
  /** `bms_fleet` (BYPASSRLS) — read-back and cleanup only. */
  readonly fixturePool: pg.Pool;
  readonly organizationId: string;
  readonly locationId: string;
  readonly createdRtuIds: string[];
};

let fixtureSeq = 0;

/**
 * A tag unique to this process and this call.
 *
 * Port 5433 is shared with every other suite, with the other worktrees, and —
 * for this row in particular — with `tests/f4.60-rtu-code-unique.integration.
 * test.ts`, which asserts against the same index. A fixed `f4.60-` literal would
 * make the row counts below answer about another suite's rows. `bms.rtus` has no
 * charset CHECK (unlike `bms.assets` since migration `0070`), so a dot is safe
 * in a code here.
 */
function tag(): string {
  return `f4.60-${process.pid}-${Date.now()}-${fixtureSeq++}`;
}

/**
 * One RTU, created through the service so the row is written the way production
 * writes it.
 *
 * `sourceType` is `catalog` and `ingestEnabled` is left false: this suite is
 * about the unique index, and a `mqtt` fixture would drag in the `F4.59`
 * telemetry-source move for no reason.
 */
async function createRtu(
  ctx: RtuCodeConflictCtx,
  jwt: JwtPayload,
  rtuCode?: string,
): Promise<{ id: string; code: string }> {
  const code = tag();
  const rtu = await ctx.svc.create(jwt, {
    locationId: ctx.locationId,
    code,
    displayName: `F4.60 ${code}`,
    sourceType: "catalog",
    ...(rtuCode === undefined ? {} : { rtuCode }),
  });
  ctx.createdRtuIds.push(rtu.id);
  return { id: rtu.id, code };
}

/** `bms.rtus.rtu_code` as `bms_fleet` sees it — never as `bms_owner`. */
async function readRtuCode(
  ctx: RtuCodeConflictCtx,
  id: string,
): Promise<string | null> {
  const res = await ctx.fixturePool.query<{ rtu_code: string | null }>(
    "SELECT rtu_code FROM bms.rtus WHERE id = $1",
    [id],
  );
  const row = res.rows[0];
  if (row === undefined) {
    throw new Error(`F4.60: no bms.rtus row for ${id}`);
  }
  return row.rtu_code;
}

/** How many rows fleet-wide hold this exact `rtu_code`. */
/** The target's `display_name`, so a partial commit is observable. */
async function readDisplayName(ctx: RtuCodeConflictCtx, id: string): Promise<string | null> {
  const res = await ctx.fixturePool.query<{ display_name: string | null }>(
    "SELECT display_name FROM bms.rtus WHERE id = $1",
    [id],
  );
  return res.rows[0]?.display_name ?? null;
}

async function countRowsHolding(
  ctx: RtuCodeConflictCtx,
  rtuCode: string,
): Promise<number> {
  const res = await ctx.fixturePool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM bms.rtus WHERE rtu_code = $1",
    [rtuCode],
  );
  return res.rows[0]?.n ?? 0;
}

/** The error a call refused with, or a failure if it did not refuse at all. */
async function rejectionOf(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  throw new Error("F4.60: the call resolved where a refusal was expected");
}

/**
 * `create` refuses a taken `rtuCode` with the ruled 409.
 *
 * **The row count is a control, not a gate**, and the sentence it replaces
 * claimed otherwise. It read: "a translation that answered 409 while the row
 * went in anyway would satisfy the first on its own." That state is
 * unreachable. To arrive at a `ConflictException` the driver must have raised
 * `23505`, which means the INSERT did not happen; remove the `.catch` and the
 * first expectation fails before this one is evaluated; drop the index and
 * `rejectionOf` throws instead. No mutation of this change discriminates on it.
 * It is kept because it is cheap and it documents the fleet-wide shape of the
 * key — the count is unqualified by organization because the index is.
 */
export async function assertCreateRefusesATakenRtuCode(
  ctx: RtuCodeConflictCtx,
  jwt: JwtPayload,
): Promise<void> {
  const taken = tag();
  await createRtu(ctx, jwt, taken);

  const code = tag();
  const error = await rejectionOf(
    ctx.svc.create(jwt, {
      locationId: ctx.locationId,
      code,
      displayName: `F4.60 ${code}`,
      sourceType: "catalog",
      rtuCode: taken,
    }),
  );

  expect(error).toBeInstanceOf(ConflictException);
  expect((error as ConflictException).message).toBe(RTU_CODE_TAKEN_MESSAGE);
  expect(await countRowsHolding(ctx, taken)).toBe(1);
}

/**
 * `update` refuses a taken `rtuCode` with the same 409, and changes nothing.
 *
 * **The PATCH carries a `displayName` it does not need, and that is what makes
 * the rollback claim gate anything.** With a body of `{ rtuCode }` alone, every
 * other column in `update`'s `.set()` is restated from `existing`, so the only
 * column that changes is the one whose write failed — and Postgres cannot commit
 * a failed statement. The assertion would then hold under every mutation,
 * including one that never rolled back at all. Sending a second, *valid* field
 * makes a non-rollback observable: if the transaction did not unwind, the row
 * keeps the new `displayName` while the refusal says nothing was written.
 */
export async function assertUpdateRefusesATakenRtuCode(
  ctx: RtuCodeConflictCtx,
  jwt: JwtPayload,
): Promise<void> {
  const taken = tag();
  await createRtu(ctx, jwt, taken);
  const mine = tag();
  const target = await createRtu(ctx, jwt, mine);

  const renamed = `F4.60 renamed ${tag()}`;
  const error = await rejectionOf(
    ctx.svc.update(jwt, target.id, { rtuCode: taken, displayName: renamed }),
  );

  expect(error).toBeInstanceOf(ConflictException);
  expect((error as ConflictException).message).toBe(RTU_CODE_TAKEN_MESSAGE);
  expect(await readRtuCode(ctx, target.id)).toBe(mine);
  // Positive, not `.not.toBe(renamed)`: an absence check passes for any reason
  // the row failed to change, including one that never wrote anything. Asserting
  // the ORIGINAL value is what says the row is intact.
  expect(
    await readDisplayName(ctx, target.id),
    "the whole PATCH must roll back, not just the column that collided — the row " +
      "must still carry the display name createRtu gave it",
  ).toBe(`F4.60 ${target.code}`);
}

/**
 * **A control, not a gate.** No mutation of the `.catch` wiring reddens it.
 *
 * `update` restates every column on every PATCH, including `rtu_code`. A row
 * that already holds one therefore writes its own value back, and if that
 * counted as a duplicate then every edit of an ingest-bound RTU — a rename, the
 * ingest switch — would be refused with "That rtuCode is already taken."
 *
 * Postgres does not treat it as one: the unique check sees the old tuple as the
 * row's own prior version. This case fences that, and fences the repair a future
 * reader might reach for instead — a `SELECT … WHERE rtu_code = $1` pre-check
 * that did not exclude the row being updated would fail exactly here and
 * nowhere else in this suite.
 *
 * The PATCH deliberately changes something else, so the statement really runs.
 */
export async function assertUpdateDoesNotSelfCollideOnAnUnchangedRtuCode(
  ctx: RtuCodeConflictCtx,
  jwt: JwtPayload,
): Promise<void> {
  const mine = tag();
  const target = await createRtu(ctx, jwt, mine);

  const updated = await ctx.svc.update(jwt, target.id, {
    displayName: "F4.60 renamed, rtuCode untouched",
  });

  expect(updated.displayName).toBe("F4.60 renamed, rtuCode untouched");
  expect(await readRtuCode(ctx, target.id)).toBe(mine);
}

/**
 * **A control, not a gate.** No mutation of the `.catch` wiring reddens it.
 *
 * `''` is what clears the column: `updateRtuBodySchema` is optional-but-not-
 * nullable, so `null` cannot be sent and an omitted key means "leave it". The
 * index's `WHERE rtu_code IS NOT NULL AND rtu_code <> ''` is what makes two
 * cleared rows legal — a plain unique index on the bare column would refuse the
 * second one, and an operator clearing two RTUs would be told the empty string
 * was taken.
 *
 * Both fixtures start with **distinct non-empty** codes, so each clear is a real
 * write. Starting from `NULL` would let this pass with the clear doing nothing.
 */
export async function assertClearingRtuCodeOnTwoRtusDoesNotCollide(
  ctx: RtuCodeConflictCtx,
  jwt: JwtPayload,
): Promise<void> {
  const first = await createRtu(ctx, jwt, tag());
  const second = await createRtu(ctx, jwt, tag());

  await ctx.svc.update(jwt, first.id, { rtuCode: "" });
  await ctx.svc.update(jwt, second.id, { rtuCode: "" });

  expect(await readRtuCode(ctx, first.id)).toBe("");
  expect(await readRtuCode(ctx, second.id)).toBe("");
}
