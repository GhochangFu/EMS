import { ConflictException } from "@nestjs/common";
import pg from "pg";
import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import {
  RTU_CODE_TAKEN_MESSAGE,
  RTU_EXTERNAL_ID_TAKEN_MESSAGE,
  RTU_LOCATION_CODE_TAKEN_MESSAGE,
  RTU_MQTT_TOPIC_TAKEN_MESSAGE,
} from "./rtus-conflict";
import type { RtusAdminService } from "./rtus.service";

/**
 * `F4.60` / `F4.141` — a duplicate on any of the four `bms.rtus` unique
 * constraints is answered 409, not 500, on both write paths.
 *
 * **This suite belongs to two rows.** `F4.60` wrote it for `rtus_rtu_code_idx`
 * (migration `0071`: unique on `rtu_code` fleet-wide where the column is
 * neither `NULL` nor `''`) as `rtus.rtu-code-conflict.integration.spec.ts`.
 * `F4.141` renamed it and added six cells for the other three — the fleet-wide
 * partial uniques `rtus_external_rtu_idx` and `rtus_mqtt_topic_idx`, and the
 * per-location `rtus_location_code_unique` (all migration `0016`).
 * `RtusAdminService` carries no `onConflict`, so before each row the driver's
 * `23505` reached Nest's default handler and became a 500.
 *
 * **Integration rather than unit, and the reason is not ceremony.** The unit
 * spec (`rtus-conflict.spec.ts`) proves the translation given an error of a
 * stated shape. It cannot prove that the database *raises* that shape — that a
 * duplicate yields `23505` with the constraint name the map spells and not some
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
export type RtuUniqueConflictCtx = {
  readonly svc: RtusAdminService;
  /** `bms_fleet` (BYPASSRLS) — read-back and cleanup only. */
  readonly fixturePool: pg.Pool;
  readonly organizationId: string;
  readonly locationId: string;
  readonly createdRtuIds: string[];
};

let fixtureSeq = 0;
let externalIdSeq = 0;

/**
 * A tag unique to this process and this call.
 *
 * Port 5433 is shared with every other suite, with the other worktrees, and —
 * for this suite in particular — with `tests/f4.60-rtu-code-unique.integration.
 * test.ts`, which asserts against the same index. A fixed `f4.60-` literal would
 * make the row counts below answer about another suite's rows. `bms.rtus` has no
 * charset CHECK (unlike `bms.assets` since migration `0070`), so a dot is safe
 * in a code here. The `f4.60-` prefix is kept for the `F4.141` cells too: that
 * file's leak count reasons about exactly this prefix, and a second one would
 * reopen the question it closed.
 */
function tag(): string {
  return `f4.60-${process.pid}-${Date.now()}-${fixtureSeq++}`;
}

/**
 * An `external_rtu_id` unique to this process and this call, **negative** and
 * int4-safe.
 *
 * The column is `integer`, so a raw `Date.now()` would overflow it. The seed's
 * ids are all positive, so a negative value cannot collide with a seeded row.
 * The pid spreads concurrent processes apart and the sequence separates calls
 * within one. The pid alone is not unique across runs — Windows recycles pids —
 * so a leaked row from a crashed earlier run could collide at fixture time; the
 * run's start second, drawn once, moves each run to a different block. The
 * largest magnitude is `1 + 213_999 * 10_000 + 9_999 < 2^31`.
 */
const externalIdBase = (process.pid + Math.floor(Date.now() / 1000)) % 214_000;

function nextExternalId(): number {
  return -(1 + externalIdBase * 10_000 + (externalIdSeq++ % 10_000));
}

type RtuFixtureFields = {
  readonly rtuCode?: string;
  readonly externalRtuId?: number;
  readonly mqttTopic?: string;
  readonly code?: string;
};

/**
 * One RTU, created through the service so the row is written the way production
 * writes it.
 *
 * `sourceType` is `catalog` and `ingestEnabled` is left false: this suite is
 * about the unique constraints, and a `mqtt` fixture would drag in the `F4.59`
 * telemetry-source move for no reason.
 */
