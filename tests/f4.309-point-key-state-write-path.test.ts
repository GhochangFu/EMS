import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F4.309` / ADR 0088 Amendment 3 decisions 1–3 (plan T4) — the state-label write path, by source.
 *
 * **Assertions inline, no `.spec` sibling** (§4.6 carves out `tests/`).
 * `tests/f3.40-asset-role-write-path.test.ts` is the model. The behaviour (the 403s, the 409s,
 * the org-less audit rows) needs a database and lives in
 * `apps/api/src/admin/point-key-states/point-key-states.integration.spec.ts`; the gate order
 * before the database is `point-key-states.service.gates.spec.ts`. What remains for a scan is the
 * wiring and the class of mistake a green behaviour suite cannot see: a write that slipped onto
 * the tenant pool, a method that reads before it gates, an audit row stamped with an
 * organization, the directory missing from the copilot's catalog scan (PR 3 lists it and its writer),
 * and a migration that reaches for the table when the ADR says none is needed.
 *
 * Each assertion has an anti-vacuity twin, because a rename would otherwise turn it green by
 * deleting its subject.
 */
const DIR = "apps/api/src/admin/point-key-states";
const SERVICE_REL = `${DIR}/point-key-states.service.ts`;
const CONTROLLER_REL = `${DIR}/point-key-states.controller.ts`;
const MODULE_REL = "apps/api/src/admin/admin.module.ts";
const AUDIT_GATE_REL = "tests/f3.85-audit-via-mark.test.ts";
const MIGRATIONS_REL = "packages/db/drizzle";

/** Comment lines dropped, so a docblock quoting the code cannot keep an assertion green. */
const codeOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("--") && !trimmed.startsWith("*") && !trimmed.startsWith("/*") && !trimmed.startsWith("//");
    })
    .join("\n");

/** The body of one class method, from its signature to the next member at the same indent. */
function methodBody(source: string, method: string): string {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^  (?:private |public |protected )?(?:async )?${method}\\(`).test(line));
  if (start === -1) throw new Error(`${SERVICE_REL}: no method ${method}`);
  let end = start + 1;
  while (end < lines.length && !/^  (?:private |public |protected )?(?:async )?[A-Za-z]+\(/.test(lines[end] as string) && !/^}/.test(lines[end] as string)) end++;
  return codeOnly(lines.slice(start, end).join("\n"));
}

const service = read(SERVICE_REL);
const serviceCode = codeOnly(service);

