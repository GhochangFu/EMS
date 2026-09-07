import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `E2.4` U1 / ADR 0058 decision 5 — migration `0067`: four provenance
 * columns and one plain, non-unique index on `bms.automation_rules`. Model:
 * `tests/f3.10-alarm-lifecycle-schema.test.ts`.
 *
 * **Assertions inline, no `.spec` sibling** — the top-level `tests/`
 * carve-out (§4.6). Files are read by relative path from the repo root,
 * never through a static `@bms` import (the `F2.7` lesson: a hand-repaired
 * workspace made a real TS2307 pass locally and die only in CI).
 */
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0067_template_alarm_provenance.sql";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const SCHEMA_REL = "packages/db/src/schema/alarms-schema.ts";

/** Comments stripped before every assertion (the `f3.1a` lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

describe("E2.4 — migration 0067 exists", () => {
  it("0067_template_alarm_provenance.sql is present in packages/db/drizzle", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), "migration must exist").toBe(true);
  });
});

describe("E2.4 template alarm provenance migration 0067 (ADR 0058 decision 5)", () => {
  const sql = sqlOnly(read(MIGRATION_REL));

  it("journals 0067 with idx 67, version 7, breakpoints true, and a when strictly greater than entry 66's, all read from the file", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: ReadonlyArray<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;
    };
    const entry66 = journal.entries.find((e) => e.idx === 66);
    expect(entry66, "journal entry idx 66 (0066_alarm_lifecycle) not found").toBeDefined();

    const stem = MIGRATION_REL.split("/").pop()!.replace(/\.sql$/, "");
    const entry67 = journal.entries.find((e) => e.tag === stem);
    expect(
      entry67,
      `no journal entry with tag "${stem}". Drizzle matches migrations to journal entries ` +
        "by tag; an unjournalled .sql file is silently skipped.",
    ).toBeDefined();
    expect(entry67?.idx, "journal entry for 0067 must have idx 67").toBe(67);
    expect(entry67?.version).toBe("7");
    expect(entry67?.breakpoints).toBe(true);
    expect(
      entry67?.when,
      "migration 0067's journal when must be strictly greater than entry 66's — read both " +
        "from the file, never a literal copy, so a later regeneration mistake is caught.",
    ).toBeGreaterThan(entry66!.when);
  });

  it("adds the four provenance columns, each IF NOT EXISTS, with the named FK constraint", () => {
    expect(sql).toMatch(
      /ALTER TABLE bms\.automation_rules\s+ADD COLUMN IF NOT EXISTS source_template_id uuid\s+CONSTRAINT automation_rules_source_template_id_fk\s+REFERENCES bms\.asset_templates\(id\);/,
    );
    expect(sql).toMatch(
      /ALTER TABLE bms\.automation_rules\s+ADD COLUMN IF NOT EXISTS source_template_version integer;/,
    );
    expect(sql).toMatch(
      /ALTER TABLE bms\.automation_rules\s+ADD COLUMN IF NOT EXISTS source_alarm_code varchar\(64\);/,
    );
    expect(sql).toMatch(
      /ALTER TABLE bms\.automation_rules\s+ADD COLUMN IF NOT EXISTS seeded_baseline jsonb;/,
    );
  });

  it("adds a plain, non-unique index on source_template_id, and carries no unique index, CONCURRENTLY, GRANT, CHECK, UPDATE or INSERT", () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS automation_rules_source_template_idx\s+ON bms\.automation_rules\s*\(\s*source_template_id\s*\)\s*;/,
    );

    expect(
      /CREATE UNIQUE INDEX/i.test(sql),
      "ADR 0058 decision 5: an earlier draft's partial unique index could never fire " +
        "(asset_id is always fresh on instantiate) — 0067 must add no unique index at all.",
    ).toBe(false);
    expect(
      /CONCURRENTLY/i.test(sql),
      "drizzle applies the file inside one transaction; CONCURRENTLY cannot run inside one (§4.4).",
    ).toBe(false);
    expect(/\bGRANT\b/.test(sql), "migration 0067 must write no GRANT").toBe(false);
    // WITH CHECK is a policy clause, not a column CHECK; strip it before the
    // scan so it cannot mask (or be mistaken for) a real column CHECK.
    expect(
      /\bCHECK\b/.test(sql.replace(/WITH CHECK/g, "")),
      "migration 0067 must carry no CHECK constraint",
    ).toBe(false);
    expect(/\bUPDATE\b/i.test(sql), "migration 0067 has no backfill — it must write no UPDATE").toBe(false);
    expect(/\bINSERT\b/i.test(sql), "migration 0067 has no backfill — it must write no INSERT").toBe(false);
  });

  it("takes the SET ROLE bms_owner / RESET ROLE bracket", () => {
    expect(sql).toContain("SET ROLE bms_owner;");
    expect(sql).toContain("RESET ROLE;");
  });

  it("packages/db/src/schema/alarms-schema.ts mirrors the four columns on automationRules", () => {
    const schema = read(SCHEMA_REL);

    const rulesStart = schema.indexOf('bmsSchema.table("automation_rules"');
    expect(rulesStart).toBeGreaterThan(-1);
    const rulesBlock = schema.slice(rulesStart, schema.indexOf("\n});", rulesStart));

    expect(rulesBlock).toMatch(/sourceTemplateId:\s*uuid\(\s*"source_template_id"\s*\)/);
    expect(rulesBlock).toMatch(/sourceTemplateVersion:\s*integer\(\s*"source_template_version"\s*\)/);
    expect(rulesBlock).toMatch(/sourceAlarmCode:\s*varchar\(\s*"source_alarm_code"/);
    expect(rulesBlock).toMatch(/seededBaseline:\s*jsonb\(\s*"seeded_baseline"\s*\)/);
  });
});
