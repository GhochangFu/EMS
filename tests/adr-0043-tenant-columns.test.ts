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
 * This file covers migration **0046** only (the additive column + backfill
 * pass). The `tenant_isolation` policies, `FORCE ROW LEVEL SECURITY`, and the
 * Amendment-4 `bms_auth` policy swap land in **0047** (Task 4), and this file is
 * extended to assert them then. Splitting the assertions keeps the Task-1
 * migration checkpoint's suite green.
 */

const migration0046 = (() => {
  const name = readdirSync(drizzleDir).find((f) => f.startsWith("0046_") && f.endsWith(".sql"));
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
