import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";
import { catalogEntry } from "@bms/shared/copilot";

import { CopilotTargetResolver } from "./copilot-target-resolver";
import { CopilotTargetRefusal } from "./copilot-telemetry-targets";

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

/*
 * `F4.283` (owner ruling 2026-10-25, Q2): the readings' `telemetry` target checks every row's
 * asset before the card, as an `asset` target does — it exists in an allowed organization, the
 * route's `canManageAsset` passes, and it is of the bound organization. A refusal names its rows.
 */

const ORG_B = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const UNKNOWN = "55555555-5555-4555-8555-555555555555";
const row = (assetId: string) => ({ assetId, pointKey: "kw", value: 1, time: "2026-10-20T09:00:00.000Z" });

/**
 * The `oneRowDb` shape, but a list read answers the asset ids of the tenant the current
 * `withTenant` transaction set — the n-th transaction is the n-th allowed organization.
 */
function assetsDb(perTenant: ReadonlyArray<readonly string[]>): never {
  let selected: string[] = [];
  let tenant = -1;
  const named: Record<string, unknown> = { name: "Pune Works", organizationId: ORG };
  const chain = {
    select: (columns: Record<string, unknown> = {}) => {
      selected = Object.keys(columns);
      return chain;
    },
    from: () => chain,
    where: () => chain,
    innerJoin: () => chain,
    limit: async () => [Object.fromEntries(selected.map((key) => [key, named[key]]))],
    then: (resolve: (rows: unknown[]) => unknown) => resolve((perTenant[tenant] ?? []).map((id) => ({ id }))),
    execute: async () => undefined,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      tenant += 1;
      return fn(chain);
    },
  };
  return chain as never;
}

function resolveReadings(
  rows: readonly unknown[],
  options: { manageable?: (assetId: string) => boolean; mode?: "propose" | "record"; tenants?: ReadonlyArray<readonly string[]> } = {},
) {
  const asked: string[] = [];
  const resolver = new CopilotTargetResolver(
    // The fake answers a tenant's ids whatever the query named: A holds ASSET, B holds OTHER.
    assetsDb(options.tenants ?? [[ASSET], [OTHER]]),
    {
      requireMasterDataUser: async () => ({ id: "u1", role: "location_admin" }),
      canManageAsset: async (_user: JwtPayload, assetId: string) => {
        asked.push(assetId);
        return options.manageable?.(assetId) ?? true;
      },
    } as never,
    {} as never,
    {} as never,
  );
  const entry = catalogEntry("telemetryReading.create")!;
  const result = resolver.resolve(entry, {}, { rows }, [ORG, ORG_B], JWT, ORG, options.mode ?? "propose");
  return { result, asked };
}

/** What a refusal threw: its class (the propose tool catches `CopilotTargetRefusal` only) and its sentence. */
async function refusalOf(result: Promise<unknown>): Promise<[boolean, string] | "resolved"> {
  try {
    await result;
    return "resolved";
  } catch (err) {
    return [err instanceof CopilotTargetRefusal, (err as Error).message];
  }
}

/** Rows whose every asset is in the bound organization and manageable resolve. */
export async function readingsOfManageableBoundAssetsResolve(): Promise<void> {
  expect((await resolveReadings([row(ASSET), row(ASSET)]).result)?.organizationId).toBe(ORG);
}

/** The route's `canManageAsset` runs on the row's asset. Mutation: skip the asset check → red. */
export async function theReadingsAskCanManageAssetOnTheRowsAsset(): Promise<void> {
  const { result, asked } = resolveReadings([row(ASSET)], { tenants: [[ASSET], []] });
  await result;
  expect(asked).toEqual([ASSET]);
}

/** An asset in no allowed organization is refused with its row number. Mutation: treat a missing asset as found → red. */
export async function anUnknownAssetIsRefusedWithItsRowNumber(): Promise<void> {
  expect(await refusalOf(resolveReadings([row(ASSET), row(UNKNOWN)]).result)).toEqual([
    true,
    "Row 2: Asset not found or outside your access scope.",
  ]);
}

/** An asset the caller may not manage is refused with the same sentence (disclosure-safe). */
export async function anUnmanageableAssetIsRefusedWithItsRowNumber(): Promise<void> {
  const { result } = resolveReadings([row(ASSET), row(ASSET), row(ASSET)], { manageable: () => false });
  expect(await refusalOf(result)).toEqual([true, "Rows 1, 2, 3: Asset not found or outside your access scope."]);
}

/** An asset of another allowed organization is refused as outside the conversation's organization. Mutation: drop the bound check → red. */
export async function anAssetOfAnotherOrganizationIsRefusedWithItsRowNumber(): Promise<void> {
  expect(await refusalOf(resolveReadings([row(OTHER), row(ASSET)]).result)).toEqual([
    true,
    "Row 1: the asset is outside this conversation's organization.",
  ]);
}

/** An open wizard's record (`"record"`) is what a fill is about to set: its rows are not checked. Mutation: drop the mode check → red. */
export async function anOpenReadingsWizardIsNotCheckedByRow(): Promise<void> {
  expect((await resolveReadings([row(UNKNOWN)], { mode: "record" }).result)?.organizationId).toBe(ORG);
}
