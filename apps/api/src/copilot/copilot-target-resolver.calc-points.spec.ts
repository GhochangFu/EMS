import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";
import { catalogEntry } from "@bms/shared/copilot";

import { CopilotTargetResolver } from "./copilot-target-resolver";

/**
 * `F4.311` PR 3 (ADR 0099 Amendment 11 G2, G3) — the calc-point targets with
 * fakes. `PUT` and `DELETE /admin/assets/:assetId/calc-points/:pointKey`
 * dispatch on the asset's kind, so each entry's target admits only the kind
 * its body is for: `calcOverride.set` a pinned asset, `calcPoint.set` and
 * `calcPoint.delete` a template-less one. A card never describes a different
 * write than the route performs. The batch's database claims are the
 * integration spec's (`copilot-calc-point-targets.integration.spec.ts`).
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const ASSET = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const TEMPLATE = "44444444-4444-4444-8444-444444444444";
const JWT = { sub: "f4311-resolver-unit", role: "admin" } as JwtPayload;

/**
 * A database that answers each read — a `… limit` or an awaited `… where` — with the next result
 * of `results`, in order; its transaction runs the callback on itself.
 */
function queuedDb(results: unknown[][]): never {
  const next = async () => results.shift() ?? [];
  const chain: Record<string, unknown> = {
    select: () => chain,
    from: () => chain,
    innerJoin: () => chain,
    where: () => ({ limit: next, then: (resolve: (value: unknown) => unknown) => next().then(resolve) }),
    execute: async () => undefined,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(chain),
  };
  return chain as never;
}

function access(manages: readonly string[], asked: string[] = [], masterData = true): never {
  return {
    requireMasterDataUser: async () => {
      asked.push("requireMasterDataUser");
      if (!masterData) throw new Error("403");
    },
    canManageAsset: async (_user: unknown, assetId: string) => {
      asked.push(`canManageAsset:${assetId}`);
      return manages.includes(assetId);
    },
  } as never;
}

/** One asset target resolved for `entryId`, the asset stored with `templateId`. */
async function resolveAsset(entryId: string, templateId: string | null) {
  const db = queuedDb([[{ name: "Pump 7", templateId }], [{ pointKey: "kw" }], [{ name: "Org Seven" }]]);
  const resolver = new CopilotTargetResolver(db, access([ASSET]), {} as never, {} as never);
  return resolver.resolve(catalogEntry(entryId)!, { assetId: ASSET, pointKey: "kw_x2" }, {}, [ORG], JWT, ORG);
}

/** G2: an override card on an asset with no template is refused — the route would write a standalone point. */
export async function anOverrideOnATemplateLessAssetIsRefused(): Promise<void> {
  expect(await resolveAsset("calcOverride.set", null)).toBeNull();
}

/** G2's allowed twin: the override resolves on a pinned asset, with its point keys. */
export async function anOverrideOnAPinnedAssetResolves(): Promise<void> {
  const resolved = await resolveAsset("calcOverride.set", TEMPLATE);
  expect([resolved?.targetName, resolved?.pointKeys]).toEqual(["Pump 7", ["kw"]]);
}

/** G2: a standalone set on a pinned asset is refused — the route would write an override. */
export async function aStandaloneSetOnAPinnedAssetIsRefused(): Promise<void> {
  expect(await resolveAsset("calcPoint.set", TEMPLATE)).toBeNull();
}

/** G2's allowed twin: the standalone set resolves on a template-less asset, with its point keys. */
export async function aStandaloneSetOnATemplateLessAssetResolves(): Promise<void> {
  const resolved = await resolveAsset("calcPoint.set", null);
  expect([resolved?.targetName, resolved?.pointKeys]).toEqual(["Pump 7", ["kw"]]);
}

/** G4: a standalone removal on a pinned asset is refused — the route would clear an override, which stays manual. */
export async function aStandaloneDeleteOnAPinnedAssetIsRefused(): Promise<void> {
  expect(await resolveAsset("calcPoint.delete", TEMPLATE)).toBeNull();
}

/** G4's allowed twin: the removal resolves on a template-less asset. */
export async function aStandaloneDeleteOnATemplateLessAssetResolves(): Promise<void> {
  expect((await resolveAsset("calcPoint.delete", null))?.targetName).toBe("Pump 7");
}

/** The batch with the two assets read, each with its points, and the organization's name. */
async function resolveBatch(manages: readonly string[], asked: string[] = [], masterData = true) {
  const db = queuedDb([
    [{ id: ASSET }, { id: OTHER }],
    [
      { assetId: ASSET, pointKey: "kw" },
      { assetId: OTHER, pointKey: "kw" },
      { assetId: ASSET, pointKey: "kva" },
    ],
    [{ name: "Org Seven" }],
  ]);
  const resolver = new CopilotTargetResolver(db, access(manages, asked, masterData), {} as never, {} as never);
  return resolver.resolve(catalogEntry("calcPoint.createBatch")!, {}, { assetIds: [ASSET, OTHER] }, [ORG], JWT, ORG);
}

/** G3: the batch resolves to its organization, the formula's refs the keys every asset has, after the route's gate on each. */
export async function aBatchResolvesToItsOrganizationAndTheSharedKeys(): Promise<void> {
  const asked: string[] = [];
  const resolved = await resolveBatch([ASSET, OTHER], asked);
  expect([resolved?.organizationId, resolved?.targetName, resolved?.pointKeys]).toEqual([ORG, "Org Seven", ["kw"]]);
  expect(asked).toEqual(["requireMasterDataUser", `canManageAsset:${ASSET}`, `canManageAsset:${OTHER}`]);
}

/** G3: one asset the caller may not manage refuses the whole batch (the route's all-or-nothing). */
export async function aBatchWithOneUnmanageableAssetIsRefused(): Promise<void> {
  expect(await resolveBatch([ASSET])).toBeNull();
}

/** G3: a caller who is not a master-data user is refused before any asset is checked. */
export async function aBatchForANonMasterDataUserIsRefused(): Promise<void> {
  const asked: string[] = [];
  expect(await resolveBatch([ASSET, OTHER], asked, false)).toBeNull();
  expect(asked).toEqual(["requireMasterDataUser"]);
}