describe("F4.309 — the state-label write path (ADR 0088 Amendment 3)", () => {
  it("registers the controller and the service in AdminModule", () => {
    const module = codeOnly(read(MODULE_REL));
    expect(module).toContain('from "./point-key-states/point-key-states.controller"');
    expect(module).toContain('from "./point-key-states/point-key-states.service"');
    expect(module.match(/\bPointKeyStatesAdminController\b/g)?.length).toBe(2);
    // The import, the provider and (`F4.309` PR 3) the export for the copilot's `list_point_key_states`.
    expect(module.match(/\bPointKeyStatesAdminService\b/g)?.length).toBe(3);
  });

  it("mounts the four routes under admin/point-key-states behind JwtAuthGuard", () => {
    const controller = codeOnly(read(CONTROLLER_REL));
    expect(controller).toContain('@Controller("admin/point-key-states")');
    expect(controller).toContain("@UseGuards(JwtAuthGuard)");
    expect(controller.match(/^\s*@Get\(\)/gm)?.length).toBe(1);
    expect(controller.match(/^\s*@Post\(\)/gm)?.length).toBe(1);
    expect(controller.match(/^\s*@Patch\(":id"\)/gm)?.length).toBe(1);
    expect(controller.match(/^\s*@Delete\(":id"\)/gm)?.length).toBe(1);
    // No other route: decision 1 names four.
    expect(controller.match(/^\s*@(Get|Post|Put|Patch|Delete)\(/gm)?.length).toBe(4);
  });

  it("calls requireGlobalAdmin first in every public method (403 before the body, the row and the seed)", () => {
    for (const method of ["list", "create", "update", "remove"]) {
      const body = methodBody(service, method);
      const statements = body.split("\n").slice(1).map((line) => line.trim()).filter(Boolean);
      expect(statements[0], `${method}: the first statement`).toBe("await this.requireGlobalAdmin(jwt);");
    }
    // The gate itself: the master-data user first, then the global admin.
    const gate = methodBody(service, "requireGlobalAdmin");
    expect(gate.indexOf("requireMasterDataUser(")).toBeGreaterThan(-1);
    expect(gate.indexOf("isGlobalAdmin(")).toBeGreaterThan(gate.indexOf("requireMasterDataUser("));
    expect(gate).toContain("ForbiddenException");
  });

  it("parses each body with the shared schema after the gate, inside the method", () => {
    const create = methodBody(service, "create");
    expect(create).toMatch(/createPointKeyStateBodySchema\.safeParse\(/);
    expect(create.indexOf("requireGlobalAdmin(")).toBeLessThan(create.indexOf("createPointKeyStateBodySchema.safeParse("));
    const update = methodBody(service, "update");
    expect(update).toMatch(/updatePointKeyStateBodySchema\.safeParse\(/);
    expect(update.indexOf("requireGlobalAdmin(")).toBeLessThan(update.indexOf("updatePointKeyStateBodySchema.safeParse("));
  });

  it("injects FLEET_DRIZZLE only — the table is global, with no organization and no policy (§4.3)", () => {
    expect(serviceCode).toContain("@Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb");
    expect(serviceCode).not.toMatch(/\bTENANT_DRIZZLE\b/);
    expect(serviceCode).not.toMatch(/\bwithTenant\b/);
    // The named reason is recorded at the call site (§4.3).
    expect(service).toMatch(/no `organization_id`/);
  });

  it("writes each mutation in one fleetDb transaction with its audit row, organizationId null", () => {
    expect(serviceCode.match(/this\.fleetDb\.transaction\(/g)?.length).toBe(3);
    const actions = [...serviceCode.matchAll(/action: "(master\.point_key_state\.\w+)"/g)].map((m) => m[1]);
    expect(actions).toEqual([
      "master.point_key_state.create",
      "master.point_key_state.update",
      "master.point_key_state.delete",
    ]);
    expect(serviceCode.match(/entityType: "point_key_state"/g)?.length).toBe(3);
    expect(serviceCode.match(/organizationId: null/g)?.length).toBe(3);
    expect(serviceCode).not.toMatch(/organizationId: (?!null)/);
    // Each audit write is handed the transaction, not the pool.
    expect(serviceCode.match(/\n\s*tx,\n\s*\);/g)?.length).toBe(3);
  });

  it("audits only through MasterDataAuditService, never by a direct insert (inside DIRECT_INSERT's scan since PR 3)", () => {
    // The `f3.85-audit-via-mark` forms: the drizzle `insert(auditLog)` and the raw SQL.
    const direct = /\binsert\(\s*auditLog\s*\)|\binsert\s+into\s+(bms\.)?audit_log\b/i;
    for (const name of readdirSync(join(repoRoot, DIR)).filter((n) => n.endsWith(".ts") && !/\.(spec|test)\.ts$/.test(n))) {
      expect(read(`${DIR}/${name}`), `${DIR}/${name}`).not.toMatch(direct);
    }
    expect(serviceCode).not.toMatch(/\bauditLog\b/);
    // Anti-vacuity: the service does audit, through the funnel, three times.
    expect(serviceCode).toContain("private readonly audit: MasterDataAuditService");
    expect(serviceCode.match(/this\.audit\.write\(/g)?.length).toBe(3);
  });

  it("writes the update audit as { from, to }, the old values read and locked in the transaction", () => {
    const update = methodBody(service, "update");
    expect(update).toMatch(/\.for\("update"\)/);
    expect(update).toMatch(/payload: \{ from: \{ label: before\.label, tone: before\.tone \}, to: body \}/);
  });

  it("answers seeded from POINT_KEY_STATE_SEED through the pure check (owner ruling Q3 (a))", () => {
    const pure = codeOnly(read(`${DIR}/point-key-states.pure.ts`));
    expect(pure).toContain('import { POINT_KEY_STATE_SEED } from "@bms/db";');
    expect(serviceCode.match(/isSeededPointKeyState\(/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("is a copilot catalog directory since PR 3, its service a catalog writer (ADR 0099 Amendment 13; plan C5, T16)", () => {
    const gate = read(AUDIT_GATE_REL);
    const dirs = /const CATALOG_DIRS = \[([\s\S]*?)\] as const;/.exec(gate)?.[1];
    expect(dirs, "CATALOG_DIRS not found in the audit-via-mark gate").toBeDefined();
    const listed = [...codeOnly(dirs as string).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(listed).toContain("admin/point-keys"); // anti-vacuity: the parse reads the list
    expect(listed).toContain("admin/point-key-states");
    const writers = /const CATALOG_WRITERS = \[([\s\S]*?)\] as const;/.exec(gate)?.[1];
    expect(writers, "CATALOG_WRITERS not found in the audit-via-mark gate").toBeDefined();
    expect([...codeOnly(writers as string).matchAll(/"([^"]+)"/g)].map((m) => m[1])).toContain(SERVICE_REL);
  });

  it("adds no migration after 0109 that names point_key_states (decision 2: no grant change)", () => {
    const files = readdirSync(join(repoRoot, MIGRATIONS_REL)).filter((name) => /^\d{4}_.*\.sql$/.test(name));
    const naming = files.filter((name) => /\bpoint_key_states\b/.test(read(`${MIGRATIONS_REL}/${name}`)));
    // Anti-vacuity: the scan sees the two that do.
    expect(naming).toEqual(
      expect.arrayContaining(["0097_point_key_states_breaker_roles_asset_rating_and_layout_flags.sql", "0109_network_mimics_switching_units.sql"]),
    );
    expect(naming.filter((name) => Number(name.slice(0, 4)) > 109)).toEqual([]);
  });
});
