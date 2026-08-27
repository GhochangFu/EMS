import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const drizzleDir = join(repoRoot, "packages", "db", "drizzle");

/**
 * `E7.1c` (ADR 0043 Amendment 5, ruled 2026-08-27) — the migration `0048`
 * must exist before the assertions here can be scanned; the plan writes this
 * test first, and it stays red until `0048` lands (plan `docs/plans/
 * e7.1c-slice-2-channel-org-scope.md` §6 Task 1/3).
 *
 * A source-scan invariant, not a running-DB test: §4.6 forbids instantiating
 * a Nest module here, so the *text* of `0048` is pinned in code rather than
 * trusted to a reviewer's eye. Modelled on `tests/adr-0043-tenant-columns.test.ts`,
 * which reads `0046`/`0047` the same way.
 *
 * Amendment 5's ruling, restated as the shape this file checks: the `0047`
 * `tenant_isolation` policy's `organization_id IS NULL` disjunct is split out
 * of the shared `WITH CHECK` and narrowed `TO bms_fleet` on `bms.users`,
 * `bms.notification_channels` and `bms.audit_log` (a second, fleet-only
 * permissive policy ORs against the strict one), removed outright on
 * `bms.notification_deliveries` (which also gains `SET NOT NULL`), and
 * `USING` is untouched on all four — that last part is the whole of the
 * ruling, so it gets its own assertion, bounded with `[^;]*` exactly as the
 * existing file does so a regex cannot borrow a neighbouring statement's
 * clause.
 *
 * **`bms.audit_log` is in scope here.** The owner ruled Blocker 2 (plan §2)
 * on 2026-08-27 as "all four tables, one `0048`, one PR" — the two-PR split
 * was offered and rejected, so Amendment 5's "one class with one migration"
 * governs. This file previously asserted `audit_log` ABSENT from `0048`
 * under that rejected shape; that assertion was inverted, and what stands in
 * its place guards the opposite mistake — see the `audit_log` describe block
 * at the foot of the file.
 */

const migration0048 = (() => {
  const name = readdirSync(drizzleDir).find((f) => f.startsWith("0048_") && f.endsWith(".sql"));
  if (!name) return null;
  return readFileSync(join(drizzleDir, name), "utf8");
})();

/**
 * The three tables that KEEP a legitimate NULL organization and therefore keep
 * the disjunct, role-scoped `TO bms_fleet`. Amendment 5's per-table table:
 * `users` is the fleet-actor marker (Amendment 4), `notification_channels` is
 * the fleet-managed global (decision 7), `audit_log` is the platform event
 * (decision 5). `notification_deliveries` is absent by design — it loses the
 * branch outright, because this item gives the column SET NOT NULL.
 *
 * `audit_log` joined this list on 2026-08-27 when the owner ruled Blocker 2
 * "all four tables, one 0048, one PR" (plan §2). It was previously asserted
 * ABSENT from `0048` under the rejected two-PR shape.
 */
const FLEET_SCOPED_NULL_TABLES = ["users", "notification_channels", "audit_log"];

/** The strict `USING` predicate `0047` wrote, re-asserted unchanged by `0048` on all three tables. */
const STRICT_USING =
  "organization_id = nullif(current_setting('app.current_organization', true), '')::uuid";

describe("E7.1c migration 0048 — the Amendment 5 WITH CHECK split exists", () => {
  it("0048 is present in packages/db/drizzle", () => {
    expect(
      migration0048,
      "0048_*.sql not found — Task 3 writes it after this suite goes red",
    ).not.toBeNull();
  });

  it("takes and returns the owner role (ADR 0045)", () => {
    expect(migration0048).not.toBeNull();
    expect(migration0048).toMatch(/\bSET\s+ROLE\s+bms_owner\b/i);
    expect(migration0048).toMatch(/\bRESET\s+ROLE\b/i);
  });
});

