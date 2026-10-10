import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const apiSrc = join(repoRoot, "apps/api/src");
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F3.85` PR 4 / ADR 0099 decision 4.5, drafter choice 4 — a confirmed
 * copilot change is visible in the audit log only because
 * `MasterDataAuditService` adds `via: "copilot"` and the change id. A catalog
 * write that inserted into `bms.audit_log` itself would lose the mark.
 *
 * So: every release-1 catalog write service audits through
 * `MasterDataAuditService` (a positive control — a renamed or moved file turns
 * this red rather than passing by absence), no file in a catalog directory
 * inserts into the audit log directly, and both of the service's inserts
 * apply the mark. The catalog itself arrives in PR 8; until then the catalog
 * is the plan's §6.3 list, named here by file.
 */
const CATALOG_WRITERS = [
  "apps/api/src/dashboard-builder/dashboards.service.ts",
  "apps/api/src/admin/dashboard-templates/dashboard-templates.service.ts",
  "apps/api/src/admin/dashboard-templates/dashboard-templates-instantiate.service.ts",
  "apps/api/src/admin/dashboard-templates/dashboard-templates-stock.service.ts",
  "apps/api/src/admin/asset-templates/asset-templates.service.ts",
  "apps/api/src/admin/asset-templates/asset-templates-write-core.ts",
  "apps/api/src/admin/asset-templates/asset-templates-instantiate-core.ts",
  "apps/api/src/admin/calc-parameters/calc-parameters.service.ts",
  "apps/api/src/admin/asset-points/asset-point-calc-override.service.ts",
] as const;

/** Directories whose write routes the release-1 catalog covers; no file in them may insert into the audit log itself. */
const CATALOG_DIRS = [
  "dashboard-builder",
  "admin/dashboard-templates",
  "admin/asset-templates",
  "admin/calc-parameters",
  "admin/asset-points",
  "calc",
] as const;

/** The drizzle form and the raw-SQL form. */
const DIRECT_INSERT = /\binsert\(\s*auditLog\s*\)|\binsert\s+into\s+(bms\.)?audit_log\b/i;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (name.endsWith(".ts") && !name.endsWith(".spec.ts") && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("F3.85 — every catalog write is audited through the copilot mark (ADR 0099 decision 4.5)", () => {
  it.each(CATALOG_WRITERS)("%s audits through MasterDataAuditService", (rel) => {
    expect(existsSync(join(repoRoot, rel)), `${rel} not found — update the list`).toBe(true);
    const source = read(rel);
    expect(source).toMatch(/\bMasterDataAuditService\b/);
    expect(source).not.toMatch(DIRECT_INSERT);
  });

  it("finds the direct audit-log inserts that exist, and none is in a catalog directory", () => {
    const direct = sourceFiles(apiSrc)
      .filter((file) => DIRECT_INSERT.test(readFileSync(file, "utf8")))
      .map((file) => relative(apiSrc, file).replaceAll("\\", "/"));
    // Positive control: the scan sees the known writers, so an empty result cannot mean a broken regex.
    expect(direct).toContain("admin/master-data-audit.service.ts");
    expect(direct).toContain("work-orders/work-orders.service.ts");
    const inCatalog = direct.filter((file) => CATALOG_DIRS.some((dir) => file.startsWith(`${dir}/`)));
    expect(inCatalog, "a catalog write inserting into bms.audit_log itself loses the copilot mark").toEqual([]);
  });

  it("marks both of MasterDataAuditService's inserts", () => {
    // Code lines only: `writeMany`'s comment quotes the insert call it explains.
    const source = read("apps/api/src/admin/master-data-audit.service.ts")
      .split(/\r?\n/)
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    const inserts = source.split("insert(auditLog).values(").slice(1);
    expect(inserts).toHaveLength(2);
    for (const block of inserts) {
      expect(block.slice(0, 600)).toContain("payload: withCopilotMark(input.payload) ?? null");
    }
  });
});
