import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F2.10` / ADR 0098 decision 1, Drafter choice 3 and Amendment 1 (A1, A2) —
 * what migration `0103` guarantees against a real database.
 * `tests/f2.10-location-tree-migration.test.ts` asserts the migration's text;
 * this asserts what Postgres enforces: the constraints, the trigger's
 * refusals with no API in front of it (the *Verification owed* API-bypass
 * proof, as `bms_owner` with the tenant GUC — the `bms_fleet` twin with no GUC
 * is `apps/api/src/auth/location-tree.integration.spec.ts`), the CHECK with the
 * trigger switched off, and the isolation raise.
 *
 * Lifecycle follows `tests/f4.157-location-types-schema.integration.test.ts`:
 * every case runs in a transaction that is rolled back, and a case that
 * expects an error runs it under `SAVEPOINT probe`. Two pools: the owner pool
 * (`DATABASE_URL`, `bms_owner`, bound by FORCE ROW LEVEL SECURITY) for the
 * tenant-shaped writes, and the superuser pool for the catalog reads, the
 * cross-organization lookups the owner cannot see, and replica mode.
 *
 * A case that writes a child takes the tree lock on the oldest organization's
 * key until its ROLLBACK, so each `it` holds it for one short transaction.
 * Every transaction here carries a `lock_timeout`, which bounds this file's
 * own waits: a key held elsewhere fails the case instead of hanging the run.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F2.10",
  label: "bms.locations tree schema tests",
  because:
    "the composite foreign key, the CHECK and the tree-guard trigger's refusals are all " +
    "things Postgres enforces, so a green run without a database asserts nothing about any of them.",
});

const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type Rows = { rows: Array<Record<string, unknown>> };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};
type PgFailure = { code: string | undefined; constraint: string | undefined; message: string };

const NO_ERROR: PgFailure = { code: undefined, constraint: undefined, message: "" };

const failureOf = (err: unknown): PgFailure => {
  const e = err as { code?: string; constraint?: string } | undefined;
  return {
    code: e?.code,
    constraint: e?.constraint,
    message: err instanceof Error ? err.message : String(err),
  };
};

/** Runs `body` under a SAVEPOINT and returns the error it raised (`NO_ERROR` if none). */
const probe = async (run: Run, body: (run: Run) => Promise<unknown>): Promise<PgFailure> => {
  await run("SAVEPOINT probe");
  let failure = NO_ERROR;
  try {
    await body(run);
  } catch (err) {
    failure = failureOf(err);
  }
  await run("ROLLBACK TO SAVEPOINT probe");
  return failure;
};

describe.skipIf(!has)("F2.10 — bms.locations tree against a live database", () => {
  let ownerPool: IntegrationPool;
  let superPool: IntegrationPool;
  let orgA = "";
  let orgARoot = "";
  let orgBRoot = "";
  let seq = 0;

  beforeAll(async () => {
    ownerPool = await openIntegrationPool(connectionString as string, "F2.10");
    superPool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F2.10",
    );
    const orgs = await superPool.query<{ id: string }>(
      `SELECT id FROM bms.organizations ORDER BY created_at, code LIMIT 2`,
    );
    orgA = orgs.rows[0]?.id ?? "";
    const orgB = orgs.rows[1]?.id ?? "";
    if (!orgA || !orgB) throw new Error("F2.10: needs two bms.organizations rows — run pnpm db:seed.");
    const oldest = async (org: string): Promise<string> => {
      const r = await superPool.query<{ id: string }>(
        `SELECT id FROM bms.locations WHERE organization_id = $1 ORDER BY created_at, code LIMIT 1`,
        [org],
      );
      const id = r.rows[0]?.id;
      if (!id) throw new Error(`F2.10: organization ${org} has no location — run pnpm db:seed.`);
      return id;
    };
    orgARoot = await oldest(orgA);
    orgBRoot = await oldest(orgB);
  });

  afterAll(async () => {
    await ownerPool?.end();
    await superPool?.end();
  });

  /** Runs `body` in a rolled-back transaction on `pool`, as `orgA`'s tenant when `tenant`. */
  const inTx = async (
    pool: IntegrationPool,
    tenant: boolean,
    body: (run: Run) => Promise<void>,
  ): Promise<void> => {
    const client = (await pool.connect()) as unknown as IntegrationClient;
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'");
      if (tenant) await client.query(`SELECT set_config('app.current_organization', $1, true)`, [orgA]);
      await body((sql, params) => client.query(sql, params));
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  };
  const asOwner = (body: (run: Run) => Promise<void>) => inTx(ownerPool, true, body);
  const asSuperuser = (body: (run: Run) => Promise<void>) => inTx(superPool, false, body);

  /** Inserts a location in `orgA` and returns its id. */
  const insertLocation = async (
    run: Run,
    parentId: string | null,
    active = true,
  ): Promise<string> => {
    seq += 1;
    const code = `F210-${RUN}-${seq}`;
    const r = await run(
      `INSERT INTO bms.locations
         (organization_id, code, slug, name, type, latitude, longitude, parent_id, active)
       VALUES ($1, $2, $3, $4, 'smoc_campus', 0, 0, $5, $6)
       RETURNING id`,
      [orgA, code, code.toLowerCase(), `F2.10 ${code}`, parentId, active],
    );
    return r.rows[0]?.id as string;
  };

  /** R → A → A1, all active, built inside the caller's transaction. */
  const chain = async (run: Run): Promise<{ r: string; a: string; a1: string }> => {
    const r = await insertLocation(run, null);
    const a = await insertLocation(run, r);
    const a1 = await insertLocation(run, a);
    return { r, a, a1 };
  };

  const expectTreeGuard = (failure: PgFailure, reason: string): void => {
    expect(failure.code, `${reason}: ${failure.message}`).toBe("23514");
    expect(failure.constraint, `${reason}: ${failure.message}`).toBe("locations_tree_guard");
    expect(failure.message).toBe(reason);
  };

  const expectCompositeFk = (failure: PgFailure): void => {
    expect(failure.code, failure.message).toBe("23503");
    expect(failure.constraint).toBe("locations_parent_id_organization_id_fkey");
    expect(failure.message).not.toContain("locations_tree_guard");
  };

  // I1
  it("I1 the unique, the composite FK and the CHECK exist, the FK NO ACTION both ways", async () => {
    const r = await superPool.query<{
      conname: string;
      contype: string;
      confdeltype: string;
      confupdtype: string;
    }>(
      `SELECT conname, contype, confdeltype, confupdtype FROM pg_constraint
        WHERE conrelid = 'bms.locations'::regclass
          AND conname = ANY($1::text[]) ORDER BY conname`,
      [["locations_id_organization_key", "locations_parent_id_organization_id_fkey", "locations_parent_not_self_check"]],
    );
    expect(r.rows.map((c) => [c.conname, c.contype])).toEqual([
      ["locations_id_organization_key", "u"],
      ["locations_parent_id_organization_id_fkey", "f"],
      ["locations_parent_not_self_check", "c"],
    ]);
    const fk = r.rows.find((c) => c.contype === "f");
    expect(fk?.confdeltype).toBe("a");
    expect(fk?.confupdtype).toBe("a");
  });

  // I2
  it("I2 the trigger is enabled and its function is SECURITY INVOKER with a pinned search_path", async () => {
    const trigger = await superPool.query<{ tgenabled: string }>(
      `SELECT tgenabled FROM pg_trigger
        WHERE tgname = 'locations_tree_guard' AND tgrelid = 'bms.locations'::regclass`,
    );
    expect(trigger.rows.map((t) => t.tgenabled)).toEqual(["O"]);
    const fn = await superPool.query<{ prosecdef: boolean; pinned: boolean }>(
      `SELECT p.prosecdef,
              p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp'] AS pinned
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'bms' AND p.proname = 'locations_tree_guard'`,
    );
    expect(fn.rows).toEqual([{ prosecdef: false, pinned: true }]);
  });

  // I3
  it("I3 campus, township, building and plant exist, active, at sort_order 50/60/70/80", async () => {
    const r = await superPool.query<{ code: string; sort_order: number; active: boolean }>(
      `SELECT code, sort_order, active FROM bms.location_types
        WHERE code = ANY($1::text[]) ORDER BY sort_order`,
      [["campus", "township", "building", "plant"]],
    );
    expect(r.rows.map((t) => [t.code, t.sort_order, t.active])).toEqual([
      ["campus", 50, true],
      ["township", 60, true],
      ["building", 70, true],
      ["plant", 80, true],
    ]);
  });

  // I4
  it("I4 INSERT under another organization's location fails on the composite FK, not the trigger", async () => {
    await asOwner(async (run) => {
      expectCompositeFk(await probe(run, (r) => insertLocation(r, orgBRoot)));
    });
  });

  // I4b
  it("I4b UPDATE onto another organization's location fails on the composite FK, not the trigger", async () => {
    await asOwner(async (run) => {
      const failure = await probe(run, (r) =>
        r(`UPDATE bms.locations SET parent_id = $2 WHERE id = $1`, [orgARoot, orgBRoot]),
      );
      expectCompositeFk(failure);
    });
  });

  // I5
  it("I5 a self-parent UPDATE is refused by the trigger as location_parent_cycle", async () => {
    await asOwner(async (run) => {
      const failure = await probe(run, (r) =>
        r(`UPDATE bms.locations SET parent_id = id WHERE id = $1`, [orgARoot]),
      );
      expectTreeGuard(failure, "location_parent_cycle");
    });
  });

  // I6
  it("I6 with triggers off (replica), a self-parent UPDATE fails on locations_parent_not_self_check", async () => {
    await asSuperuser(async (run) => {
      await run("SET LOCAL session_replication_role = replica");
      const failure = await probe(run, (r) =>
        r(`UPDATE bms.locations SET parent_id = id WHERE id = $1`, [orgARoot]),
      );
      expect(failure.code, failure.message).toBe("23514");
      expect(failure.constraint).toBe("locations_parent_not_self_check");
    });
  });

  // I7 — a dedicated connection, never a shared transaction.
  it("I7 under REPEATABLE READ a root INSERT succeeds and a child INSERT raises the read committed refusal", async () => {
    const client = (await ownerPool.connect()) as unknown as IntegrationClient;
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query(`SELECT set_config('app.current_organization', $1, true)`, [orgA]);
      const run: Run = (sql, params) => client.query(sql, params);
      // (a) positive control: A2 returns before the isolation check.
      const root = await insertLocation(run, null);
      expect(root).toMatch(/^[0-9a-f-]{36}$/);
      // (b)
      let failure = NO_ERROR;
      try {
        await insertLocation(run, root);
      } catch (err) {
        failure = failureOf(err);
      }
      expect(failure.message).toContain("read committed");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });

  // I8 — decision 5, the cycle and the depth bound, with no API in front.
  it("I8 deactivating a location with an active child is location_has_active_children", async () => {
    await asOwner(async (run) => {
      const { r } = await chain(run);
      const failure = await probe(run, (q) =>
        q(`UPDATE bms.locations SET active = false WHERE id = $1`, [r]),
      );
      expectTreeGuard(failure, "location_has_active_children");
    });
  });

  it("I8 an active child under an inactive parent is location_parent_inactive", async () => {
    await asOwner(async (run) => {
      const { a1 } = await chain(run);
      await run(`UPDATE bms.locations SET active = false WHERE id = $1`, [a1]);
      expectTreeGuard(await probe(run, (q) => insertLocation(q, a1)), "location_parent_inactive");
    });
  });

  it("I8 reactivating a child under an inactive parent is location_parent_inactive", async () => {
    await asOwner(async (run) => {
      const { a, a1 } = await chain(run);
      await run(`UPDATE bms.locations SET active = false WHERE id = $1`, [a1]);
      await run(`UPDATE bms.locations SET active = false WHERE id = $1`, [a]);
      const failure = await probe(run, (q) =>
        q(`UPDATE bms.locations SET active = true WHERE id = $1`, [a1]),
      );
      expectTreeGuard(failure, "location_parent_inactive");
    });
  });

  it("I8 moving an active location under an inactive parent is location_parent_inactive", async () => {
    await asOwner(async (run) => {
      const { r, a1 } = await chain(run);
      const aPrime = await insertLocation(run, r);
      await run(`UPDATE bms.locations SET active = false WHERE id = $1`, [aPrime]);
      const failure = await probe(run, (q) =>
        q(`UPDATE bms.locations SET parent_id = $2 WHERE id = $1`, [a1, aPrime]),
      );
      expectTreeGuard(failure, "location_parent_inactive");
    });
  });

  it("I8 a ninth level is location_depth_exceeded, and the eighth is not", async () => {
    await asOwner(async (run) => {
      let parent: string | null = null;
      for (let depth = 1; depth <= 8; depth += 1) {
        parent = await insertLocation(run, parent);
      }
      expectTreeGuard(await probe(run, (q) => insertLocation(q, parent)), "location_depth_exceeded");
    });
  });

  it("I8 moving a location under its own descendant is location_parent_cycle", async () => {
    await asOwner(async (run) => {
      const { r, a1 } = await chain(run);
      const failure = await probe(run, (q) =>
        q(`UPDATE bms.locations SET parent_id = $2 WHERE id = $1`, [r, a1]),
      );
      expectTreeGuard(failure, "location_parent_cycle");
    });
  });
});
