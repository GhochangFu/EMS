import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F3.16` / ADR 0127 decision 12 — what migration `0151` (device alarms in
 * `bms.alarms`) guarantees against a real database.
 * `tests/f3.16-device-alarms-schema.test.ts` asserts the text; this asserts
 * what Postgres enforces.
 *
 * The `tests/f3.16-device-health-schema.integration.test.ts` lifecycle: one held
 * client, every case inside `BEGIN … ROLLBACK`, `bms_tenant` (the role
 * `AlarmRaiser` writes as) reached by `SET LOCAL ROLE` plus the tenant GUC, and a
 * `SAVEPOINT`-protected probe per refusal. Nothing commits.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F3.16",
  label: "device alarms schema tests",
  because:
    "the per-device dedupe index, the shape CHECK and the composite RTU key are all things " +
    "Postgres enforces, so a green run without a database asserts nothing about any of them.",
});

const has = connectionString !== undefined && connectionString !== "";

type Rows = { rows: Array<Record<string, unknown>> };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};

describe.skipIf(!has)("F3.16 — device alarms schema against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  let eskom = "";
  let phewb = "";
  let eskomRtu = "";
  let phewbRtu = "";
  let eskomAsset = "";
  let eskomRule = "";

  const first = async (sql: string, org: string, what: string): Promise<string> => {
    const r = await client.query(sql, [org]);
    const id = r.rows[0]?.id as string | undefined;
    if (!id) throw new Error(`F3.16: needs a seeded ${what} for organization ${org} — run pnpm db:seed.`);
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
    const rtu = `SELECT id FROM bms.rtus WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`;
    eskomRtu = await first(rtu, eskom, "bms.rtus row");
    phewbRtu = await first(rtu, phewb, "bms.rtus row");
    eskomAsset = await first(
      `SELECT id FROM bms.assets WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
      eskom,
      "bms.assets row",
    );
    eskomRule = await first(
      `SELECT id FROM bms.automation_rules WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
      eskom,
      "bms.automation_rules row",
    );
  });

  afterAll(async () => {
    client?.release();
    await pool?.end();
  });

  const asTenant = async (org: string, body: (run: Run) => Promise<void>): Promise<void> => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE bms_tenant");
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

  /** The raiser's statement: a bare ON CONFLICT DO NOTHING, so an open duplicate returns no row. */
  const RAISE = `INSERT INTO bms.alarms (organization_id, source, asset_id, rtu_id, rule_id, severity, message)
    VALUES ($1, $2, $3, $4, $5, 'warning', 'F3.16 test')
    ON CONFLICT DO NOTHING RETURNING id`;

  it("a second open rtu_comms alarm for one RTU is deduped; a new one opens after a clear", async () => {
    await asTenant(eskom, async (run) => {
      const opened = await run(RAISE, [eskom, "rtu_comms", null, eskomRtu, null]);
      expect(opened.rows).toHaveLength(1);
      expect((await run(RAISE, [eskom, "rtu_comms", null, eskomRtu, null])).rows).toHaveLength(0);
      await run(`UPDATE bms.alarms SET cleared_at = now() WHERE id = $1`, [opened.rows[0]?.id]);
      expect((await run(RAISE, [eskom, "rtu_comms", null, eskomRtu, null])).rows).toHaveLength(1);
    });
  });

  it("one open ingest_host alarm per organization; a bare INSERT duplicate is refused with 23505", async () => {
    await asTenant(eskom, async (run) => {
      expect((await run(RAISE, [eskom, "ingest_host", null, null, null])).rows).toHaveLength(1);
      expect((await run(RAISE, [eskom, "ingest_host", null, null, null])).rows).toHaveLength(0);
      const dup = await probe(
        run,
        `INSERT INTO bms.alarms (organization_id, source, severity, message)
         VALUES ($1, 'ingest_host', 'critical', 'dup')`,
        [eskom],
      );
      expect(dup.code, dup.message).toBe("23505");
      expect(dup.message).toContain("alarms_open_per_device_uidx");
      // An rtu_comms alarm in the same organization is a different key.
      expect((await run(RAISE, [eskom, "rtu_comms", null, eskomRtu, null])).rows).toHaveLength(1);
    });
  });

  it("each wrong shape is refused with 23514", async () => {
    await asTenant(eskom, async (run) => {
      const cases: Array<[string, unknown[], string]> = [
        ["rule with no asset", [eskom, "rule", null, null, eskomRule], "alarms_source_shape_check"],
        ["rule with an RTU", [eskom, "rule", eskomAsset, eskomRtu, eskomRule], "alarms_source_shape_check"],
        ["rtu_comms with no RTU", [eskom, "rtu_comms", null, null, null], "alarms_source_shape_check"],
        ["rtu_comms with an asset", [eskom, "rtu_comms", eskomAsset, eskomRtu, null], "alarms_source_shape_check"],
        ["rtu_comms with a rule", [eskom, "rtu_comms", null, eskomRtu, eskomRule], "alarms_source_shape_check"],
        ["ingest_host with an RTU", [eskom, "ingest_host", null, eskomRtu, null], "alarms_source_shape_check"],
        ["ingest_host with an asset", [eskom, "ingest_host", eskomAsset, null, null], "alarms_source_shape_check"],
        ["ingest_host with a rule", [eskom, "ingest_host", null, null, eskomRule], "alarms_source_shape_check"],
        ["an unknown source", [eskom, "edge_gateway", null, null, null], "alarms_source_check"],
      ];
      for (const [label, params, constraint] of cases) {
        const r = await probe(run, RAISE, params);
        expect(r.code, `${label}: ${r.message}`).toBe("23514");
        expect(r.message, label).toContain(constraint);
      }
    });
  });

  it("an rtu_comms alarm naming an RTU of another organization is refused with 23503", async () => {
    await asTenant(eskom, async (run) => {
      const r = await probe(run, RAISE, [eskom, "rtu_comms", null, phewbRtu, null]);
      expect(r.code, r.message).toBe("23503");
      expect(r.message).toContain("alarms_rtu_id_organization_id_fkey");
    });
  });

  it("the rule dedupe behaves as before: one open alarm per (asset, rule), source defaults to rule", async () => {
    await asTenant(eskom, async (run) => {
      const ruleRaise = `INSERT INTO bms.alarms (organization_id, asset_id, rule_id, severity, message)
        VALUES ($1, $2, $3, 'warning', 'F3.16 rule') ON CONFLICT DO NOTHING RETURNING id, source`;
      // Clear whatever the seed left open for this pair, so the first raise is ours.
      await run(`UPDATE bms.alarms SET cleared_at = now() WHERE asset_id = $1 AND rule_id = $2 AND cleared_at IS NULL`, [
        eskomAsset,
        eskomRule,
      ]);
      const opened = await run(ruleRaise, [eskom, eskomAsset, eskomRule]);
      expect(opened.rows).toEqual([{ id: expect.any(String), source: "rule" }]);
      expect((await run(ruleRaise, [eskom, eskomAsset, eskomRule])).rows).toHaveLength(0);
      const dup = await probe(
        run,
        `INSERT INTO bms.alarms (organization_id, asset_id, rule_id, severity, message)
         VALUES ($1, $2, $3, 'warning', 'dup')`,
        [eskom, eskomAsset, eskomRule],
      );
      expect(dup.code, dup.message).toBe("23505");
      expect(dup.message).toContain("alarms_open_per_rule_uidx");
      // Two open rule alarms on different assets never meet the per-device index.
      const other = await run(
        `SELECT id FROM bms.assets WHERE organization_id = $1 AND id <> $2 ORDER BY created_at, id LIMIT 1`,
        [eskom, eskomAsset],
      );
      await run(`UPDATE bms.alarms SET cleared_at = now() WHERE asset_id = $1 AND rule_id = $2 AND cleared_at IS NULL`, [
        other.rows[0]?.id,
        eskomRule,
      ]);
      expect((await run(ruleRaise, [eskom, other.rows[0]?.id, eskomRule])).rows).toHaveLength(1);
    });
  });
});
