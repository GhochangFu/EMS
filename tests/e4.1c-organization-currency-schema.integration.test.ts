import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `E4.1c` / ADR 0070 decision 8 — what migration `0076` guarantees against a
 * real database. `tests/e4.1c-organization-currency-schema.test.ts` asserts
 * the migration's *text*; this asserts what Postgres actually enforces,
 * following `tests/e4.1a-calc-parameters-schema.integration.test.ts`'s
 * lifecycle: superuser pool, one held client, one rolled-back transaction per
 * case, a per-probe `SAVEPOINT`, every code suffixed with a per-run
 * `randomUUID()`.
 *
 * **Every case rolls back** — `BEGIN` … `ROLLBACK` in a `finally`, never a
 * bare return: a case that merely returns COMMITS, and `verifyHierarchySeed`
 * asserts `count(*) FROM bms.organizations = 2` on every `db:seed`, so one
 * leaked organization stops the compose stack from starting.
 *
 * **Roles.** `bms.organizations` carries no RLS policy, so the owner would
 * see the rows here — but I5 still counts as `bms_fleet` and asserts
 * `current_user` in the same case, because `FORCE ROW LEVEL SECURITY` returns
 * 0 to the owner on every tenant table and the habit must hold (repo memory).
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "E4.1c",
  label: "organization currency schema tests",
  because:
    "NOT NULL with no default, the ISO 4217 shape CHECK and the backfilled values are all " +
    "things Postgres enforces, so a green run without a database asserts nothing about any of them.",
  connection: "superuser",
});

const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";

type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type Row = Record<string, unknown>;
type Run = (sql: string, params?: unknown[]) => Promise<{ rows: Row[] }>;
type IntegrationClient = {
  query: <R extends Row = Row>(sql: string, params?: unknown[]) => Promise<{ rows: R[] }>;
  release: () => void;
};
type PgError = { code?: string; constraint?: string; column?: string; message?: string };

describe.skipIf(!has)("E4.1c — organizations.currency against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "E4.1c",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  const run: Run = (sql, params) => client.query(sql, params);

  /** Runs `body` inside a transaction that ALWAYS rolls back, as `bms_owner`. */
  const inTx = async (role: "bms_owner" | "bms_fleet", body: (run: Run) => Promise<void>): Promise<void> => {
    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL ROLE ${role}`);
      await body(run);
    } finally {
      await client.query("ROLLBACK");
    }
  };

  const INSERT_WITHOUT = `INSERT INTO bms.organizations (code, name) VALUES ($1, $2) RETURNING id`;
  const INSERT_WITH = `INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, $3) RETURNING id`;

  /** Asserts the SQLSTATE and the constraint/column name off the error object,
   * not the message (RLS suppresses a violation's DETAIL — repo memory). */
  const refuses = async (
    run: Run,
    sql: string,
    params: unknown[],
    code: string,
    named?: { constraint?: string; column?: string },
  ): Promise<void> => {
    await run("SAVEPOINT probe");
    let err: PgError | undefined;
    try {
      await run(sql, params);
    } catch (e) {
      err = e as PgError;
    }
    await run("ROLLBACK TO SAVEPOINT probe");
    expect(err?.code, `expected SQLSTATE ${code}`).toBe(code);
    if (named?.constraint) {
      expect(err?.constraint, `expected the refusal to name ${named.constraint}`).toBe(named.constraint);
    }
    if (named?.column) {
      expect(err?.column, `expected the refusal to name column ${named.column}`).toBe(named.column);
    }
  };

  // I1
  it("the column is character(3), NOT NULL, with no default", async () => {
    await inTx("bms_owner", async (run) => {
      const { rows } = await run(
        `SELECT data_type, character_maximum_length, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema = 'bms' AND table_name = 'organizations' AND column_name = 'currency'`,
      );
      expect(rows.length, "bms.organizations.currency must exist — has 0076 been applied?").toBe(1);
      expect(rows[0]).toEqual({
        data_type: "character",
        character_maximum_length: 3,
        is_nullable: "NO",
        column_default: null,
      });
    });
  });

  // I2 — the NOT NULL is real: an insert without the column is 23502 naming it.
  it("an insert without currency is refused with 23502 (not_null_violation) naming the column", async () => {
    await inTx("bms_owner", async (run) => {
      await refuses(run, INSERT_WITHOUT, [`E41C-I2-${RUN}`, "E4.1c I2"], "23502", { column: "currency" });
    });
  });

  // I3 — the shape CHECK: lower-case is refused, naming the constraint.
  it("'zar' is refused with 23514 naming organizations_currency_check", async () => {
    await inTx("bms_owner", async (run) => {
      await refuses(run, INSERT_WITH, [`E41C-I3-${RUN}`, "E4.1c I3", "zar"], "23514", {
        constraint: "organizations_currency_check",
      });
      // The same constraint refuses a two-letter and a four-letter code.
      await refuses(run, INSERT_WITH, [`E41C-I3B-${RUN}`, "E4.1c I3b", "ZA"], "23514", {
        constraint: "organizations_currency_check",
      });
      await refuses(run, INSERT_WITH, [`E41C-I3C-${RUN}`, "E4.1c I3c", "ZARR"], "22001");
    });
  });

  // I4 — the positive control for I2 and I3: a well-formed code is accepted and read back unchanged.
  it("'INR' is accepted and reads back as 'INR'", async () => {
    await inTx("bms_owner", async (run) => {
      const inserted = await run(INSERT_WITH, [`E41C-I4-${RUN}`, "E4.1c I4", "INR"]);
      expect(inserted.rows.length).toBe(1);
      const back = await run(`SELECT currency FROM bms.organizations WHERE id = $1`, [inserted.rows[0]?.id]);
      expect(back.rows[0]?.currency).toBe("INR");
    });
  });

  // I5 — the backfill / seed values, counted as bms_fleet in the same case.
  it("as bms_fleet, ESKOM reads ZAR and PHEWB reads INR", async () => {
    await inTx("bms_fleet", async (run) => {
      const who = await run(`SELECT current_user`);
      expect(who.rows[0]?.current_user, "the read must be taken as the fleet role").toBe("bms_fleet");
      const { rows } = await run(
        `SELECT code, currency FROM bms.organizations WHERE code IN ('ESKOM', 'PHEWB') ORDER BY code`,
      );
      expect(rows).toEqual([
        { code: "ESKOM", currency: "ZAR" },
        { code: "PHEWB", currency: "INR" },
      ]);
    });
  });
});
