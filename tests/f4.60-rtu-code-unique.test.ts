import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F4.60` / ADR 0016 §3 — migration `0071`, the partial unique index that makes
 * `bms.rtus.rtu_code` actually route. Model:
 * `tests/f3.46-notification-deliveries-dedupe-index.test.ts` and
 * `tests/e7.1i-audit-log-index.test.ts`.
 *
 * **This file gates the migration's TEXT, and text is all it gates.** Every
 * assertion here passes against a database that has never run the file, and
 * `tests/f3.46-…` and `tests/e7.1i-…` — the repo's only two precedents for an
 * index migration — stop exactly here. What the index *enforces* is gated by
 * `tests/f4.60-rtu-code-unique.integration.test.ts`, which inserts real
 * duplicates against real Postgres. Neither file is sufficient alone: this one
 * cannot see a migration that was never applied, and that one cannot see a
 * predicate that was hand-applied to one database and never committed.
 *
 * **Assertions inline, no `.spec` sibling** — the top-level `tests/` carve-out
 * (§4.6).
 */
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0071_rtu_code_unique.sql";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";

/**
 * Comments stripped before every assertion (the `f3.1a` lesson).
 *
 * Load-bearing here beyond the usual reason: `0071`'s header quotes its own
 * predicate in prose twice while explaining why the backlog row's spelling was
 * wrong, so an assertion run against the raw file would match the explanation
 * of the defect rather than the statement that fixes it.
 */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

describe("F4.60 — migration 0071 exists and is journalled", () => {
  it("0071_rtu_code_unique.sql is present in packages/db/drizzle", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), "migration must exist").toBe(true);
  });

  it("journals migration 0071 with idx 71 and the matching tag", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: Array<{ idx: number; tag: string; when: number; version: string }>;
    };
    const entry = journal.entries.find((e) => e.tag === "0071_rtu_code_unique");
    expect(
      entry,
      "no journal entry tagged 0071_rtu_code_unique. Drizzle applies the journal, " +
        "not the directory listing, so an unjournalled .sql is silently skipped on " +
        "every database — the index would exist only where it was applied by hand.",
    ).toBeDefined();
    expect(entry!.idx, "0071's journal idx must be 71").toBe(71);
  });

  it("journals 0071 strictly after 0070", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: Array<{ idx: number; tag: string; when: number }>;
    };
    const prev = journal.entries.find((e) => e.idx === 70)!;
    const next = journal.entries.find((e) => e.idx === 71)!;
    expect(
      next.when > prev.when,
      `0071's when (${next.when}) must be strictly greater than 0070's (${prev.when}).`,
    ).toBe(true);
  });
});

describe("F4.60 rtus.rtu_code partial unique index (ADR 0016 §3)", () => {
  const sql = sqlOnly(read(MIGRATION_REL));

  it("creates the partial unique index exactly as specified", () => {
    expect(
      /CREATE UNIQUE INDEX IF NOT EXISTS rtus_rtu_code_idx\s+ON bms\.rtus\s*\(\s*rtu_code\s*\)\s*WHERE rtu_code IS NOT NULL AND rtu_code <> ''/.test(
        sql,
      ),
      "migration 0071 must CREATE UNIQUE INDEX IF NOT EXISTS rtus_rtu_code_idx " +
        "ON bms.rtus (rtu_code) WHERE rtu_code IS NOT NULL AND rtu_code <> ''.",
    ).toBe(true);
  });

  it("excludes the empty string from the predicate", () => {
    expect(
      /WHERE rtu_code IS NOT NULL AND rtu_code <> ''/.test(sql),
      "0071's predicate must exclude ''. The backlog row asks for " +
        "`WHERE rtu_code IS NOT NULL` alone, and that spelling is wrong: " +
        "apps/ingest/src/host/bindings.ts:414 skips '' as missing-rtu-code, so '' " +
        "means NO code, and rtus.schema.ts:13 makes '' the only way a PATCH can " +
        "clear the column. Under the row's predicate two cleared RTUs collide.",
    ).toBe(true);
  });

  it("keys the index on the bare column, not on organization_id", () => {
    expect(
      /ON bms\.rtus\s*\(\s*rtu_code\s*\)/.test(sql),
      "0071 must key on (rtu_code) alone. BINDING_QUERY (bindings.ts:112-144) has " +
        "no organization_id filter — the ingest host reads the whole fleet — so a " +
        "per-organization key leaves the deviceKey merge at bindings.ts:643 reachable " +
        "across two tenants at one broker.",
    ).toBe(true);
    expect(
      /ON bms\.rtus\s*\(\s*organization_id/.test(sql),
      "0071 must not lead the key with organization_id.",
    ).toBe(false);
  });

  it("normalises a stored empty string to NULL", () => {
    expect(
      /UPDATE bms\.rtus SET rtu_code = NULL WHERE rtu_code = ''/.test(sql),
      "0071 must carry the one-time UPDATE that normalises '' to NULL, so a stored " +
        "'' reads as absent the way bindings.ts:414 already reads it.",
    ).toBe(true);
  });

  it("runs that UPDATE before the SET ROLE bracket, not inside it", () => {
    const update = sql.indexOf("UPDATE bms.rtus");
    const setRole = sql.indexOf("SET ROLE bms_owner;");
    expect(update, "the UPDATE must be present").toBeGreaterThan(-1);
    expect(setRole, "the SET ROLE bracket must be present").toBeGreaterThan(-1);
    expect(
      update < setRole,
      "the UPDATE must run BEFORE SET ROLE bms_owner. Measured on the running " +
        "database 2026-09-12: bms.rtus has relforcerowsecurity = t with policy " +
        "tenant_isolation on app.current_organization, so bms_owner sees 0 of the 56 " +
        "rows with no GUC and the same statement inside the bracket reports " +
        "UPDATE 0 — normalising nothing, silently. DDL is unaffected, which is why " +
        "the CREATE INDEX keeps the bracket and this statement does not.",
    ).toBe(true);
  });

  it("takes the SET ROLE bms_owner / RESET ROLE bracket for the DDL", () => {
    expect(
      sql.includes("SET ROLE bms_owner;"),
      "migration 0071 has no SET ROLE bms_owner. bms_owner owns bms.rtus (ADR 0045).",
    ).toBe(true);
    expect(
      sql.includes("RESET ROLE;"),
      "migration 0071 has no RESET ROLE. A forgotten RESET ROLE leaks past COMMIT " +
        "into drizzle's own journal INSERT and every later migration in the same run.",
    ).toBe(true);
  });

  it("never uses CONCURRENTLY — drizzle applies the file inside one transaction", () => {
    expect(
      /CONCURRENTLY/i.test(sql),
      "0071 must not use CREATE INDEX CONCURRENTLY. The migrator wraps the run in " +
        "one transaction (§4.4) and CONCURRENTLY cannot run inside one.",
    ).toBe(false);
  });

  it("bounds the lock it takes", () => {
    expect(
      sql.includes("SET LOCAL lock_timeout = '5s';"),
      "0071 must bound its lock as 0069 and 0070 do. Building this index holds SHARE " +
        "on bms.rtus, which blocks every ingest and admin write to the table.",
    ).toBe(true);
    expect(sql.includes("RESET lock_timeout;"), "0071 must reset lock_timeout.").toBe(true);
  });

  it("carries no DELETE and no de-duplicating UPDATE", () => {
    expect(
      /\bDELETE\b/i.test(sql),
      "0071 must not DELETE. A duplicate rtu_code on another database stops the " +
        "migration with Postgres's own error and the operator repairs it by hand — " +
        "an rtu_code is a device identity someone knows by name (ADR 0065 §4).",
    ).toBe(false);
    expect(
      /UPDATE bms\.rtus(?!\s+SET rtu_code = NULL WHERE rtu_code = '')/.test(sql),
      "0071's only UPDATE is the '' → NULL normalisation.",
    ).toBe(false);
  });
});
