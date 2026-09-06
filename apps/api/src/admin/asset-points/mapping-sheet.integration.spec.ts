import { HttpException } from "@nestjs/common";
import pg from "pg";
import { expect } from "vitest";

import { MAPPING_SHEET_HEADERS } from "@bms/shared";
import type { JwtPayload, MappingSheetErrorCode, MappingSheetErrorDto } from "@bms/shared";

import { csvDocument, csvNumberCell, csvTextCell } from "../../serialise/csv";
import { mappingSheetToBuffer } from "./mapping-sheet-export";
import { parseMappingSheet } from "./mapping-sheet-rows";
import type { MappingSheetService } from "./mapping-sheet.service";

/**
 * `F2.7` Unit H / ADR 0056 decisions 6 and 7 — the mapping sheet against a real
 * database: export one location, preview an uploaded sheet, commit the valid
 * rows in one transaction.
 *
 * **Why this suite is an integration one.** Every rule it covers is a property
 * of rows the pure modules never see. `assertExportThenImportIsIdentity` is
 * decision 7's round trip over a location the service itself read; the commit's
 * three-phase re-key exists only because
 * `asset_points_asset_source_key_idx` is checked per statement inside the
 * transaction; the audit rows are written under `0048`'s strict `WITH CHECK`;
 * and the scope refusal is `canManageLocation` against real grant rows.
 * `mapping-sheet-rows.spec.ts`, `-export.spec.ts` and `-plan.spec.ts` hold the
 * pure halves and none of them can reach any of this.
 *
 * The fixture is a **location this suite builds**, not a seeded one: the
 * identity property is only meaningful over a known row set, and a seeded
 * location's shape is another item's to change.
 */
export type MappingSheetFixtures = {
  svc: MappingSheetService;
  /**
   * The same service with an audit component whose `writeMany` throws — the one
   * transaction case. A stub rather than a broken database because the audit
   * insert is the *last* thing the commit does, so a throw there is the only
   * cheap way to prove the writes before it are rolled back too.
   */
  failingAuditSvc: MappingSheetService;
  /** BYPASSRLS connection, for reading the stored rows back column by column. */
  fleetPool: pg.Pool;
  locationId: string;
  locationCode: string;
  /** Every fixture code this run created starts with it; also what the audit query joins on. */
  assetPrefix: string;
  /** An active RTU of the fixture location. */
  rtuCode: string;
  /** An RTU of the fixture location with `active = false` (correction 39). */
  retiredRtuCode: string;
  /** The six fixture assets, by role. */
  assets: {
    /** One existing `KW` row wired to the active RTU; the update target. */
    readonly withOneRow: string;
    /** No rows at all — three pre-fill suggestions. */
    readonly bare: string;
    /** Two existing rows whose source keys the swap case exchanges. */
    readonly swap: string;
    /** Two existing rows; one of the keys is what the duplicate case claims. */
    readonly duplicate: string;
    /** One existing row wired to the RETIRED RTU. */
    readonly retired: string;
    /** No rows; the create target of the mixed sheet and of the rollback case. */
    readonly creates: string;
  };
  /** The catalog point keys this run created. `pressure` is template-only pre-fill. */
  keys: {
    /** On the template, pattern `{asset_code}_KW`. */
    readonly kw: string;
    /** On the template with `eng_max = 100` — the inherited bound the merged pair inverts. */
    readonly kwh: string;
    /** On the template; never mapped, so it is a pre-fill row on every asset. */
    readonly pressure: string;
    /** In the catalog only — what a create names. */
    readonly temp: string;
  };
};

type Column = (typeof MAPPING_SHEET_HEADERS)[number];
type Cells = Record<Column, string | number>;

type StoredPoint = {
  id: string;
  point_key: string;
  source_data_key: string;
  source_kind: string;
  rtu_id: string | null;
  unit: string | null;
  scale_multiplier: number | null;
  eng_min: number | null;
  active: boolean;
};

/* -------------------------------------------------------------------------- */
/* Reading the stored state back                                               */
/* -------------------------------------------------------------------------- */

/** Every `asset_points` row of one fixture asset, by point key. */
async function pointsOf(pool: pg.Pool, assetCode: string): Promise<Map<string, StoredPoint>> {
  const { rows } = await pool.query<StoredPoint>(
    `SELECT ap.id, ap.point_key, ap.source_data_key, ap.source_kind, ap.rtu_id, ap.unit,
            ap.scale_multiplier, ap.eng_min, ap.active
       FROM bms.asset_points ap
       JOIN bms.assets a ON a.id = ap.asset_id
      WHERE a.code = $1`,
    [assetCode],
  );
  return new Map(rows.map((row) => [row.point_key, row]));
}

