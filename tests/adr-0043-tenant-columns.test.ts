import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const drizzleDir = join(repoRoot, "packages", "db", "drizzle");

/**
 * E7.1b (ADR 0043 decision 5, "at minimum") — the tenant-column migration.
 *
 * A source-scan invariant, not a running-DB test: §4.6 forbids instantiating a
 * Nest module here, and this repo has shipped both an orphaned spec and an
 * orphaned migration, so the *set* of tables that gain `organization_id` is
 * pinned in code rather than trusted to a reviewer's eye. Modelled on
 * `tests/adr-0045-owner-and-superuser-url.test.ts`.
 *
 * This file covers migration **0046** (the additive column + backfill pass) and
 * **0047** (the enforcement flip: `SET NOT NULL`, `tenant_isolation` policies,
 * `FORCE ROW LEVEL SECURITY`, and the Amendment-4 `bms_auth` policy swap). Both
 * are source scans of the SQL text — they prove the migration *says* the right
 * thing, not that Postgres *does* it; the live behaviour (a foreign-org row
 * invisible, a NULL-org row reachable only via `fleetDb`) is proved by the RLS
 * integration suites.
 */

const migration0046 = (() => {
  const name = readdirSync(drizzleDir).find((f) => f.startsWith("0046_") && f.endsWith(".sql"));
  if (!name) return null;
  return readFileSync(join(drizzleDir, name), "utf8");
})();

const migration0047 = (() => {
  const name = readdirSync(drizzleDir).find((f) => f.startsWith("0047_") && f.endsWith(".sql"));
  if (!name) return null;
  return readFileSync(join(drizzleDir, name), "utf8");
})();

/**
 * The 19 tenant-bearing tables E7.1b gives `organization_id`: decision 5's 13,
 * plus `users` (Amendment 4), plus the five the Task 0 audit found unlisted
 * (`rtu_connection_configs`, `alarm_enrichments`, `work_order_tasks`,
 * `maintenance_task_templates`, `template_points`). Ruled in 2026-08-26 on
 * decision 5's "at minimum" — `rtu_connection_configs` holds encrypted RTU
 * credentials, so leaving it unpoliced is the exact hole RLS closes.
 */
const TENANT_TABLES = [
  "users",
  "rtus",
  "assets",
  "asset_groups",
  "asset_points",
  "alarms",
  "automation_rules",
  "rule_executions",
  "notification_channels",
  "notification_deliveries",
  "work_orders",
  "maintenance_schedules",
  "maintenance_history",
  "audit_log",
  "rtu_connection_configs",
  "alarm_enrichments",
  "work_order_tasks",
  "maintenance_task_templates",
  "template_points",
];

/** Junctions inherit the tenant through their parent — no column of their own. */
const JUNCTIONS = ["asset_group_members", "rule_notifications", "alarm_affected_assets"];

/**
 * The four tables **`0047` itself** leaves with a NULLABLE `organization_id`
 * and a blanket NULL-tolerant policy (decision 5/7 + Amendment 4): a global
 * `admin` `users` row is org-less, and every E7.1b `audit_log`/channel/delivery
 * row was written org-less at the time `0047` landed. This is `0047`'s own
 * text, scanned as-is below — it does not change when a later migration does.
 *
 * **Superseded for current behaviour by `0048`** (ADR 0043 Amendment 5,
 * `E7.1c`): `notification_deliveries` gained `SET NOT NULL` and left this set
 * (4 → 3 nullable tables), and `users`/`notification_channels`/`audit_log`
 * kept a nullable column but had their blanket NULL-tolerant `WITH CHECK`
 * narrowed to role-scoped `TO bms_fleet`. For what the database actually
 * enforces today, see `tests/adr-0043-amendment-5-with-check.test.ts`, not
 * this constant.
 */
const NULLABLE_TENANT_TABLES = [
  "users",
  "audit_log",
  "notification_channels",
  "notification_deliveries",
];

/** The 15 tables 0047 makes `NOT NULL` — every tenant table that is not nullable. */
const NOT_NULL_TABLES = TENANT_TABLES.filter((t) => !NULLABLE_TENANT_TABLES.includes(t));

/** Junction → its org-bearing parent table(s) the 0047 policy subquery must name. */
const JUNCTION_PARENTS: Record<string, string[]> = {
  asset_group_members: ["asset_groups", "assets"],
  alarm_affected_assets: ["alarm_enrichments", "assets"],
  rule_notifications: ["automation_rules"],
};

/**
 * Platform vocabulary and access-control plumbing get no column and no policy.
 * The `user_*_access` grant tables are read during scope resolution on the
 * fleet/auth pools; policying them is out of scope (consistent with F4.16).
 */
