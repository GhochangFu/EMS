import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `E7.2` / ADR 0123 decisions 5 and 6, plan C8 — what migration `0141`
 * (`bms.edge_gateways`, `bms.rtus.edge_gateway_id`) guarantees against a real
 * database, with migration `0142` (the tenant pool reads and never writes,
 * ADR 0123 decision 12). `tests/e7.2-edge-gateways-schema.test.ts` asserts the
 * text; this asserts what Postgres enforces.
 *
 * The `tests/f4.311-calc-backfill-runs-schema.integration.test.ts` lifecycle:
 * superuser pool, one held client, every case inside `BEGIN … ROLLBACK`, a
 * role reached by `SET LOCAL ROLE` plus the tenant GUC, and a
 * `SAVEPOINT`-protected probe per refusal that names the constraint it expects.
 * Nothing commits.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "E7.2",
  label: "edge gateways schema tests",
  because:
    "the composite tenant keys, the CHECKs, the unique token-hash index, FORCE row level " +
    "security and bms_fleet's inherited UPDATE on bms.edge_gateways are all things Postgres " +
    "enforces, so a green run without a database asserts nothing about any of them.",
});

const RUN = randomUUID().slice(0, 8);
const has = connectionString !== undefined && connectionString !== "";

type Rows = { rows: Array<Record<string, unknown>> };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};

/** 32 bytes, as a hex literal for `decode(..., 'hex')`. */
const HASH_32 = "ab".repeat(32);
const HASH_31 = "ab".repeat(31);

