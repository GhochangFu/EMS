import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F4.162` (ADR 0077 Amendment 1, plan U2) — the global-admin write path for
 * `bms.location_types` is wired, gated, keyed by code, and beside — not in
 * place of — the `F4.157` read.
 *
 * **Assertions inline, no `.spec` sibling** (§4.6's carve-out for `tests/`);
 * `tests/f3.40-asset-role-write-path.test.ts` is the model. Every behavioural
 * claim (the 403s, the 409, the count, the org-less audit row) needs a
 * database and lives in
 * `apps/api/src/admin/vocabularies/location-types.service.integration.spec.ts`.
 * This file holds what a green suite cannot see: a route Nest never mounts, a
 * gate a method forgot, a bound that drifted from its contract, and the
 * `F4.157` controller changing shape.
 *
 * **Every assertion has an anti-vacuity twin** — each is "the source contains
 * X", and a rename would otherwise turn the file green by deleting its subject.
 */
const CONTROLLER_REL = "apps/api/src/admin/vocabularies/location-types.controller.ts";
const SERVICE_REL = "apps/api/src/admin/vocabularies/location-types.service.ts";
const SCHEMA_REL = "apps/api/src/admin/vocabularies/location-types.schema.ts";
const MODULE_REL = "apps/api/src/admin/admin.module.ts";
const REGISTRY_REL = "apps/api/src/openapi/openapi-registry.ts";
const CONTRACT_REL = "packages/shared/src/contracts/location-types.ts";
const EXISTING_READ_REL = "apps/api/src/admin/locations/location-types.controller.ts";

/**
 * Comments stripped before any assertion reads the source (the `f3.1a`
 * lesson): every header in this row's files quotes the code it describes.
 */
const codeOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("*") && !trimmed.startsWith("/*") && !trimmed.startsWith("//");
    })
    .join("\n");

/** The body of `async <name>(` up to the next member at class indentation. */
function methodBody(source: string, method: string): string {
  const start = source.indexOf(method);
  expect(start, `no longer declares ${method}`).toBeGreaterThan(-1);
  const rest = source.slice(start + method.length);
  const end = rest.search(/\n {2}(?:private|protected|public|async)\b/);
  return end === -1 ? rest : rest.slice(0, end);
}

const controller = codeOnly(read(CONTROLLER_REL));
const service = codeOnly(read(SERVICE_REL));
const schema = codeOnly(read(SCHEMA_REL));
const adminModule = codeOnly(read(MODULE_REL));
const registry = codeOnly(read(REGISTRY_REL));
const contract = codeOnly(read(CONTRACT_REL));
const existingRead = codeOnly(read(EXISTING_READ_REL));

describe("F4.162 the stripping and slicing this file relies on", () => {
  it("strips a comment line that names what an assertion looks for", () => {
    expect(codeOnly('  // @Controller("admin/vocabularies/location-types")')).not.toContain(
      "@Controller",
    );
    expect(codeOnly(' * await this.requireGlobalAdmin(jwt)')).not.toContain("requireGlobalAdmin");
  });

  it("cuts a method body at the next member, so a later method's gate is not borrowed", () => {
    const sample = [
      "  async list(jwt) {",
      "    return 1;",
      "  }",
      "",
      "  async create(jwt) {",
      "    await this.requireGlobalAdmin(jwt);",
      "  }",
    ].join("\n");
    expect(methodBody(sample, "async list(")).not.toContain("requireGlobalAdmin");
    expect(methodBody(sample, "async create(")).toContain("requireGlobalAdmin");
  });
});

describe("F4.162 the write path is registered in AdminModule", () => {
  it("imports and lists the new controller and service", () => {
    expect(adminModule).toContain(
      'import { LocationTypesVocabularyAdminController } from "./vocabularies/location-types.controller"',
    );
    expect(adminModule).toContain(
      'import { LocationTypesVocabularyAdminService } from "./vocabularies/location-types.service"',
    );
    // Listed, not only imported: an import with no `controllers` entry leaves
    // every verb a 404.
    expect(adminModule).toMatch(/^\s+LocationTypesVocabularyAdminController,$/m);
    expect(adminModule).toMatch(/^\s+LocationTypesVocabularyAdminService,$/m);
  });

  it("anti-vacuity: the listing pattern matches the sibling asset-roles entries", () => {
    expect(adminModule).toMatch(/^\s+AssetRolesAdminController,$/m);
    expect(adminModule).toMatch(/^\s+AssetRolesAdminService,$/m);
    expect("    import { X }\n").not.toMatch(/^\s+LocationTypesVocabularyAdminController,$/m);
  });
});

describe("F4.162 the controller mounts the five routes under admin/vocabularies", () => {
  const decorators = [
    '@Controller("admin/vocabularies/location-types")',
    "@Get()",
    "@Post()",
    '@Patch(":code")',
    '@Post(":code/deactivate")',
    '@Post(":code/reactivate")',
  ];

  it.each(decorators)("declares %s", (decorator) => {
    expect(controller).toContain(decorator);
  });

  it("anti-vacuity: the scan finds a decorator only when the line is code", () => {
    expect(codeOnly('// @Post(":code/deactivate")')).not.toContain("@Post(");
    expect(codeOnly('  @Post(":code/deactivate")')).toContain('@Post(":code/deactivate")');
  });

  it("parses :code with the local code schema and never with the uuid param schema", () => {
    expect(controller).not.toContain("idParamSchema");
    expect(controller).toContain("locationTypeCodeParamSchema.parse(code)");
  });

  it("anti-vacuity: the scan sees idParamSchema when it is there", () => {
    expect(codeOnly("    idParamSchema.parse(id);")).toContain("idParamSchema");
  });

  it("offers no delete, in the controller or the service", () => {
    expect(controller).not.toContain("@Delete");
    expect(service).not.toMatch(/\.delete\(locationTypes\)/);
  });

  it("anti-vacuity: the delete patterns match a delete", () => {
    expect("  @Delete(\":code\")").toContain("@Delete");
    expect("await tx.delete(locationTypes).where(x)").toMatch(/\.delete\(locationTypes\)/);
  });
});

describe("F4.162 every handler is global admin only", () => {
  const methods = [
    "async list(",
    "async create(",
    "async update(",
    "async deactivate(",
    "async reactivate(",
  ];

  it.each(methods)("%s awaits requireGlobalAdmin(jwt)", (method) => {
    expect(methodBody(service, method)).toContain("await this.requireGlobalAdmin(jwt)");
  });

  it("requireGlobalAdmin runs requireMasterDataUser then isGlobalAdmin", () => {
    const gate = methodBody(service, "private async requireGlobalAdmin(");
    expect(gate).toContain("await this.accessControl.requireMasterDataUser(jwt)");
    expect(gate).toContain("await this.accessControl.isGlobalAdmin(jwt)");
    expect(gate.indexOf("requireMasterDataUser")).toBeLessThan(gate.indexOf("isGlobalAdmin"));
  });

  it("anti-vacuity: a method body without the call is caught", () => {
    const body = methodBody(
      "  async list(jwt) {\n    return this.selectRows();\n  }\n\n  private x() {}",
      "async list(",
    );
    expect(body).not.toContain("await this.requireGlobalAdmin(jwt)");
  });
});

describe("F4.162 the write runs on the fleet pool with an org-less audit row", () => {
  it("injects FLEET_DRIZZLE and never opens a tenant context", () => {
    expect(service).toContain("@Inject(FLEET_DRIZZLE)");
    expect(service).not.toContain("withTenant");
    expect(service).not.toContain("TENANT_DRIZZLE");
  });

  it("anti-vacuity: the tenant patterns match a tenant write", () => {
    expect(codeOnly("    await withTenant(db, orgId, fn);")).toContain("withTenant");
    expect(codeOnly("  @Inject(TENANT_DRIZZLE) db")).toContain("TENANT_DRIZZLE");
  });

  it("writes organizationId: null and entityId: null at every audit site", () => {
    const sites = service.split("this.audit.write(").length - 1;
    expect(sites, "create, update and setActive each write one audit row").toBe(3);
    expect(service.split("organizationId: null").length - 1).toBe(sites);
    expect(service.split("entityId: null").length - 1).toBe(sites);
    expect(service).not.toMatch(/entityId:\s*(?:code|body\.code|row\.code)/);
  });

  it("anti-vacuity: the entityId pattern matches a code passed as the entity id", () => {
    expect("          entityId: code,").toMatch(/entityId:\s*(?:code|body\.code|row\.code)/);
    expect("          entityId: body.code,").toMatch(/entityId:\s*(?:code|body\.code|row\.code)/);
  });

  it("names the four master.location_type actions and the location_type entity", () => {
    for (const verb of ["create", "update", "deactivate", "reactivate"]) {
      expect(service).toContain(`"master.location_type.${verb}"`);
    }
    expect(service).toContain('entityType: "location_type"');
  });

  it("anti-vacuity: an action string in a comment does not count", () => {
    expect(codeOnly('  // "master.location_type.create"')).not.toContain("master.location_type");
  });
});

describe("F4.162 the body schemas keep code out of the PATCH and pin the bound", () => {
  it("omits code from the update body", () => {
    expect(schema).toContain(".omit({ code: true })");
    expect(schema).toContain("code: locationTypeCodeParamSchema");
  });

  it("anti-vacuity: the omit check is not satisfied by a different key", () => {
    expect(".omit({ label: true })").not.toContain(".omit({ code: true })");
  });

  it("declares the code bound locally, at the contract's width", () => {
    expect(schema).toContain(
      "export const locationTypeCodeParamSchema = z.string().min(1).max(32)",
    );
    expect(
      contract,
      "locationTypeCodeSchema's bound moved; location-types.schema.ts states the same width " +
        "for the same column — move both, or the route and the contract disagree about " +
        "what fits in code varchar(32).",
    ).toContain("export const locationTypeCodeSchema = z.string().min(1).max(32)");
  });

  it("anti-vacuity: a widened bound does not match the pin", () => {
    expect("export const locationTypeCodeParamSchema = z.string().min(1).max(64)").not.toContain(
      "export const locationTypeCodeParamSchema = z.string().min(1).max(32)",
    );
  });

  it("applies the catalog class and the ruled snake_case class to the create code", () => {
    expect(schema).toContain(".regex(CATALOG_CODE_PATTERN, CATALOG_CODE_MESSAGE)");
    expect(schema).toContain(".regex(/^[a-z][a-z0-9_]*$/, LOCATION_TYPE_CODE_MESSAGE)");
  });

  it("anti-vacuity: a class that admits '-' does not match the ruled one", () => {
    expect(".regex(/^[a-z][a-z0-9_-]*$/, LOCATION_TYPE_CODE_MESSAGE)").not.toContain(
      ".regex(/^[a-z][a-z0-9_]*$/, LOCATION_TYPE_CODE_MESSAGE)",
    );
  });
});

describe("F4.162 the registry describes the two bodies", () => {
  it("names _create and _update against the new schemas", () => {
    expect(registry).toContain(
      "LocationTypesVocabularyAdminController_create: createLocationTypeBodySchema",
    );
    expect(registry).toContain(
      "LocationTypesVocabularyAdminController_update: updateLocationTypeBodySchema",
    );
  });

  it("anti-vacuity: the sibling asset-roles entries are found the same way", () => {
    expect(registry).toContain("AssetRolesAdminController_create: createAssetRoleBodySchema");
  });
});

describe("F4.162 the F4.157 read at admin/location-types does not change", () => {
  it("still mounts admin/location-types with exactly one @Get() and no write or query", () => {
    expect(existingRead).toContain('@Controller("admin/location-types")');
    expect(existingRead.split("@Get()").length - 1).toBe(1);
    for (const forbidden of ["@Post", "@Patch", "@Delete", "@Put", "@Query"]) {
      expect(existingRead, `${EXISTING_READ_REL} gained ${forbidden}`).not.toContain(forbidden);
    }
    expect(existingRead).toContain("return this.service.listLocationTypes(user)");
  });

  it("anti-vacuity: the same scan finds @Post() in the new controller", () => {
    expect(controller).toContain("@Post()");
    expect(controller).toContain("@Patch(");
  });
});

// ---------------------------------------------------------------------------
// F4.162 plan U3b (D9) — `PATCH /admin/onboarding/sessions/:id/draft` refuses a
// `location.type` that is not an active code. `patchDraft` reads the database
// in `loadSession`, so it has no unit seam; the helper's behaviour is
// `onboarding-location-type-match.spec.ts` (M2–M4), and this block pins that
// `patchDraft` calls it, after the session gate.
// ---------------------------------------------------------------------------

const ONBOARDING_SERVICE_REL = "apps/api/src/admin/onboarding/onboarding.service.ts";

/** Every comment removed, block and line (the `tests/f4.104` `withoutComments` shape). */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

/**
 * The executable body of `async <name>(`, comments removed, cut at the next
 * class member (the `tests/f4.104` `executableBodyOf` shape, with `async` added
 * to the member pattern: every public method here is `async`, so without it the
 * body would run on to the next `private` member and borrow later methods' calls).
 */
function executableBodyOf(source: string, name: string): string {
  const stripped = withoutComments(source);
  const start = stripped.search(new RegExp(`\\basync ${name}\\s*\\(`));
  if (start < 0) {
    throw new Error(`could not find \`async ${name}(\`; a rename must be reflected here`);
  }
  const rest = stripped.slice(start + `async ${name}`.length);
  const end = rest.search(/\n {2}(?:private|protected|public|async)\b/);
  const body = end < 0 ? rest : rest.slice(0, end);
  if (body.trim().length === 0) {
    throw new Error(`\`async ${name}(\` parsed to an empty body`);
  }
  return body;
}

