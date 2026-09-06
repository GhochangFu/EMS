import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F3.46` Unit B / ADR 0041 Amendment 2 — migration `0065`, the partial index
 * `0038` promised `dedupe_key`'s first reader. Model:
 * `tests/e7.1i-audit-log-index.test.ts` and
 * `tests/adr-0055-min-coverage-ratio-migration.test.ts`.
 *
 * **Assertions inline, no `.spec` sibling** — the top-level `tests/` carve-out
 * (§4.6).
 */
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0065_notification_deliveries_dedupe_index.sql";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const SERVICE_REL = "apps/api/src/notifications/notifications.service.ts";

/** Comments stripped before every assertion (the `f3.1a` lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

describe("F3.46 — migration 0065 exists", () => {
  it("0065_notification_deliveries_dedupe_index.sql is present in packages/db/drizzle", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), "migration must exist").toBe(true);
  });
});

describe("F3.46 notification_deliveries dedupe skip index (ADR 0041 Amendment 2)", () => {
  const sql = sqlOnly(read(MIGRATION_REL));

  it("creates the partial dedupe skip index exactly as specified", () => {
    expect(
      /CREATE INDEX IF NOT EXISTS notification_deliveries_dedupe_skip_idx\s+ON bms\.notification_deliveries\s*\(\s*channel_id,\s*dedupe_key\s*\)\s*WHERE status = 'skipped_deduped'/.test(
        sql,
      ),
      "migration 0065 must CREATE INDEX IF NOT EXISTS notification_deliveries_dedupe_skip_idx " +
        "ON bms.notification_deliveries (channel_id, dedupe_key) WHERE status = 'skipped_deduped'.",
    ).toBe(true);
  });

  it("takes the SET ROLE bms_owner / RESET ROLE bracket", () => {
    expect(
      sql.includes("SET ROLE bms_owner;"),
      "migration 0065 has no SET ROLE bms_owner. bms_owner owns " +
        "bms.notification_deliveries, and the repo's default branch is to take the " +
        "bracket even when the file drops no policy.",
    ).toBe(true);
    expect(
      sql.includes("RESET ROLE;"),
      "migration 0065 has no RESET ROLE. A forgotten RESET ROLE leaks past COMMIT into " +
        "drizzle's own journal INSERT and every later migration in the same run.",
    ).toBe(true);
  });

  it("never uses CONCURRENTLY — drizzle applies the file inside one transaction", () => {
    expect(
      /CONCURRENTLY/i.test(sql),
      "migration 0065 must not use CREATE INDEX CONCURRENTLY: drizzle wraps the run in " +
        "one transaction, and CONCURRENTLY cannot execute inside one (AGENTS.md §4.4).",
    ).toBe(false);
  });

  it("journals migration 0065 with idx 65 and a when strictly greater than entry 64's", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: ReadonlyArray<{ idx: number; when: number; tag: string }>;
    };

    const entry64 = journal.entries.find((e) => e.idx === 64);
    expect(entry64, "journal entry idx 64 (0064_point_metadata_finite_check) not found").toBeDefined();

    const stem = MIGRATION_REL.split("/").pop()!.replace(/\.sql$/, "");
    const entry65 = journal.entries.find((e) => e.tag === stem);
    expect(
      entry65,
      `no journal entry with tag "${stem}". Drizzle matches migrations to journal entries ` +
        "by tag; an unjournalled .sql file is silently skipped.",
    ).toBeDefined();

    expect(entry65?.idx, "journal entry for 0065 must have idx 65").toBe(65);
    expect(
      entry65?.when,
      "migration 0065's journal when must be strictly greater than entry 64's — read both " +
        "from the file, never a literal copy, so a later regeneration mistake is caught.",
    ).toBeGreaterThan(entry64!.when);
  });

  it("the reader exists: NotificationsService.hasRecordedSkip reads dedupe_key", () => {
    const service = read(SERVICE_REL);
    expect(
      service.includes("eq(notificationDeliveries.dedupeKey"),
      "apps/api/src/notifications/notifications.service.ts no longer reads dedupe_key — " +
        "0038's rule in reverse: an index whose reader is later removed should be named by " +
        "a failing test rather than carried for free.",
    ).toBe(true);
  });
});