async function createRtu(
  ctx: RtuUniqueConflictCtx,
  jwt: JwtPayload,
  fields: RtuFixtureFields = {},
): Promise<{ id: string; code: string }> {
  const code = fields.code ?? tag();
  const rtu = await ctx.svc.create(jwt, {
    locationId: ctx.locationId,
    code,
    displayName: `F4.60 ${code}`,
    sourceType: "catalog",
    ...(fields.rtuCode === undefined ? {} : { rtuCode: fields.rtuCode }),
    ...(fields.externalRtuId === undefined ? {} : { externalRtuId: fields.externalRtuId }),
    ...(fields.mqttTopic === undefined ? {} : { mqttTopic: fields.mqttTopic }),
  });
  ctx.createdRtuIds.push(rtu.id);
  return { id: rtu.id, code };
}

type RtuRow = {
  code: string;
  display_name: string | null;
  rtu_code: string | null;
  external_rtu_id: number | null;
  mqtt_topic: string | null;
};

/** One `bms.rtus` row as `bms_fleet` sees it — never as `bms_owner`. */
async function readRow(ctx: RtuUniqueConflictCtx, id: string): Promise<RtuRow> {
  const res = await ctx.fixturePool.query<RtuRow>(
    `SELECT code, display_name, rtu_code, external_rtu_id, mqtt_topic
       FROM bms.rtus WHERE id = $1`,
    [id],
  );
  const row = res.rows[0];
  if (row === undefined) {
    throw new Error(`F4.60: no bms.rtus row for ${id}`);
  }
  return row;
}

/** `bms.rtus.rtu_code` as `bms_fleet` sees it — never as `bms_owner`. */
async function readRtuCode(
  ctx: RtuUniqueConflictCtx,
  id: string,
): Promise<string | null> {
  return (await readRow(ctx, id)).rtu_code;
}

/** The target's `display_name`, so a second write in the same PATCH is observable. */
async function readDisplayName(ctx: RtuUniqueConflictCtx, id: string): Promise<string | null> {
  return (await readRow(ctx, id)).display_name;
}

/** How many rows fleet-wide hold this exact `rtu_code`. */
async function countRowsHolding(
  ctx: RtuUniqueConflictCtx,
  rtuCode: string,
): Promise<number> {
  const res = await ctx.fixturePool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM bms.rtus WHERE rtu_code = $1",
    [rtuCode],
  );
  return res.rows[0]?.n ?? 0;
}

/** How many rows fleet-wide hold this exact `external_rtu_id`. */
async function countRowsHoldingExternalId(
  ctx: RtuUniqueConflictCtx,
  externalRtuId: number,
): Promise<number> {
  const res = await ctx.fixturePool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM bms.rtus WHERE external_rtu_id = $1",
    [externalRtuId],
  );
  return res.rows[0]?.n ?? 0;
}

/**
 * The error a call refused with, or a failure if it did not refuse at all.
 *
 * A `create` that resolves has committed a row the suite never asked for. Its
 * id is recorded before the failure is thrown, so `afterAll` deletes it with
 * the rest: without that, the regression this cell exists to catch would also
 * leave a row with a non-null `external_rtu_id` or `mqtt_topic` on the shared
 * database. An `update` resolves to a row already in `createdRtuIds`.
 */