/** The claim: the body calls the assert, and calls it after `loadSession(`. */
function callsTheAssertAfterLoadSession(body: string): boolean {
  const load = body.indexOf("loadSession(");
  const check = body.indexOf("assertPatchLocationTypeIsActive(");
  return load >= 0 && check > load;
}

const onboardingService = read(ONBOARDING_SERVICE_REL);
const PATCH_CALL = "await assertPatchLocationTypeIsActive(draft, this.vocabularies);";

describe("F4.162 patchDraft refuses a location type that is not active", () => {
  it("calls assertPatchLocationTypeIsActive after loadSession", () => {
    expect(callsTheAssertAfterLoadSession(executableBodyOf(onboardingService, "patchDraft"))).toBe(true);
  });

  it("positive control: a copy with the call deleted fails the check", () => {
    expect(onboardingService).toContain(PATCH_CALL);
    const mutated = onboardingService.split(PATCH_CALL).join("");
    expect(callsTheAssertAfterLoadSession(executableBodyOf(mutated, "patchDraft"))).toBe(false);
  });

  it("positive control: a copy with the call only in a comment fails the check", () => {
    const mutated = onboardingService.split(PATCH_CALL).join(`// ${PATCH_CALL}`);
    expect(callsTheAssertAfterLoadSession(executableBodyOf(mutated, "patchDraft"))).toBe(false);
  });

  it("positive control: a copy with the call above loadSession fails the check", () => {
    const load = "const session = await this.loadSession(jwt, sessionId);";
    const body = executableBodyOf(onboardingService, "patchDraft");
    expect(body).toContain(load);
    const mutated = onboardingService
      .split(PATCH_CALL)
      .join("")
      .split(load)
      .join(`${PATCH_CALL}\n    ${load}`);
    const mutatedBody = executableBodyOf(mutated, "patchDraft");
    expect(mutatedBody).toContain("assertPatchLocationTypeIsActive(");
    expect(callsTheAssertAfterLoadSession(mutatedBody)).toBe(false);
  });

  it("positive control: the body ends at the next member, so validate's calls are not borrowed", () => {
    const body = executableBodyOf(onboardingService, "patchDraft");
    expect(body).not.toContain("async validate(");
    expect(body).not.toContain("async uploadExcel(");
  });
});
