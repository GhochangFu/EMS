import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";
import { catalogEntry } from "@bms/shared/copilot";

import { CopilotTargetResolver } from "./copilot-target-resolver";

/**
 * `F4.283` (ADR 0099 Amendment 8 D2; owner ruling 2026-10-24, drafter choice 2)
 * — the `telemetry` target of the import and the manual readings, and the
 * `asset` target of the image upload. `telemetry` lives in the conversation's
 * bound organization (the `fleet` rule) and mirrors the routes' gate,
 * `requireMasterDataUser` alone (it refuses an `asset_group_admin` with a 403);
 * the image upload mirrors its route's `canManageAsset`. Vitest entry point:
 * the sibling `.test.ts`.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const ASSET = "22222222-2222-4222-8222-222222222222";
const JWT = { sub: "f4283-resolver-unit", role: "admin" } as JwtPayload;

/** A database whose every `select … limit` answers one row holding only the columns that select named; a list read answers none. */
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
    // A list read with no `limit` (an asset's point keys) answers no rows.
    then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
    execute: async () => undefined,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(chain),
  };
  return chain as never;
}

/** The routes' calls, answered for one role: `requireMasterDataUser` throws for a non-master-data role. */
function access(role: string, canManageAsset = true): never {
  const refused = role === "asset_group_admin" || role === "operator" || role === "viewer";
  return {
    requireMasterDataUser: async () => {
      if (refused) throw new Error("403");
      return { id: "u1", role };
    },
    // `canManageAsset` reaches `assertMasterDataRole`, which throws for the same roles.
    canManageAsset: async () => {
      if (refused) throw new Error("403");
      return canManageAsset;
    },
  } as never;
}

async function resolveAs(id: string, role: string, options: { bound?: string | null; canManageAsset?: boolean } = {}) {
  const resolver = new CopilotTargetResolver(
    oneRowDb({ name: "Pune Works", organizationId: ORG }),
    access(role, options.canManageAsset),
    {} as never,
    {} as never,
  );
  const entry = catalogEntry(id)!;
  const params: Record<string, string> = entry.path.includes(":assetId") ? { assetId: ASSET } : {};
  const bound = options.bound === undefined ? ORG : options.bound;
  return resolver.resolve(entry, params, {}, [ORG], JWT, bound);
}

/** Each master-data role resolves the import to the bound organization. */
export async function theMasterDataRolesResolveTheImportToTheBoundOrganization(): Promise<void> {
  for (const role of ["admin", "organization_admin", "location_admin"]) {
    expect((await resolveAs("telemetry.import", role))?.organizationId, role).toBe(ORG);
  }
}

/** The readings resolve the same way, named by the organization. */
export async function theReadingsResolveToTheBoundOrganizationsName(): Promise<void> {
  expect((await resolveAs("telemetryReading.create", "location_admin"))?.targetName).toBe("Pune Works");
}

/** `requireMasterDataUser` throws for an `asset_group_admin`: refused. Mutation: gate with `true` → red. */
export async function anAssetGroupAdminIsRefusedTheImport(): Promise<void> {
  expect(await resolveAs("telemetry.import", "asset_group_admin")).toBeNull();
}

/** An `asset_group_admin` is refused the readings too. */
export async function anAssetGroupAdminIsRefusedTheReadings(): Promise<void> {
  expect(await resolveAs("telemetryReading.create", "asset_group_admin")).toBeNull();
}

/** A conversation bound to no organization is refused. Mutation: drop the bound check → red. */
export async function anUnboundConversationIsRefusedTheImport(): Promise<void> {
  expect(await resolveAs("telemetry.import", "admin", { bound: null })).toBeNull();
}

/** The image upload: an asset the caller may manage resolves to its organization. */
export async function aManageableAssetResolvesTheImageUpload(): Promise<void> {
  expect((await resolveAs("assetImage.upload", "location_admin"))?.organizationId).toBe(ORG);
}

/** The image upload: `canManageAsset` false refuses. */
export async function anUnmanageableAssetIsRefusedTheImageUpload(): Promise<void> {
  expect(await resolveAs("assetImage.upload", "location_admin", { canManageAsset: false })).toBeNull();
}

/** The image upload: an `asset_group_admin` is refused (`canManageAsset` throws). */
export async function anAssetGroupAdminIsRefusedTheImageUpload(): Promise<void> {
  expect(await resolveAs("assetImage.upload", "asset_group_admin")).toBeNull();
}