describe("E7.1c / 0048 — the NULL branch narrows TO bms_fleet on users, notification_channels and audit_log", () => {
  /**
   * Amendment 5 replaces the single `tenant_isolation` policy on each of these
   * two tables with a strict one (every role) plus a second, fleet-only
   * permissive policy carrying the `organization_id IS NULL` disjunct.
   * Permissive policies OR together, so the net effect is: `bms_fleet` alone
   * may still write/read a NULL-org row; every other role may not.
   */
  it.each(FLEET_SCOPED_NULL_TABLES)(
    "bms.%s gets a CREATE POLICY ... TO bms_fleet carrying organization_id IS NULL",
    (table) => {
      expect(migration0048).not.toBeNull();
      const re = new RegExp(
        `CREATE POLICY\\s+\\w+\\s+ON\\s+bms\\.${table}\\b[^;]*TO\\s+bms_fleet[^;]*organization_id IS NULL`,
        "i",
      );
      expect(migration0048).toMatch(re);
    },
  );
});

describe("E7.1c / 0048 — notification_deliveries loses the NULL branch and gains SET NOT NULL", () => {
  it("no statement in 0048 pairs notification_deliveries with organization_id IS NULL in a WITH CHECK", () => {
    expect(migration0048).not.toBeNull();
    // Bounded to a single CREATE POLICY ... ON bms.notification_deliveries
    // statement (`[^;]*`) so the negative assertion cannot be defeated by an
    // IS NULL clause that belongs to a neighbouring table's policy.
    const re = new RegExp(
      `CREATE POLICY\\s+\\w+\\s+ON\\s+bms\\.notification_deliveries\\b[^;]*WITH CHECK[^;]*organization_id IS NULL`,
      "i",
    );
    expect(migration0048).not.toMatch(re);
  });

  it("ALTER COLUMN organization_id SET NOT NULL is present for notification_deliveries", () => {
    expect(migration0048).not.toBeNull();
    expect(migration0048).toMatch(
      /ALTER TABLE\s+bms\.notification_deliveries\s+ALTER COLUMN organization_id SET NOT NULL/i,
    );
  });
});

describe("E7.1c / 0048 — USING stays the strict predicate, unchanged, on all four tables", () => {
  /**
   * The whole of Amendment 5's ruling is that `WITH CHECK` narrows while
   * `USING` does not move. `[^;]*` bounds each regex to the single CREATE
   * POLICY statement it targets, so a match cannot borrow a neighbouring
   * statement's `USING` clause — the same technique
   * `tests/adr-0043-tenant-columns.test.ts` uses for its NULL-branch scan.
   */
  it.each(["users", "notification_channels", "notification_deliveries", "audit_log"])(
    "bms.%s keeps the strict USING predicate byte-identical to 0047",
    (table) => {
      expect(migration0048).not.toBeNull();
      const re = new RegExp(
        `CREATE POLICY\\s+\\w+\\s+ON\\s+bms\\.${table}\\b[^;]*USING\\s*\\(${STRICT_USING.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        )}\\)`,
        "i",
      );
      expect(migration0048).toMatch(re);
    },
  );
});

describe("E7.1c / 0048 — audit_log keeps its nullable column (decision 5's platform event)", () => {
  /**
   * This block replaced the "audit_log is not touched" assertion when the
   * owner ruled Blocker 2 as one migration covering all four tables. What it
   * guards now is the mistake that ruling makes easy to reach for.
   *
   * `audit_log` and `notification_deliveries` get OPPOSITE treatment in the
   * same migration: deliveries loses the NULL branch *because* it gains
   * SET NOT NULL, while audit_log keeps the branch *because* decision 5 rules
   * a platform event legitimately has no organization. Mirroring the
   * deliveries treatment onto audit_log — the natural reflex when writing two
   * adjacent statements — would make every platform-level audit row
   * unwritable and is exactly what decision 5 forbids.
   *
   * Statement-bounded, like the negative assertion for deliveries above, so a
   * SET NOT NULL belonging to a neighbouring table cannot satisfy it.
   */
  it("no ALTER COLUMN organization_id SET NOT NULL statement targets bms.audit_log", () => {
    expect(migration0048).not.toBeNull();
    expect(migration0048).not.toMatch(
      /ALTER TABLE\s+bms\.audit_log\s+ALTER COLUMN organization_id SET NOT NULL/i,
    );
  });
});
