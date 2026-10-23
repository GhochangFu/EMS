import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";
import { catalogEntry, proposeToolName } from "@bms/shared/copilot";

import { proposeHarness } from "./copilot-propose-tools.spec";
import { CopilotTargetResolver } from "./copilot-target-resolver";

/**
 * `F3.86` PR 6 review — the resolver's `onboardingSession` target. Only a
 * server-made change has it (the onboarding commit, ADR 0099 decision 7), so
 * the resolver refuses it before any read: every seam it holds throws when
 * touched, and records the touch. No propose tool reaches it either. Vitest
 * entry point: the sibling `.test.ts` (ADR 0014).
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const JWT = { sub: "f386-resolver-unit", role: "admin" } as JwtPayload;

/** A seam that records each property read and throws, so a refusal that reads anything fails loudly. */
function untouchable(name: string, touched: string[]): never {
  return new Proxy(
    {},
    {
      get: (_target, key) => {
        touched.push(`${name}.${String(key)}`);
        throw new Error(`F3.86: the resolver touched ${name}.${String(key)}`);
      },
    },
  ) as never;
}

/** The onboarding commit is refused with no database read and no access check. */
export async function anOnboardingSessionTargetIsRefusedBeforeAnyRead(): Promise<void> {
  const entry = catalogEntry("onboarding.commit");
  expect(entry?.target.kind).toBe("onboardingSession");
  const touched: string[] = [];
  const resolver = new CopilotTargetResolver(
    untouchable("tenantDb", touched),
    untouchable("access", touched),
    untouchable("users", touched),
    untouchable("grants", touched),
  );
  const resolved = await resolver.resolve(entry!, { id: SESSION }, { draftHash: "c".repeat(64) }, [ORG], JWT, ORG);
  expect(resolved).toBeNull();
  expect(touched).toEqual([]);
}

/** No propose tool reaches the entry: the model's call is an unknown tool, nothing is resolved or stored. */
export async function noProposeToolProposesTheOnboardingCommit(): Promise<void> {
  const entry = catalogEntry("onboarding.commit")!;
  const h = proposeHarness();
  const result = await h.tools.dispatch(proposeToolName(entry), { id: SESSION, body: { draftHash: "c".repeat(64) } }, h.ctx());
  expect(result.ok).toBe(false);
  expect(h.resolved).toEqual([]);
  expect(h.stored).toEqual([]);
}

/**
 * `F3.87` PR 2 (ADR 0099 Amendment 3 A1) — the mimic targets. A fake database
 * answers every row read with one named row; the access fake answers the
 * role and the organization check. The mimic authoring check is the mimic
 * services' `assertCanAuthor`: the role first (`canManageOrganization` alone
 * admits a `location_admin`), then the organization.
 */
const LAYOUT = "33333333-3333-4333-8333-333333333333";

/**
 * A database whose every `select … limit` answers one row, holding only the
 * columns that select named (an arm that reads a column it did not select gets
 * `undefined`, as from the real database), and whose transaction runs the
 * callback on itself.
 */
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

function mimicAccess(role: string, managesOrganization: boolean): never {
  return {
    requireMasterDataUser: async () => ({ id: "u1", role }),
    canManageOrganization: async () => managesOrganization,
  } as never;
}

const fixtureEntry = (target: unknown) =>
  ({ ...catalogEntry("dashboard.create")!, id: "fixture.mimic", target, refs: [] }) as never;

async function resolveMimic(target: unknown, role: string, managesOrganization: boolean, params = {}, body = {}) {
  const resolver = new CopilotTargetResolver(
    oneRowDb({ name: "Plant A", label: "Plant A" }),
    mimicAccess(role, managesOrganization),
    {} as never,
    {} as never,
  );
  return resolver.resolve(fixtureEntry(target), params, body, [ORG], JWT, ORG);
}

