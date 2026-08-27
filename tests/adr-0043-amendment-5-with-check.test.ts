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
 * of the shared `WITH CHECK` and narrowed `TO bms_fleet` on `bms.users` and
 * `bms.notification_channels` (a second, fleet-only permissive policy ORs
 * against the strict one), removed outright on `bms.notification_deliveries`
 * (which also gains `SET NOT NULL`), and `USING` is untouched on all three —
 * that last part is the whole of the ruling, so it gets its own assertion,
 * bounded with `[^;]*` exactly as the existing file does so a regex cannot
 * borrow a neighbouring statement's clause.
 *
 * `bms.audit_log` is deliberately left out of this file's scope (assertion 5
 * below) — Amendment 5's Blocker 2 (plan §2) leaves "one PR or two" open, and
 * the owner has not yet ruled which migration carries `audit_log`'s clause.
 */

const migration0048 = (() => {
  const name = readdirSync(drizzleDir).find((f) => f.startsWith("0048_") && f.endsWith(".sql"));
  if (!name) return null;
  return readFileSync(join(drizzleDir, name), "utf8");
})();

/** The two tables where the NULL branch narrows `TO bms_fleet` rather than disappearing. */
const FLEET_SCOPED_NULL_TABLES = ["users", "notification_channels"];

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

describe("E7.1c / 0048 — the NULL branch narrows TO bms_fleet on users and notification_channels", () => {
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

describe("E7.1c / 0048 — USING stays the strict predicate, unchanged, on all three tables", () => {
  /**
   * The whole of Amendment 5's ruling is that `WITH CHECK` narrows while
   * `USING` does not move. `[^;]*` bounds each regex to the single CREATE
   * POLICY statement it targets, so a match cannot borrow a neighbouring
   * statement's `USING` clause — the same technique
   * `tests/adr-0043-tenant-columns.test.ts` uses for its NULL-branch scan.
   */
  it.each(["users", "notification_channels", "notification_deliveries"])(
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

describe("E7.1c / 0048 — bms.audit_log is not touched (Blocker 2 is still open)", () => {
  /**
   * Amendment 5's Blocker 2 (plan §2) leaves "one PR or two" to the owner.
   * Until that is ruled, `0048` must not carry `audit_log`'s policy or
   * column changes — if the human chooses the one-PR option, this assertion
   * is the one to invert, per the plan's own instruction (§6 Task 1 item 5).
   *
   * Statement-bounded, not a bare string search: plan §4/§6 Task 3d both
   * expect `0048` to carry a comment naming PR 2 as the reason `audit_log` is
   * deferred, and `0047` itself already mentions `audit_log` in prose. A bare
   * `not.toMatch(/bms\.audit_log\b/i)` would go red against that correctly-
   * written comment, so this checks for the two DDL statement shapes that
   * would actually touch the table, exactly as `adr-0043-tenant-columns.test.ts`
   * bounds its own ADD COLUMN / SET NOT NULL scans to a statement rather than
   * a bare substring.
   */
  it("no CREATE/DROP POLICY or ALTER TABLE statement in 0048 names bms.audit_log", () => {
    expect(migration0048).not.toBeNull();
    expect(migration0048).not.toMatch(/(?:CREATE|DROP)\s+POLICY\s+\w+\s+ON\s+bms\.audit_log\b/i);
    expect(migration0048).not.toMatch(/ALTER TABLE\s+bms\.audit_log\b/i);
  });
});