/** How many `asset_points` rows this run's assets hold in total. */
async function pointCount(pool: pg.Pool, assetPrefix: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM bms.asset_points ap
       JOIN bms.assets a ON a.id = ap.asset_id
      WHERE a.code LIKE $1`,
    [`${assetPrefix}%`],
  );
  return Number(rows[0]?.n ?? "0");
}

/**
 * The audit rows this run's points carry, by action. `bms.audit_log` has no
 * foreign key on `entity_id`, so it is joined back through `asset_points` —
 * which is also why a create's audit row must carry the *inserted* id rather
 * than `null`.
 */
async function auditActions(pool: pg.Pool, assetPrefix: string): Promise<Map<string, number>> {
  const { rows } = await pool.query<{ action: string; n: string }>(
    `SELECT al.action, count(*)::text AS n
       FROM bms.audit_log al
      WHERE al.entity_id IN (
              SELECT ap.id FROM bms.asset_points ap
                JOIN bms.assets a ON a.id = ap.asset_id
               WHERE a.code LIKE $1)
      GROUP BY al.action`,
    [`${assetPrefix}%`],
  );
  return new Map(rows.map((row) => [row.action, Number(row.n)]));
}

/* -------------------------------------------------------------------------- */
/* Building a sheet                                                            */
/* -------------------------------------------------------------------------- */

/** One data row: every one of the twelve cells, blank unless the caller states it. */
function sheetRow(cells: Partial<Cells>): Cells {
  const base = Object.fromEntries(MAPPING_SHEET_HEADERS.map((column) => [column, ""])) as Cells;
  return { ...base, ...cells };
}

/**
 * The rows as a `.csv` upload — the format an operator's Excel "Save as"
 * produces most often, and the parser's non-binary branch.
 *
 * Escaped through `serialise/csv.ts` rather than by hand: ADR 0026 decision 1
 * puts the rule in one place, and `tests/repo-invariants.test.ts` refuses a
 * second copy of it even in a fixture builder.
 */
function csvBuffer(rows: readonly Cells[]): Buffer {
  const header = MAPPING_SHEET_HEADERS.map((column) => csvTextCell(column));
  const body = rows.map((row) =>
    MAPPING_SHEET_HEADERS.map((column) => {
      const value = row[column];
      return typeof value === "number" ? csvNumberCell(value) : csvTextCell(value);
    }),
  );
  return Buffer.from(csvDocument([header, ...body]), "utf8");
}

/** The refusal's status and its error DTO body, or a throw naming what was expected. */
async function refusalOf(run: () => Promise<unknown>, what: string): Promise<{ status: number; body: unknown }> {
  try {
    await run();
  } catch (err) {
    if (err instanceof HttpException) {
      return { status: err.getStatus(), body: err.getResponse() };
    }
    throw err;
  }
  throw new Error(`${what}: expected a refusal, but the call succeeded`);
}

/** The one error carrying `code`, or a failure naming what came instead. */
function errorWithCode(errors: readonly MappingSheetErrorDto[], code: MappingSheetErrorCode): MappingSheetErrorDto {
  const found = errors.find((error) => error.code === code);
  expect(found, `expected one '${code}' among ${JSON.stringify(errors.map((e) => `${e.row}:${e.code}`))}`).toBeDefined();
  return found as MappingSheetErrorDto;
}

/* -------------------------------------------------------------------------- */
/* (1) The identity                                                            */
/* -------------------------------------------------------------------------- */

/**
 * ADR 0056 decision 7's round trip, end to end and against a real location:
 * export it, upload that very file back, and nothing changes.
 *
 * The fixture is built rather than found precisely so the two counts under it
 * are non-zero by construction — existing rows to be `unchanged`, and template
 * points with no row to be `untouchedSuggestions`. One of those existing rows is
 * wired to a **retired** RTU, so correction 39's exception is inside the
 * identity rather than beside it: without it, that row's exported `rtu_code`
 * would fail step 9 on the way back in and the round trip would not hold.
 */
export async function assertExportThenImportIsIdentity(
  ctx: MappingSheetFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const { buffer, filename } = await ctx.svc.exportSheet(jwt, ctx.locationId);
  expect(filename).toBe(`mapping-sheet-${ctx.locationCode}.xlsx`);

  const parsed = parseMappingSheet(buffer);
  expect(parsed.ok, `the export parses: ${parsed.ok ? "" : JSON.stringify(parsed.error)}`).toBe(true);
  if (!parsed.ok) {
    return;
  }
  expect(parsed.rows.length, "the export has data rows").toBeGreaterThan(0);
  expect(parsed.errors, "the export has no parse-level errors").toEqual([]);

  const preview = await ctx.svc.preview(jwt, ctx.locationId, buffer);
  expect(preview.locationId).toBe(ctx.locationId);
  expect(preview.creates, "identity: no creates").toEqual([]);
  expect(preview.updates, "identity: no updates").toEqual([]);
  expect(preview.errors, "identity: no errors").toEqual([]);
  expect(preview.unchanged, "identity: existing rows restated").toBeGreaterThan(0);
  expect(preview.untouchedSuggestions, "identity: pre-fill rows left alone").toBeGreaterThan(0);
  // Every data row landed in exactly one bucket, which is what makes the two
  // "greater than zero" assertions above a partition rather than a sample.
  expect(preview.unchanged + preview.untouchedSuggestions).toBe(preview.totalRows);

  const before = await pointCount(ctx.fleetPool, ctx.assetPrefix);
  const commit = await ctx.svc.commit(jwt, ctx.locationId, buffer);
  expect(commit.applied).toEqual({ created: 0, updated: 0 });
  expect(commit.skipped).toEqual([]);
  expect(await pointCount(ctx.fleetPool, ctx.assetPrefix), "a no-op commit writes no row").toBe(before);
  // A commit that changed nothing leaves no audit trail — `writeMany` with an
  // empty array must not reach the database at all.
  expect(await auditActions(ctx.fleetPool, ctx.assetPrefix)).toEqual(new Map());
}

/* -------------------------------------------------------------------------- */
/* (2) The mixed sheet                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Four rows, two of them good: the preview names both problems by row and
 * column, and the commit writes exactly the two rows it promised, with one
 * audit row each.
 *
 * The `eng_range_inverted` row states `active TRUE` deliberately. Blank, it
 * would stop at step 7 as an untouched suggestion and report nothing — a
 * silently vacuous case, and the reason this comment is here rather than the
 * next reader rediscovering it.
 */
export async function assertPreviewListsErrorsAndCommitWritesTheValidRows(
  ctx: MappingSheetFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const before = await pointsOf(ctx.fleetPool, ctx.assets.withOneRow);
  const existingKw = before.get(ctx.keys.kw);
  expect(existingKw, "the update target exists").toBeDefined();

  const buffer = csvBuffer([
    // a create, wired by RTU code
    sheetRow({
      asset_code: ctx.assets.creates,
      point_key: ctx.keys.temp,
      rtu_code: ctx.rtuCode,
      source_data_key: `${ctx.assets.creates}_TEMP`,
      unit: "degC",
      active: "TRUE",
    }),
    // an update: one field, everything else restated as stored
    sheetRow({
      asset_code: ctx.assets.withOneRow,
      point_key: ctx.keys.kw,
      rtu_code: ctx.rtuCode,
      source_data_key: existingKw?.source_data_key ?? "",
      unit: "kW",
      scale_multiplier: 0.5,
    }),
    // an asset of no location at all
    sheetRow({
      asset_code: `${ctx.assetPrefix}NOSUCH`,
      point_key: ctx.keys.kw,
      source_data_key: "X",
      active: "TRUE",
    }),
    // eng_min 150 against the template's inherited eng_max 100
    sheetRow({
      asset_code: ctx.assets.creates,
      point_key: ctx.keys.kwh,
      source_data_key: `${ctx.assets.creates}_KWH`,
      eng_min: 150,
      active: "TRUE",
    }),
  ]);

  const preview = await ctx.svc.preview(jwt, ctx.locationId, buffer);
  expect(preview.totalRows).toBe(4);
  expect(preview.creates.map((create) => create.pointKey)).toEqual([ctx.keys.temp]);
  expect(preview.updates.map((update) => update.pointKey)).toEqual([ctx.keys.kw]);
  expect(preview.updates[0]?.changes).toEqual([{ field: "scaleMultiplier", from: null, to: 0.5 }]);

  const notFound = errorWithCode(preview.errors, "asset_not_found");
  expect(notFound.row, "the third data row is Excel row 4").toBe(4);
  expect(notFound.column).toBe("asset_code");
  const inverted = errorWithCode(preview.errors, "eng_range_inverted");
  expect(inverted.row).toBe(5);
  expect(inverted.column).toBe("eng_min");
  expect(inverted.message, "the refusal names the inherited side").toContain("100");
  expect(preview.errors).toHaveLength(2);

  const auditBefore = await auditActions(ctx.fleetPool, ctx.assetPrefix);
  const commit = await ctx.svc.commit(jwt, ctx.locationId, buffer);
  expect(commit.applied).toEqual({ created: 1, updated: 1 });
  expect(commit.skipped.map((error) => error.code).sort()).toEqual(["asset_not_found", "eng_range_inverted"]);

  const created = (await pointsOf(ctx.fleetPool, ctx.assets.creates)).get(ctx.keys.temp);
  expect(created?.source_data_key).toBe(`${ctx.assets.creates}_TEMP`);
  expect(created?.source_kind, "an rtu_code makes the row measured").toBe("measured");
  expect(created?.unit).toBe("degC");
  expect(created?.active).toBe(true);
  expect(
    (await pointsOf(ctx.fleetPool, ctx.assets.creates)).get(ctx.keys.kwh),
    "the refused row was not written",
  ).toBeUndefined();

  const updated = (await pointsOf(ctx.fleetPool, ctx.assets.withOneRow)).get(ctx.keys.kw);
  expect(updated?.scale_multiplier).toBe(0.5);
  expect(updated?.source_data_key, "the other columns were restated, not cleared").toBe(
    existingKw?.source_data_key,
  );

  const audit = await auditActions(ctx.fleetPool, ctx.assetPrefix);
  expect(audit.get("master.asset_point.create") ?? 0).toBe(
    (auditBefore.get("master.asset_point.create") ?? 0) + 1,
  );
  expect(audit.get("master.asset_point.update") ?? 0).toBe(
    (auditBefore.get("master.asset_point.update") ?? 0) + 1,
  );
}

/* -------------------------------------------------------------------------- */
/* (3) The header                                                              */
/* -------------------------------------------------------------------------- */

/** A thirteenth column refuses the whole file — 400 with one error DTO, and nothing written. */
export async function assertAThirteenthColumnRefusesTheWholeFile(
  ctx: MappingSheetFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const before = await pointCount(ctx.fleetPool, ctx.assetPrefix);
  const rows = [
    [...MAPPING_SHEET_HEADERS, "sensor_code"],
    [
      ctx.assets.creates,
      "",
      ctx.keys.temp,
      "",
      `${ctx.assets.creates}_HDR`,
      "",
      "",
      "",
      "",
      "",
      "",
      "TRUE",
      "S1",
    ],
  ];

  const refusal = await refusalOf(
    () => ctx.svc.commit(jwt, ctx.locationId, mappingSheetToBuffer(rows)),
    "a thirteen-column header",
  );
  expect(refusal.status).toBe(400);
  const body = refusal.body as MappingSheetErrorDto;
  expect(body.code).toBe("header_mismatch");
  expect(body.row, "a file-level refusal names no row").toBeNull();
  expect(body.column, "and no column — the offender is named in the message").toBeNull();
  expect(body.message).toContain("sensor_code");
  expect(await pointCount(ctx.fleetPool, ctx.assetPrefix), "nothing was written").toBe(before);
}

/* -------------------------------------------------------------------------- */
/* (4) The duplicate source key                                                */
/* -------------------------------------------------------------------------- */

/**
 * A row claiming a `source_data_key` an existing row of another point key holds
 * is a **row** error, and the sheet's other rows still land.
 *
 * That is design decision 8 made observable: left to the database, the same
 * sheet would raise `23505` on `asset_points_asset_source_key_idx` inside the
 * commit transaction and roll back the good row with it.
 */
export async function assertADuplicateSourceKeyIsARowErrorAndTheRestStillLand(
  ctx: MappingSheetFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const before = await pointsOf(ctx.fleetPool, ctx.assets.duplicate);
  const kwRow = before.get(ctx.keys.kw);
  const kwhRow = before.get(ctx.keys.kwh);
  expect(kwRow, "the duplicate fixture has a kw row").toBeDefined();
  expect(kwhRow, "and a kwh row whose key it will claim").toBeDefined();

  const buffer = csvBuffer([
    sheetRow({
      asset_code: ctx.assets.duplicate,
      point_key: ctx.keys.kw,
      rtu_code: ctx.rtuCode,
      // the key held by this asset's OTHER point, which this sheet leaves alone
      source_data_key: kwhRow?.source_data_key ?? "",
      unit: "kW",
    }),
    sheetRow({
      asset_code: ctx.assets.duplicate,
      point_key: ctx.keys.temp,
      source_data_key: `${ctx.assets.duplicate}_TEMP`,
      active: "TRUE",
    }),
  ]);

  const commit = await ctx.svc.commit(jwt, ctx.locationId, buffer);
  expect(commit.applied).toEqual({ created: 1, updated: 0 });
  const duplicate = errorWithCode(commit.skipped, "source_data_key_duplicate");
  expect(duplicate.row).toBe(2);
  expect(duplicate.column).toBe("source_data_key");

  const after = await pointsOf(ctx.fleetPool, ctx.assets.duplicate);
  expect(after.get(ctx.keys.kw)?.source_data_key, "the refused row kept its key").toBe(
    kwRow?.source_data_key,
  );
  expect(after.get(ctx.keys.temp)?.source_data_key, "the good row landed").toBe(
    `${ctx.assets.duplicate}_TEMP`,
  );
}

/* -------------------------------------------------------------------------- */
/* (5) Scope                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A `location_admin` of another location is refused **before** the file is
 * read.
 *
 * The buffer is deliberately not a spreadsheet: a 403 then proves the ordering,
 * where a valid sheet would pass this test whichever gate ran first. §9.6 — a
 * file upload is a security surface, so nothing inside it is parsed until the
 * caller has been shown to be allowed to manage this location.
 */
export async function assertAnOutOfScopeCallerIsRefusedBeforeTheFileIsRead(
  ctx: MappingSheetFixtures,
  outOfScope: JwtPayload,
): Promise<void> {
  const garbage = Buffer.from("this is not a spreadsheet at all", "utf8");

  for (const [what, run] of [
    ["preview", () => ctx.svc.preview(outOfScope, ctx.locationId, garbage)],
    ["commit", () => ctx.svc.commit(outOfScope, ctx.locationId, garbage)],
    ["export", () => ctx.svc.exportSheet(outOfScope, ctx.locationId)],
  ] as const) {
    const refusal = await refusalOf(run, `${what} for a location outside the caller's scope`);
    expect(refusal.status, `${what} is 403, not a parse error`).toBe(403);
  }
}