const LAYOUT_TARGET = { kind: "mimicLayout", param: "id" };
const LIBRARY_TARGET = { kind: "mimicLibrary", param: "id" };
const CREATE_TARGET = { kind: "organization", manage: "mimic" };

/** An organization admin who manages the organization resolves each mimic target, with the row's name. */
export async function anOrganizationAdminResolvesEveryMimicTarget(): Promise<void> {
  expect((await resolveMimic(LAYOUT_TARGET, "organization_admin", true, { id: LAYOUT }))?.targetName).toBe("Plant A");
  expect((await resolveMimic(LIBRARY_TARGET, "admin", true, { id: LAYOUT }))?.targetName).toBe("Plant A");
  expect((await resolveMimic(CREATE_TARGET, "organization_admin", true, {}, { organizationId: ORG }))?.organizationId).toBe(ORG);
}

/** A `location_admin` who manages the organization is refused: the role check comes first. */
export async function aLocationAdminIsRefusedEveryMimicTarget(): Promise<void> {
  expect(await resolveMimic(LAYOUT_TARGET, "location_admin", true, { id: LAYOUT })).toBeNull();
  expect(await resolveMimic(LIBRARY_TARGET, "location_admin", true, { id: LAYOUT })).toBeNull();
  expect(await resolveMimic(CREATE_TARGET, "location_admin", true, {}, { organizationId: ORG })).toBeNull();
}

/** An organization admin of another organization is refused. */
export async function anAdminOutsideTheOrganizationIsRefused(): Promise<void> {
  expect(await resolveMimic(LAYOUT_TARGET, "organization_admin", false, { id: LAYOUT })).toBeNull();
  expect(await resolveMimic(LIBRARY_TARGET, "organization_admin", false, { id: LAYOUT })).toBeNull();
  expect(await resolveMimic(CREATE_TARGET, "organization_admin", false, {}, { organizationId: ORG })).toBeNull();
}

/**
 * `F4.278` (ADR 0099 Amendment 8 D2) — the `rule` target. It mirrors
 * `rules.controller.ts`: `assertOperationsWriteRole(user, "configuration")`, then
 * the rule's (or the create body's) asset in the caller's **read** scope
 * (`readableAssetIds`; `null` is a global admin, who reads every asset). The
 * route refuses no copilot role by role — all four are in the configuration
 * class — so the per-role refusal is by scope.
 */
const RULE = "44444444-4444-4444-8444-444444444444";
const RULE_ASSET = "55555555-5555-4555-8555-555555555555";
const OTHER_ASSET = "66666666-6666-4666-8666-666666666666";

function ruleAccess(readable: string[] | null, refuseRole = false, asked: string[] = []): never {
  return {
    assertOperationsWriteRole: async (_user: unknown, writeClass: string) => {
      asked.push(`role:${writeClass}`);
      if (refuseRole) throw new Error("403");
    },
    readableAssetIds: async () => {
      asked.push("readableAssetIds");
      return readable;
    },
  } as never;
}

async function resolveRule(
  id: string,
  readable: string[] | null,
  options: { refuseRole?: boolean; asked?: string[]; body?: Record<string, unknown>; mode?: "propose" | "record" } = {},
) {
  const resolver = new CopilotTargetResolver(
    oneRowDb({ name: "Chiller high", assetId: RULE_ASSET, lifecycleStatus: "published" }),
    ruleAccess(readable, options.refuseRole, options.asked),
    {} as never,
    {} as never,
  );
  const entry = catalogEntry(id)!;
  const params: Record<string, string> = id === "rule.create" ? {} : { id: RULE };
  return resolver.resolve(entry, params, options.body ?? {}, [ORG], JWT, ORG, options.mode);
}

