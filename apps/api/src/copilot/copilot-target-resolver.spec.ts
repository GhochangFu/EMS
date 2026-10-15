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
