import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F4.359` / ADR 0131 decision 17 (+ plan ruling Q2) — what migration `0152`
 * (`bms.maintenance_windows`, `bms.maintenance_window_targets`, the three
 * suppression columns on `bms.alarms`) guarantees against a real database.
 * `tests/f4.359-maintenance-windows-schema.test.ts` asserts the text; this
 * asserts what Postgres enforces.
 *
 * The `tests/f3.16-device-alarms-schema.integration.test.ts` lifecycle: one held
 * client on the superuser pool, every case inside `BEGIN … ROLLBACK`, a role
 * reached by `SET LOCAL ROLE` plus the tenant GUC, and a `SAVEPOINT`-protected
 * probe per refusal. Nothing commits.
 */
const connectionString = process.env.DATABASE_URL;

requireIntegrationDb({
  item: "F4.359",
  label: "maintenance windows schema tests",
  because:
    "the one-target CHECK, the composite tenant keys, the suppressed shape CHECK and FORCE row " +
    "level security are all things Postgres enforces, so a green run without a database asserts " +
    "nothing about any of them.",
});

const has = connectionString !== undefined && connectionString !== "";
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const MIGRATION_SQL = readFileSync(join(repoRoot, "packages/db/drizzle/0152_maintenance_windows.sql"), "utf8");

type Rows = { rows: Array<Record<string, unknown>>; rowCount?: number | null };
type Run = (sql: string, params?: unknown[]) => Promise<Rows>;
type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;
type IntegrationClient = {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  release: () => void;
};

type Org = { id: string; asset: string; location: string; rule: string };

describe.skipIf(!has)("F4.359 — maintenance windows schema against a live database", () => {
  let pool: IntegrationPool;
  let client: IntegrationClient;
  const eskom: Org = { id: "", asset: "", location: "", rule: "" };
  const phewb: Org = { id: "", asset: "", location: "", rule: "" };
  let user = "";

  const first = async (sql: string, params: unknown[], what: string): Promise<string> => {
    const r = await client.query(sql, params);
    const id = r.rows[0]?.id as string | undefined;
    if (!id) throw new Error(`F4.359: needs a seeded ${what} — run pnpm db:seed.`);
    return id;
  };

  const fill = async (org: Org, code: string): Promise<void> => {
    org.id = await first(`SELECT id FROM bms.organizations WHERE code = $1`, [code], `${code} organization`);
    org.asset = await first(
      `SELECT id FROM bms.assets WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
      [org.id],
      `bms.assets row in ${code}`,
    );
    org.location = await first(
      `SELECT id FROM bms.locations WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
      [org.id],
      `bms.locations row in ${code}`,
    );
    const rule = await client.query(
      `SELECT id FROM bms.automation_rules WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
      [org.id],
    );
    org.rule = (rule.rows[0]?.id as string | undefined) ?? "";
  };

  /** The organization's seeded rule, or (PHEWB seeds none) one written inside the case's rolled-back transaction. */
  const ruleOf = async (run: Run, org: Org): Promise<string> => {
    if (org.rule !== "") return org.rule;
    const r = await run(
      `INSERT INTO bms.automation_rules (organization_id, code, name, rule_type, asset_id)
       VALUES ($1, 'F4359-' || substr(gen_random_uuid()::text, 1, 8), 'F4.359 schema test', 'threshold', $2) RETURNING id`,
      [org.id, org.asset],
    );
    return r.rows[0]?.id as string;
  };

  beforeAll(async () => {
    pool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "superuser", process.env),
      "F4.359",
    );
    client = (await pool.connect()) as unknown as IntegrationClient;
    await fill(eskom, "ESKOM");
    await fill(phewb, "PHEWB");
    if (eskom.rule === "") throw new Error("F4.359: needs a seeded bms.automation_rules row in ESKOM — run pnpm db:seed.");
    user = await first(`SELECT id FROM bms.users ORDER BY created_at, id LIMIT 1`, [], "bms.users row");
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

  const INSERT_WINDOW = `INSERT INTO bms.maintenance_windows (organization_id, reason, starts_at, ends_at, created_by)
    VALUES ($1, 'F4.359 schema test', now(), now() + interval '1 hour', $2) RETURNING id`;
  const INSERT_TARGET = `INSERT INTO bms.maintenance_window_targets (window_id, organization_id, asset_id, location_id, rule_id)
    VALUES ($1, $2, $3, $4, $5) RETURNING id`;

  const window = async (run: Run, org: string): Promise<string> => {
    const r = await run(INSERT_WINDOW, [org, user]);
    return r.rows[0]?.id as string;
  };

  it("(1) a target with two targets set, or with none, is refused; each single kind is accepted", async () => {
    await inTx(null, null, async (run) => {
      const w = await window(run, eskom.id);
      for (const [label, params] of [
        ["asset and location", [w, eskom.id, eskom.asset, eskom.location, null]],
        ["asset and rule", [w, eskom.id, eskom.asset, null, eskom.rule]],
        ["all three", [w, eskom.id, eskom.asset, eskom.location, eskom.rule]],
        ["none", [w, eskom.id, null, null, null]],
      ] as Array<[string, unknown[]]>) {
        const r = await probe(run, INSERT_TARGET, params);
        expect(r.code, `${label}: ${r.message}`).toBe("23514");
        expect(r.message, label).toContain("maintenance_window_targets_one_target_check");
      }
      for (const params of [
        [w, eskom.id, eskom.asset, null, null],
        [w, eskom.id, null, eskom.location, null],
        [w, eskom.id, null, null, eskom.rule],
      ]) {
        expect((await run(INSERT_TARGET, params)).rows).toHaveLength(1);
      }
      // The partial unique indexes: one asset once per window.
      const dup = await probe(run, INSERT_TARGET, [w, eskom.id, eskom.asset, null, null]);
      expect(dup.code, dup.message).toBe("23505");
      expect(dup.message).toContain("maintenance_window_targets_asset_uidx");
    });
  });

  it("(2) a target whose asset, location or rule is in another organization is refused with 23503", async () => {
    await inTx(null, null, async (run) => {
      const w = await window(run, eskom.id);
      const foreignRule = await ruleOf(run, phewb);
      for (const [label, params, constraint] of [
        ["asset", [w, eskom.id, phewb.asset, null, null], "maintenance_window_targets_asset_fkey"],
        ["location", [w, eskom.id, null, phewb.location, null], "maintenance_window_targets_location_fkey"],
        ["rule", [w, eskom.id, null, null, foreignRule], "maintenance_window_targets_rule_fkey"],
        // A target row claiming the other organization breaks the window key instead.
        ["window", [w, phewb.id, phewb.asset, null, null], "maintenance_window_targets_window_fkey"],
      ] as Array<[string, unknown[], string]>) {
        const r = await probe(run, INSERT_TARGET, params);
        expect(r.code, `${label}: ${r.message}`).toBe("23503");
        expect(r.message, label).toContain(constraint);
      }
    });
  });

  it("(2b) a window cannot link a work order or a maintenance schedule of another organization", async () => {
    await inTx(null, null, async (run) => {
      const workOrder = (
        await run(
          `INSERT INTO bms.work_orders (organization_id, seq, reference, asset_id, title)
           VALUES ($1, 999001, 'F4359-' || substr(gen_random_uuid()::text, 1, 8), $2, 'F4.359 link test') RETURNING id`,
          [phewb.id, phewb.asset],
        )
      ).rows[0]?.id as string;
      const template = (
        await run(
          `INSERT INTO bms.maintenance_task_templates (organization_id, asset_id, title) VALUES ($1, $2, 'F4.359 link test') RETURNING id`,
          [phewb.id, phewb.asset],
        )
      ).rows[0]?.id as string;
      const schedule = (
        await run(
          `INSERT INTO bms.maintenance_schedules (organization_id, template_id, interval_days, next_due_at)
           VALUES ($1, $2, 90, now() + interval '10 days') RETURNING id`,
          [phewb.id, template],
        )
      ).rows[0]?.id as string;
      const insert = (column: string): string =>
        `INSERT INTO bms.maintenance_windows (organization_id, reason, starts_at, ends_at, created_by, ${column})
         VALUES ($1, 'F4.359 schema test', now(), now() + interval '1 hour', $2, $3) RETURNING id`;
      for (const [column, id, constraint] of [
        ["work_order_id", workOrder, "maintenance_windows_work_order_fkey"],
        ["maintenance_schedule_id", schedule, "maintenance_windows_maintenance_schedule_fkey"],
      ] as Array<[string, string, string]>) {
        const foreign = await probe(run, insert(column), [eskom.id, user, id]);
        expect(foreign.code, `${column}: ${foreign.message}`).toBe("23503");
        expect(foreign.message, column).toContain(constraint);
        // The positive twin: the same link from its own organization is accepted.
        expect((await run(insert(column), [phewb.id, user, id])).rows).toHaveLength(1);
      }
    });
  });

  it("(3) ends_at <= starts_at is refused; the ended pair and the reason are held to their shape", async () => {
    await inTx(null, null, async (run) => {
      const insert = `INSERT INTO bms.maintenance_windows (organization_id, reason, starts_at, ends_at, created_by, ended_at, ended_by)
        VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5, $6::timestamptz, $7) RETURNING id`;
      const t0 = "2026-11-13T10:00:00Z";
      const t1 = "2026-11-13T11:00:00Z";
      for (const [label, params, constraint] of [
        ["ends before it starts", [eskom.id, "valid reason", t1, t0, user, null, null], "maintenance_windows_period_check"],
        ["ends as it starts", [eskom.id, "valid reason", t0, t0, user, null, null], "maintenance_windows_period_check"],
        ["ended_at without ended_by", [eskom.id, "valid reason", t0, t1, user, t1, null], "maintenance_windows_ended_shape_check"],
        ["ended_by without ended_at", [eskom.id, "valid reason", t0, t1, user, null, user], "maintenance_windows_ended_shape_check"],
        ["a reason too short after trim", [eskom.id, "   ab   ", t0, t1, user, null, null], "maintenance_windows_reason_check"],
      ] as Array<[string, unknown[], string]>) {
        const r = await probe(run, insert, params);
        expect(r.code, `${label}: ${r.message}`).toBe("23514");
        expect(r.message, label).toContain(constraint);
      }
      expect((await run(insert, [eskom.id, "abc", t0, t1, user, t1, user])).rows).toHaveLength(1);
    });
  });

  /** Claims 4 and 5: the same isolation for the tenant role and for the owner under FORCE. */
  const isolationAs = async (role: "bms_tenant" | "bms_owner"): Promise<void> => {
    await inTx(null, null, async (run) => {
      // Written as the superuser (RLS does not bind it): one window per organization.
      const a = await window(run, eskom.id);
      const b = await window(run, phewb.id);
      await run(INSERT_TARGET, [a, eskom.id, eskom.asset, null, null]);
      await run(INSERT_TARGET, [b, phewb.id, phewb.asset, null, null]);
      await run(`SET LOCAL ROLE ${role}`);
      await run(`SET LOCAL app.current_organization = '${eskom.id}'`);

      const windows = await run(`SELECT id FROM bms.maintenance_windows WHERE id = ANY($1::uuid[])`, [[a, b]]);
      expect(windows.rows.map((r) => r.id)).toEqual([a]);
      const targets = await run(`SELECT window_id FROM bms.maintenance_window_targets WHERE window_id = ANY($1::uuid[])`, [
        [a, b],
      ]);
      expect(targets.rows.map((r) => r.window_id)).toEqual([a]);

      const foreign = await probe(run, INSERT_WINDOW, [phewb.id, user]);
      expect(foreign.code, foreign.message).toBe("42501");
      expect(foreign.message).toContain("row-level security");
      const foreignTarget = await probe(run, INSERT_TARGET, [b, phewb.id, phewb.asset, null, null]);
      expect(foreignTarget.code, foreignTarget.message).toBe("42501");
      expect(foreignTarget.message).toContain("row-level security");
      // The adjacent positives: the own organization's window and target inserts land.
      expect((await probe(run, INSERT_WINDOW, [eskom.id, user])).message).toBe("");
      expect((await probe(run, INSERT_TARGET, [a, eskom.id, null, eskom.location, null])).message).toBe("");

      await run(`SET LOCAL app.current_organization = ''`);
      expect((await run(`SELECT 1 FROM bms.maintenance_windows WHERE id = ANY($1::uuid[])`, [[a, b]])).rows).toHaveLength(0);
      expect(
        (await run(`SELECT 1 FROM bms.maintenance_window_targets WHERE window_id = ANY($1::uuid[])`, [[a, b]])).rows,
      ).toHaveLength(0);
    });
  };

  it("(4) as bms_tenant under A's GUC: B's window is invisible, an insert for B fails WITH CHECK, no GUC sees none", async () => {
    await isolationAs("bms_tenant");
  });

  it("(5) as bms_owner, the table owner, FORCE binds the same policy", async () => {
    // The behaviour first, so a dropped FORCE fails on what it lets through.
    await isolationAs("bms_owner");
    const r = await client.query(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE oid IN ('bms.maintenance_windows'::regclass, 'bms.maintenance_window_targets'::regclass) ORDER BY relname`,
    );
    expect(r.rows).toEqual([
      { relname: "maintenance_window_targets", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "maintenance_windows", relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });

  const STAMP = `UPDATE bms.alarms SET suppressed_at = now(), suppressed_by_window_id = $2 WHERE id = $1`;
  const RAISE = `INSERT INTO bms.alarms (organization_id, source, asset_id, rtu_id, severity, message)
    VALUES ($1, $2, $3, $4, 'warning', 'F4.359 test') RETURNING id`;

  it("(6) an alarm cannot name a window of another organization", async () => {
    await inTx(null, null, async (run) => {
      const own = await window(run, eskom.id);
      const other = await window(run, phewb.id);
      const alarm = (await run(RAISE, [eskom.id, "rule", eskom.asset, null])).rows[0]?.id;
      const r = await probe(run, STAMP, [alarm, other]);
      expect(r.code, r.message).toBe("23503");
      expect(r.message).toContain("alarms_suppressed_by_window_id_organization_id_fkey");
      await run(STAMP, [alarm, own]);
      const read = await run(
        `SELECT suppressed_by_window_id, suppressed_at IS NOT NULL AS stamped, unsuppressed_at FROM bms.alarms WHERE id = $1`,
        [alarm],
      );
      expect(read.rows).toEqual([{ suppressed_by_window_id: own, stamped: true, unsuppressed_at: null }]);
    });
  });

  it("(7) an ingest_host alarm cannot take suppressed_at; an rtu_comms alarm can", async () => {
    await inTx(null, null, async (run) => {
      const w = await window(run, eskom.id);
      const host = (await run(RAISE, [eskom.id, "ingest_host", null, null])).rows[0]?.id;
      const r = await probe(run, STAMP, [host, w]);
      expect(r.code, r.message).toBe("23514");
      expect(r.message).toContain("alarms_suppressed_shape_check");
      const rtu = (await run(`SELECT id FROM bms.rtus WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`, [eskom.id]))
        .rows[0]?.id;
      expect(rtu, "needs a seeded ESKOM RTU").toBeDefined();
      await run(
        `UPDATE bms.alarms SET cleared_at = now() WHERE organization_id = $1 AND source = 'rtu_comms' AND rtu_id = $2 AND cleared_at IS NULL`,
        [eskom.id, rtu],
      );
      const comms = (await run(RAISE, [eskom.id, "rtu_comms", null, rtu])).rows[0]?.id;
      expect((await probe(run, STAMP, [comms, w])).message).toBe("");
    });
  });

  it("(8) suppressed_at without a window id is refused; a window id alone (a lifted alarm's history) is not", async () => {
    await inTx(null, null, async (run) => {
      const w = await window(run, eskom.id);
      const alarm = (await run(RAISE, [eskom.id, "rule", eskom.asset, null])).rows[0]?.id;
      const r = await probe(run, `UPDATE bms.alarms SET suppressed_at = now() WHERE id = $1`, [alarm]);
      expect(r.code, r.message).toBe("23514");
      expect(r.message).toContain("alarms_suppressed_shape_check");
      const lifted = await probe(
        run,
        `UPDATE bms.alarms SET suppressed_by_window_id = $2, unsuppressed_at = now() WHERE id = $1`,
        [alarm, w],
      );
      expect(lifted.message).toBe("");
    });
  });

  it("(9) the migration replays clean: a second run adds nothing and its proof block passes", async () => {
    const count = `SELECT
        (SELECT count(*)::int FROM pg_constraint WHERE conname LIKE 'maintenance_window%'
            OR conname IN ('assets_id_organization_id_key', 'automation_rules_id_organization_id_key',
                           'alarms_suppressed_by_window_id_organization_id_fkey', 'alarms_suppressed_shape_check')) AS constraints,
        (SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'bms'
            AND (indexname LIKE 'maintenance_window%' OR indexname = 'maintenance_schedules_organization_id_id_key')) AS indexes,
        (SELECT count(*)::int FROM pg_policy WHERE polrelid IN
            ('bms.maintenance_windows'::regclass, 'bms.maintenance_window_targets'::regclass)) AS policies,
        (SELECT count(*)::int FROM pg_attribute WHERE attrelid = 'bms.alarms'::regclass AND NOT attisdropped
            AND attname IN ('suppressed_at', 'suppressed_by_window_id', 'unsuppressed_at')) AS columns`;
    await client.query("BEGIN");
    try {
      const before = (await client.query(count)).rows[0];
      expect(before).toEqual({ constraints: 21, indexes: 8, policies: 2, columns: 3 });
      await client.query(MIGRATION_SQL);
      expect((await client.query(count)).rows[0]).toEqual(before);
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
