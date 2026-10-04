import { randomUUID } from "node:crypto";

import type pg from "pg";
import { sql } from "drizzle-orm";

import { pointKeys, templatePoints } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { type BmsTx, withTenant } from "../../database/tenant-context";
import { jwtFor, primeSeededSubjects } from "../../testing/seeded-subjects";
import { toTemplatePointInsert } from "./asset-templates-point-rows";
import type { AssetTemplatesAdminService } from "./asset-templates.service";

/**
 * `F3.22` PR 1 (ADR 0091 decision 1) — the create and publish cores read their
 * guards through the caller's transaction.
 *
 * Every claim here is "a row written earlier in the **same uncommitted
 * transaction** is visible to the guard". A pool read cannot see such a row, so
 * a core that still read on `fleetDb` refuses — the guard's own 400/404 is what
 * a mutation turns these red with.
 *
 * **Nothing written inside a claim commits.** Each runs inside
 * `inRolledBackTransaction`, which ends the transaction by throwing
 * `RollbackSentinel` and refuses a callback that returns (a returning callback
 * would COMMIT onto a database other suites share). Reads inside a claim go
 * through the same `tx`. The committed drafts C3/C4 start from carry
 * `TEST_CODE_PREFIX` and are deleted on the owner pool before and after the run.
 */

export const TEST_CODE_PREFIX = "F322-CORE-";

export type Fixtures = {
  organizationId: string;
  /** One active point-key code from the seeded catalog. */
  seededPointKey: string;
  adminJwt: JwtPayload;
};

export type Harness = {
  tenantDb: BmsDb;
  /** The owner pool — committed fixture setup and cleanup only. */
  pool: pg.Pool;
  templates: AssetTemplatesAdminService;
  fx: Fixtures;
};

/** Ends a claim's transaction, carrying what it observed out of it. */
export class RollbackSentinel extends Error {
  constructor(readonly captured: unknown) {
    super("F3.22 rollback sentinel");
  }
}

/**
 * Runs `fn` inside `withTenant(org)` and returns what it captured. `fn` must end
 * by throwing `RollbackSentinel`; if it returns instead, this throws **inside**
 * the transaction, so it rolls back rather than committing, and the claim fails.
 */
