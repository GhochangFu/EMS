import { randomUUID } from "node:crypto";

import type pg from "pg";

import type { AssetTemplatesAdminService } from "./asset-templates.service";
import { assert, loadFixtures, type Fixtures } from "./asset-templates.lifecycle.integration.spec";

/**
 * `F2.13` / ADR 0052 decisions 3, 4 and 7 — the stock stamp on
 * `bms.asset_templates`, against a real database.
 *
 * **A separate file, not four more cases in
 * `asset-templates.lifecycle.integration.spec.ts`.** That file sits at 979 of
 * the §4.5 1000 lines; this row's cases would cross it. Same shape as pass A's
 * `asset-templates-point-meta.lifecycle.integration.spec.ts`: `loadFixtures`
 * and `assert` are imported rather than restated, and `TEST_CODE` is this
 * file's own per-run code, for the reason the sibling's `TEST_CODE` docblock
 * gives (two instances of one suite on one database must not share a row).
 *
 * What is database behaviour here and nowhere else: the two columns landing
 * from `create`'s third argument, the audit row being ONE row with the import
 * action, the fork copying the stamp, and `asset_templates_stock_stamp_check`
 * refusing a half-stamp — proved by an `INSERT` the CHECK must reject, not by
 * reading the migration's text (`tests/f2.13-asset-template-stock-stamp.test.ts`
 * already does that).
 */
const TEST_CODE = `F213-STAMP-TEST-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;

/** Deletes only this run's own rows. `template_points` cascades on the FK. */
export async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1`, [`${TEST_CODE}%`]);
}

type StampRow = { stock_code: string | null; stock_version: number | null };

async function storedStamp(pool: pg.Pool, templateId: string): Promise<StampRow> {
  const { rows } = await pool.query<StampRow>(
    `SELECT stock_code, stock_version FROM bms.asset_templates WHERE id = $1`,
    [templateId],
  );
  const row = rows[0];
  assert(row !== undefined, `template ${templateId} must exist`);
  return row as StampRow;
}

type AuditRow = { action: string; reason: string | null };

async function auditRowsFor(pool: pg.Pool, templateId: string): Promise<AuditRow[]> {
  const { rows } = await pool.query<AuditRow>(
    `SELECT action, reason FROM bms.audit_log WHERE entity_type = 'asset_template' AND entity_id = $1
      ORDER BY created_at`,
    [templateId],
  );
  return rows;
}

function body(fx: Fixtures, suffix: string) {
  return {
    organizationId: fx.organizationId,
    code: `${TEST_CODE}-${suffix}`,
    name: `Stamp fixture ${suffix}`,
    assetType: "test_rig",
    domain: "water",
    points: [{ pointKey: fx.pointKeys[0], kind: "measured" as const, required: true, sortOrder: 0 }],
  };
}

/** The ordinary create path yields two NULLs — a hand-authored template has no stamp. */
export async function assertHandAuthoredTemplateCarriesNoStamp(
  svc: AssetTemplatesAdminService,
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const created = await svc.create(fx.adminJwt, body(fx, "HAND"));
  assert(created.stockCode === null, `DTO stockCode must be null, got ${String(created.stockCode)}`);
  assert(created.stockVersion === null, `DTO stockVersion must be null, got ${String(created.stockVersion)}`);
  const stored = await storedStamp(pool, created.id);
  assert(
    stored.stock_code === null && stored.stock_version === null,
    `both columns must be NULL on a hand-authored row, got ${JSON.stringify(stored)}`,
  );
  const audit = await auditRowsFor(pool, created.id);
  assert(
    audit.length === 1 && audit[0]?.action === "master.asset_template.create",
    `a hand-authored create audits as master.asset_template.create, once; got ${JSON.stringify(audit)}`,
  );
}

/**
 * `create` with the stamp sets both columns AND switches the audit to
 * `master.asset_template.import` with reason `stock <code> v<n>` — ONE row,
 * not a `create` row plus an `import` row (ADR 0052 decision 4).
 */
