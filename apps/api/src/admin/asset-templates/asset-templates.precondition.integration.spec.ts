import { randomUUID } from "node:crypto";

import { PreconditionFailedException } from "@nestjs/common";
import type pg from "pg";
import { expect } from "vitest";

import { type IfMatch, PRECONDITION_STALE_MESSAGE } from "@bms/shared";

import type { AssetTemplatesAdminService } from "./asset-templates.service";
import { loadFixtures, type Fixtures } from "./asset-templates.lifecycle.integration.spec";

/**
 * `F4.247` / ADR 0099 Amendment 5 C3 — `PATCH /admin/asset-templates/:id` with `If-Match`,
 * against a real database: the conditional update applies on the live value, refuses a stale
 * one with 412 writing nothing (name, audit row and `updated_at` unchanged), matches a
 * microsecond stamp by its milliseconds, never answers 500 for a schema-valid value Postgres
 * cannot cast, and applies with no header. Its own file: the lifecycle spec is at 988 of the
 * 1000 lines; `loadFixtures` is imported, not restated, as the stamp sibling does. Vitest entry
 * point: the sibling `.test.ts` (ADR 0014).
 */
export type TemplatePreconditionCtx = {
  svc: AssetTemplatesAdminService;
  fx: Fixtures;
  /** Superuser pool: stamps `updated_at` and reads the rows behind the service. */
  superuserPool: pg.Pool;
};

/** This run's own code prefix (two instances of one suite on one database must not share a row). */
const TEST_CODE = `F4247-IFMATCH-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;

/** Deletes only this run's rows and their audit rows. `template_points` cascades on the FK. */
export async function cleanup(superuserPool: pg.Pool): Promise<void> {
  await superuserPool.query(
    `DELETE FROM bms.audit_log WHERE entity_type = 'asset_template'
       AND entity_id IN (SELECT id FROM bms.asset_templates WHERE code LIKE $1)`,
    [`${TEST_CODE}%`],
  );
  await superuserPool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1`, [`${TEST_CODE}%`]);
}

export { loadFixtures };

const STAMP = { stored: "2026-10-20 10:00:00.123+00", iso: "2026-10-20T10:00:00.123Z" as IfMatch };

let n = 0;
async function newDraft(ctx: TemplatePreconditionCtx): Promise<string> {
  n += 1;
  const created = await ctx.svc.create(ctx.fx.adminJwt, {
    organizationId: ctx.fx.organizationId,
    code: `${TEST_CODE}-${n}`,
    name: "F4.247 before",
    assetType: "test_rig",
    domain: "water",
    points: [{ pointKey: ctx.fx.pointKeys[0], kind: "measured", required: true, sortOrder: 0 }],
  });
  return created.id;
}

async function stampTo(ctx: TemplatePreconditionCtx, id: string, stored: string): Promise<void> {
  await ctx.superuserPool.query("UPDATE bms.asset_templates SET updated_at = $2 WHERE id = $1", [id, stored]);
}

async function stored(ctx: TemplatePreconditionCtx, id: string): Promise<{ name: string; at: string; audits: number }> {
  const { rows } = await ctx.superuserPool.query<{ name: string; at: Date; audits: number }>(
    `SELECT t.name, t.updated_at AS at,
            (SELECT count(*)::int FROM bms.audit_log a
              WHERE a.entity_id = t.id AND a.action = 'master.asset_template.update') AS audits
       FROM bms.asset_templates t WHERE t.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error(`F4.247: template ${id} must exist`);
  return { name: row.name, at: row.at.toISOString(), audits: row.audits };
}

async function caught(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  return null;
}

/** Claim 1 — the live value applies and moves `updated_at`. Mutation: a predicate that is always false. */
export async function theLiveIfMatchUpdates(ctx: TemplatePreconditionCtx): Promise<void> {
  const id = await newDraft(ctx);
  await stampTo(ctx, id, STAMP.stored);
  const dto = await ctx.svc.update(ctx.fx.adminJwt, id, { name: "F4.247 after" }, STAMP.iso);
  expect(dto.name).toBe("F4.247 after");
  expect(Date.parse(dto.updatedAt)).toBeGreaterThan(Date.parse(STAMP.iso));
}

/** Claim 2 — a stale value is a 412 that writes nothing. Mutation: drop the predicate from the `UPDATE`. */
export async function aStaleIfMatchIs412AndWritesNothing(ctx: TemplatePreconditionCtx): Promise<void> {
  const id = await newDraft(ctx);
  await stampTo(ctx, id, STAMP.stored);
  const before = await stored(ctx, id);
  const err = await caught(() =>
    ctx.svc.update(ctx.fx.adminJwt, id, { name: "F4.247 after" }, "2026-10-20T09:00:00.000Z" as IfMatch),
  );
  expect(err).toBeInstanceOf(PreconditionFailedException);
  expect((err as Error).message).toBe(PRECONDITION_STALE_MESSAGE);
  expect(await stored(ctx, id)).toEqual(before);
}

/** Claim 3 — a microsecond stamp matches its milliseconds. Mutation: compare `updated_at = ${ifMatch}::timestamptz`. */
export async function aMicrosecondStampMatchesItsMilliseconds(ctx: TemplatePreconditionCtx): Promise<void> {
  const id = await newDraft(ctx);
  await stampTo(ctx, id, "2026-10-20 10:00:00.123456+00");
  const dto = await ctx.svc.update(ctx.fx.adminJwt, id, { name: "F4.247 after" }, STAMP.iso);
  expect(dto.name).toBe("F4.247 after");
}

/** Claim 4 — no header, no compare. Mutation: treat undefined as stale. */
export async function noIfMatchUpdatesWithoutACompare(ctx: TemplatePreconditionCtx): Promise<void> {
  const id = await newDraft(ctx);
  await stampTo(ctx, id, STAMP.stored);
  const dto = await ctx.svc.update(ctx.fx.adminJwt, id, { name: "F4.247 after" });
  expect(dto.name).toBe("F4.247 after");
}

/** Claim 5 (critique C1) — the year 0000 passes the schema and Postgres cannot cast it: 412, never 500. */
export async function anUncastableIfMatchIs412NotA500(ctx: TemplatePreconditionCtx): Promise<void> {
  const id = await newDraft(ctx);
  const err = await caught(() =>
    ctx.svc.update(ctx.fx.adminJwt, id, { name: "F4.247 after" }, "0000-01-01T00:00:00.000Z" as IfMatch),
  );
  expect(err).toBeInstanceOf(PreconditionFailedException);
}
