import { expect } from "vitest";

import type { JwtPayload, UserRole } from "@bms/shared";
import { catalogEntry } from "@bms/shared/copilot";

import { canPerformOperationsWrite, type OperationsWriteClass } from "../auth/operations-write";
import { CopilotTargetResolver } from "./copilot-target-resolver";

/**
 * `F4.281` (ADR 0099 Amendment 8 D2) — the `maintenanceSchedule` target. It
 * mirrors `maintenance.controller.ts` exactly: `assertOperationsWriteRole(user,
 * "configuration")` (the real role rule here, `canPerformOperationsWrite`),
 * then the schedule's (or the create body's) asset in the caller's **read**
 * scope (`readableAssetIds`; `null` is every asset). Vitest entry point: the
 * sibling `.test.ts`.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const ROW = "22222222-2222-4222-8222-222222222222";
const ASSET = "44444444-4444-4444-8444-444444444444";
const OTHER_ASSET = "55555555-5555-4555-8555-555555555555";

/** A database whose every `select … limit` answers one row holding only the columns that select named. */
function oneRowDb(row: Record<string, unknown>): never {
  let selected: string[] = [];
  const chain = {
    select: (columns: Record<string, unknown> = {}) => {
      selected = Object.keys(columns);
      return chain;
    },
    from: () => chain,
    where: () => chain,
    innerJoin: () => chain,
    limit: async () => [Object.fromEntries(selected.map((key) => [key, row[key]]))],
    execute: async () => undefined,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(chain),
  };
  return chain as never;
}

/** The controller's two calls, answered for one caller with the real role rule; `asked` records the order. */
function maintenanceAccess(readable: string[] | null, asked: string[]): never {
  return {
    assertOperationsWriteRole: async (user: JwtPayload, writeClass: OperationsWriteClass) => {
      asked.push(`role:${writeClass}`);
      if (!canPerformOperationsWrite(user.role as UserRole, writeClass)) throw new Error("403");
    },
    readableAssetIds: async () => {
      asked.push("readableAssetIds");
      return readable;
    },
  } as never;
}

async function resolveAs(
  id: string,
  role: string,
  readable: string[] | null,
  options: { body?: Record<string, unknown>; asked?: string[]; allowed?: string[] } = {},
) {
  const resolver = new CopilotTargetResolver(
    oneRowDb({ title: "Quarterly filter check", assetId: ASSET, name: "Chiller 2" }),
    maintenanceAccess(readable, options.asked ?? []),
    {} as never,
    {} as never,
  );
  const entry = catalogEntry(id)!;
  const params: Record<string, string> = entry.path.includes(":id") ? { id: ROW } : {};
  const user = { sub: "f4281-resolver-unit", role } as JwtPayload;
  return resolver.resolve(entry, params, options.body ?? { active: false }, options.allowed ?? [ORG], user, ORG);
}

const COPILOT_ROLES = ["admin", "organization_admin", "location_admin", "asset_group_admin"];

/** Each copilot role with the schedule's asset in its read scope resolves it by title, asked in the route's order. */
export async function everyCopilotRoleInScopeResolvesTheSchedule(): Promise<void> {
  for (const role of COPILOT_ROLES) {
    const asked: string[] = [];
    expect((await resolveAs("maintenanceSchedule.deactivate", role, [ASSET], { asked }))?.targetName, role).toBe(
      "Quarterly filter check",
    );
    expect(asked, role).toEqual(["role:configuration", "readableAssetIds"]);
  }
}

/** An operator is refused by the configuration class, before the scope is read. */
export async function anOperatorIsRefusedBeforeTheScope(): Promise<void> {
  const asked: string[] = [];
  expect(await resolveAs("maintenanceSchedule.deactivate", "operator", [ASSET], { asked })).toBeNull();
  expect(asked).toEqual(["role:configuration"]);
}

/** A viewer likewise. */
export async function aViewerIsRefusedBeforeTheScope(): Promise<void> {
  const asked: string[] = [];
  expect(await resolveAs("maintenanceSchedule.activate", "viewer", [ASSET], { asked, body: { active: true } })).toBeNull();
  expect(asked).toEqual(["role:configuration"]);
}

/** A schedule whose asset is outside the caller's read scope is refused (the route's 404). */
export async function aScheduleOutsideTheReadScopeIsRefused(): Promise<void> {
  expect(await resolveAs("maintenanceSchedule.deactivate", "asset_group_admin", [OTHER_ASSET])).toBeNull();
  expect(await resolveAs("maintenanceSchedule.deactivate", "asset_group_admin", [])).toBeNull();
}

/** A global admin (`readableAssetIds` → `null`) reads every asset. */
export async function aGlobalAdminResolvesAnySchedule(): Promise<void> {
  expect((await resolveAs("maintenanceSchedule.deactivate", "admin", null))?.targetName).toBe("Quarterly filter check");
}

/** The create needs a string `assetId`, resolves the asset's organization and name, and checks the body's asset. */
export async function theCreateResolvesTheBodysAsset(): Promise<void> {
  expect(await resolveAs("maintenanceSchedule.create", "location_admin", [ASSET], { body: { title: "x" } })).toBeNull();
  const resolved = await resolveAs("maintenanceSchedule.create", "location_admin", [ASSET], { body: { assetId: ASSET } });
  expect({ organizationId: resolved?.organizationId, targetName: resolved?.targetName }).toEqual({ organizationId: ORG, targetName: "Chiller 2" });
  expect(await resolveAs("maintenanceSchedule.create", "location_admin", [OTHER_ASSET], { body: { assetId: ASSET } })).toBeNull();
}

/** A create whose asset is in no allowed organization is refused. */
export async function aCreateInNoAllowedOrganizationIsRefused(): Promise<void> {
  expect(await resolveAs("maintenanceSchedule.create", "admin", null, { body: { assetId: ASSET }, allowed: [] })).toBeNull();
}

/** D6: the resolved target carries no `updatedAt`, so no precondition is stored. */
export async function theTargetCarriesNoPrecondition(): Promise<void> {
  const resolved = await resolveAs("maintenanceSchedule.deactivate", "admin", null);
  expect(resolved).not.toBeNull();
  expect(resolved?.updatedAt).toBeUndefined();
}
