import { expect } from "vitest";

import { parseFormula, type CalcCrossRef } from "@bms/shared";

import { refuseOutOfScopeReferences, type ScopeGuardDeps } from "./calc-point-standalone.service";

/**
 * `F4.311` PR 2 — rule 6 (ADR 0109 ruling 5), the scope/organization guard,
 * with fakes and no database. One claim per function.
 *
 * The integration suite cannot build the case this guard exists for: a
 * qualified code resolves only at the owner's location (ADR 0055 decision
 * 12), and a location has one organization, so a resolved asset in a second
 * organization is impossible in a real database today. The guard is written
 * so a later widening of decision 12 cannot open it silently — and that is
 * only provable with a resolver that answers what today's cannot.
 */

const OWNER = { id: "00000000-0000-4000-8000-0000000000a1", organizationId: "org-a" };
const OTHER_ID = "00000000-0000-4000-8000-0000000000b2";
const SAME_ID = "00000000-0000-4000-8000-0000000000c3";

function crossRefsOf(formula: string): CalcCrossRef[] {
  const parsed = parseFormula(formula, { dialect: "bms-calc-v2" });
  if (!parsed.ok) throw new Error(`fixture formula does not parse: ${formula}`);
  return parsed.crossRefs;
}

function deps(over: {
  resolved: Record<string, string | null>;
  orgs: Record<string, string | null>;
  manageable?: readonly string[];
}): ScopeGuardDeps {
  return {
    resolveQualified: async () => new Map(Object.entries(over.resolved)),
    readAssets: async (ids) =>
      ids.filter((id) => id in over.orgs).map((id) => ({ id, organizationId: over.orgs[id] ?? null })),
    canManageAsset: async (id) => (over.manageable ?? [OTHER_ID, SAME_ID]).includes(id),
  };
}

/** A named asset in a second organization is refused even when the scope check would pass. */
export async function aSecondOrganizationIsRefusedEvenInScope(): Promise<void> {
  const message = await refuseOutOfScopeReferences(
    deps({ resolved: { "OTHER-01": OTHER_ID }, orgs: { [OTHER_ID]: "org-b" } }),
    OWNER,
    crossRefsOf("{OTHER-01.kw} * 2"),
  );
  expect(message).not.toBeNull();
}

/** The refusal names the code the author typed. */
export async function theRefusalNamesTheCode(): Promise<void> {
  const message = await refuseOutOfScopeReferences(
    deps({ resolved: { "OTHER-01": OTHER_ID }, orgs: { [OTHER_ID]: "org-b" } }),
    OWNER,
    crossRefsOf("{OTHER-01.kw} * 2"),
  );
  expect(message).toContain("OTHER-01");
}

/** The refusal never names the refused asset's id. */
export async function theRefusalNeverNamesTheId(): Promise<void> {
  const message = await refuseOutOfScopeReferences(
    deps({ resolved: { "OTHER-01": OTHER_ID }, orgs: { [OTHER_ID]: "org-b" } }),
    OWNER,
    crossRefsOf("{OTHER-01.kw} * 2"),
  );
  expect(message).not.toContain(OTHER_ID);
}

/** A same-organization asset the author cannot manage is refused. */
export async function anUnmanageableAssetIsRefused(): Promise<void> {
  const message = await refuseOutOfScopeReferences(
    deps({ resolved: { "SAME-01": SAME_ID }, orgs: { [SAME_ID]: "org-a" }, manageable: [] }),
    OWNER,
    crossRefsOf("{SAME-01.kw} * 2"),
  );
  expect(message).toContain("SAME-01");
}

/** A resolved id whose row cannot be read is refused: the guard fails closed. */
export async function anUnreadableResolvedAssetIsRefused(): Promise<void> {
  const message = await refuseOutOfScopeReferences(
    deps({ resolved: { "GONE-01": OTHER_ID }, orgs: {} }),
    OWNER,
    crossRefsOf("{GONE-01.kw} * 2"),
  );
  expect(message).toContain("GONE-01");
}

/** A same-organization asset in scope passes. */
export async function aSameOrganizationAssetInScopePasses(): Promise<void> {
  const message = await refuseOutOfScopeReferences(
    deps({ resolved: { "SAME-01": SAME_ID }, orgs: { [SAME_ID]: "org-a" } }),
    OWNER,
    crossRefsOf("{SAME-01.kw} * 2"),
  );
  expect(message).toBeNull();
}

/** Only the refused code is named, not a sibling that passed. */
export async function onlyTheRefusedCodeIsNamed(): Promise<void> {
  const message = await refuseOutOfScopeReferences(
    deps({
      resolved: { "SAME-01": SAME_ID, "OTHER-01": OTHER_ID },
      orgs: { [SAME_ID]: "org-a", [OTHER_ID]: "org-b" },
    }),
    OWNER,
    crossRefsOf("{SAME-01.kw} + {OTHER-01.kw}"),
  );
  expect(message).not.toContain("SAME-01");
}

/** No answer from the resolver for the owner is not a pass: every typed code is refused (fail closed). */
export async function anUnansweredResolverRefusesEveryCode(): Promise<void> {
  const unanswered: ScopeGuardDeps = { ...deps({ resolved: {}, orgs: {} }), resolveQualified: async () => undefined };
  const message = await refuseOutOfScopeReferences(unanswered, OWNER, crossRefsOf("{SAME-01.kw} + {OTHER-01.kw}"));
  expect(message).toMatch(/SAME-01[\s\S]*OTHER-01/);
}

/** A code the resolver answers `null` for is refused here too, not passed as "nothing to check". */
export async function aNullResolutionIsRefused(): Promise<void> {
  const message = await refuseOutOfScopeReferences(
    deps({ resolved: { "GONE-01": null }, orgs: {} }),
    OWNER,
    crossRefsOf("{GONE-01.kw} * 2"),
  );
  expect(message).toContain("GONE-01");
}
