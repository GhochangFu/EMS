import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0083_point_keys_headline_rank.sql";
const TAG = "0083_point_keys_headline_rank";

/** Strip `--` comment lines before a scan — the `f3.1a-dashboard-schema.test.ts`
 * lesson: a raw scan is satisfied by a comment quoting the statement it
 * explains, so a deleted statement stays green as long as a comment still
 * spells it. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** Strips block and line comments from a TypeScript source, the
 * `adr-0037-calc-engine-invariants.test.ts` precedent — so a scan for a
 * property cannot be satisfied by a comment that only names it. */
const BLOCK_COMMENT = new RegExp(["/", "\\*", "[\\s\\S]*?", "\\*", "/"].join(""), "g");
const LINE_COMMENT = /\/\/.*$/gm;
const tsOnly = (source: string): string => source.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "");

/**
 * `F3.68` — U1's static gate: migration `0083`, its journal entry, and the
 * Drizzle column (ADR 0076 decision 7; plan U1, T0–T6). T7–T9 belong to
 * later units and are not asserted here. Assertions inline, no `.spec`
 * sibling (§4.6).
 */
describe("F3.68 — bms.point_keys.headline_rank (migration 0083)", () => {
  // T0
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    const migration = read(MIGRATION_REL);
    expect(migration.length).toBeGreaterThan(400);
  });

  // T1
  it("registers migration 0083 in the journal, after 0082 and before now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);

    expect(entry, "migration 0083 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.idx).toBe(83);
    expect(entry?.tag).toBe(TAG);
    // 0082's `when` — the F4.94 class: a stamp ahead of the wall clock sorts
    // above a later, honestly-stamped one and is silently skipped wherever
    // the later one applies.
    expect(entry?.when as number).toBeGreaterThan(1790320280708);
    expect(entry?.when as number).toBeLessThan(Date.now());
  });

  // T2
  it("brackets the whole migration in SET ROLE bms_owner / RESET ROLE", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain("SET ROLE bms_owner;");
    expect(migration).toContain("RESET ROLE;");
  });

  // T3
  it("adds headline_rank as smallint, if not already present", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS headline_rank smallint");
  });

  // T4
  it("names the CHECK constraint and rejects a non-positive rank", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain("point_keys_headline_rank_check");
    expect(migration).toContain("headline_rank IS NULL OR headline_rank > 0");
  });

  // T5
  it("issues no GRANT, REVOKE or CREATE POLICY — bms.point_keys is fleet-wide (0057/0059)", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).not.toMatch(/\bGRANT\b/i);
    expect(migration).not.toMatch(/\bREVOKE\b/i);
    expect(migration).not.toMatch(/\bCREATE\s+POLICY\b/i);
  });

  // T6
  it("declares headlineRank: smallint(\"headline_rank\") on the Drizzle pointKeys table", () => {
    const schema = tsOnly(read("packages/db/src/schema/bms-schema.ts"));
    const start = schema.indexOf('export const pointKeys = bmsSchema.table("point_keys"');
    expect(start, "no pointKeys table declaration found").toBeGreaterThanOrEqual(0);
    const end = schema.indexOf("\n});", start);
    expect(end, "unterminated pointKeys table declaration").toBeGreaterThan(start);
    const block = schema.slice(start, end);
    expect(block).toContain('headlineRank: smallint("headline_rank")');
  });
});
