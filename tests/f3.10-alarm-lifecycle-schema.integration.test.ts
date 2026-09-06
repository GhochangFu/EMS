import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
} from "../apps/api/src/testing/integration-db-gate.js";

/**
 * `F3.10` U3 — what migration `0066_alarm_lifecycle.sql` guarantees against
 * a real Postgres. Model: `tests/f3.8-notification-schema.integration.test.ts`
 * (why this lives in `tests/` and not `packages/db`: `vitest.config.ts` never
 * collects `packages/db`, so a suite there would never run).
 *
 * Six things are worth a database to check, and none can be checked without
 * one:
 *
 * 1. The three columns exist, nullable, with the declared types.
 * 2. `alarms_open_per_rule_uidx` predicates on `cleared_at IS NULL` as the
 *    planner stored it — the static `.sql` says what was asked, not what is.
 * 3. The predicate's behaviour (ADR 0057 decision 2): an acknowledged,
 *    uncleared alarm and a new open alarm for the same `(asset_id, rule_id)`
 *    cannot coexist, while a cleared alarm and a new open one can.
 * 4. `alarm_escalation_defaults.severity` is a real foreign key into
 *    `bms.alarm_severities` (plan D11: the database validates it, not a
 *    `VocabulariesModule` import), and a profile is unique per
 *    `(organization_id, code)`.
 * 5. All four escalation tables carry `ENABLE` + `FORCE ROW LEVEL SECURITY`
 *    and a `tenant_isolation` policy — `tests/adr-0043-tenant-columns.test.ts`
 *    scans `0046`/`0047` only.
 * 6. The two `notification_deliveries` indexes the PR 1 readers promised
 *    exist, and `0065`'s subsumed one is gone.
 *
 * Runs as `bms_fleet` (the gate's default, BYPASSRLS): every case here is a
 * constraint or a catalogue fact, not an RLS proof. The policies' behaviour
 * under `bms_tenant` is the escalation service's RLS suite (U8).
 *
 * **Assertions inline, no `.spec` sibling** — the top-level `tests/` carve-out
 * (§4.6). Every row this suite writes is prefixed and removed.
 */

const connectionString = requireIntegrationDb({
  item: "F3.10",
  label: "alarm lifecycle schema tests",
  because:
    "the unique index's stored predicate, the severity foreign key, the FORCE flags and the " +
    "deliveries indexes are all things Postgres holds, so a green run without a database " +
    "asserts nothing about any of them.",
});

// Derived, not imported from `pg`: that package is a dependency of `apps/api`
// and `packages/db`, not of the repo root, so a `pg` type import fails
// `typecheck:tests`. `f3.8-notification-schema.integration.test.ts` does the same.
type IntegrationPool = Awaited<ReturnType<typeof openIntegrationPool>>;

/** Prefixed so a leftover row from a failed run is recognisable and removable. */
const RULE_CODE = "f3-10-schema-test-rule";
const PROFILE_CODE = "f3-10-schema-test-profile";

type SqlError = Error & { code?: string; constraint?: string };

/** Awaits a refusal and returns the SQLSTATE and constraint name it carried. */
async function refusal(work: Promise<unknown>): Promise<{ code: string; constraint: string }> {
  try {
    await work;
  } catch (err) {
    const e = err as SqlError;
    return { code: e.code ?? "", constraint: e.constraint ?? "" };
  }
  throw new Error("expected the statement to be refused, but it succeeded");
}

