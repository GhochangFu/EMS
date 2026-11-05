import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";
import { catalogEntry } from "@bms/shared/copilot";

import {
  alreadyPinnedMessage,
  domainMismatchMessage,
  organizationMismatchMessage,
} from "../admin/asset-templates/asset-templates-adopt-messages";
import {
  adoptMalformedIdMessage,
  type AdoptAssetRow,
  adoptAssetIds,
  adoptBatchRefusal,
  resolveAdoptTarget,
} from "./copilot-adopt-targets";
import { CopilotTargetResolver } from "./copilot-target-resolver";
import { CopilotTargetRefusal } from "./copilot-telemetry-targets";

/**
 * `F4.312` PR 2 (ADR 0099 Amendment 12) — the `assetTemplateAdopt` target with
 * fakes. The adopt route refuses, on Confirm, a version outside the caller's
 * scope, and any listed asset that is pinned, of another organization or
 * domain, or outside the caller's write scope; the card must not be offered
 * for a batch the route would refuse (plan §4, PR 2: "a pinned asset is
 * refused before the card"). An unpublished version resolves with its status
 * for the lifecycle mirror (`copilot-template-lifecycle.spec.ts`). Each
 * refusal is checked beside the allowed twin, so "always refuse" and "never
 * refuse" both redden. The real-database claims are the integration twin's
 * (`copilot-adopt-targets.integration.spec.ts`).
 *
 * `F4.315` PR A (ADR 0099 Amendment 14 decisions 2–3): a refusal the caller
 * may see the records of names its cause — a pinned asset, an asset of
 * another domain or of another allowed organization — with the asset code and
 * `"<code>" v<version>`; an id found nowhere, or an asset outside the write
 * scope, keeps the one refusal (`null`); a non-UUID id gets the malformed
 * sentence before any read.
 *
 * Mutations, each applied once and seen red: drop `row.templateId !== null`
 * from `adoptBatchRefusal` ({@link aPinnedAssetIsRefused} and
 * {@link theResolverRefusesAPinnedAssetBeforeTheCard}); drop the domain
 * comparison ({@link anAssetOfAnotherDomainIsRefused}); pass `true` for
 * `checkAssets` in the resolver ({@link theResolverRecordModeResolvesTheVersion});
 * swap the pinned and domain sentences ({@link aPinnedAssetInScopeNamesItsCause},
 * {@link anAssetOfAnotherDomainInScopeNamesItsCause}); return the pinned
 * sentence for the out-of-scope asset ({@link anAssetOutsideTheWriteScopeNamesNoCause});
 * move the UUID test after the first read ({@link aMalformedVersionIdReadsNothing}).
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "55555555-5555-4555-8555-555555555555";
const ASSET = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const TEMPLATE = "44444444-4444-4444-8444-444444444444";
const SITE = "66666666-6666-4666-8666-666666666666";
const JWT = { sub: "f4312-adopt-unit", role: "admin" } as JwtPayload;

const VERSION = { organizationId: ORG, code: "TPL", version: 2, domain: "electrical" };
/** The stored version row the target reads (`findAdoptTemplate`'s select). */
const versionRow = (status: string) => ({ name: "Feeder v2", code: "TPL", version: 2, domain: "electrical", status });
const row = (id: string, over: Partial<AdoptAssetRow> = {}): AdoptAssetRow => ({
  id,
  code: id === ASSET ? "PHE-MFM-1" : "PHE-MFM-2",
  organizationId: ORG,
  domain: "electrical",
  templateId: null,
  locationId: SITE,
  ...over,
});

/**
 * A database that answers each read — a `… limit` or an awaited `… where` — with the next result
 * of `results`, in order, and counts the reads; its transaction runs the callback on itself.
 */
