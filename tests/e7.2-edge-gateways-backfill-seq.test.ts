import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `E7.2` / ADR 0123 decision 11, PR 3 code review 2 — migration `0143` adds
 * `bms.edge_gateways.backfill_dirty_seq`, the dirty window's generation, so the
 * aggregate repair never clears a window a late row landed inside while it
 * refreshed. This holds the file's text; the column's behaviour is
 * `apps/ingest/src/host/uplink-write.integration.spec.ts` and
 * `aggregate-repair.integration.spec.ts` against a real database.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const REL = "packages/db/drizzle/0143_edge_gateways_backfill_seq.sql";
const TAG = "0143_edge_gateways_backfill_seq";

const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");
/** The SQL with `--` comments removed, so a sentence about GRANT is not a GRANT. */
const sqlOnly = (text: string): string => text.replace(/--.*$/gm, "");

describe("E7.2 — bms.edge_gateways.backfill_dirty_seq (migration 0143)", () => {
  it("exists as the only 0143 file", () => {
    expect(existsSync(join(repoRoot, REL))).toBe(true);
    expect(readdirSync(join(repoRoot, "packages/db/drizzle")).filter((f) => f.startsWith("0143_"))).toEqual([
      `${TAG}.sql`,
    ]);
  });

  it("registers 0143 in the journal at idx 144, right after 0142 and before now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);
    const previous = journal.entries.find((e) => e.tag === "0142_edge_gateways_tenant_read_only");
    expect(entry, "0143 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.idx).toBe(144);
    expect(entry?.version).toBe("7");
    expect(entry?.breakpoints).toBe(true);
    expect(entry?.when as number).toBeGreaterThan(previous?.when as number);
    expect(entry?.when as number).toBeLessThan(Date.now());
    expect(journal.entries.indexOf(entry as Record<string, unknown>)).toBe(
      journal.entries.indexOf(previous as Record<string, unknown>) + 1,
    );
  });

  it("adds the column idempotently, inside one bms_owner bracket, under a bounded lock", () => {
    const sql = sqlOnly(read(REL));
    expect(sql).toContain(
      "ALTER TABLE bms.edge_gateways ADD COLUMN IF NOT EXISTS backfill_dirty_seq bigint NOT NULL DEFAULT 0;",
    );
    expect(sql.match(/SET ROLE bms_owner;/g) ?? []).toHaveLength(1);
    expect(sql.match(/RESET ROLE;/g) ?? []).toHaveLength(1);
    const lockAt = sql.indexOf("SET LOCAL lock_timeout = '5s';");
    const roleAt = sql.indexOf("SET ROLE bms_owner;");
    const alterAt = sql.indexOf("ALTER TABLE bms.edge_gateways");
    const resetRoleAt = sql.indexOf("RESET ROLE;");
    const resetLockAt = sql.indexOf("RESET lock_timeout;");
    expect(lockAt, "the lock is bounded before the ALTER (the 0071 idiom)").toBeGreaterThanOrEqual(0);
    expect(lockAt < roleAt && roleAt < alterAt && alterAt < resetRoleAt && resetRoleAt < resetLockAt).toBe(true);
    expect(sql).not.toMatch(/\bGRANT\b/i);
    expect(sql).not.toMatch(/statement-breakpoint/);
  });

  it("proves the column's type, nullability and default, and bms_fleet's UPDATE on it", () => {
    const proof = sqlOnly(read(REL)).slice(sqlOnly(read(REL)).indexOf("DO $$")).replace(/\s+/g, " ");
    expect(proof).toContain("column_name = 'backfill_dirty_seq' AND data_type = 'bigint' AND is_nullable = 'NO'");
    expect(proof).toContain("has_column_privilege('bms_fleet', 'bms.edge_gateways', 'backfill_dirty_seq', 'UPDATE')");
    expect(proof).toContain("RAISE EXCEPTION 'migration 0143:");
  });

  it("declares the column in Drizzle", () => {
    const schema = read("packages/db/src/schema/edge-gateways-schema.ts");
    expect(schema).toContain('backfillDirtySeq: bigint("backfill_dirty_seq", { mode: "number" }).notNull().default(0)');
  });

  it("the receiver bumps it and the repair clears only the generation it read", () => {
    const write = read("apps/ingest/src/host/uplink-write.ts").replace(/\s+/g, " ");
    expect(write).toContain("backfill_dirty_seq = CASE WHEN $5::timestamptz IS NULL THEN g.backfill_dirty_seq");
    const repair = read("apps/ingest/src/host/aggregate-repair.ts").replace(/\s+/g, " ");
    expect(repair).toContain("AND backfill_dirty_seq = $4::bigint");
  });
});
