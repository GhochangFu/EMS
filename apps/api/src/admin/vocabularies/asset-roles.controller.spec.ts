import { BadRequestException } from "@nestjs/common";

import type { AssetRoleDto, JwtPayload } from "@bms/shared";

import { AssetRolesAdminController } from "./asset-roles.controller";
import type { AssetRolesAdminService } from "./asset-roles.service";

/**
 * `F3.40` — the controller's own layer, with no database.
 *
 * **Why this exists at all.** The integration suite constructs
 * `AssetRolesAdminService` directly, so nothing before this file ever ran the
 * controller. Everything it does — parsing the `:code` param, turning a
 * `ZodError` into a 400, passing `parseActiveFilter`'s tri-state through — is
 * therefore invisible to it, and `tests/f3.40-asset-role-write-path.test.ts`
 * can only string-match the source. The `F3.40` compliance review named the
 * gap.
 *
 * **The service is a stub, deliberately.** The gate, the executor and the audit
 * row are the `.integration.spec`'s subject and are checked against a real
 * database there. What is checked here is only what the controller decides by
 * itself, which is the parse boundary. Recording every call makes that
 * boundary observable rather than assumed —
 * `apps/api/src/admin/audit/audit.controller.spec.ts` is the model.
 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const JWT: JwtPayload = {
  sub: "00000000-0000-4000-8000-000000000000",
  email: "admin@bms.local",
  name: "spec",
  role: "admin",
};

const ROW: AssetRoleDto = { code: "meter", label: "Meters", sortOrder: 170, active: true };

type ListCall = { activeOnly: boolean | undefined };
type CreateCall = { body: unknown };
type UpdateCall = { code: string; body: unknown };

function stubService(): {
  service: AssetRolesAdminService;
  listCalls: ListCall[];
  createCalls: CreateCall[];
  updateCalls: UpdateCall[];
} {
  const listCalls: ListCall[] = [];
  const createCalls: CreateCall[] = [];
  const updateCalls: UpdateCall[] = [];
  const service = {
    async list(_jwt: JwtPayload, activeOnly?: boolean) {
      listCalls.push({ activeOnly });
      return { items: [ROW] };
    },
    async create(_jwt: JwtPayload, body: unknown) {
      createCalls.push({ body });
      return ROW;
    },
    async update(_jwt: JwtPayload, code: string, body: unknown) {
      updateCalls.push({ code, body });
      return ROW;
    },
  } as unknown as AssetRolesAdminService;
  return { service, listCalls, createCalls, updateCalls };
}

async function rejects(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  return null;
}

/** `?active=` is a tri-state, and the third state is "no filter", not `false`. */
export async function assertListPassesTheActiveFilterThrough(): Promise<void> {
  const { service, listCalls } = stubService();
  const controller = new AssetRolesAdminController(service);

  await controller.list(JWT, "true");
  await controller.list(JWT, "false");
  await controller.list(JWT, undefined);

  assert(listCalls[0]?.activeOnly === true, "?active=true must ask for active rows only");
  assert(listCalls[1]?.activeOnly === false, "?active=false must ask for retired rows only");
  assert(
    listCalls[2]?.activeOnly === undefined,
    "no ?active must ask for every row — an omitted filter is not `false`, and the " +
      "retired codes this route exists to show would vanish if it were",
  );
}

/** A malformed create body is a 400 from the controller, never a 500. */
export async function assertCreateTurnsAZodErrorIntoABadRequest(): Promise<void> {
  const { service, createCalls } = stubService();
  const controller = new AssetRolesAdminController(service);

  const err = await rejects(() => controller.create({ code: "HT_Panel", label: "x" }, JWT));

  assert(
    err instanceof BadRequestException,
    `a bad code must be a 400, got ${err === null ? "no error" : String(err)}`,
  );
  assert(
    createCalls.length === 0,
    "the service was called with a body that did not parse — the guard runs after the write",
  );

  // Anti-vacuity: the same call with a valid body reaches the service.
  await controller.create({ code: "cooling-tower", label: "Cooling Tower" }, JWT);
  assert(createCalls.length === 1, "a valid body must reach the service");
}

/**
 * THE DEFECT THE COMPILER CANNOT SEE.
 *
 * `admin.schema.ts`'s `idParamSchema` is `z.string().uuid()`, and copying
 * `PointKeysAdminController` would have used it here. `bms.asset_roles` has no
 * `id` column — `0051` made `code varchar(64)` the primary key — so every real
 * code would come back 400. This asserts the param survives the parse.
 */
export async function assertThePatchParamIsACodeAndNotAUuid(): Promise<void> {
  const { service, updateCalls } = stubService();
  const controller = new AssetRolesAdminController(service);

  await controller.update("cooling-tower", { label: "Cooling Towers" }, JWT);
  assert(
    updateCalls[0]?.code === "cooling-tower",
    `a kebab-case code must reach the service unchanged, got ${String(updateCalls[0]?.code)}`,
  );

  // An empty param is still refused — `assetRoleCodeSchema` is `min(1)`.
  const err = await rejects(() => controller.update("", { label: "x" }, JWT));
  assert(
    err instanceof BadRequestException,
    `an empty code must be a 400, got ${err === null ? "no error" : `${(err as Error).constructor.name}: ${String(err)}`}`,
  );
}

/** An unknown key in the patch body is a 400, per ADR 0029's `.strict()`. */
export async function assertUpdateRefusesAnUnknownKey(): Promise<void> {
  const { service, updateCalls } = stubService();
  const controller = new AssetRolesAdminController(service);

  const err = await rejects(() => controller.update("meter", { organizationId: "x" }, JWT));
  assert(err instanceof BadRequestException, "an unknown key must be a 400");
  assert(updateCalls.length === 0, "the service must not see a body that did not parse");
}