export function queuedDb(results: unknown[][], reads: { count: number } = { count: 0 }): never {
  const next = async () => {
    reads.count += 1;
    return results.shift() ?? [];
  };
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

export type AccessOptions = { masterData?: boolean; managesOrg?: boolean; writable?: string[] | null };

/** A fake of the three access checks the target asks, recording each call in `asked`. */
export function access(asked: string[], { masterData = true, managesOrg = true, writable = null }: AccessOptions = {}): never {
  return {
    requireMasterDataUser: async () => {
      asked.push("requireMasterDataUser");
      if (!masterData) throw new Error("403");
    },
    canManageOrganization: async (_user: unknown, organizationId: string) => {
      asked.push(`canManageOrganization:${organizationId}`);
      return managesOrg;
    },
    writableLocationIds: async () => {
      asked.push("writableLocationIds");
      return writable;
    },
  } as never;
}

type Fixture = {
  status?: string;
  template?: boolean;
  assets?: AdoptAssetRow[];
  ids?: unknown;
  options?: AccessOptions;
  checkAssets?: boolean;
  /** The answers of `findAssetElsewhere`'s reads, one per other allowed organization asked. */
  elsewhere?: unknown[][];
  allowed?: string[];
  templateId?: string;
};

/** The target resolved against one stored version (`status`; none when `template` is false) and the asset rows read. */
async function resolveWith(fixture: Fixture = {}) {
  const { status = "published", template = true, assets, ids = [ASSET, OTHER], options, checkAssets, elsewhere = [] } = fixture;
  const asked: string[] = [];
  const reads = { count: 0 };
  const stored = assets ?? [row(ASSET), row(OTHER)];
  const version = template ? [versionRow(status)] : [];
  const db = queuedDb([version, stored, ...elsewhere], reads);
  const allowed = fixture.allowed ?? [ORG];
  const resolved = await resolveAdoptTarget(db, access(asked, options), JWT, fixture.templateId ?? TEMPLATE, ids, allowed, checkAssets);
  return { resolved, asked, reads: reads.count };
}

/** The refusal sentence `resolveWith` throws, or `null` when it resolves (to a target or to the one refusal). */
async function sentenceOf(fixture: Fixture): Promise<string | null> {
  try {
    await resolveWith(fixture);
    return null;
  } catch (err) {
    if (err instanceof CopilotTargetRefusal) return err.message;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// The body's ids, before any read
// ---------------------------------------------------------------------------

/** Twenty-five distinct ids are admitted (the allowed twin of the bound). */
export function twentyFiveIdsAreAdmitted(): void {
  const ids = Array.from({ length: 25 }, (_, i) => uuidAt(i));
  expect(adoptAssetIds(ids)).toEqual(ids);
}

/** A twenty-sixth id is refused: the route's `TEMPLATE_ADOPTION_MAX_ASSETS`. */
export function aTwentySixthIdIsRefused(): void {
  expect(adoptAssetIds(Array.from({ length: 26 }, (_, i) => uuidAt(i)))).toBeNull();
}

/** The `i`-th of a run of distinct UUIDs. */
const uuidAt = (i: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`;

/** `F4.315` PR A (decision 3): a listed asset id that is not a UUID is refused with the malformed sentence. */
export function aNonUuidAssetIdIsTheMalformedSentence(): void {
  expect(() => adoptAssetIds([ASSET, "PHE-MFM-000000003"])).toThrow(adoptMalformedIdMessage("PHE-MFM-000000003"));
}

/** An id listed twice is refused: the body schema refuses it rather than collapsing it. */
export function aRepeatedIdIsRefused(): void {
  expect(adoptAssetIds([ASSET, OTHER, ASSET])).toBeNull();
}

/** A malformed list is refused before any read, so a body the route would 400 never reads a row. */
export async function aMalformedListIsRefusedBeforeAnyRead(): Promise<void> {
  const results = await Promise.all([[], "x", [ASSET, ASSET], [1]].map((ids) => resolveWith({ ids })));
  expect(results.map(({ resolved, reads }) => ({ resolved, reads }))).toEqual(Array(4).fill({ resolved: null, reads: 0 }));
}

// ---------------------------------------------------------------------------
// The listed assets (pure)
// ---------------------------------------------------------------------------

/** The allowed twin: template-less assets of the version's organization and domain, at writable sites. */
export function templateLessAssetsOfTheVersionAreAdmitted(): void {
  expect(adoptBatchRefusal(VERSION, [ASSET, OTHER], [row(ASSET), row(OTHER)], [SITE])).toBeNull();
}

/** A pinned asset refuses the batch by name: the route refuses `already_pinned`. */
export function aPinnedAssetIsRefused(): void {
  const pinned = row(OTHER, { templateId: TEMPLATE });
  expect(adoptBatchRefusal(VERSION, [ASSET, OTHER], [row(ASSET), pinned], null)).toEqual({ kind: "already_pinned", asset: pinned });
}

/** An asset of another domain refuses the batch by name (A1, `domain_mismatch`). */
export function anAssetOfAnotherDomainIsRefused(): void {
  const hvac = row(OTHER, { domain: "hvac" });
  expect(adoptBatchRefusal(VERSION, [ASSET, OTHER], [row(ASSET), hvac], null)).toEqual({ kind: "domain_mismatch", asset: hvac });
}

/** A row of another organization refuses the batch by name (A1, `organization_mismatch`). */
export function aReadRowOfAnotherOrganizationIsRefused(): void {
  const foreign = row(OTHER, { organizationId: OTHER_ORG });
  expect(adoptBatchRefusal(VERSION, [ASSET, OTHER], [row(ASSET), foreign], null)).toEqual({
    kind: "organization_mismatch",
    asset: foreign,
  });
}

/** A listed id no read returned is the general refusal (decision 3: an unknown record is never named). */
export function aListedIdTheReadDidNotReturnIsRefused(): void {
  expect(adoptBatchRefusal(VERSION, [ASSET, OTHER], [row(ASSET)], null)).toEqual({ kind: "general" });
}

/** An asset at a site outside the caller's write scope is the general refusal (the route's count refusal). */
export function anAssetOutsideTheWriteScopeIsRefused(): void {
  expect(adoptBatchRefusal(VERSION, [ASSET, OTHER], [row(ASSET), row(OTHER, { locationId: OTHER_ORG })], [SITE])).toEqual({
    kind: "general",
  });
}

/** An out-of-scope asset outranks a pinned one: the batch names no cause while any asset is out of scope. */
export function anOutOfScopeAssetOutranksAPinnedOne(): void {
  const rows = [row(ASSET, { templateId: TEMPLATE }), row(OTHER, { locationId: OTHER_ORG })];
  expect(adoptBatchRefusal(VERSION, [ASSET, OTHER], rows, [SITE])).toEqual({ kind: "general" });
}

/** A global administrator (`writableLocationIds` is `null`) writes every site, including an asset with none. */
export function aGlobalAdministratorWritesEverySite(): void {
  expect(adoptBatchRefusal(VERSION, [ASSET], [row(ASSET, { locationId: null })], null)).toBeNull();
}

// ---------------------------------------------------------------------------
// The cause, named in scope (Amendment 14 decisions 2-3)
// ---------------------------------------------------------------------------

/** (i) A pinned asset in scope names its cause: the asset code and `"TPL" v2`. */
export async function aPinnedAssetInScopeNamesItsCause(): Promise<void> {
  const sentence = await sentenceOf({ assets: [row(ASSET), row(OTHER, { templateId: TEMPLATE })] });
  expect(sentence).toBe(alreadyPinnedMessage({ code: "PHE-MFM-2" }, VERSION));
}

/** The pinned sentence names the asset code and the version's code and number. */
export async function thePinnedSentenceNamesTheAssetAndTheVersion(): Promise<void> {
  const sentence = (await sentenceOf({ assets: [row(ASSET), row(OTHER, { templateId: TEMPLATE })] })) ?? "";
  expect([sentence.includes('"PHE-MFM-2"'), sentence.includes('"TPL" v2')]).toEqual([true, true]);
}

/** (ii) An asset of another domain in scope names its cause. */
export async function anAssetOfAnotherDomainInScopeNamesItsCause(): Promise<void> {
  const sentence = await sentenceOf({ assets: [row(ASSET), row(OTHER, { domain: "hvac" })] });
  expect(sentence).toBe(domainMismatchMessage({ code: "PHE-MFM-2", domain: "hvac" }, VERSION));
}

/** (iii) An asset found in another allowed organization names the organization cause. */
export async function anAssetOfAnotherAllowedOrganizationNamesItsCause(): Promise<void> {
  const sentence = await sentenceOf({
    assets: [row(ASSET)],
    allowed: [ORG, OTHER_ORG],
    elsewhere: [[row(OTHER, { organizationId: OTHER_ORG })]],
  });
  expect(sentence).toBe(organizationMismatchMessage({ code: "PHE-MFM-2" }, VERSION));
}

/** (iv) An id found in no allowed organization keeps the general refusal (`null`), with no sentence. */
export async function anIdFoundNowhereKeepsTheGeneralRefusal(): Promise<void> {
  const { resolved } = await resolveWith({ assets: [row(ASSET)], allowed: [ORG, OTHER_ORG], elsewhere: [[]] });
  expect(resolved).toBeNull();
}

/** (v) An asset outside the write scope keeps the general refusal, with no sentence (the positive twin of iv). */
export async function anAssetOutsideTheWriteScopeNamesNoCause(): Promise<void> {
  const fixture: Fixture = { assets: [row(ASSET), row(OTHER, { locationId: null, templateId: TEMPLATE })], options: { writable: [SITE] } };
  expect([await sentenceOf(fixture), (await resolveWith(fixture)).resolved]).toEqual([null, null]);
}

/** (vi) A version id that is not a UUID is the malformed sentence. */
export async function aMalformedVersionIdIsTheMalformedSentence(): Promise<void> {
  expect(await sentenceOf({ templateId: "PUMP-M" })).toBe(adoptMalformedIdMessage("PUMP-M"));
}

/** (vi) A version id that is not a UUID reads nothing and asks no access check (before any read). */
export async function aMalformedVersionIdReadsNothing(): Promise<void> {
  const asked: string[] = [];
  const reads = { count: 0 };
  const db = queuedDb([[versionRow("published")], [row(ASSET), row(OTHER)]], reads);
  await resolveAdoptTarget(db, access(asked), JWT, "PUMP-M", [ASSET, OTHER], [ORG]).catch(() => undefined);
  expect([reads.count, asked]).toEqual([0, []]);
}

/** The malformed sentence points the model to the two read tools that answer the id. */
export function theMalformedSentenceNamesTheReadTools(): void {
  const sentence = adoptMalformedIdMessage("PUMP-M");
  expect([sentence.includes("not a record id"), sentence.includes("list_asset_templates"), sentence.includes("list_assets")]).toEqual([
    true,
    true,
    true,
  ]);
}

// ---------------------------------------------------------------------------
// The version and the gate
// ---------------------------------------------------------------------------

/** The allowed twin: a published version resolves to its organization, name and status. */
export async function aPublishedVersionInScopeResolves(): Promise<void> {
  const { resolved } = await resolveWith({ options: { writable: [SITE] } });
  expect(resolved).toEqual({ organizationId: ORG, name: "Feeder v2", status: "published" });
}

/** The route's gate runs in its order: master-data user, the version's organization, then the write scope. */
export async function theGateRunsInTheRoutesOrder(): Promise<void> {
  const { asked } = await resolveWith({ options: { writable: [SITE] } });
  expect(asked).toEqual(["requireMasterDataUser", `canManageOrganization:${ORG}`, "writableLocationIds"]);
}

/** A draft version in scope resolves with its status, so the lifecycle mirror reads the route's sentence. */
export async function aDraftVersionResolvesWithItsStatus(): Promise<void> {
  const { resolved } = await resolveWith({ status: "draft" });
  expect(resolved?.status).toBe("draft");
}

/** An archived version in scope resolves with its status, for the same mirror. */
export async function anArchivedVersionResolvesWithItsStatus(): Promise<void> {
  const { resolved } = await resolveWith({ status: "archived" });
  expect(resolved?.status).toBe("archived");
}

/** An unpublished version's assets are not read: the route answers its 409 before it reads them. */
export async function anUnpublishedVersionsAssetsAreNotRead(): Promise<void> {
  const { reads } = await resolveWith({ status: "draft" });
  expect(reads).toBe(1);
}

/** A version in no allowed organization is refused. */
export async function aVersionOutsideTheAllowedSetIsRefused(): Promise<void> {
  const { resolved } = await resolveWith({ template: false });
  expect(resolved).toBeNull();
}

/** A version in no allowed organization asks no organization check. */
export async function aVersionOutsideTheAllowedSetAsksNoOrganizationCheck(): Promise<void> {
  const { asked } = await resolveWith({ template: false });
  expect(asked).toEqual(["requireMasterDataUser"]);
}

/** A caller who does not manage the version's organization is refused. */
export async function aVersionOutsideTheCallersScopeIsRefused(): Promise<void> {
  const { resolved } = await resolveWith({ options: { managesOrg: false } });
  expect(resolved).toBeNull();
}

/** A caller who does not manage the version's organization reads no asset (the template read only). */
export async function aVersionOutsideTheCallersScopeReadsNoAsset(): Promise<void> {
  const { reads } = await resolveWith({ options: { managesOrg: false } });
  expect(reads).toBe(1);
}

/** A caller who is not a master-data user is refused (the 403 is the one refusal, not a thrown error). */
export async function aNonMasterDataUserIsRefused(): Promise<void> {
  const { resolved } = await resolveWith({ options: { masterData: false } });
  expect(resolved).toBeNull();
}

/** A caller who is not a master-data user is refused before the version is read (security review L1). */
export async function aNonMasterDataUserReadsNothing(): Promise<void> {
  const { reads } = await resolveWith({ options: { masterData: false } });
  expect(reads).toBe(0);
}

/** A listed asset outside the write scope refuses the target through the read path too. */
export async function aTargetWithAnAssetOutsideTheWriteScopeIsRefused(): Promise<void> {
  const { resolved } = await resolveWith({ assets: [row(ASSET), row(OTHER, { locationId: null })], options: { writable: [SITE] } });
  expect(resolved).toBeNull();
}

/** `checkAssets: false` (an open wizard's record) resolves the version alone. */
export async function theRecordModeResolvesTheVersionAlone(): Promise<void> {
  const { resolved } = await resolveWith({ ids: undefined, checkAssets: false });
  expect(resolved).toEqual({ organizationId: ORG, name: "Feeder v2", status: "published" });
}

/** `checkAssets: false` reads no asset. */
export async function theRecordModeReadsNoAsset(): Promise<void> {
  const { reads } = await resolveWith({ ids: undefined, checkAssets: false });
  expect(reads).toBe(1);
}

// ---------------------------------------------------------------------------
// Through the resolver
// ---------------------------------------------------------------------------

/** The `assetTemplate.adopt` entry through `CopilotTargetResolver`: the version read, the assets read, the organization's name. */
async function resolveEntry(assets: AdoptAssetRow[], body: Record<string, unknown> = { assetIds: [ASSET, OTHER] }, mode?: "record") {
  const results = [[versionRow("published")], ...(mode ? [] : [assets]), [{ name: "Org Seven" }]];
  const db = queuedDb(results);
  const resolver = new CopilotTargetResolver(db, access([]), {} as never, {} as never);
  return resolver.resolve(catalogEntry("assetTemplate.adopt")!, { id: TEMPLATE }, body, [ORG], JWT, ORG, mode);
}

/** The resolver wires the target: the card names the version and its organization. */
export async function theResolverNamesTheVersionAndItsOrganization(): Promise<void> {
  const resolved = await resolveEntry([row(ASSET), row(OTHER)]);
  expect([resolved?.organizationId, resolved?.organizationName, resolved?.targetName]).toEqual([ORG, "Org Seven", "Feeder v2"]);
}

/** The resolver hands the version's status to the propose tool's lifecycle mirror. */
export async function theResolverCarriesTheVersionsStatus(): Promise<void> {
  expect((await resolveEntry([row(ASSET), row(OTHER)]))?.status).toBe("published");
}

/** Plan §4 PR 2: a pinned asset in the list is refused before the card, through the resolver — by name since `F4.315`. */
export async function theResolverRefusesAPinnedAssetBeforeTheCard(): Promise<void> {
  await expect(resolveEntry([row(ASSET), row(OTHER, { templateId: TEMPLATE })])).rejects.toThrow(
    alreadyPinnedMessage({ code: "PHE-MFM-2" }, VERSION),
  );
}

/** `"record"` mode with an empty body resolves the version and its organization (an open wizard's record). */
export async function theResolverRecordModeResolvesTheVersion(): Promise<void> {
  const resolved = await resolveEntry([], {}, "record");
  expect([resolved?.organizationId, resolved?.organizationName, resolved?.targetName]).toEqual([ORG, "Org Seven", "Feeder v2"]);
}
