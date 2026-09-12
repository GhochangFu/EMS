import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F2.23` / ADR 0065 decisions 2, 3 and 5 — migration `0070_catalog_code_
 * charset.sql` adds `assets_code_charset_check` and
 * `point_keys_code_charset_check`, each `CHECK (code ~ '^[A-Za-z0-9_-]+$')`
 * inside the `0061` idempotent `DO $$ … IF NOT EXISTS` shape, bounded by
 * `0069`'s `SET LOCAL lock_timeout`. A plain `ADD CONSTRAINT` (no `NOT
 * VALID`) so a violator fails the migration loudly (decision 3); no `UPDATE`
 * or `DELETE` anywhere in the file (decision 5 — no automatic repair).
 *
 * **`@bms/shared` resolved through `createRequire`**, not a bare `import` —
 * `tests/adr-0055-calc-v2-invariants.test.ts:1-22` documents why: the `tests`
 * project runs from the repo root, where the bundler resolver has no
 * workspace link to `@bms/shared`; Node's own resolution does, and a bare
 * import typechecks locally (a stale `node_modules` symlink) while failing
 * CI's clean install.
 *
 * **Assertions inline, no `.spec` sibling** — the top-level `tests/`
 * carve-out (§4.6).
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0070_catalog_code_charset.sql";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";

const require_ = createRequire(import.meta.url);
const shared = require_("@bms/shared") as {
  CATALOG_CODE_PATTERN: RegExp;
  CATALOG_CODE_MESSAGE: string;
};

/**
 * Comments stripped before every assertion — the `f3.1a` lesson
 * (`tests/adr-0061-device-time-migration.test.ts:24-34`): a header quoting
 * DDL in a comment must not keep a `toContain` green after the real
 * statement is gone.
 */
const sqlOnly = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

describe("F2.23 — migration 0070 exists", () => {
  it("0070_catalog_code_charset.sql is present in packages/db/drizzle", () => {
    expect(() => read(MIGRATION_REL)).not.toThrow();
  });
});

describe("F2.23 catalog code charset (ADR 0065 decisions 2, 3, 5)", () => {
  const raw = read(MIGRATION_REL);
  const sql = sqlOnly(raw);

  it("carries the SET ROLE bms_owner / RESET ROLE bracket", () => {
    expect(sql).toMatch(/SET ROLE bms_owner;/);
    expect(sql).toMatch(/RESET ROLE;/);
  });

  it("bounds the lock with SET LOCAL lock_timeout = '5s' and RESET lock_timeout", () => {
    expect(sql).toMatch(/SET LOCAL lock_timeout = '5s';/);
    expect(sql).toMatch(/RESET lock_timeout;/);
  });

  it("never uses the case-insensitive operator ~*", () => {
    expect(sql).not.toMatch(/~\*/);
  });

  it("carries no NOT VALID, no UPDATE and no DELETE (decisions 3 and 5)", () => {
    expect(sql).not.toMatch(/NOT VALID/);
    expect(sql).not.toMatch(/\bUPDATE\b/);
    expect(sql).not.toMatch(/\bDELETE\b/);
  });

  const names = ["assets_code_charset_check", "point_keys_code_charset_check"];

  it.each(names)("guards %s with an idempotent IF NOT EXISTS check", (name) => {
    const guardRe = new RegExp(
      `IF NOT EXISTS \\(\\s*SELECT 1 FROM pg_constraint[\\s\\S]*?conname = '${name}'`,
    );
    expect(sql).toMatch(guardRe);
  });

  it("extracts exactly two ADD CONSTRAINT ... CHECK (code ~ '<class>') clauses, byte-identical to CATALOG_CODE_PATTERN.source", () => {
    const addRe = /ADD CONSTRAINT\s+(\S+)\s+CHECK\s*\(code ~ '([^']+)'\)/g;
    const found: { name: string; klass: string }[] = [];
    let match: RegExpExecArray | null;
    while ((match = addRe.exec(sql)) !== null) {
      found.push({ name: match[1]!, klass: match[2]! });
    }
    // Anti-vacuity: exactly two classes extracted, one per constraint.
    expect(found).toHaveLength(2);
    expect(found.map((f) => f.name).sort()).toEqual([...names].sort());
    for (const { klass } of found) {
      expect(klass).toBe(shared.CATALOG_CODE_PATTERN.source);
    }
  });

  it("declares both constraints on bms.assets and bms.point_keys respectively", () => {
    expect(sql).toMatch(/ALTER TABLE bms\.assets/);
    expect(sql).toMatch(/ALTER TABLE bms\.point_keys/);
  });
});

describe("F2.23 — the journal entry for idx 70", () => {
  const journal = JSON.parse(read(JOURNAL_REL)) as {
    entries: { idx: number; when: number; tag: string }[];
  };

  it("has an entry with idx 70 whose tag equals the filename stem", () => {
    const entry = journal.entries.find((e) => e.idx === 70);
    expect(entry).toBeDefined();
    expect(entry?.tag).toBe("0070_catalog_code_charset");
  });

  it("idx 70's when is strictly greater than idx 69's when, and not greater than Date.now()", () => {
    const entry69 = journal.entries.find((e) => e.idx === 69);
    const entry70 = journal.entries.find((e) => e.idx === 70);
    expect(entry69).toBeDefined();
    expect(entry70).toBeDefined();
    expect(entry70!.when).toBeGreaterThan(entry69!.when);
    expect(entry70!.when).toBeLessThanOrEqual(Date.now());
  });
});

describe("F2.23 — CATALOG_CODE_PATTERN pins decision 1's literal", () => {
  it("carries no flags and the exact source", () => {
    expect(shared.CATALOG_CODE_PATTERN.flags).toBe("");
    expect(shared.CATALOG_CODE_PATTERN.source).toBe("^[A-Za-z0-9_-]+$");
  });
});