const NO_COLUMN = [
  "asset_domains",
  "rule_categories",
  "alarm_severities",
  "alarm_skills",
  "protocol_catalog",
  "notification_channel_kinds",
  "map_locations",
  "user_location_access",
  "user_asset_group_access",
];

describe("E7.1b migration 0046 — the tenant-column + backfill pass exists", () => {
  it("0046 is present in packages/db/drizzle", () => {
    expect(
      migration0046,
      "0046_*.sql not found — Task 1 writes it before this suite goes green",
    ).not.toBeNull();
  });
});

describe("E7.1b / ADR 0043 decision 5 — every tenant table gains organization_id in 0046", () => {
  it.each(TENANT_TABLES)("bms.%s gets ADD COLUMN organization_id", (table) => {
    expect(migration0046).not.toBeNull();
    // `ADD COLUMN [IF NOT EXISTS] organization_id` on this exact table, in any
    // whitespace shape. `\b` after the table name stops `assets` matching
    // `asset_points`.
    const re = new RegExp(
      `ALTER TABLE\\s+bms\\.${table}\\b[\\s\\S]*?ADD COLUMN\\s+(?:IF NOT EXISTS\\s+)?organization_id`,
      "i",
    );
    expect(migration0046).toMatch(re);
  });

  it.each(JUNCTIONS)("junction bms.%s gets NO organization_id column", (table) => {
    expect(migration0046).not.toBeNull();
    const re = new RegExp(
      `ALTER TABLE\\s+bms\\.${table}\\b[\\s\\S]*?ADD COLUMN\\s+(?:IF NOT EXISTS\\s+)?organization_id`,
      "i",
    );
    expect(migration0046).not.toMatch(re);
  });

  it.each(NO_COLUMN)("vocabulary/plumbing bms.%s gets NO organization_id column", (table) => {
    expect(migration0046).not.toBeNull();
    const re = new RegExp(
      `ALTER TABLE\\s+bms\\.${table}\\b[\\s\\S]*?ADD COLUMN\\s+(?:IF NOT EXISTS\\s+)?organization_id`,
      "i",
    );
    expect(migration0046).not.toMatch(re);
  });
});