async function rejectionOf(
  ctx: RtuUniqueConflictCtx,
  run: Promise<unknown>,
): Promise<unknown> {
  let resolved: unknown;
  try {
    resolved = await run;
  } catch (error) {
    return error;
  }
  const id = (resolved as { id?: unknown } | null)?.id;
  if (typeof id === "string" && !ctx.createdRtuIds.includes(id)) {
    ctx.createdRtuIds.push(id);
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
  ctx: RtuUniqueConflictCtx,
  jwt: JwtPayload,
): Promise<void> {
  const taken = tag();
  await createRtu(ctx, jwt, { rtuCode: taken });

  const code = tag();
  const error = await rejectionOf(
    ctx,
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
 * **The PATCH carries a `displayName` it does not need, and the reason is
 * narrower than the sentence this replaces claimed.** That sentence said the
 * second field makes a *non-rollback* observable. It does not, and cannot:
 * `rtus.service.ts` writes `display_name` and `rtu_code` in ONE `.set()`, so the
 * index refuses a single statement and Postgres discards all of it. Statement
 * atomicity — not the transaction — is what keeps the row intact here, with the
 * `.catch` or without it, inside a transaction or outside one.
 *
 * What the second field actually fences is a **future** change that splits that
 * one `.set()` into two writes, at which point the first would commit and the
 * refusal would be a lie about what was written. The mutation that proves it
 * has power is exactly that split: moving the `displayName` write out of the
 * transaction reddens this assertion and nothing else. Keep the field; it costs
 * one column and guards a real edit someone will one day make.
 */
export async function assertUpdateRefusesATakenRtuCode(
  ctx: RtuUniqueConflictCtx,
  jwt: JwtPayload,
): Promise<void> {
  const taken = tag();
  await createRtu(ctx, jwt, { rtuCode: taken });
  const mine = tag();
  const target = await createRtu(ctx, jwt, { rtuCode: mine });

  const renamed = `F4.60 renamed ${tag()}`;
  const error = await rejectionOf(
    ctx,
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
  ctx: RtuUniqueConflictCtx,
  jwt: JwtPayload,
): Promise<void> {
  const mine = tag();
  const target = await createRtu(ctx, jwt, { rtuCode: mine });

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
  ctx: RtuUniqueConflictCtx,
  jwt: JwtPayload,
): Promise<void> {
  const first = await createRtu(ctx, jwt, { rtuCode: tag() });
  const second = await createRtu(ctx, jwt, { rtuCode: tag() });

  await ctx.svc.update(jwt, first.id, { rtuCode: "" });
  await ctx.svc.update(jwt, second.id, { rtuCode: "" });

  expect(await readRtuCode(ctx, first.id)).toBe("");
  expect(await readRtuCode(ctx, second.id)).toBe("");
}

/**
 * `F4.141` — `create` refuses a taken `externalRtuId` with the ruled 409.
 *
 * The row count is a control, for the reason `assertCreateRefusesATakenRtuCode`
 * records: a `ConflictException` can only arrive from a refused INSERT.
 */
export async function assertCreateRefusesATakenExternalRtuId(
  ctx: RtuUniqueConflictCtx,
  jwt: JwtPayload,
): Promise<void> {
  const taken = nextExternalId();
  await createRtu(ctx, jwt, { externalRtuId: taken });

  const code = tag();
  const error = await rejectionOf(
    ctx,
    ctx.svc.create(jwt, {
      locationId: ctx.locationId,
      code,
      displayName: `F4.60 ${code}`,
      sourceType: "catalog",
      externalRtuId: taken,
    }),
  );

  expect(error).toBeInstanceOf(ConflictException);
  expect((error as ConflictException).message).toBe(RTU_EXTERNAL_ID_TAKEN_MESSAGE);
  expect(await countRowsHoldingExternalId(ctx, taken)).toBe(1);
}

/**
 * `F4.141` — `update` refuses a taken `externalRtuId`, and writes no part of
 * the PATCH.
 *
 * The target starts with **its own non-null** `externalRtuId`, and the
 * read-back asserts that original value and the original `display_name`
 * positively — the second field fences a split `.set()`, for the reason
 * `assertUpdateRefusesATakenRtuCode` records.
 */
export async function assertUpdateRefusesATakenExternalRtuId(
  ctx: RtuUniqueConflictCtx,
  jwt: JwtPayload,
): Promise<void> {
  const taken = nextExternalId();
  await createRtu(ctx, jwt, { externalRtuId: taken });
  const mine = nextExternalId();
  const target = await createRtu(ctx, jwt, { externalRtuId: mine });

  const error = await rejectionOf(
    ctx,
    ctx.svc.update(jwt, target.id, {
      externalRtuId: taken,
      displayName: `F4.60 renamed ${tag()}`,
    }),
  );

  expect(error).toBeInstanceOf(ConflictException);
  expect((error as ConflictException).message).toBe(RTU_EXTERNAL_ID_TAKEN_MESSAGE);
  const row = await readRow(ctx, target.id);
  expect({ externalRtuId: row.external_rtu_id, displayName: row.display_name }).toEqual({
    externalRtuId: mine,
    displayName: `F4.60 ${target.code}`,
  });
}

/** `F4.141` — `create` refuses a taken `mqttTopic` with the ruled 409. */
export async function assertCreateRefusesATakenMqttTopic(
  ctx: RtuUniqueConflictCtx,
  jwt: JwtPayload,
): Promise<void> {
  const taken = `${tag()}/topic`;
  await createRtu(ctx, jwt, { mqttTopic: taken });

  const code = tag();
  const error = await rejectionOf(
    ctx,
    ctx.svc.create(jwt, {
      locationId: ctx.locationId,
      code,
      displayName: `F4.60 ${code}`,
      sourceType: "catalog",
      mqttTopic: taken,
    }),
  );

  expect(error).toBeInstanceOf(ConflictException);
  expect((error as ConflictException).message).toBe(RTU_MQTT_TOPIC_TAKEN_MESSAGE);
}

/** `F4.141` — `update` refuses a taken `mqttTopic`, and writes no part of the PATCH. */
export async function assertUpdateRefusesATakenMqttTopic(
  ctx: RtuUniqueConflictCtx,
  jwt: JwtPayload,
): Promise<void> {
  const taken = `${tag()}/topic`;
  await createRtu(ctx, jwt, { mqttTopic: taken });
  const mine = `${tag()}/topic`;
  const target = await createRtu(ctx, jwt, { mqttTopic: mine });

  const error = await rejectionOf(
    ctx,
    ctx.svc.update(jwt, target.id, {
      mqttTopic: taken,
      displayName: `F4.60 renamed ${tag()}`,
    }),
  );

  expect(error).toBeInstanceOf(ConflictException);
  expect((error as ConflictException).message).toBe(RTU_MQTT_TOPIC_TAKEN_MESSAGE);
  const row = await readRow(ctx, target.id);
  expect({ mqttTopic: row.mqtt_topic, displayName: row.display_name }).toEqual({
    mqttTopic: mine,
    displayName: `F4.60 ${target.code}`,
  });
}

/**
 * `F4.141` — `create` refuses a `code` already used **at the same location**
 * with the ruled 409.
 *
 * The key is `(location_id, code)`, and both writes go to `ctx.locationId`.
 */
export async function assertCreateRefusesATakenCodeAtTheSameLocation(
  ctx: RtuUniqueConflictCtx,
  jwt: JwtPayload,
): Promise<void> {
  const taken = await createRtu(ctx, jwt);

  const error = await rejectionOf(
    ctx,
    ctx.svc.create(jwt, {
      locationId: ctx.locationId,
      code: taken.code,
      displayName: `F4.60 second ${taken.code}`,
      sourceType: "catalog",
    }),
  );

  expect(error).toBeInstanceOf(ConflictException);
  expect((error as ConflictException).message).toBe(RTU_LOCATION_CODE_TAKEN_MESSAGE);
}

/**
 * `F4.141` — `update` refuses a `code` another RTU at this location already
 * uses, and writes no part of the PATCH. `location_id` is not updatable, so
 * the collision is always within the target's own location.
 */
export async function assertUpdateRefusesATakenCodeAtTheSameLocation(
  ctx: RtuUniqueConflictCtx,
  jwt: JwtPayload,
): Promise<void> {
  const taken = await createRtu(ctx, jwt);
  const target = await createRtu(ctx, jwt);

  const error = await rejectionOf(
    ctx,
    ctx.svc.update(jwt, target.id, {
      code: taken.code,
      displayName: `F4.60 renamed ${tag()}`,
    }),
  );

  expect(error).toBeInstanceOf(ConflictException);
  expect((error as ConflictException).message).toBe(RTU_LOCATION_CODE_TAKEN_MESSAGE);
  const row = await readRow(ctx, target.id);
  expect({ code: row.code, displayName: row.display_name }).toEqual({
    code: target.code,
    displayName: `F4.60 ${target.code}`,
  });
}
