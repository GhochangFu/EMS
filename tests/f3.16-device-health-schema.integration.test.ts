import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F3.16` / ADR 0127 decisions 7 and 17 — what migration `0149`
 * (`bms.rtu_health`, `bms.rtu_drop_hours`, `bms.ingest_hosts`,
 * `bms.ingest_endpoint_drop_hours`) guarantees against a real database.
 * `tests/f3.16-device-health-schema.test.ts` asserts the text; this asserts
 * what Postgres enforces.
 *
 * The `tests/e7.2-edge-gateways-schema.integration.test.ts` lifecycle: one held
 * client, every case inside `BEGIN … ROLLBACK`, a role reached by `SET LOCAL ROLE`
 * plus the tenant GUC, and a `SAVEPOINT`-protected probe per refusal. Nothing
 * commits.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F3.16",
  label: "device health schema tests",
  because:
    "the composite tenant keys, the CHECKs, FORCE row level security and the revokes from " +
    "bms_tenant are all things Postgres enforces, so a green run without a database asserts " +
    "nothing about any of them.",
});

const has = connectionString !== undefined && connectionString !== "";
const RUN = randomUUID().slice(0, 8);

type Rows = { rows: Array<Record<string, unknown>> };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};

describe.skipIf(!has)("F3.16 — device health schema against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let eskom = "";
  let phewb = "";
  let eskomRtu = "";
  let phewbRtu = "";

  const oldestRtu = async (org: string): Promise<string> => {
    const r = await client.query(
      `SELECT id FROM bms.rtus WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
      [org],
    );
    const id = r.rows[0]?.id as string | undefined;
    if (!id) throw new Error(`F3.16: needs a seeded bms.rtus row for organization ${org} — run pnpm db:seed.`);
    return id;
  };

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F3.16",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
    const orgs = await client.query(`SELECT id, code FROM bms.organizations WHERE code IN ('ESKOM', 'PHEWB')`);
    eskom = orgs.rows.find((r) => r.code === "ESKOM")?.id as string;
    phewb = orgs.rows.find((r) => r.code === "PHEWB")?.id as string;
    if (!eskom || !phewb) throw new Error("F3.16: needs the seeded ESKOM and PHEWB organizations — run pnpm db:seed.");
    eskomRtu = await oldestRtu(eskom);
    phewbRtu = await oldestRtu(phewb);
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  const inTx = async (role: string | null, org: string | null, body: (run: Run) => Promise<void>): Promise<void> => {
    await client.query("BEGIN");
    try {
      if (role !== null) await client.query(`SET LOCAL ROLE ${role}`);
      if (org !== null) await client.query(`SET LOCAL app.current_organization = '${org}'`);
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

  const INSERT_HEALTH = `INSERT INTO bms.rtu_health (rtu_id, organization_id, host_key, last_seen_at)
    VALUES ($1, $2, $3, now()) RETURNING rtu_id`;
  const INSERT_DROP = `INSERT INTO bms.rtu_drop_hours (organization_id, rtu_id, bucket, reason, dropped)
    VALUES ($1, $2, $3::timestamptz, $4, $5) RETURNING rtu_id`;
  const HOUR = "2026-01-01T10:00:00Z";

  it("FORCE row level security is on for both tenant tables", async () => {
    const r = await client.query(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE oid IN ('bms.rtu_health'::regclass, 'bms.rtu_drop_hours'::regclass) ORDER BY relname`,
    );
    expect(r.rows).toEqual([
      { relname: "rtu_drop_hours", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "rtu_health", relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });

  it("as bms_tenant on organization A only A's rtu_health rows read; with the setting unset, none", async () => {
    await inTx("bms_fleet", null, async (run) => {
      // bms_fleet is BYPASSRLS: it writes both organizations' rows.
      expect((await probe(run, INSERT_HEALTH, [eskomRtu, eskom, `f316-${RUN}`])).message).toBe("");
      await run(INSERT_HEALTH, [eskomRtu, eskom, `f316-${RUN}`]);
      await run(INSERT_HEALTH, [phewbRtu, phewb, `f316-${RUN}`]);
      await run("RESET ROLE");
      await run("SET LOCAL ROLE bms_tenant");
      await run(`SET LOCAL app.current_organization = '${eskom}'`);
      const own = await run(`SELECT organization_id FROM bms.rtu_health WHERE host_key = $1`, [`f316-${RUN}`]);
      expect(own.rows.map((r) => r.organization_id)).toEqual([eskom]);
      await run(`SET LOCAL app.current_organization = ''`);
      const none = await run(`SELECT 1 FROM bms.rtu_health WHERE host_key = $1`, [`f316-${RUN}`]);
      expect(none.rows).toHaveLength(0);
    });
  });

  it("as bms_tenant INSERT, UPDATE and DELETE on both tenant tables are refused with 42501", async () => {
    await inTx("bms_tenant", eskom, async (run) => {
      for (const [sql, params] of [
        [INSERT_HEALTH, [eskomRtu, eskom, "x"]],
        [INSERT_DROP, [eskom, eskomRtu, HOUR, "badQuality", 1]],
        [`UPDATE bms.rtu_health SET host_key = 'y'`, []],
        [`UPDATE bms.rtu_drop_hours SET dropped = 2`, []],
        [`DELETE FROM bms.rtu_health`, []],
        [`DELETE FROM bms.rtu_drop_hours`, []],
      ] as Array<[string, unknown[]]>) {
        const r = await probe(run, sql, params);
        expect(r.code, `${sql}: ${r.message}`).toBe("42501");
      }
    });
  });

  it("as bms_tenant SELECT on the two platform tables is refused with 42501", async () => {
    await inTx("bms_tenant", eskom, async (run) => {
      for (const table of ["ingest_hosts", "ingest_endpoint_drop_hours"]) {
        const r = await probe(run, `SELECT 1 FROM bms.${table}`);
        expect(r.code, `${table}: ${r.message}`).toBe("42501");
      }
    });
  });

  it("as bms_fleet the upserts work on all four tables", async () => {
    await inTx("bms_fleet", null, async (run) => {
      const upsertHealth = `INSERT INTO bms.rtu_health (rtu_id, organization_id, host_key, last_seen_at)
        SELECT id, organization_id, $2, now() FROM bms.rtus WHERE id = $1
        ON CONFLICT (rtu_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at, updated_at = now()`;
      expect((await probe(run, upsertHealth, [eskomRtu, "h"])).message).toBe("");
      await run(upsertHealth, [eskomRtu, "h"]);
      await run(upsertHealth, [eskomRtu, "h"]);
      const dropSql = `${INSERT_DROP.replace("RETURNING rtu_id", "")} ON CONFLICT (rtu_id, bucket, reason)
        DO UPDATE SET dropped = bms.rtu_drop_hours.dropped + EXCLUDED.dropped`;
      await run(dropSql, [eskom, eskomRtu, HOUR, "badQuality", 2]);
      await run(dropSql, [eskom, eskomRtu, HOUR, "badQuality", 3]);
      const drops = await run(`SELECT dropped::int AS dropped FROM bms.rtu_drop_hours WHERE rtu_id = $1`, [eskomRtu]);
      expect(drops.rows).toEqual([{ dropped: 5 }]);
      await run(
        `INSERT INTO bms.ingest_hosts (host_key, started_at, last_beat_at, endpoints) VALUES ($1, now(), now(), 2)
         ON CONFLICT (host_key) DO UPDATE SET last_beat_at = now()`,
        [`f316-${RUN}`],
      );
      await run(
        `INSERT INTO bms.ingest_endpoint_drop_hours (host_key, endpoint_key, bucket, reason, dropped)
         VALUES ($1, 'mqtts://broker:8883', $2::timestamptz, 'unknownDevice', 1)`,
        [`f316-${RUN}`, HOUR],
      );
      const hosts = await run(`SELECT endpoints FROM bms.ingest_hosts WHERE host_key = $1`, [`f316-${RUN}`]);
      expect(hosts.rows).toEqual([{ endpoints: 2 }]);
    });
  });

  it("a row whose organization_id is not its RTU's is refused with 23503", async () => {
    await inTx("bms_fleet", null, async (run) => {
      const health = await probe(run, INSERT_HEALTH, [eskomRtu, phewb, "x"]);
      expect(health.code, health.message).toBe("23503");
      expect(health.message).toContain("rtu_health_rtu_id_organization_id_fkey");
      const drop = await probe(run, INSERT_DROP, [phewb, eskomRtu, HOUR, "badQuality", 1]);
      expect(drop.code, drop.message).toBe("23503");
      expect(drop.message).toContain("rtu_drop_hours_rtu_id_organization_id_fkey");
    });
  });

  it("a whole UTC hour is a valid bucket in a half-hour session time zone (Asia/Kolkata)", async () => {
    await inTx("bms_fleet", null, async (run) => {
      await run("SET LOCAL timezone = 'Asia/Kolkata'");
      const drop = await probe(run, INSERT_DROP, [eskom, eskomRtu, HOUR, "badQuality", 1]);
      expect(drop.code, drop.message).toBeUndefined();
      const platform = await probe(
        run,
        `INSERT INTO bms.ingest_endpoint_drop_hours (host_key, endpoint_key, bucket, reason, dropped)
         VALUES ('h', 'e', $1::timestamptz, 'unknownDevice', 1)`,
        [HOUR],
      );
      expect(platform.code, platform.message).toBeUndefined();
    });
  });

  it("an unknown reason, a non-hour bucket and a zero count are refused with 23514", async () => {
    await inTx("bms_fleet", null, async (run) => {
      const reason = await probe(run, INSERT_DROP, [eskom, eskomRtu, HOUR, "seventh", 1]);
      expect(reason.code, reason.message).toBe("23514");
      expect(reason.message).toContain("rtu_drop_hours_reason_check");
      const bucket = await probe(run, INSERT_DROP, [eskom, eskomRtu, "2026-01-01T10:30:00Z", "badQuality", 1]);
      expect(bucket.code, bucket.message).toBe("23514");
      expect(bucket.message).toContain("rtu_drop_hours_bucket_check");
      const zero = await probe(run, INSERT_DROP, [eskom, eskomRtu, HOUR, "badQuality", 0]);
      expect(zero.code, zero.message).toBe("23514");
      expect(zero.message).toContain("rtu_drop_hours_dropped_check");
      const platform = await probe(
        run,
        `INSERT INTO bms.ingest_endpoint_drop_hours (host_key, endpoint_key, bucket, reason, dropped)
         VALUES ('h', 'e', $1::timestamptz, 'seventh', 1)`,
        [HOUR],
      );
      expect(platform.code, platform.message).toBe("23514");
    });
  });
});