/* -------------------------------------------------------------------------- */
/* (6) One transaction                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The commit is one transaction: when the audit write throws, the row it
 * described is not on disk either.
 *
 * `writeMany` is the last statement of the commit, so this is the strongest
 * cheap probe there is — every insert and update has already succeeded when it
 * fires.
 */
export async function assertAFailedAuditRollsBackEveryWrittenRow(
  ctx: MappingSheetFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const before = await pointCount(ctx.fleetPool, ctx.assetPrefix);
  const buffer = csvBuffer([
    sheetRow({
      asset_code: ctx.assets.bare,
      point_key: ctx.keys.temp,
      source_data_key: `${ctx.assets.bare}_ROLLBACK`,
      active: "TRUE",
    }),
  ]);

  // The plan is valid — the same sheet through the healthy service would write.
  const preview = await ctx.failingAuditSvc.preview(jwt, ctx.locationId, buffer);
  expect(preview.creates).toHaveLength(1);
  expect(preview.errors).toEqual([]);

  await expect(ctx.failingAuditSvc.commit(jwt, ctx.locationId, buffer)).rejects.toThrow();

  expect(await pointCount(ctx.fleetPool, ctx.assetPrefix), "the insert rolled back with the audit").toBe(
    before,
  );
  expect(
    (await pointsOf(ctx.fleetPool, ctx.assets.bare)).get(ctx.keys.temp),
    "no row survives a failed commit",
  ).toBeUndefined();
}