describe("E7.1b — 0046 mechanism guards", () => {
  it("takes and returns the owner role (ADR 0045)", () => {
    expect(migration0046).toMatch(/\bSET\s+ROLE\s+bms_owner\b/i);
    expect(migration0046).toMatch(/\bRESET\s+ROLE\b/i);
  });

  /**
   * The backfill JOINs `bms.locations`, which carries `FORCE ROW LEVEL SECURITY`
   * (0040/0041) binding `bms_owner`. As `bms_owner` with no tenant GUC it sees
   * zero locations, so the backfill must run inside a per-organization loop that
   * sets `app.current_organization`. The no-superuser rule forbids the simpler
   * `bms_app` bypass (ADR 0045 §4).
   */
  it("backfills inside a per-organization GUC loop, not a superuser bypass", () => {
    expect(migration0046).toMatch(/FROM\s+bms\.organizations/i);
    expect(migration0046).toMatch(/set_config\(\s*'app\.current_organization'/i);
  });

  /**
   * A tenant-scoped row that resolves to no organization is a data error, not a
   * default (decision 11). The migration must fail loud, listing the ids.
   */
  it("aborts on any unresolved tenant-scoped row", () => {
    expect(migration0046).toMatch(/RAISE\s+EXCEPTION/i);
  });

  /**
   * `bms.users` gaining `organization_id` is unreadable to the pool roles unless
   * the column-level grant names it (0039:80-81). `bms_auth` needs it to read
   * the home org during the pre-tenant bootstrap.
   */
  it("grants SELECT on the new bms.users.organization_id column to bms_auth", () => {
    expect(migration0046).toMatch(
      /GRANT\s+SELECT\s*\(\s*organization_id\s*\)\s+ON\s+bms\.users[\s\S]*?bms_auth/i,
    );
  });
});

describe("E7.1b migration 0047 — the enforcement flip exists", () => {
  it("0047 is present in packages/db/drizzle", () => {
    expect(
      migration0047,
      "0047_*.sql not found — Task 4 writes it before this suite goes green",
    ).not.toBeNull();
  });

  it("takes and returns the owner role (ADR 0045)", () => {
    expect(migration0047).toMatch(/\bSET\s+ROLE\s+bms_owner\b/i);
    expect(migration0047).toMatch(/\bRESET\s+ROLE\b/i);
  });
});

describe("E7.1b / 0047 — SET NOT NULL on the 15, and NOT on the 4 nullable", () => {
  it.each(NOT_NULL_TABLES)("bms.%s is made NOT NULL", (table) => {
    expect(migration0047).not.toBeNull();
    const re = new RegExp(
      `ALTER TABLE\\s+bms\\.${table}\\s+ALTER COLUMN organization_id SET NOT NULL`,
      "i",
    );
    expect(migration0047).toMatch(re);
  });

  it.each(NULLABLE_TENANT_TABLES)("bms.%s is NOT made NOT NULL (nullable by design)", (table) => {
    expect(migration0047).not.toBeNull();
    const re = new RegExp(
      `ALTER TABLE\\s+bms\\.${table}\\s+ALTER COLUMN organization_id SET NOT NULL`,
      "i",
    );
    expect(migration0047).not.toMatch(re);
  });
});

describe("E7.1b / 0047 — every tenant table and junction gets a tenant_isolation policy + FORCE", () => {
  it.each([...TENANT_TABLES, ...JUNCTIONS])("bms.%s gets CREATE POLICY tenant_isolation", (table) => {
    expect(migration0047).not.toBeNull();
    const re = new RegExp(`CREATE POLICY tenant_isolation ON bms\\.${table}\\b`, "i");
    expect(migration0047).toMatch(re);
  });

  it.each([...TENANT_TABLES, ...JUNCTIONS])("bms.%s gets FORCE ROW LEVEL SECURITY", (table) => {
    expect(migration0047).not.toBeNull();
    const re = new RegExp(`ALTER TABLE\\s+bms\\.${table}\\s+FORCE ROW LEVEL SECURITY`, "i");
    expect(migration0047).toMatch(re);
  });
});

describe("E7.1b / 0047 — as 0047 wrote it, the 4 nullable tables get a NULL-tolerant WITH CHECK", () => {
  /**
   * A NULL-org insert must not be rejected (a global `admin` user, an org-less
   * audit/channel/delivery row) — in `0047`'s own text. `[^;]*` bounds the scan
   * to this table's single CREATE POLICY statement, so it cannot borrow another
   * table's clause.
   *
   * `0048` (Amendment 5, `E7.1c`) later narrows three of these four to a
   * role-scoped `TO bms_fleet` disjunct and removes the fourth
   * (`notification_deliveries`) outright — this block does not track that; it
   * stays green because `0047`'s file has not changed. See
   * `tests/adr-0043-amendment-5-with-check.test.ts` for the current state.
   */
  it.each(NULLABLE_TENANT_TABLES)("bms.%s policy admits organization_id IS NULL", (table) => {
    expect(migration0047).not.toBeNull();
    const re = new RegExp(
      `CREATE POLICY tenant_isolation ON bms\\.${table}\\b[^;]*organization_id IS NULL`,
      "i",
    );
    expect(migration0047).toMatch(re);
  });
});

describe("E7.1b / 0047 — junction policies key on their org-bearing parent(s)", () => {
  it.each(JUNCTIONS)("bms.%s policy names each parent it isolates through", (junction) => {
    expect(migration0047).not.toBeNull();
    for (const parent of JUNCTION_PARENTS[junction]) {
      const re = new RegExp(
        `CREATE POLICY tenant_isolation ON bms\\.${junction}\\b[^;]*bms\\.${parent}\\b`,
        "i",
      );
      expect(migration0047, `${junction} policy must reference bms.${parent}`).toMatch(re);
    }
  });
});

describe("E7.1b / 0047 — Amendment 4 auth-pool swap", () => {
  it("gives bms_auth a SELECT bootstrap policy on bms.users", () => {
    expect(migration0047).toMatch(
      /CREATE POLICY auth_bootstrap_read ON bms\.users\b[^;]*FOR SELECT TO bms_auth/i,
    );
  });

  /**
   * Without an UPDATE policy the login `last_login_at` write silently matches
   * zero rows under FORCE (org = NULL, never true) — the plan's swap named only
   * the SELECT policy; this closes that gap.
   */
  it("gives bms_auth an UPDATE bootstrap policy on bms.users (last_login_at)", () => {
    expect(migration0047).toMatch(
      /CREATE POLICY auth_bootstrap_write ON bms\.users\b[^;]*FOR UPDATE TO bms_auth/i,
    );
  });

  it("drops the old bms_auth bootstrap policies on locations and user_organization_access", () => {
    expect(migration0047).toMatch(/DROP POLICY IF EXISTS auth_bootstrap_read ON bms\.locations/i);
    expect(migration0047).toMatch(
      /DROP POLICY IF EXISTS auth_bootstrap_read ON bms\.user_organization_access/i,
    );
  });

  it.each(["user_organization_access", "user_location_access", "locations"])(
    "revokes bms_auth's SELECT on bms.%s (Amendment 1's standing removal)",
    (table) => {
      const re = new RegExp(`REVOKE SELECT ON bms\\.${table} FROM bms_auth`, "i");
      expect(migration0047).toMatch(re);
    },
  );
});