export async function assertStampedCreateWritesBothColumnsAndAuditsAsImport(
  svc: AssetTemplatesAdminService,
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const created = await svc.create(fx.adminJwt, body(fx, "STAMP"), {
    stockCode: "f213-spec-stock",
    stockVersion: 3,
  });
  assert(created.stockCode === "f213-spec-stock", `DTO stockCode lost — got ${String(created.stockCode)}`);
  assert(created.stockVersion === 3, `DTO stockVersion lost — got ${String(created.stockVersion)}`);
  assert(created.status === "draft", `an import lands as a draft, got ${created.status}`);

  const stored = await storedStamp(pool, created.id);
  assert(
    stored.stock_code === "f213-spec-stock" && stored.stock_version === 3,
    `both columns must be written, got ${JSON.stringify(stored)}`,
  );

  const audit = await auditRowsFor(pool, created.id);
  assert(
    audit.length === 1,
    `a stamped create must write exactly ONE audit row, not a create row plus an import row; ` +
      `got ${audit.length}: ${JSON.stringify(audit)}`,
  );
  assert(
    audit[0]?.action === "master.asset_template.import",
    `the one audit row must be master.asset_template.import, got ${String(audit[0]?.action)}`,
  );
  assert(
    audit[0]?.reason === "stock f213-spec-stock v3",
    `the audit reason must read "stock <code> v<n>", got ${JSON.stringify(audit[0]?.reason)}`,
  );
}

/**
 * ADR 0052 decision 7: `createDraftFrom` copies the stamp forward, exactly as
 * the dashboard service does, or "which stock did this come from" becomes
 * unanswerable the first time an organization edits an import.
 */
export async function assertCreateDraftFromCopiesTheStampForward(
  svc: AssetTemplatesAdminService,
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const created = await svc.create(fx.adminJwt, body(fx, "FORK"), {
    stockCode: "f213-spec-fork",
    stockVersion: 2,
  });
  const published = await svc.publish(fx.adminJwt, created.id);
  assert(published.stockCode === "f213-spec-fork", "publish must not disturb the stamp");

  const draft = await svc.createDraftFrom(fx.adminJwt, published.id);
  assert(draft.id !== published.id && draft.version === published.version + 1, "the fork is a new row at the next version");
  assert(
    draft.stockCode === "f213-spec-fork" && draft.stockVersion === 2,
    `the draft must carry the same stamp as the version it was forked from; got ` +
      `${String(draft.stockCode)} v${String(draft.stockVersion)}`,
  );
  const stored = await storedStamp(pool, draft.id);
  assert(
    stored.stock_code === "f213-spec-fork" && stored.stock_version === 2,
    `the fork's columns must carry the stamp, got ${JSON.stringify(stored)}`,
  );
}

/**
 * `asset_templates_stock_stamp_check` (migration `0061`) refuses a half-stamp,
 * proved on the running database with a raw `INSERT`. `stock_code` set and
 * `stock_version` NULL is the case a service bug would most plausibly produce.
 */
export async function assertStampIsAllOrNothing(pool: pg.Pool, fx: Fixtures): Promise<void> {
  let message: string | null = null;
  try {
    await pool.query(
      `INSERT INTO bms.asset_templates
         (organization_id, code, version, name, asset_type, domain, stock_code, stock_version)
       VALUES ($1, $2, 1, 'Half stamp', 'test_rig', 'water', 'f213-half', NULL)`,
      [fx.organizationId, `${TEST_CODE}-HALF`],
    );
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  assert(message !== null, "a row with stock_code set and stock_version NULL must be refused; the INSERT succeeded");
  assert(
    /asset_templates_stock_stamp_check/.test(message ?? ""),
    `the refusal must come from asset_templates_stock_stamp_check, not from something else; got "${message}"`,
  );
}

export { loadFixtures, type Fixtures };
