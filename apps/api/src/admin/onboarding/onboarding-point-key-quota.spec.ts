import { MAX_NEW_POINT_KEYS_PER_COMMIT, MAX_POINT_KEYS_PER_ORGANIZATION, type OnboardingDraft } from "@bms/shared";

import { runTool, type ToolContext, type ToolState } from "./onboarding-agent-tools";
import { newCatalogCodes, pointKeyQuotaProblem, type PointKeyQuota } from "./onboarding-draft-caps";
import { EMPTY_TEMPLATE_CONTEXT, type ValidateTemplateContext } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";

/**
 * `F4.111` (ADR 0104) — the growth quota on the fleet point-key catalog: the
 * pure rule, and the early refusal in the three tools that can put a new key
 * in a draft or propose it. The commit's locked check is the integration
 * suite's (`onboarding-point-key-quota.integration.spec.ts`). Assertions live
 * here (ADR 0014); the `.test` sibling registers one `it()` per claim.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** A catalog that holds `kw` active, as the global seed does. */
const KW_ACTIVE: ValidateTemplateContext = { ...EMPTY_TEMPLATE_CONTEXT, pointKeys: new Map([["kw", true]]) };

function keys(count: number, prefix = "new"): { code: string; name: string }[] {
  return Array.from({ length: count }, (_, i) => ({ code: `${prefix}_${i}`, name: `Key ${i}` }));
}

function draftWith(pointKeys: { code: string; name: string }[]): OnboardingDraft {
  return { pointKeys } as OnboardingDraft;
}

const NONE_ADDED: PointKeyQuota = { createdByOrganization: 0 };

function context(quota: PointKeyQuota, templates: ValidateTemplateContext = KW_ACTIVE): ToolContext {
  return {
    organizationId: "org-1",
    activeTypes: [{ code: "smoc_campus", label: "SMOC campus" }],
    catalog: { listPointKeys: async () => [], listInUsePointKeys: async () => new Set<string>() },
    protocols: {
      getContextForOrganization: async () => ({ catalog: [], orgExamples: [] }),
      formatForAssistant: () => "MQTT",
    },
    validator: new OnboardingValidateService(),
    templates,
    pointKeyQuota: quota,
    inventory: { listExisting: async () => ({ rows: [], total: 0 }) },
  };
}

function call(name: string, args: unknown): { id: string; name: string; arguments: string } {
  return { id: "c1", name, arguments: JSON.stringify(args) };
}

/** Q-U1 — ADR 0104 decision 2 pins both numbers. */
export function assertTheLimitsArePinned(): void {
  assert(MAX_NEW_POINT_KEYS_PER_COMMIT === 200, `per-commit limit ${MAX_NEW_POINT_KEYS_PER_COMMIT}, expected 200`);
  assert(MAX_POINT_KEYS_PER_ORGANIZATION === 1000, `per-organization limit ${MAX_POINT_KEYS_PER_ORGANIZATION}, expected 1000`);
}

/** Q-U2 — a code the catalog holds is not new, and a code named twice counts once. */
export function assertOnlyDistinctCodesTheCatalogLacksCount(): void {
  const draft = draftWith([...keys(2), { code: "kw", name: "Active Power" }, { code: "new_0", name: "Again" }]);
  const codes = newCatalogCodes(draft, KW_ACTIVE.pointKeys);
  assert(JSON.stringify(codes) === JSON.stringify(["new_0", "new_1"]), `new codes ${JSON.stringify(codes)}`);
}

/** Q-U3 — exactly the per-commit limit passes; one more is refused with the excess named. */
export function assertThePerCommitLimitIsInclusive(): void {
  assert(pointKeyQuotaProblem(draftWith(keys(200)), KW_ACTIVE.pointKeys, NONE_ADDED) === null, "200 new keys were refused");
  const problem = pointKeyQuotaProblem(draftWith(keys(201)), KW_ACTIVE.pointKeys, NONE_ADDED);
  assert(problem !== null && problem.includes("adds 201 point keys") && problem.includes("remove 1 of them"), `got ${problem}`);
}

/** Q-U4 — the organization's earlier additions count with this draft's. */
export function assertThePerOrganizationLimitCountsEarlierAdditions(): void {
  assert(
    pointKeyQuotaProblem(draftWith(keys(10)), KW_ACTIVE.pointKeys, { createdByOrganization: 990 }) === null,
    "990 + 10 was refused",
  );
  const problem = pointKeyQuotaProblem(draftWith(keys(11)), KW_ACTIVE.pointKeys, { createdByOrganization: 990 });
  assert(
    problem !== null && problem.includes("has added 990") && problem.includes("adds 11 more") && problem.includes("remove 1 of them"),
    `got ${problem}`,
  );
}

/** Q-U5 — an organization at its limit may still commit a draft that adds nothing to the catalog. */
export function assertADraftOfExistingCodesPassesAtTheLimit(): void {
  const problem = pointKeyQuotaProblem(draftWith([{ code: "kw", name: "Active Power" }]), KW_ACTIVE.pointKeys, {
    createdByOrganization: 1000,
  });
  assert(problem === null, `got ${problem}`);
}

/** Q-U6 — ADR 0104 decision 6: an exempt actor passes both limits. */
export function assertAnExemptActorPassesBothLimits(): void {
  const problem = pointKeyQuotaProblem(draftWith(keys(500)), KW_ACTIVE.pointKeys, "exempt");
  assert(problem === null, `got ${problem}`);
}

/** Q-U7 — `add_point_keys` refuses a call that would pass a limit and writes nothing. */
export async function assertAddPointKeysRefusesOverTheLimit(): Promise<void> {
  const state: ToolState = { working: draftWith(keys(150, "old")) };
  const out = await runTool(call("add_point_keys", { keys: keys(51) }), state, context(NONE_ADDED));
  assert(!out.ok && (out.error ?? "").includes("adds 201 point keys"), `got ${out.content}`);
  assert((state.working.pointKeys ?? []).length === 150, "the refused call wrote keys");
}

/** Q-U8 — the same call by an exempt actor writes. */
export async function assertAddPointKeysPassesForAnExemptActor(): Promise<void> {
  const state: ToolState = { working: draftWith(keys(150, "old")) };
  const out = await runTool(call("add_point_keys", { keys: keys(51) }), state, context("exempt"));
  assert(out.ok && (state.working.pointKeys ?? []).length === 201, `got ${out.content}`);
}

/** Q-U9 — the guided `add_point_key` refuses the key that would pass the organization's limit. */
export async function assertAddPointKeyRefusesAtTheOrganizationLimit(): Promise<void> {
  const state: ToolState = { working: draftWith([]) };
  const out = await runTool(call("add_point_key", { code: "fresh", name: "Fresh" }), state, context({ createdByOrganization: 1000 }));
  assert(!out.ok && (out.error ?? "").includes("past the 1000"), `got ${out.content}`);
  assert((state.working.pointKeys ?? []).length === 0, "the refused call wrote a key");
}

/** Q-U10 — `propose_commit` does not propose a draft over a limit (a `PATCH` or an upload can put one there). */
export async function assertProposeCommitRefusesOverTheLimit(): Promise<void> {
  const state: ToolState = { working: draftWith(keys(201)) };
  const out = await runTool(call("propose_commit", {}), state, context(NONE_ADDED));
  assert(!out.ok && (out.error ?? "").includes("adds 201 point keys"), `got ${out.content}`);
  assert(state.pendingProposal === undefined, "a proposal was recorded");
}
