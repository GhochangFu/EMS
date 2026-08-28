import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

describe("E7.1i — tenant-scoped audit-log index", () => {
  it("registers and defines the tenant-leading audit-log index", () => {
    const migrationRel =
      "packages/db/drizzle/0049_audit_log_organization_created_index.sql";
    const migrationPath = join(repoRoot, migrationRel);
    expect(existsSync(migrationPath), "migration must exist").toBe(true);

    const journal = JSON.parse(
      read("packages/db/drizzle/meta/_journal.json"),
    ) as { entries: Array<Record<string, unknown>> };
    expect(
      journal.entries.find(
        (entry) =>
          entry.tag === "0049_audit_log_organization_created_index",
      ),
    ).toEqual({
      idx: 49,
      version: "7",
      when: 1787920383386,
      tag: "0049_audit_log_organization_created_index",
      breakpoints: true,
    });

    const migration = read(migrationRel);
    expect(migration).toContain("SET ROLE bms_owner;");
    expect(migration).toMatch(
      /CREATE INDEX IF NOT EXISTS audit_log_organization_created_idx\s+ON bms\.audit_log\s*\(\s*organization_id,\s*created_at DESC,\s*id DESC\s*\);/,
    );
    expect(migration).toContain("RESET ROLE;");
    expect(migration).not.toMatch(/CREATE INDEX CONCURRENTLY/i);
  });
});
