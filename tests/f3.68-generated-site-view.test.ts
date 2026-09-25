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
 * `F3.68` — U1's static gate: migration `0083`, its journal entry, the
 * Drizzle column, and (T9, added by U2) the generated-site-view contracts'
 * constant (ADR 0076 decision 7; plan U1, T0–T6, T9). T7 and T8 belong to
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
    const setRole = migration.indexOf("SET ROLE bms_owner;");
    const addColumn = migration.indexOf("ADD COLUMN");
    const resetRole = migration.indexOf("RESET ROLE;");
    // Present AND in order: a RESET ROLE moved above the ALTER leaves the
    // column owned by bms_app (the migrate connection), which containment
    // alone cannot see.
    expect(setRole, "SET ROLE bms_owner; is missing").toBeGreaterThanOrEqual(0);
    expect(addColumn, "the ADD COLUMN must come after SET ROLE bms_owner;").toBeGreaterThan(setRole);
    expect(resetRole, "RESET ROLE; must come after the ADD COLUMN").toBeGreaterThan(addColumn);
  });

  // T3
  it("adds headline_rank as smallint, if not already present", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS headline_rank smallint");
  });

  // T3b / T3c — the column is nullable with no default (plan D1: NULL =
  // unranked). The whole statement up to its ";" is scanned, not the line,
  // so a NOT NULL or DEFAULT wrapped onto the next line cannot escape. One
  // claim per it(): an expect throws, so a second one in the same it() would
  // never be reached by the first mutation.
  const addColumnStatement = (): string => {
    const migration = sqlOnly(read(MIGRATION_REL));
    const start = migration.indexOf("ADD COLUMN IF NOT EXISTS headline_rank");
    expect(start, "no ADD COLUMN headline_rank statement found").toBeGreaterThanOrEqual(0);
    const end = migration.indexOf(";", start);
    expect(end, "unterminated ADD COLUMN statement").toBeGreaterThan(start);
    return migration.slice(start, end);
  };

  it("adds headline_rank without NOT NULL — NULL means unranked", () => {
    expect(addColumnStatement()).not.toMatch(/\bNOT\s+NULL\b/i);
  });

  it("adds headline_rank without a DEFAULT — the seed ranks, not the migration", () => {
    expect(addColumnStatement()).not.toMatch(/\bDEFAULT\b/i);
  });

  // T4
  it("names the CHECK constraint and rejects a non-positive rank", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain("point_keys_headline_rank_check");
    expect(migration).toContain("headline_rank IS NULL OR headline_rank > 0");
  });

  // T4b — the ADD CONSTRAINT is guarded, so a re-run migration (or a database
  // that already has the constraint) does not fail with 42710.
  it("guards the ADD CONSTRAINT with IF NOT EXISTS on pg_constraint", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    const guard = migration.indexOf("IF NOT EXISTS (SELECT 1 FROM pg_constraint");
    const addConstraint = migration.indexOf("ADD CONSTRAINT point_keys_headline_rank_check");
    expect(guard, "the pg_constraint existence guard is missing").toBeGreaterThanOrEqual(0);
    expect(addConstraint, "the ADD CONSTRAINT must sit inside the guard").toBeGreaterThan(guard);
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

  // T9 (U2)
  it("declares HEADLINE_POINT_COUNT = 4 and no flattening combinator in generated-site-view.ts", () => {
    const source = tsOnly(read("packages/shared/src/contracts/generated-site-view.ts"));
    expect(source).toContain("export const HEADLINE_POINT_COUNT = 4");
    expect(source).not.toMatch(/\.merge\s*\(/);
    expect(source).not.toMatch(/\.extend\s*\(/);
    expect(source).not.toMatch(/z\.intersection\s*\(/);
  });
});

/**
 * Review finding L3 — `bms_tenant` holds table-level INSERT on
 * `bms.point_keys` (0059 revoked only UPDATE and DELETE), and the onboarding
 * commit inserts catalog rows on that path. A rank is a fleet-wide display
 * order that only a global admin may set (`PointKeysAdminService.
 * requireGlobalAdmin`), so the onboarding path must not carry one: not in
 * either draft schema, and not in the insert. `unit` is the positive control
 * — the cut really is the point-key block, not an empty slice.
 */
describe("F3.68 — the onboarding point-key path never writes headline_rank", () => {
  const RANK = /headlineRank|headline_rank/;

  const block = (source: string, startMarker: string, endMarker: string): string => {
    const start = source.indexOf(startMarker);
    expect(start, `${startMarker} not found`).toBeGreaterThanOrEqual(0);
    const end = source.indexOf(endMarker, start);
    expect(end, `no ${endMarker} after ${startMarker}`).toBeGreaterThan(start);
    return source.slice(start, end);
  };

  const COMMIT_REL = "apps/api/src/admin/onboarding/onboarding-commit.service.ts";
  const API_DRAFT_REL = "apps/api/src/admin/onboarding/onboarding.schema.ts";
  const SHARED_DRAFT_REL = "packages/shared/src/contracts/onboarding.ts";

  const commitInsert = (): string =>
    block(tsOnly(read(COMMIT_REL)), ".insert(pointKeys)", ".returning()");
  const apiDraft = (): string =>
    block(tsOnly(read(API_DRAFT_REL)), "export const draftPointKeySchema", "\n  });");
  const sharedDraft = (): string =>
    block(tsOnly(read(SHARED_DRAFT_REL)), "export const onboardingDraftPointKeySchema", "\n});");

  it("onboarding-commit.service.ts inserts into point_keys exactly once", () => {
    // A second insert would sit outside the cut the next three it()s read.
    expect(tsOnly(read(COMMIT_REL)).split(".insert(pointKeys)").length - 1).toBe(1);
  });

  it("the onboarding point-key insert names unit (positive control)", () => {
    expect(commitInsert()).toMatch(/\bunit:/);
  });

  it("the onboarding point-key insert does not name headlineRank", () => {
    expect(commitInsert()).not.toMatch(RANK);
  });

  it("the API draft point-key schema names unit (positive control)", () => {
    expect(apiDraft()).toMatch(/\bunit:/);
  });

  it("the API draft point-key schema does not name headlineRank", () => {
    expect(apiDraft()).not.toMatch(RANK);
  });

  it("the shared draft point-key contract names unit (positive control)", () => {
    expect(sharedDraft()).toMatch(/\bunit:/);
  });

  it("the shared draft point-key contract does not name headlineRank", () => {
    expect(sharedDraft()).not.toMatch(RANK);
  });
});