/** Each of the four copilot roles, with the rule's asset in its read scope, resolves the rule (the route's two gates pass). */
export async function everyCopilotRoleInTheConfigurationClassResolvesARule(): Promise<void> {
  for (const readable of [null, [RULE_ASSET], [OTHER_ASSET, RULE_ASSET]]) {
    const asked: string[] = [];
    expect((await resolveRule("rule.publish", readable, { asked }))?.targetName).toBe("Chiller high");
    expect(asked).toEqual(["role:configuration", "readableAssetIds"]);
  }
}

/** A role the configuration class refuses (the route's 403) is refused, before the scope is read. */
export async function aRoleTheConfigurationClassRefusesIsRefused(): Promise<void> {
  const asked: string[] = [];
  expect(await resolveRule("rule.publish", null, { refuseRole: true, asked })).toBeNull();
  expect(asked).toEqual(["role:configuration"]);
}

/** A rule whose asset is outside the caller's read scope is refused (the route's 404). */
export async function aRuleWhoseAssetIsOutsideTheReadScopeIsRefused(): Promise<void> {
  expect(await resolveRule("rule.disable", [OTHER_ASSET])).toBeNull();
  expect(await resolveRule("rule.disable", [])).toBeNull();
}

/** The create needs an `assetId`; it resolves the asset's organization and name, and its scope check reads the body's asset. */
export async function aRuleCreateNeedsAnAssetIdAndResolvesTheAssetsOrganization(): Promise<void> {
  expect(await resolveRule("rule.create", null, { body: { name: "x" } })).toBeNull();
  const resolved = await resolveRule("rule.create", [RULE_ASSET], { body: { assetId: RULE_ASSET } });
  expect([resolved?.organizationId, resolved?.targetName]).toEqual([ORG, "Chiller high"]);
  expect(await resolveRule("rule.create", [RULE_ASSET], { body: { assetId: OTHER_ASSET } })).toBeNull();
}

/** A rule target carries the row's lifecycle, so the update summary can carry D3's live line. */
export async function aRuleTargetCarriesItsLifecycle(): Promise<void> {
  expect((await resolveRule("rule.update", null, { body: { thresholdValue: 4 } }))?.lifecycle).toBe("published");
}

/**
 * F4.278 review: `RulesService.updateRule` runs `assertAssetInScope` on the rule's current asset
 * **and** on the merged one, so an update whose body names an asset outside the read scope is refused.
 */
export async function aRuleUpdateToAnAssetOutsideTheReadScopeIsRefused(): Promise<void> {
  expect(await resolveRule("rule.update", [RULE_ASSET], { body: { assetId: OTHER_ASSET } })).toBeNull();
}

/** The allowed twin: an update whose body names an asset in the read scope resolves. */
export async function aRuleUpdateToAnAssetInTheReadScopeResolves(): Promise<void> {
  const resolved = await resolveRule("rule.update", [RULE_ASSET, OTHER_ASSET], { body: { assetId: OTHER_ASSET } });
  expect(resolved?.targetName).toBe("Chiller high");
}

/** A body `assetId: null` clears the asset; the route refuses that for a scoped caller (`!assetId`). */
export async function aRuleUpdateThatClearsTheAssetIsRefusedForAScopedCaller(): Promise<void> {
  expect(await resolveRule("rule.update", [RULE_ASSET], { body: { assetId: null } })).toBeNull();
}

/** A global admin (`null` read scope) may clear the asset, as the route lets them. */
export async function aRuleUpdateThatClearsTheAssetResolvesForAGlobalAdmin(): Promise<void> {
  expect((await resolveRule("rule.update", null, { body: { assetId: null } }))?.targetName).toBe("Chiller high");
}

/** A record-mode read (an open wizard) resolves the row with the same two gates. */
export async function aRecordModeReadResolvesTheRow(): Promise<void> {
  expect((await resolveRule("rule.update", [RULE_ASSET], { mode: "record" }))?.targetName).toBe("Chiller high");
  expect(await resolveRule("rule.update", [OTHER_ASSET], { mode: "record" })).toBeNull();
}