describe.skipIf(!has)("E7.2 — edge gateways schema against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let eskom = "";
  let phewb = "";
  let eskomLocation = "";
  let phewbLocation = "";
  let eskomRtu = "";
  let phewbRtu = "";

  /** The oldest row of a seeded table for one organization (F4.53). */
  const oldest = async (table: "locations" | "rtus", org: string): Promise<string> => {
    const r = await client.query(
      `SELECT id FROM bms.${table} WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
      [org],
    );
    const id = r.rows[0]?.id as string | undefined;
    if (!id) throw new Error(`E7.2: needs a seeded bms.${table} row for organization ${org} — run pnpm db:seed.`);
    return id;
  };

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "E7.2",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
    const orgs = await client.query(
      `SELECT id, code FROM bms.organizations WHERE code IN ('ESKOM', 'PHEWB')`,
    );
    eskom = orgs.rows.find((r) => r.code === "ESKOM")?.id as string;
    phewb = orgs.rows.find((r) => r.code === "PHEWB")?.id as string;
    if (!eskom || !phewb) throw new Error("E7.2: needs the seeded ESKOM and PHEWB organizations — run pnpm db:seed.");
    eskomLocation = await oldest("locations", eskom);
    phewbLocation = await oldest("locations", phewb);
    eskomRtu = await oldest("rtus", eskom);
    phewbRtu = await oldest("rtus", phewb);
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  /** One rolled-back transaction; `role` `null` stays the superuser (no RLS). */
  const inTx = async (role: string | null, org: string, body: (run: Run) => Promise<void>): Promise<void> => {
    await client.query("BEGIN");
    try {
      if (role !== null) await client.query(`SET LOCAL ROLE ${role}`);
      await client.query(`SET LOCAL app.current_organization = '${org}'`);
      await body((sql, params) => client.query(sql, params));
    } finally {
      await client.query("ROLLBACK");
    }
  };

  const probe = async (
    run: Run,
    sql: string,
    params: unknown[] = [],
  ): Promise<{ code: string | undefined; message: string; rows: number }> => {
    await run("SAVEPOINT probe");
    let code: string | undefined;
    let message = "";
    let rows = 0;
    try {
      rows = (await run(sql, params)).rows.length;
    } catch (err) {
      code = (err as NodeJS.ErrnoException | undefined)?.code;
      message = err instanceof Error ? err.message : String(err);
    }
    await run("ROLLBACK TO SAVEPOINT probe");
    return { code, message, rows };
  };

  /** $1 organization, $2 location (nullable), $3 code, $4 status, $5 hash hex (nullable). */
  const INSERT_GATEWAY = `INSERT INTO bms.edge_gateways (organization_id, location_id, code, name, status, token_hash)
    VALUES ($1, $2, $3, 'E7.2 fixture gateway', $4, decode($5::text, 'hex'))
    RETURNING id`;

  const insertGateway = async (
    run: Run,
    org: string,
    location: string | null,
    code = `E72-${RUN}`,
  ): Promise<string> => {
    const r = await run(INSERT_GATEWAY, [org, location, code, "active", null]);
    return r.rows[0]?.id as string;
  };

  it("FORCE row level security is on for edge_gateways", async () => {
    const r = await client.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'bms.edge_gateways'::regclass`,
    );
    expect(r.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("a good row inserts for its own organization and location, with the defaults", async () => {
    await inTx("bms_owner", eskom, async (run) => {
      const r = await probe(run, INSERT_GATEWAY, [eskom, eskomLocation, `E72-${RUN}`, "active", HASH_32]);
      expect(r.message).toBe("");
      expect(r.code).toBeUndefined();
      expect(r.rows).toBe(1);
      await run(INSERT_GATEWAY, [eskom, eskomLocation, `E72-${RUN}`, "active", HASH_32]);
      const row = await run(
        `SELECT status, octet_length(token_hash) AS len, backfill_dirty_from, clock_state
           FROM bms.edge_gateways WHERE code = $1`,
        [`E72-${RUN}`],
      );
      expect(row.rows[0]).toEqual({ status: "active", len: 32, backfill_dirty_from: null, clock_state: null });
    });
  });

  it("refuses a status outside active | revoked, 23514 edge_gateways_status_check", async () => {
    await inTx("bms_owner", eskom, async (run) => {
      const r = await probe(run, INSERT_GATEWAY, [eskom, null, `E72-${RUN}`, "paused", null]);
      expect(r.code).toBe("23514");
      expect(r.message).toContain("edge_gateways_status_check");
    });
  });

  it("refuses a clock_state outside synced | unsynced, 23514 edge_gateways_clock_state_check", async () => {
    await inTx("bms_owner", eskom, async (run) => {
      const id = await insertGateway(run, eskom, null);
      const r = await probe(run, `UPDATE bms.edge_gateways SET clock_state = 'drifting' WHERE id = $1`, [id]);
      expect(r.code).toBe("23514");
      expect(r.message).toContain("edge_gateways_clock_state_check");
    });
  });

  it("refuses a 31-byte token hash, 23514 edge_gateways_token_hash_check", async () => {
    await inTx("bms_owner", eskom, async (run) => {
      const r = await probe(run, INSERT_GATEWAY, [eskom, null, `E72-${RUN}`, "active", HASH_31]);
      expect(r.code).toBe("23514");
      expect(r.message).toContain("edge_gateways_token_hash_check");
    });
  });

  it("refuses a duplicate (organization, code), 23505 edge_gateways_organization_id_code_key", async () => {
    await inTx("bms_owner", eskom, async (run) => {
      await insertGateway(run, eskom, null);
      const r = await probe(run, INSERT_GATEWAY, [eskom, null, `E72-${RUN}`, "active", null]);
      expect(r.code).toBe("23505");
      expect(r.message).toContain("edge_gateways_organization_id_code_key");
    });
  });

  it("refuses a second gateway with the same token hash, 23505 edge_gateways_token_hash_key", async () => {
    await inTx(null, eskom, async (run) => {
      await run(INSERT_GATEWAY, [eskom, null, `E72-${RUN}-a`, "active", HASH_32]);
      const r = await probe(run, INSERT_GATEWAY, [phewb, null, `E72-${RUN}-b`, "active", HASH_32]);
      expect(r.code).toBe("23505");
      expect(r.message).toContain("edge_gateways_token_hash_key");
      // The index is partial: two un-minted gateways (NULL hash) coexist.
      await run(INSERT_GATEWAY, [eskom, null, `E72-${RUN}-c`, "active", null]);
      const ok = await probe(run, INSERT_GATEWAY, [eskom, null, `E72-${RUN}-d`, "active", null]);
      expect(ok.message).toBe("");
    });
  });

  it("refuses a half-set or inverted dirty window, 23514 edge_gateways_backfill_window_check", async () => {
    await inTx("bms_owner", eskom, async (run) => {
      const id = await insertGateway(run, eskom, null);
      for (const set of [
        "backfill_dirty_from = now()",
        "backfill_dirty_to = now()",
        "backfill_dirty_from = now(), backfill_dirty_to = now() - interval '1 hour'",
      ]) {
        const r = await probe(run, `UPDATE bms.edge_gateways SET ${set} WHERE id = $1`, [id]);
        expect(r.code, set).toBe("23514");
        expect(r.message, set).toContain("edge_gateways_backfill_window_check");
      }
      const ok = await probe(
        run,
        `UPDATE bms.edge_gateways SET backfill_dirty_from = now() - interval '4 hours', backfill_dirty_to = now()
          WHERE id = $1 RETURNING id`,
        [id],
      );
      expect(ok.message, "an ordered, fully-set window is accepted").toBe("");
      expect(ok.rows).toBe(1);
    });
  });

  it("refuses a gateway on another organization's location, 23503 edge_gateways_location_id_organization_id_fkey", async () => {
    // Superuser: the referential check runs with row security off whatever the
    // caller sees, which is exactly the hole the composite key closes.
    await inTx(null, eskom, async (run) => {
      const r = await probe(run, INSERT_GATEWAY, [eskom, phewbLocation, `E72-${RUN}`, "active", null]);
      expect(r.code).toBe("23503");
      expect(r.message).toContain("edge_gateways_location_id_organization_id_fkey");
    });
  });

  it("refuses an RTU of organization B on a gateway of organization A, 23503 rtus_edge_gateway_id_organization_id_fkey", async () => {
    await inTx(null, eskom, async (run) => {
      const gateway = await insertGateway(run, eskom, eskomLocation);
      const foreign = await probe(run, `UPDATE bms.rtus SET edge_gateway_id = $1 WHERE id = $2 RETURNING id`, [
        gateway,
        phewbRtu,
      ]);
      expect(foreign.code).toBe("23503");
      expect(foreign.message).toContain("rtus_edge_gateway_id_organization_id_fkey");
      // Adjacent positive: the same gateway takes an RTU of its own organization.
      const own = await probe(run, `UPDATE bms.rtus SET edge_gateway_id = $1 WHERE id = $2 RETURNING id`, [
        gateway,
        eskomRtu,
      ]);
      expect(own.message).toBe("");
      expect(own.rows).toBe(1);
    });
  });

  it("bms_tenant under organization A reads its gateway; under B it reads nothing", async () => {
    await inTx(null, eskom, async (run) => {
      const gateway = await insertGateway(run, eskom, null);
      await run("SET LOCAL ROLE bms_tenant");

      await run(`SET LOCAL app.current_organization = '${eskom}'`);
      const own = await run(`SELECT id FROM bms.edge_gateways WHERE id = $1`, [gateway]);
      expect(own.rows, "adjacent positive: organization A sees its own gateway").toHaveLength(1);

      await run(`SET LOCAL app.current_organization = '${phewb}'`);
      const read = await run(`SELECT id FROM bms.edge_gateways WHERE id = $1`, [gateway]);
      expect(read.rows, "organization B must not read A's gateway").toHaveLength(0);
    });
  });

  it("bms_tenant cannot INSERT, UPDATE or DELETE a gateway under any organization, 42501 permission denied", async () => {
    // Migration 0142 revokes the three write verbs from the tenant pool
    // (gateways are global-admin only, on the fleet pool), so the refusal is a
    // privilege error before RLS is consulted — the same for the gateway's own
    // organization as for another.
    for (const org of [eskom, phewb]) {
      await inTx(null, eskom, async (run) => {
        const gateway = await insertGateway(run, eskom, null);
        await run("SET LOCAL ROLE bms_tenant");
        await run(`SET LOCAL app.current_organization = '${org}'`);
        const label = org === eskom ? "own organization" : "other organization";
        for (const [verb, sql, params] of [
          ["INSERT", INSERT_GATEWAY, [org, null, `E72-${RUN}-t`, "active", null]],
          ["UPDATE", `UPDATE bms.edge_gateways SET name = 'stolen' WHERE id = $1 RETURNING id`, [gateway]],
          ["DELETE", `DELETE FROM bms.edge_gateways WHERE id = $1 RETURNING id`, [gateway]],
        ] as const) {
          const r = await probe(run, sql, [...params]);
          expect(r.code, `${label}: tenant ${verb}`).toBe("42501");
          expect(r.message, `${label}: tenant ${verb}`).toContain("permission denied");
        }
      });
    }
  });

  it("bms_fleet updates a gateway with no organization set (BYPASSRLS + 0041's default UPDATE)", async () => {
    await inTx(null, eskom, async (run) => {
      const gateway = await insertGateway(run, eskom, null);
      await run("SET LOCAL ROLE bms_fleet");
      await run(`SET LOCAL app.current_organization = ''`);
      const r = await probe(
        run,
        `UPDATE bms.edge_gateways
            SET last_seen_at = now(), reported_backlog = 7, clock_state = 'synced'
          WHERE id = $1 RETURNING id`,
        [gateway],
      );
      expect(r.message).toBe("");
      expect(r.rows).toBe(1);
    });
  });

  it("rtus.edge_gateway_id is a nullable uuid", async () => {
    const col = await client.query(
      `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'bms' AND table_name = 'rtus' AND column_name = 'edge_gateway_id'`,
    );
    expect(col.rows[0]).toEqual({ data_type: "uuid", is_nullable: "YES" });
  });
});
