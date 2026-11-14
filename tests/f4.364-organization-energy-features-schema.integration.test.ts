import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F4.364` / ADR 0133 decision 1 — what migration `0153` guarantees against a real database.
 * `tests/f4.364-organization-energy-features-schema.test.ts` asserts the migration's *text*; this
 * asserts what Postgres enforces, on the `e4.1c-organization-currency-schema.integration.test.ts`
 * lifecycle: superuser pool, one held client, one rolled-back transaction per case, a per-probe
 * `SAVEPOINT`, every code suffixed with a per-run `randomUUID()`.
 *
 * **Every case rolls back** — `BEGIN` … `ROLLBACK` in a `finally`: a leaked organization is a stray
 * tenant on a shared database.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F4.364",
  label: "organization energy-features schema tests",
  because:
    "the 'auto' defaults and the two CHECKs are things Postgres enforces, so a green run without a " +
    "database asserts nothing about them.",
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
type PgError = { code?: string; constraint?: string };

describe.skipIf(!has)("F4.364 — organizations energy features against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F4.364",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  const run: Run = (sql, params) => client.query(sql, params);

  /** Runs `body` inside a transaction that ALWAYS rolls back, as `bms_owner`. */
  const inTx = async (body: (run: Run) => Promise<void>): Promise<void> => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE bms_owner");
      await body(run);
    } finally {
      await client.query("ROLLBACK");
    }
  };

  const INSERT = `INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id`;

  const refuses = async (run: Run, sql: string, params: unknown[], constraint: string): Promise<void> => {
    await run("SAVEPOINT probe");
    let err: PgError | undefined;
    try {
      await run(sql, params);
    } catch (e) {
      err = e as PgError;
    }
    await run("ROLLBACK TO SAVEPOINT probe");
    expect(err?.code, "expected SQLSTATE 23514").toBe("23514");
    expect(err?.constraint).toBe(constraint);
  };

  it("a new organization reads auto / auto", async () => {
    await inTx(async (run) => {
      const inserted = await run(INSERT, [`F4364-A-${RUN}`, "F4.364 A"]);
      const back = await run(
        `SELECT energy_features, card_primary_metric FROM bms.organizations WHERE id = $1`,
        [inserted.rows[0]?.id],
      );
      expect(back.rows[0]).toEqual({ energy_features: "auto", card_primary_metric: "auto" });
    });
  });

  it("'maybe' on either column is refused with 23514 naming its CHECK; a listed value is accepted", async () => {
    await inTx(async (run) => {
      const inserted = await run(INSERT, [`F4364-B-${RUN}`, "F4.364 B"]);
      const id = inserted.rows[0]?.id;
      await refuses(
        run,
        `UPDATE bms.organizations SET energy_features = 'maybe' WHERE id = $1`,
        [id],
        "organizations_energy_features_check",
      );
      await refuses(
        run,
        `UPDATE bms.organizations SET card_primary_metric = 'maybe' WHERE id = $1`,
        [id],
        "organizations_card_primary_metric_check",
      );
      // Positive control: the CHECKs refuse only what is outside the list.
      await run(`UPDATE bms.organizations SET energy_features = 'off', card_primary_metric = 'critical_alarms' WHERE id = $1`, [id]);
      const back = await run(`SELECT energy_features, card_primary_metric FROM bms.organizations WHERE id = $1`, [id]);
      expect(back.rows[0]).toEqual({ energy_features: "off", card_primary_metric: "critical_alarms" });
    });
  });
});
