import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F3.40` / ADR 0051 decision 5 — the asset role vocabulary grows, and gains a
 * write path.
 *
 * **Assertions inline, no `.spec` sibling.** §4.6 carves out the top-level
 * `tests/` directory for repo-wide invariants;
 * `tests/f3.37-asset-role-vocabulary.test.ts` is this file's own model.
 *
 * **What is NOT here, and where it is instead.** Every behavioural claim — the
 * `admin`-only gate, the 409, the retirement, the org-less audit row, `0060`'s
 * two codes arriving as vocabulary entries — needs a database and lives in
 * `apps/api/src/admin/vocabularies/asset-roles.service.integration.spec.ts`.
 * The body schemas need neither and are checked from that file's `.test`
 * outside the database gate.
 *
 * What remains for a source scan is the class of defect a green suite cannot
 * see: a wiring or shape mistake that makes the route silently absent, or
 * silently wrong about its own key. Each assertion below has an anti-vacuity
 * twin, because every one of them is "the source contains X" and a rename
 * would otherwise turn the file green by deleting its subject.
 */
const MIGRATION_REL = "packages/db/drizzle/0060_asset_role_estate_shapes.sql";
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const CONTROLLER_REL = "apps/api/src/admin/vocabularies/asset-roles.controller.ts";
const SERVICE_REL = "apps/api/src/admin/vocabularies/asset-roles.service.ts";
const SCHEMA_REL = "apps/api/src/admin/vocabularies/asset-roles.schema.ts";
const MODULE_REL = "apps/api/src/admin/admin.module.ts";

/**
 * Comments stripped before any assertion reads the source — the `f3.1a` lesson
 * `tests/f3.37-asset-role-vocabulary.test.ts` records: a header comment quoting
 * an `INSERT` kept a `toContain` green after the statement itself was deleted.
 * Every header in this row's four files quotes the code it describes, so
 * without this the whole file would be checking its own prose.
 */
const codeOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("--") && !trimmed.startsWith("*") && !trimmed.startsWith("//");
    })
    .join("\n");

describe("F3.40 migration 0060 seeds the estate's shapes", () => {
  const migration = codeOnly(read(MIGRATION_REL));

  it("inserts meter and pump into bms.asset_roles", () => {
    expect(migration).toContain("INSERT INTO bms.asset_roles");
    expect(migration).toMatch(/\('meter',\s*'Meters',\s*\d+\)/);
    expect(migration).toMatch(/\('pump',\s*'Pumps',\s*\d+\)/);

    // Anti-vacuity: `codeOnly` really removed the header, which names both
    // codes in prose. Without this the two assertions above would pass on a
    // file whose INSERT had been deleted.
    expect(codeOnly("-- ('meter', 'Meters', 170),")).not.toContain("meter");
  });

  it("uses a bare ON CONFLICT DO NOTHING, with no arbiter", () => {
    // `0030`, `0034` and `0051` all state the reason: a named `(code)` arbiter
    // would let a collision on some other unique constraint abort the whole
    // transaction on a re-run.
    expect(migration).toContain("ON CONFLICT DO NOTHING");
    expect(migration).not.toMatch(/ON CONFLICT\s*\(/);
  });

  it("asserts its own effect, because ON CONFLICT DO NOTHING is silent", () => {
    // The shape `0059` established. Without it the migration reports success
    // after writing nothing — which is what makes it safe to re-run and also
    // what would hide a code that never landed.
    expect(migration).toContain("RAISE EXCEPTION");
    expect(migration).toContain("active = true");
  });

  it("has a journal entry, applied after 0059", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    const entry = journal.entries.find((row) => row.tag === "0060_asset_role_estate_shapes");
    const previous = journal.entries.find((row) => row.tag === "0059_tenant_cannot_edit_point_keys");

    // Drizzle SKIPS a migration file with no journal entry, silently. A
    // missing entry here would leave every gate green and the vocabulary two
    // codes short on every fresh database.
    expect(entry, `${MIGRATION_REL} has no entry in ${JOURNAL_REL}`).toBeDefined();
    expect(previous).toBeDefined();
    expect(entry!.when).toBeGreaterThan(previous!.when);
    expect(entry!.idx).toBeGreaterThan(previous!.idx);
  });
});

describe("F3.40 the write path is wired, gated, and keyed by code", () => {
  const controller = codeOnly(read(CONTROLLER_REL));
  const service = codeOnly(read(SERVICE_REL));
  const schema = codeOnly(read(SCHEMA_REL));
  const adminModule = codeOnly(read(MODULE_REL));

  it("registers both the controller and the service in AdminModule", () => {
    // A controller Nest never sees answers 404 on every verb, and no unit test
    // of the service would notice. This is the one defect in the row that a
    // green suite genuinely cannot catch.
    expect(adminModule).toContain("AssetRolesAdminController");
    expect(adminModule).toContain("AssetRolesAdminService");
    expect(adminModule).toContain('from "./vocabularies/asset-roles.controller"');
    expect(adminModule).toContain('from "./vocabularies/asset-roles.service"');
  });

  it("mounts under admin/, with the two verbs ADR 0051 decision 5 names", () => {
    expect(controller).toContain('@Controller("admin/vocabularies/asset-roles")');
    expect(controller).toContain("@Post()");
    expect(controller).toContain('@Patch(":code")');
  });

  it("routes the patch on :code and never through the uuid param schema", () => {
    // `0051` made `code varchar(64)` the primary key of `bms.asset_roles`;
    // there is no `id` column. `admin.schema.ts`'s `idParamSchema` is
    // `z.string().uuid()`, so the obvious copy from `PointKeysAdminController`
    // would reject every real code with a 400 the compiler cannot see.
    expect(controller).not.toContain("idParamSchema");
    expect(controller).toContain("assetRoleCodeParamSchema.parse(code)");

    // Anti-vacuity twin: the scan does find `idParamSchema` when it is there.
    expect(codeOnly("  idParamSchema.parse(id);")).toContain("idParamSchema");
  });

  it("offers no delete, because the foreign key carries no ON DELETE", () => {
    // `0051` step 3: "Retire a role with `active = false`." A membership that
    // holds a code must keep holding it.
    expect(controller).not.toContain("@Delete");
    expect(service).not.toMatch(/\.delete\(assetRoles\)/);
  });

  it("gates both writes on isGlobalAdmin, after requireMasterDataUser", () => {
    // The security claim of the row. `requireMasterDataUser` alone ADMITS a
    // location_admin and an org_admin, so a service that stopped there would
    // let a tenant administrator retire `transformer` for the whole fleet.
    expect(service).toContain("isGlobalAdmin");
    expect(service).toContain("requireMasterDataUser");

    for (const method of ["async create(", "async update("]) {
      const start = service.indexOf(method);
      expect(start, `${SERVICE_REL} no longer declares ${method}`).toBeGreaterThan(-1);
      const rest = service.slice(start + method.length);
      const end = rest.search(/\n {2}(?:private|protected|public|async)\b/);
      const body = end === -1 ? rest : rest.slice(0, end);
      expect(body, `${method} does not call requireGlobalAdmin`).toContain(
        "await this.requireGlobalAdmin(jwt)",
      );
    }
  });

  it("writes on the fleet pool and audits with no organization", () => {
    // `bms.asset_roles` has no `organization_id`, so `withTenant` would set
    // `app.current_organization` for a policy that does not exist. ADR 0043
    // Amendment 5: a NULL audit organization is admitted TO bms_fleet only.
    expect(service).toContain("FLEET_DRIZZLE");
    expect(service).not.toContain("withTenant");
    expect(service).toContain("organizationId: null");
  });

  it("passes a null audit entityId, because asset_roles has no uuid key", () => {
    // `bms.audit_log.entity_id` is `uuid`. Passing the code reaches Postgres as
    // `22P02 invalid input syntax for type uuid` — a 500 after the vocabulary
    // row has already been written.
    expect(service).toContain("entityId: null");
    expect(service).not.toMatch(/entityId:\s*(?:code|body\.code|row\.code)/);
  });

  it("keeps code out of the patch body, so the primary key cannot be renamed", () => {
    expect(schema).toContain('.omit({ code: true })');
    expect(schema).toContain("active: z.boolean()");

    // And the create body still declares it, or the assertion above passes
    // because the field was renamed out from under it.
    expect(schema).toContain("code: assetRoleCodeParamSchema");
  });

  it("declares the code bound locally, and at the same width as the contract", () => {
    // The param is parsed with THIS package's zod on purpose: a `ZodError`
    // built by `@bms/shared`'s module instance failed `instanceof ZodError` in
    // the controller and escaped the 400 mapping as a 500. Declaring it here
    // removes the cross-package `instanceof`, and the cost is that the bound is
    // now written twice — so this asserts the two agree.
    expect(schema).toContain("export const assetRoleCodeParamSchema = z.string().min(1).max(64)");
    expect(schema).not.toContain('from "@bms/shared"');

    const operations = codeOnly(read("packages/shared/src/contracts/operations.ts"));
    expect(
      operations,
      "assetRoleCodeSchema's bound moved. asset-roles.schema.ts states the same width " +
        "for the same column and nothing else joins them — move both, or the route and " +
        "the contract disagree about what fits in code varchar(64).",
    ).toContain("export const assetRoleCodeSchema = z.string().min(1).max(64)");
  });
});