export async function inRolledBackTransaction<T>(
  tenantDb: BmsDb,
  organizationId: string,
  fn: (tx: BmsTx) => Promise<void>,
): Promise<T> {
  try {
    await withTenant(tenantDb, organizationId, async (tx) => {
      await fn(tx);
      throw new Error(
        "the claim's callback returned instead of throwing RollbackSentinel — refused, " +
          "because a returning callback commits its fixtures",
      );
    });
  } catch (err) {
    if (err instanceof RollbackSentinel) {
      return err.captured as T;
    }
    throw err;
  }
  throw new Error("withTenant resolved — unreachable");
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const unique = (): string => randomUUID().slice(0, 8).toUpperCase();

/** Deletes only this suite's committed rows: templates first (FK on point_keys.code), then keys. */
export async function cleanup(pool: pg.Pool): Promise<void> {
  // template_points cascade on the FK.
  await pool.query(`DELETE FROM bms.asset_templates WHERE code LIKE $1`, [`${TEST_CODE_PREFIX}%`]);
  await pool.query(`DELETE FROM bms.point_keys WHERE code LIKE $1`, [`${TEST_CODE_PREFIX}%`]);
}

export async function loadFixtures(pool: pg.Pool): Promise<Fixtures> {
  // F3.78: the admin payload carries the real bms.users.id as sub.
  await primeSeededSubjects(pool);
  const { rows: orgRows } = await pool.query<{ organization_id: string }>(
    `SELECT l.organization_id
       FROM bms.users u
       JOIN bms.user_location_access ula ON ula.user_id = u.id
       JOIN bms.locations l ON l.id = ula.location_id
      WHERE u.email = 'wc-admin@bms.local' AND l.active = true
      LIMIT 1`,
  );
  const { rows: keyRows } = await pool.query<{ code: string }>(
    `SELECT code FROM bms.point_keys
      WHERE active = true AND code NOT LIKE $1 ORDER BY created_at, code LIMIT 1`,
    [`${TEST_CODE_PREFIX}%`],
  );
  if (!orgRows[0] || !keyRows[0]) {
    throw new Error(
      "F3.22 fixtures missing — need the seeded wc-admin organization and one active point " +
        "key. Run 'pnpm db:seed'.",
    );
  }
  return {
    organizationId: orgRows[0].organization_id,
    seededPointKey: keyRows[0].code,
    adminJwt: jwtFor("admin@bms.local", "admin"),
  };
}

function draftBody(fx: Fixtures, code: string, pointKeyCodes: string[]) {
  return {
    organizationId: fx.organizationId,
    code,
    name: "F3.22 core fixture",
    assetType: "test_skid",
    domain: "water",
    points: pointKeyCodes.map((pointKey, index) => ({
      pointKey,
      kind: "measured" as const,
      required: true,
      sortOrder: index,
      sourceDataKeyPattern: "{asset_code}_X",
    })),
  };
}

async function statusThroughTx(tx: BmsTx, id: string): Promise<string | undefined> {
  const result = await tx.execute(
    sql`select status from bms.asset_templates where id = ${id}`,
  );
  return (result.rows[0] as { status?: string } | undefined)?.status;
}

/**
 * C1 — `createTemplateCore` checks the point-key catalog on `tx`: a key inserted
 * earlier in the same transaction is active to it.
 */
export async function assertCreateCoreSeesAPointKeyWrittenInTheSameTransaction(
  h: Harness,
): Promise<void> {
  const keyCode = `${TEST_CODE_PREFIX}PK-${unique()}`;
  const captured = await inRolledBackTransaction<{ status: string; pointRows: number }>(
    h.tenantDb,
    h.fx.organizationId,
    async (tx) => {
      await tx.insert(pointKeys).values({ code: keyCode, name: "F3.22 tx key", active: true });
      const row = await h.templates.createInTransaction(
        tx,
        h.fx.adminJwt,
        draftBody(h.fx, `${TEST_CODE_PREFIX}C1-${unique()}`, [keyCode]),
      );
      const counted = await tx.execute(
        sql`select count(*)::int as n from bms.template_points where template_id = ${row.id}`,
      );
      throw new RollbackSentinel({
        status: row.status,
        pointRows: Number((counted.rows[0] as { n: number }).n),
      });
    },
  );
  assert(captured.status === "draft", `C1: created row status ${captured.status}, expected draft`);
  assert(
    captured.pointRows === 1,
    `C1: ${captured.pointRows} template_points rows through tx, expected 1`,
  );
}

/**
 * C2 — `publishTemplateCore` reads the template row on `tx`: a draft created
 * earlier in the same transaction publishes.
 */
export async function assertPublishCoreSeesTheDraftRowWrittenInTheSameTransaction(
  h: Harness,
): Promise<void> {
  const captured = await inRolledBackTransaction<{
    draftId: string;
    returnedId: string;
    returnedStatus: string;
    storedStatus: string | undefined;
  }>(h.tenantDb, h.fx.organizationId, async (tx) => {
    const draft = await h.templates.createInTransaction(
      tx,
      h.fx.adminJwt,
      draftBody(h.fx, `${TEST_CODE_PREFIX}C2-${unique()}`, [h.fx.seededPointKey]),
    );
    const published = await h.templates.publishInTransaction(tx, h.fx.adminJwt, draft.id);
    throw new RollbackSentinel({
      draftId: draft.id,
      returnedId: published.id,
      returnedStatus: published.status,
      storedStatus: await statusThroughTx(tx, draft.id),
    });
  });
  assert(captured.returnedId === captured.draftId, "C2: publish returned a different row");
  assert(
    captured.returnedStatus === "published",
    `C2: publish returned status ${captured.returnedStatus}`,
  );
  assert(
    captured.storedStatus === "published",
    `C2: stored status through tx is ${captured.storedStatus}`,
  );
}

/**
 * C3 — `publishTemplateCore` checks the point-key catalog on `tx`: a committed
 * empty draft whose one point names a key **inserted in the same transaction**
 * publishes.
 *
 * The plan's fixture re-activated a committed, deactivated key with
 * `tx.update(pointKeys)`; migration `0059` revokes `UPDATE` on
 * `bms.point_keys` from `bms_tenant` (ADR 0051 Amendment 1: a tenant may
 * extend the catalog, never edit it), so that statement is refused. `INSERT`
 * is the tenant's permitted verb, and a key that exists only inside `tx`
 * is invisible to a pool read just the same. The point row is inserted on
 * `tx` too (the foreign key on `point_keys(code)` needs the key first), so
 * M4 reddens this claim as well as C4 — recorded, not hidden.
 */
export async function assertPublishCoreChecksThePointKeyCatalogThroughTheTransaction(
  h: Harness,
): Promise<void> {
  const keyCode = `${TEST_CODE_PREFIX}K3-${unique()}`;
  const draft = await h.templates.create(
    h.fx.adminJwt,
    draftBody(h.fx, `${TEST_CODE_PREFIX}C3-${unique()}`, []),
  );

  const status = await inRolledBackTransaction<string>(
    h.tenantDb,
    h.fx.organizationId,
    async (tx) => {
      await tx.insert(pointKeys).values({ code: keyCode, name: "F3.22 C3 tx key", active: true });
      await tx.insert(templatePoints).values(
        toTemplatePointInsert(
          {
            pointKey: keyCode,
            kind: "measured",
            required: true,
            sortOrder: 0,
            sourceDataKeyPattern: "{asset_code}_K3",
          },
          draft.id,
          h.fx.organizationId,
          0,
        ),
      );
      const published = await h.templates.publishInTransaction(tx, h.fx.adminJwt, draft.id);
      throw new RollbackSentinel(published.status);
    },
  );
  assert(status === "published", `C3: publish returned status ${status}`);
}

/**
 * C4 — `publishTemplateCore` reads the points on `tx`: a committed empty draft
 * whose only point is inserted in the transaction publishes.
 */
export async function assertPublishCoreReadsThePointsThroughTheTransaction(
  h: Harness,
): Promise<void> {
  const draft = await h.templates.create(
    h.fx.adminJwt,
    draftBody(h.fx, `${TEST_CODE_PREFIX}C4-${unique()}`, []),
  );
  const status = await inRolledBackTransaction<string>(
    h.tenantDb,
    h.fx.organizationId,
    async (tx) => {
      await tx.insert(templatePoints).values(
        toTemplatePointInsert(
          {
            pointKey: h.fx.seededPointKey,
            kind: "measured",
            required: true,
            sortOrder: 0,
            sourceDataKeyPattern: "{asset_code}_P",
          },
          draft.id,
          h.fx.organizationId,
          0,
        ),
      );
      const published = await h.templates.publishInTransaction(tx, h.fx.adminJwt, draft.id);
      throw new RollbackSentinel(published.status);
    },
  );
  assert(status === "published", `C4: publish returned status ${status}`);
}