/* -------------------------------------------------------------------------- */
/* (7) The key swap                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Correction 38 — two rows of one asset exchange their `source_data_key`s in
 * one sheet, and the commit succeeds.
 *
 * `asset_points_asset_source_key_idx` is unique on `(asset_id,
 * source_data_key)` and is checked per statement, so there is **no order** in
 * which two sequential `UPDATE`s can perform a swap: whichever runs first
 * collides with the row that still holds the key. The commit therefore parks
 * every re-keyed row on a `__f27_swap_<uuid>` placeholder first. Step 14
 * deliberately admits this sheet (the holder releases its key), so without the
 * placeholder phase the 23505 would roll back every valid row in the file.
 */
export async function assertTwoRowsSwapTheirSourceKeysInOneCommit(
  ctx: MappingSheetFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const before = await pointsOf(ctx.fleetPool, ctx.assets.swap);
  const kwKey = before.get(ctx.keys.kw)?.source_data_key;
  const kwhKey = before.get(ctx.keys.kwh)?.source_data_key;
  expect(kwKey, "the swap fixture has both rows").toBeDefined();
  expect(kwhKey).toBeDefined();
  expect(kwKey).not.toBe(kwhKey);

  const buffer = csvBuffer([
    sheetRow({
      asset_code: ctx.assets.swap,
      point_key: ctx.keys.kw,
      rtu_code: ctx.rtuCode,
      source_data_key: kwhKey ?? "",
      unit: "kW",
    }),
    sheetRow({
      asset_code: ctx.assets.swap,
      point_key: ctx.keys.kwh,
      rtu_code: ctx.rtuCode,
      source_data_key: kwKey ?? "",
      unit: "kWh",
    }),
  ]);

  const preview = await ctx.svc.preview(jwt, ctx.locationId, buffer);
  expect(preview.errors, "step 14 admits the swap: the holder releases its key").toEqual([]);
  expect(preview.updates).toHaveLength(2);

  const commit = await ctx.svc.commit(jwt, ctx.locationId, buffer);
  expect(commit.applied).toEqual({ created: 0, updated: 2 });
  expect(commit.skipped).toEqual([]);

  const after = await pointsOf(ctx.fleetPool, ctx.assets.swap);
  expect(after.get(ctx.keys.kw)?.source_data_key, "kw took kwh's key").toBe(kwhKey);
  expect(after.get(ctx.keys.kwh)?.source_data_key, "and kwh took kw's").toBe(kwKey);
  for (const row of after.values()) {
    expect(row.source_data_key.startsWith("__f27_swap_"), "no placeholder survived the commit").toBe(
      false,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* (8) The retired RTU                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Correction 39 — a retired RTU's code round-trips on the row already wired to
 * it, and is refused for a new one.
 *
 * `rtusByCode` is the active set step 9 resolves against; `rtuCodesById` holds
 * every RTU of the location, so the export still names the gateway a row is
 * wired to. Without the exception that exported code fails on re-import and
 * decision 7's round trip breaks for a row nobody edited — and with the
 * exception scoped any wider, a sheet could newly bind live telemetry to a
 * gateway somebody deactivated on purpose.
 */
export async function assertARetiredRtuRoundTripsButCannotBeNewlyWired(
  ctx: MappingSheetFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const before = await pointsOf(ctx.fleetPool, ctx.assets.retired);
  const wired = before.get(ctx.keys.temp);
  expect(wired?.rtu_id, "the fixture row is wired to the retired RTU").not.toBeNull();

  const buffer = csvBuffer([
    // the row that already points at it, restated exactly
    sheetRow({
      asset_code: ctx.assets.retired,
      point_key: ctx.keys.temp,
      rtu_code: ctx.retiredRtuCode,
      source_data_key: wired?.source_data_key ?? "",
      unit: "degC",
    }),
    // a create naming the same retired code — `active` TRUE on purpose, or the
    // row would stop at step 7 as an untouched suggestion and report nothing
    sheetRow({
      asset_code: ctx.assets.retired,
      point_key: ctx.keys.kw,
      rtu_code: ctx.retiredRtuCode,
      source_data_key: `${ctx.assets.retired}_KW`,
      active: "TRUE",
    }),
  ]);

  const preview = await ctx.svc.preview(jwt, ctx.locationId, buffer);
  expect(preview.unchanged, "the wired row round-trips untouched").toBe(1);
  expect(preview.creates, "and the create is refused").toEqual([]);
  const refused = errorWithCode(preview.errors, "rtu_not_found");
  expect(refused.row).toBe(3);
  expect(refused.column).toBe("rtu_code");
  expect(refused.message).toContain(ctx.retiredRtuCode);
  expect(preview.errors).toHaveLength(1);

  const commit = await ctx.svc.commit(jwt, ctx.locationId, buffer);
  expect(commit.applied).toEqual({ created: 0, updated: 0 });
  expect(
    (await pointsOf(ctx.fleetPool, ctx.assets.retired)).get(ctx.keys.kw),
    "the refused create never landed",
  ).toBeUndefined();
}