describe.skipIf(!connectionString)("F3.10 alarm lifecycle schema (migration 0066)", () => {
  let pool: IntegrationPool | undefined;
  let organizationId: string;
  let assetId: string;
  let ruleId: string;

  async function removeTestRows(): Promise<void> {
    if (!pool) throw new Error("pool not initialised");
    await pool.query(
      `DELETE FROM bms.alarms
        WHERE rule_id IN (SELECT id FROM bms.automation_rules WHERE code = $1)`,
      [RULE_CODE],
    );
    await pool.query(`DELETE FROM bms.automation_rules WHERE code = $1`, [RULE_CODE]);
    // Defaults first: `alarm_escalation_defaults_profile_id_fk` is NO ACTION
    // on purpose, so a mapped profile cannot be deleted. Steps cascade.
    await pool.query(
      `DELETE FROM bms.alarm_escalation_defaults
        WHERE profile_id IN (SELECT id FROM bms.alarm_escalation_profiles WHERE code LIKE $1)`,
      [`${PROFILE_CODE}%`],
    );
    await pool.query(`DELETE FROM bms.alarm_escalation_profiles WHERE code LIKE $1`, [
      `${PROFILE_CODE}%`,
    ]);
  }

  async function insertAlarm(acknowledged: boolean): Promise<string> {
    if (!pool) throw new Error("pool not initialised");
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO bms.alarms (organization_id, asset_id, rule_id, severity, message, acknowledged_at)
       VALUES ($1, $2, $3, 'warning', 'F3.10 schema test alarm',
               CASE WHEN $4::boolean THEN now() ELSE NULL END)
       RETURNING id`,
      [organizationId, assetId, ruleId, acknowledged],
    );
    const row = inserted.rows[0];
    if (row === undefined) throw new Error("could not insert the test alarm");
    return row.id;
  }

  async function insertProfile(code: string): Promise<string> {
    if (!pool) throw new Error("pool not initialised");
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO bms.alarm_escalation_profiles (organization_id, code, name)
       VALUES ($1, $2, 'F3.10 schema test profile')
       RETURNING id`,
      [organizationId, code],
    );
    const row = inserted.rows[0];
    if (row === undefined) throw new Error("could not insert the test profile");
    return row.id;
  }

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F3.10");
    await removeTestRows();
    const org = await pool.query<{ id: string }>(
      `SELECT id FROM bms.organizations ORDER BY code LIMIT 1`,
    );
    const orgRow = org.rows[0];
    if (orgRow === undefined) throw new Error("F3.10: no bms.organizations row — run pnpm db:seed.");
    organizationId = orgRow.id;
    // A seeded asset, not a fixture one (`F4.53`): the alarm rows below need
    // an asset to hang off, and the seed's own assets are the stable choice.
    const asset = await pool.query<{ id: string }>(
      `SELECT id FROM bms.assets WHERE organization_id = $1 ORDER BY id LIMIT 1`,
      [organizationId],
    );
    const assetRow = asset.rows[0];
    if (assetRow === undefined) throw new Error("F3.10: no bms.assets row for the organization — run pnpm db:seed.");
    assetId = assetRow.id;
    // Disabled, so the alarm engine never evaluates it; the unique index is
    // per `(asset_id, rule_id)`, so a fixture rule keeps the seeded rules'
    // open alarms out of the test's way.
    const rule = await pool.query<{ id: string }>(
      `INSERT INTO bms.automation_rules (organization_id, code, name, rule_type, asset_id, enabled)
       VALUES ($1, $2, 'F3.10 schema test rule', 'threshold', $3, false)
       RETURNING id`,
      [organizationId, RULE_CODE, assetId],
    );
    const ruleRow = rule.rows[0];
    if (ruleRow === undefined) throw new Error("could not create the test rule");
    ruleId = ruleRow.id;
  }, 60_000);

  afterAll(async () => {
    if (pool) await removeTestRows();
    await pool?.end();
  }, 60_000);

  it("adds cleared_at and normal_since to alarms and clear_hold_seconds to automation_rules, all nullable", async () => {
    if (!pool) throw new Error("pool not initialised");
    const columns = await pool.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT table_name, column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'bms'
          AND ((table_name = 'alarms' AND column_name IN ('cleared_at', 'normal_since'))
            OR (table_name = 'automation_rules' AND column_name = 'clear_hold_seconds'))
        ORDER BY table_name, column_name`,
    );
    expect(columns.rows).toEqual([
      { table_name: "alarms", column_name: "cleared_at", data_type: "timestamp with time zone", is_nullable: "YES" },
      { table_name: "alarms", column_name: "normal_since", data_type: "timestamp with time zone", is_nullable: "YES" },
      { table_name: "automation_rules", column_name: "clear_hold_seconds", data_type: "integer", is_nullable: "YES" },
    ]);
  });

  it("alarms_open_per_rule_uidx predicates on cleared_at IS NULL, not acknowledged_at", async () => {
    if (!pool) throw new Error("pool not initialised");
    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'bms' AND tablename = 'alarms' AND indexname = 'alarms_open_per_rule_uidx'`,
    );
    expect(rows.length, "alarms_open_per_rule_uidx must exist — run pnpm db:migrate to apply 0066").toBe(1);
    const indexdef = rows[0]!.indexdef;
    expect(indexdef).toContain("CREATE UNIQUE INDEX");
    expect(indexdef).toContain("(asset_id, rule_id)");
    expect(indexdef).toContain("cleared_at IS NULL");
    expect(indexdef).toContain("rule_id IS NOT NULL");
    expect(indexdef).not.toContain("acknowledged_at");
  });

  it("an acknowledged, uncleared alarm blocks a second open row; a cleared one does not (decision 2)", async () => {
    if (!pool) throw new Error("pool not initialised");
    const acknowledged = await insertAlarm(true);

    // Under the old predicate this second row was allowed — that is the
    // re-raise-after-acknowledge the ADR closes.
    const blocked = await refusal(insertAlarm(false));
    expect(blocked.code).toBe("23505");
    expect(blocked.constraint).toBe("alarms_open_per_rule_uidx");

    await pool.query(`UPDATE bms.alarms SET cleared_at = now() WHERE id = $1`, [acknowledged]);

    // The post-clear re-raise: a new row opens once the previous one clears.
    const reopened = await insertAlarm(false);
    expect(reopened).not.toBe(acknowledged);

    // And the new open row is itself the one open row per (asset, rule).
    const blockedAgain = await refusal(insertAlarm(false));
    expect(blockedAgain.code).toBe("23505");

    const open = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM bms.alarms
        WHERE asset_id = $1 AND rule_id = $2 AND cleared_at IS NULL`,
      [assetId, ruleId],
    );
    expect(open.rows[0]?.count).toBe("1");
  });

  it("alarm_escalation_defaults.severity is a foreign key into alarm_severities (plan D11)", async () => {
    if (!pool) throw new Error("pool not initialised");
    const profileId = await insertProfile(PROFILE_CODE);

    const refused = await refusal(
      pool.query(
        `INSERT INTO bms.alarm_escalation_defaults (organization_id, severity, profile_id)
         VALUES ($1, 'urgent', $2)`,
        [organizationId, profileId],
      ),
    );
    expect(refused.code).toBe("23503");
    expect(refused.constraint).toBe("alarm_escalation_defaults_severity_fk");

    // A live code is accepted. Rolled back rather than deleted, and the code
    // is one this organization has not mapped, so the shared database's own
    // configuration is never in the way and never touched.
    const live = await pool.query<{ code: string }>(
      `SELECT s.code FROM bms.alarm_severities s
        WHERE NOT EXISTS (SELECT 1 FROM bms.alarm_escalation_defaults d
                           WHERE d.organization_id = $1 AND d.severity = s.code)
        ORDER BY s.code LIMIT 1`,
      [organizationId],
    );
    const severity = live.rows[0]?.code;
    expect(severity, "every severity is already mapped for this organization").toBeDefined();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO bms.alarm_escalation_defaults (organization_id, severity, profile_id)
         VALUES ($1, $2, $3)`,
        [organizationId, severity, profileId],
      );
      const mapped = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM bms.alarm_escalation_defaults WHERE profile_id = $1`,
        [profileId],
      );
      expect(mapped.rows[0]?.count).toBe("1");
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("a profile is unique per (organization_id, code)", async () => {
    if (!pool) throw new Error("pool not initialised");
    // Inserts its own first row rather than leaning on the severity case's
    // profile: a case that only refuses a duplicate someone else created
    // passes for the wrong reason when the file runs whole and fails outright
    // under `-t`. The suffix keeps it clear of that case's `PROFILE_CODE`, and
    // `removeTestRows` sweeps `LIKE '${PROFILE_CODE}%'`, so it is cleaned up.
    const code = `${PROFILE_CODE}-unique`;
    await insertProfile(code);
    const refused = await refusal(insertProfile(code));
    expect(refused.code).toBe("23505");
    expect(refused.constraint).toBe("alarm_escalation_profiles_org_code_key");
  });

  it("steps cascade with their profile (plan D6)", async () => {
    if (!pool) throw new Error("pool not initialised");
    const profileId = await insertProfile(`${PROFILE_CODE}-cascade`);
    await pool.query(
      `INSERT INTO bms.alarm_escalation_steps (profile_id, step_no, after_minutes) VALUES ($1, 1, 5)`,
      [profileId],
    );
    await pool.query(`DELETE FROM bms.alarm_escalation_profiles WHERE id = $1`, [profileId]);
    const left = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM bms.alarm_escalation_steps WHERE profile_id = $1`,
      [profileId],
    );
    expect(left.rows[0]?.count).toBe("0");
  });

  it("all four escalation tables are ENABLE + FORCE with a tenant_isolation policy", async () => {
    if (!pool) throw new Error("pool not initialised");
    const flags = await pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'bms' AND c.relkind = 'r' AND c.relname LIKE 'alarm_escalation%'
        ORDER BY c.relname`,
    );
    expect(flags.rows).toEqual([
      { relname: "alarm_escalation_defaults", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "alarm_escalation_profiles", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "alarm_escalation_step_channels", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "alarm_escalation_steps", relrowsecurity: true, relforcerowsecurity: true },
    ]);

    const policies = await pool.query<{ tablename: string; policyname: string }>(
      `SELECT tablename, policyname FROM pg_policies
        WHERE schemaname = 'bms' AND tablename LIKE 'alarm_escalation%'
        ORDER BY tablename, policyname`,
    );
    expect(policies.rows).toEqual([
      { tablename: "alarm_escalation_defaults", policyname: "tenant_isolation" },
      { tablename: "alarm_escalation_profiles", policyname: "tenant_isolation" },
      { tablename: "alarm_escalation_step_channels", policyname: "tenant_isolation" },
      { tablename: "alarm_escalation_steps", policyname: "tenant_isolation" },
    ]);
  });

  it("notification_deliveries has the channel-key and alarm indexes, and 0065's skip index is gone", async () => {
    if (!pool) throw new Error("pool not initialised");
    const { rows } = await pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'bms' AND tablename = 'notification_deliveries'
          AND indexname IN ('notification_deliveries_channel_key_idx',
                            'notification_deliveries_alarm_idx',
                            'notification_deliveries_dedupe_skip_idx')
        ORDER BY indexname`,
    );
    const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]));

    const channelKey = byName.get("notification_deliveries_channel_key_idx");
    expect(channelKey, "notification_deliveries_channel_key_idx missing — run pnpm db:migrate").toBeDefined();
    expect(channelKey).toContain("(channel_id, dedupe_key)");
    expect(channelKey).toContain("dedupe_key IS NOT NULL");

    const alarm = byName.get("notification_deliveries_alarm_idx");
    expect(alarm, "notification_deliveries_alarm_idx missing — run pnpm db:migrate").toBeDefined();
    expect(alarm).toContain("(alarm_id)");
    expect(alarm).toContain("alarm_id IS NOT NULL");

    expect(
      byName.has("notification_deliveries_dedupe_skip_idx"),
      "0065's notification_deliveries_dedupe_skip_idx must be dropped by 0066 — the channel-key index subsumes it",
    ).toBe(false);
  });
});
