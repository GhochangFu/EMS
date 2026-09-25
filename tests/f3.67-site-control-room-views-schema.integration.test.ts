import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F3.67` / ADR 0076 decisions 3–4 — what migration `0082` guarantees against a
 * real database (plan U1, I1–I11). `tests/f3.67-site-control-room-views-schema.test.ts`
 * asserts the migration's *text*; this asserts what Postgres enforces, following
 * `tests/f3.2-asset-dashboards-schema.integration.test.ts`'s lifecycle: superuser
 * pool, one held client, `SET LOCAL ROLE bms_owner` (FORCE-bound) plus the tenant
 * GUC, a per-case `SAVEPOINT`-protected probe, everything rolled back. Locations
 * and dashboards are created per case inside the transaction, so nothing commits.
 *
 * Each refusal probe breaks exactly one rule — an organization-A stamp, location
 * and dashboard wherever the rule under test is not about them — so removing one
 * CHECK or one policy conjunct reddens one it() and no other. `location_id` is
 * the primary key, so every successful insert uses its own fresh location.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F3.67",
  label: "site control room view schema tests",
  because:
    "the four CHECKs, the two-leg tenant_isolation policy and the SET NULL / CASCADE " +
    "foreign keys are all things Postgres enforces, so a green run without a database " +
    "asserts nothing about any of them.",
});

const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";

const CONSTRAINTS = [
  "site_control_room_views_kind_check",
  "site_control_room_views_builtin_key_check",
  "site_control_room_views_dashboard_id_check",
  "site_control_room_views_builtin_pair_check",
] as const;

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type Rows = { rows: Array<Record<string, unknown>> };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};

describe.skipIf(!has)("F3.67 — bms.site_control_room_views against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let orgA = "";
  let orgB = "";
  let locationType = "";

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F3.67",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
    const orgs = await client.query(`SELECT id FROM bms.organizations ORDER BY code`);
    if (orgs.rows.length < 2) {
      throw new Error(
        "F3.67: needs two bms.organizations rows to prove tenant isolation — run pnpm db:seed.",
      );
    }
    orgA = orgs.rows[0]?.id as string;
    orgB = orgs.rows[1]?.id as string;
    const type = await client.query(`SELECT type FROM bms.locations ORDER BY code LIMIT 1`);
    locationType = type.rows[0]?.type as string;
    if (!locationType) throw new Error("F3.67: needs a seeded location — run pnpm db:seed.");
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  const setOrg = (org: string): Promise<Rows> =>
    client.query(`SET LOCAL app.current_organization = '${org}'`);

  /** Runs `body` inside a rolled-back transaction, as `bms_owner` with org A's tenant GUC. */
  const inTx = async (body: (run: Run) => Promise<void>): Promise<void> => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE bms_owner");
      await setOrg(orgA);
      await body((sql, params) => client.query(sql, params));
    } finally {
      await client.query("ROLLBACK");
    }
  };

  /** A fresh location under `org`, written under that org's GUC; leaves the GUC on org A. */
  const newLocation = async (run: Run, org: string, suffix: string): Promise<string> => {
    await setOrg(org);
    const slug = `f367-${RUN}-${suffix}`.toLowerCase();
    const row = await run(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, 0, 0) RETURNING id`,
      [org, `F367-${RUN}-${suffix}`, slug, `F3.67 ${suffix}`, locationType],
    );
    await setOrg(orgA);
    return row.rows[0]?.id as string;
  };

  /** A fresh organization-wide dashboard under `org` (no location, so a location delete is free). */
  const newDashboard = async (run: Run, org: string, suffix: string): Promise<string> => {
    await setOrg(org);
    const row = await run(
      `INSERT INTO bms.dashboards (organization_id, slug, name) VALUES ($1, $2, $3) RETURNING id`,
      [org, `f367-${RUN}-${suffix}`.toLowerCase(), `F3.67 ${suffix}`],
    );
    await setOrg(orgA);
    return row.rows[0]?.id as string;
  };

  const INSERT_VIEW = `INSERT INTO bms.site_control_room_views
     (location_id, organization_id, kind, dashboard_id, builtin_key) VALUES ($1, $2, $3, $4, $5)`;

  /** Runs `sql` under a SAVEPOINT and returns the error it raised (empty if none). */
  const probe = async (
    run: Run,
    sql: string,
    params: unknown[],
  ): Promise<{ code: string | undefined; message: string }> => {
    await run("SAVEPOINT probe");
    let code: string | undefined;
    let message = "";
    try {
      await run(sql, params);
    } catch (err) {
      code = (err as NodeJS.ErrnoException | undefined)?.code;
      message = err instanceof Error ? err.message : String(err);
    }
    await run("ROLLBACK TO SAVEPOINT probe");
    return { code, message };
  };

  /** Asserts the refusal names `constraint` and none of the other three — so a
   * refusal by the wrong CHECK cannot pass for the right one. */
  const refuses = async (run: Run, params: unknown[], constraint: string): Promise<void> => {
    const { message } = await probe(run, INSERT_VIEW, params);
    expect(message, `expected a refusal naming ${constraint}`).toContain(constraint);
    for (const other of CONSTRAINTS.filter((c) => c !== constraint)) {
      expect(message, `the refusal must not come from ${other}`).not.toContain(other);
    }
  };

  const refusesRls = async (run: Run, params: unknown[]): Promise<void> => {
    const { code } = await probe(run, INSERT_VIEW, params);
    expect(code, "expected a row-level security violation, code 42501").toBe("42501");
  };

  // I1
  it("I1 accepts a generated row for an organization-A location", async () => {
    await inTx(async (run) => {
      const loc = await newLocation(run, orgA, "i1");
      await run(INSERT_VIEW, [loc, orgA, "generated", null, null]);
      const back = await run(
        `SELECT kind FROM bms.site_control_room_views WHERE location_id = $1`,
        [loc],
      );
      expect(back.rows.map((r) => r.kind)).toEqual(["generated"]);
    });
  });

  // I2
  it("I2 refuses an unknown kind, naming _kind_check", async () => {
    await inTx(async (run) => {
      const loc = await newLocation(run, orgA, "i2");
      await refuses(run, [loc, orgA, "mimic", null, null], "site_control_room_views_kind_check");
    });
  });

  // I3
  it("I3 refuses an unknown built-in key, naming _builtin_key_check", async () => {
    await inTx(async (run) => {
      const loc = await newLocation(run, orgA, "i3");
      await refuses(
        run,
        [loc, orgA, "builtin", null, "eskom"],
        "site_control_room_views_builtin_key_check",
      );
    });
  });

  // I4
  it("I4 refuses a dashboard_id on a generated row, naming _dashboard_id_check", async () => {
    await inTx(async (run) => {
      const loc = await newLocation(run, orgA, "i4");
      const dash = await newDashboard(run, orgA, "i4");
      await refuses(
        run,
        [loc, orgA, "generated", dash, null],
        "site_control_room_views_dashboard_id_check",
      );
    });
  });

  // I5a
  it("I5a refuses builtin with no key, naming _builtin_pair_check", async () => {
    await inTx(async (run) => {
      const loc = await newLocation(run, orgA, "i5a");
      await refuses(run, [loc, orgA, "builtin", null, null], "site_control_room_views_builtin_pair_check");
    });
  });

  // I5b
  it("I5b refuses a key on a generated row, naming _builtin_pair_check", async () => {
    await inTx(async (run) => {
      const loc = await newLocation(run, orgA, "i5b");
      await refuses(
        run,
        [loc, orgA, "generated", null, "smoc"],
        "site_control_room_views_builtin_pair_check",
      );
    });
  });

  // I6
  it("I6 under GUC A, refuses a row stamped with organization B", async () => {
    await inTx(async (run) => {
      const loc = await newLocation(run, orgA, "i6");
      await refusesRls(run, [loc, orgB, "generated", null, null]);
    });
  });

  // I7
  it("I7 under GUC A, refuses an organization-A row on an organization-B location", async () => {
    await inTx(async (run) => {
      // Positive control first: the same shape on an own-organization location
      // is accepted, so the refusal below is the locations leg, not a policy
      // that refuses everything.
      const own = await newLocation(run, orgA, "i7a");
      await run(INSERT_VIEW, [own, orgA, "generated", null, null]);

      const foreign = await newLocation(run, orgB, "i7b");
      await refusesRls(run, [foreign, orgA, "generated", null, null]);
    });
  });

  // I8
  it("I8 under GUC A, refuses an organization-A row choosing an organization-B dashboard", async () => {
    await inTx(async (run) => {
      // Positive control first: an own-organization dashboard is accepted.
      const own = await newLocation(run, orgA, "i8a");
      const ownDash = await newDashboard(run, orgA, "i8a");
      await run(INSERT_VIEW, [own, orgA, "dashboard", ownDash, null]);

      const loc = await newLocation(run, orgA, "i8b");
      const foreignDash = await newDashboard(run, orgB, "i8b");
      await refusesRls(run, [loc, orgA, "dashboard", foreignDash, null]);
    });
  });

  // I9a
  it("I9a the organization-A row is visible under GUC A", async () => {
    await inTx(async (run) => {
      const loc = await newLocation(run, orgA, "i9a");
      await run(INSERT_VIEW, [loc, orgA, "generated", null, null]);
      const seen = await run(
        `SELECT count(*)::int AS n FROM bms.site_control_room_views WHERE location_id = $1`,
        [loc],
      );
      expect(seen.rows[0]?.n).toBe(1);
    });
  });

  // I9b
  it("I9b the organization-A row is invisible under GUC B", async () => {
    await inTx(async (run) => {
      const loc = await newLocation(run, orgA, "i9b");
      await run(INSERT_VIEW, [loc, orgA, "generated", null, null]);
      await setOrg(orgB);
      const seen = await run(
        `SELECT count(*)::int AS n FROM bms.site_control_room_views WHERE location_id = $1`,
        [loc],
      );
      expect(seen.rows[0]?.n).toBe(0);
    });
  });

  /** Counts the rows at `location` as `bms_owner` (FORCE-bound) under GUC A. */
  const countUnderA = async (run: Run, location: string): Promise<unknown> => {
    await run("SET LOCAL ROLE bms_owner");
    await setOrg(orgA);
    const seen = await run(
      `SELECT count(*)::int AS n FROM bms.site_control_room_views WHERE location_id = $1`,
      [location],
    );
    return seen.rows[0]?.n;
  };

  // I9c — the USING half's locations leg (migration review M1). The row is
  // written as `bms_fleet` (BYPASSRLS), which the WITH CHECK half would refuse,
  // so only USING can hide it on the read.
  it("I9c under GUC A, hides an organization-A row that sits on an organization-B location", async () => {
    await inTx(async (run) => {
      const own = await newLocation(run, orgA, "i9c-own");
      const foreign = await newLocation(run, orgB, "i9c-foreign");
      await run("SET LOCAL ROLE bms_fleet");
      await run(INSERT_VIEW, [own, orgA, "generated", null, null]);
      await run(INSERT_VIEW, [foreign, orgA, "generated", null, null]);

      // Positive control in the same transaction: the own-organization row is
      // visible, so the 0 below is the locations leg, not a read that sees nothing.
      expect(await countUnderA(run, own)).toBe(1);
      expect(await countUnderA(run, foreign)).toBe(0);
    });
  });

  // I9d — the USING half's dashboards leg (migration review M1).
  it("I9d under GUC A, hides an organization-A row that chose an organization-B dashboard", async () => {
    await inTx(async (run) => {
      const own = await newLocation(run, orgA, "i9d-own");
      const ownDash = await newDashboard(run, orgA, "i9d-own");
      const loc = await newLocation(run, orgA, "i9d-foreign");
      const foreignDash = await newDashboard(run, orgB, "i9d-foreign");
      await run("SET LOCAL ROLE bms_fleet");
      await run(INSERT_VIEW, [own, orgA, "dashboard", ownDash, null]);
      await run(INSERT_VIEW, [loc, orgA, "dashboard", foreignDash, null]);

      // Positive control: a row choosing an own-organization dashboard is visible.
      expect(await countUnderA(run, own)).toBe(1);
      expect(await countUnderA(run, loc)).toBe(0);
    });
  });

  // I10
  it("I10 deleting the chosen dashboard keeps the row, kind 'dashboard', dashboard_id NULL", async () => {
    await inTx(async (run) => {
      const loc = await newLocation(run, orgA, "i10");
      const dash = await newDashboard(run, orgA, "i10");
      await run(INSERT_VIEW, [loc, orgA, "dashboard", dash, null]);

      await run(`DELETE FROM bms.dashboards WHERE id = $1`, [dash]);

      const back = await run(
        `SELECT kind, dashboard_id FROM bms.site_control_room_views WHERE location_id = $1`,
        [loc],
      );
      expect(back.rows).toEqual([{ kind: "dashboard", dashboard_id: null }]);
    });
  });

  // I11
  it("I11 deleting the location removes its row", async () => {
    await inTx(async (run) => {
      const loc = await newLocation(run, orgA, "i11");
      await run(INSERT_VIEW, [loc, orgA, "generated", null, null]);
      // Positive control: the row is there before the delete.
      const before = await run(
        `SELECT count(*)::int AS n FROM bms.site_control_room_views WHERE location_id = $1`,
        [loc],
      );
      expect(before.rows[0]?.n).toBe(1);

      await run(`DELETE FROM bms.locations WHERE id = $1`, [loc]);

      const after = await run(
        `SELECT count(*)::int AS n FROM bms.site_control_room_views WHERE location_id = $1`,
        [loc],
      );
      expect(after.rows[0]?.n).toBe(0);
    });
  });
});
