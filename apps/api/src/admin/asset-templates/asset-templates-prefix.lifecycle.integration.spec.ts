import { randomUUID } from "node:crypto";

import { ConflictException } from "@nestjs/common";
import type pg from "pg";

import { adminAssetTemplateDtoSchema } from "@bms/shared";

import type { AssetTemplatesAdminService } from "./asset-templates.service";
import { assert, loadFixtures, type Fixtures } from "./asset-templates.lifecycle.integration.spec";

/**
 * `E3.1` (ADR 0122 decision 2.5, rulings Q4, R2 and R3; plan T7.2) — the work-order
 * prefix on `bms.asset_templates`, authored through the template service, against a
 * real database.
 *
 * A separate file for the reason `asset-templates-stamp.lifecycle.integration.spec.ts`
 * gives: the main lifecycle spec sits at the AGENTS.md section 4.5 cap. `loadFixtures`
 * and `assert` are imported; `TEST_CODE` is this file's own per-run code.
 *
 * What only a database shows: the column written by create and by a draft edit, the
 * published version refusing the edit, and — the line most easily lost —
 * `createDraftFrom` copying the prefix onto the next draft.
 */
const TEST_CODE = `E31-PFX-TEST-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;

/** Deletes only this run's own rows. `template_points` cascades on the FK. */
export async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1`, [`${TEST_CODE}%`]);
}

async function storedPrefix(pool: pg.Pool, templateId: string): Promise<string | null> {
  const { rows } = await pool.query<{ work_order_prefix: string | null }>(`SELECT work_order_prefix FROM bms.asset_templates WHERE id = $1`, [
    templateId,
  ]);
  assert(rows[0] !== undefined, `template ${templateId} must exist`);
  return rows[0]?.work_order_prefix ?? null;
}

function body(fx: Fixtures, suffix: string) {
  return {
    organizationId: fx.organizationId,
    code: `${TEST_CODE}-${suffix}`,
    name: `Prefix fixture ${suffix}`,
    assetType: "test_rig",
    domain: "water",
    points: [{ pointKey: fx.pointKeys[0], kind: "measured" as const, required: true, sortOrder: 0 }],
  };
}

/** A create with a prefix stores it and the DTO round-trips it; a create without one stores NULL, as a stock import does (R3). */
export async function assertCreateStoresThePrefix(svc: AssetTemplatesAdminService, pool: pg.Pool, fx: Fixtures): Promise<void> {
  const created = await svc.create(fx.adminJwt, { ...body(fx, "NEW"), workOrderPrefix: "STP" });
  assert(adminAssetTemplateDtoSchema.safeParse(created).success, "the DTO must match its contract");
  assert(created.workOrderPrefix === "STP", `DTO workOrderPrefix lost — got ${String(created.workOrderPrefix)}`);
  assert((await storedPrefix(pool, created.id)) === "STP", "the column must hold the prefix");
  assert((await svc.getById(fx.adminJwt, created.id)).workOrderPrefix === "STP", "the read must answer the prefix");

  const bare = await svc.create(fx.adminJwt, body(fx, "BARE"));
  assert(bare.workOrderPrefix === null, `a create that names no prefix must answer null, got ${String(bare.workOrderPrefix)}`);
  assert((await storedPrefix(pool, bare.id)) === null, "and the column must be NULL");

  const stamped = await svc.create(fx.adminJwt, body(fx, "STOCK"), { stockCode: "e31-spec-stock", stockVersion: 1 });
  assert(stamped.workOrderPrefix === null, "a stock import carries no prefix (ruling R3)");
}

/** A PATCH on a draft changes the prefix, keeps it when the field is left out, and clears it with `null`. */
export async function assertADraftEditChangesKeepsAndClearsThePrefix(svc: AssetTemplatesAdminService, pool: pg.Pool, fx: Fixtures): Promise<void> {
  const created = await svc.create(fx.adminJwt, { ...body(fx, "EDIT"), workOrderPrefix: "STP" });

  const changed = await svc.update(fx.adminJwt, created.id, { workOrderPrefix: "ETP" });
  assert(changed.workOrderPrefix === "ETP" && (await storedPrefix(pool, created.id)) === "ETP", "the draft edit must change the prefix");

  const kept = await svc.update(fx.adminJwt, created.id, { name: "Prefix fixture renamed" });
  assert(kept.name === "Prefix fixture renamed", "the other field was written");
  assert(kept.workOrderPrefix === "ETP" && (await storedPrefix(pool, created.id)) === "ETP", "an edit that leaves the prefix out must keep it");

  const cleared = await svc.update(fx.adminJwt, created.id, { workOrderPrefix: null });
  assert(cleared.workOrderPrefix === null && (await storedPrefix(pool, created.id)) === null, "null must clear the prefix");

  // The audit rows say what each prefix edit replaced; the rename, which did not name
  // the prefix, carries no `fromWorkOrderPrefix` at all (E3.1 security review).
  const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
    "SELECT payload FROM bms.audit_log WHERE action = 'master.asset_template.update' AND entity_id = $1 ORDER BY created_at",
    [created.id],
  );
  const trail = rows.map((row) => ("fromWorkOrderPrefix" in row.payload ? [row.payload.fromWorkOrderPrefix, row.payload.workOrderPrefix] : "not named"));
  assert(JSON.stringify(trail) === JSON.stringify([["STP", "ETP"], "not named", ["ETP", null]]), `the audit trail must read from → to, got ${JSON.stringify(trail)}`);
}

/**
 * Ruling R2: a published version is immutable, so its prefix cannot be edited — and
 * the next draft, the only place it can change, starts from the published one's prefix.
 */
export async function assertThePrefixTravelsWithTheVersion(svc: AssetTemplatesAdminService, pool: pg.Pool, fx: Fixtures): Promise<void> {
  const created = await svc.create(fx.adminJwt, { ...body(fx, "FORK"), workOrderPrefix: "STP" });
  const published = await svc.publish(fx.adminJwt, created.id);
  assert(published.workOrderPrefix === "STP", "publish must not disturb the prefix");

  let refusal: unknown = null;
  try {
    await svc.update(fx.adminJwt, published.id, { workOrderPrefix: "ETP" });
  } catch (err) {
    refusal = err;
  }
  assert(refusal instanceof ConflictException, `a published version must refuse the edit with 409, got ${String(refusal)}`);
  assert((await storedPrefix(pool, published.id)) === "STP", "and the published prefix must be unchanged");

  const draft = await svc.createDraftFrom(fx.adminJwt, published.id);
  assert(draft.id !== published.id && draft.version === published.version + 1, "the fork is a new row at the next version");
  assert(draft.workOrderPrefix === "STP", `the draft must carry the published version's prefix, got ${String(draft.workOrderPrefix)}`);
  assert((await storedPrefix(pool, draft.id)) === "STP", "the fork's column must carry the prefix");

  // The draft is where it changes; the published version keeps its own.
  await svc.update(fx.adminJwt, draft.id, { workOrderPrefix: "ETP" });
  assert((await storedPrefix(pool, draft.id)) === "ETP" && (await storedPrefix(pool, published.id)) === "STP", "each version holds its own prefix");
}

export { loadFixtures, type Fixtures };
