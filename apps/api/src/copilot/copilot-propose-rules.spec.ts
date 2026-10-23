import { BadRequestException } from "@nestjs/common";
import { expect } from "vitest";

import { COPILOT_CATALOG, proposeToolName, RULE_LIVE_LINE } from "@bms/shared/copilot";

import type { ResolvedIdentity } from "../auth/identity-resolver";
import type { RuleProposalCheckInput } from "../rules/rule-proposal-check.service";
import { bodyHash } from "./body-hash";
import { PROPOSE_RULES_UNAVAILABLE_ERROR, RULE_ENTRY_IDS } from "./copilot-propose-rules";
import { PROPOSE_TARGET_ERROR } from "./copilot-propose-tools";
import { proposeHarness } from "./copilot-propose-tools.spec";
import type { ResolvedTarget } from "./copilot-target-resolver";

/**
 * `F4.278` (ADR 0099 Amendment 8, D1–D3, Q9, Q10) — the propose tools over the
 * real rule entries, with a recording fake of `RuleProposalCheckService`.
 * Vitest entry point: the sibling `.test.ts`.
 */

const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const USER = "11111111-1111-4111-8111-111111111111";
const RULE = "44444444-4444-4444-8444-444444444444";
const ASSET = "55555555-5555-4555-8555-555555555555";
const NOTE = "Condition: CH-01 supply_temp_c above 3 (latest value; clear hold 120 s). Would match now: no sample yet.";

export const RULE_TOOLS = [
  "rule.create",
  "rule.update",
  "rule.duplicate",
  "rule.publish",
  "rule.enable",
  "rule.disable",
  "rule.archive",
].map((id) => proposeToolName({ id }));

const CREATE_BODY = {
  name: "Chiller high",
  ruleType: "threshold",
  assetId: ASSET,
  pointKey: "supply_temp_c",
  operator: "gt",
  thresholdValue: 3,
  condition: { window: "latest" },
  action: { type: "notify", target: "Operations" },
};

const COPILOT_ROLES = ["admin", "organization_admin", "location_admin", "asset_group_admin"] as const;

function target(lifecycle: string): ResolvedTarget {
  return {
    organizationId: ORG_X,
    organizationName: "Org X",
    targetName: "Chiller high",
    lifecycle,
  };
}

function checks(refusal?: string) {
  const calls: RuleProposalCheckInput[] = [];
  return {
    calls,
    rules: {
      check: async (input: RuleProposalCheckInput) => {
        calls.push(input);
        if (refusal !== undefined) throw new BadRequestException(refusal);
        return { note: NOTE };
      },
    },
  };
}

function harness(lifecycle = "published", refusal?: string) {
  const c = checks(refusal);
  return {
    ...proposeHarness({ target: target(lifecycle), rules: c.rules }),
    checks: c.calls,
  };
}

/** D1: the seven rule tools are in every copilot role's registry (the route's configuration class admits all four). */
export function theRuleToolsAreInEveryCopilotRolesRegistry(): void {
  for (const role of COPILOT_ROLES) {
    const names = proposeHarness()
      .tools.registryFor({ access: true, role })
      .definitions.map((d) => d.name);
    for (const tool of RULE_TOOLS) expect(names, `${role} ${tool}`).toContain(tool);
  }
}

/** Without the check service a rule proposal fails closed: nothing is stored. */
export async function aRuleProposalWithoutTheCheckServiceIsRefused(): Promise<void> {
  const h = proposeHarness({ target: target("published") });
  const result = await h.tools.dispatch(proposeToolName({ id: "rule.publish" }), { id: RULE, body: {} }, h.ctx());
  expect(result).toEqual({ ok: false, error: PROPOSE_RULES_UNAVAILABLE_ERROR });
  expect(h.stored).toEqual([]);
}

/** A refused check stores nothing and returns the route's own sentence. */
export async function aRefusedCheckStoresNothingAndReturnsTheRoutesSentence(): Promise<void> {
  const h = harness("archived", "Archived rules cannot be published");
  const result = await h.tools.dispatch(proposeToolName({ id: "rule.publish" }), { id: RULE, body: {} }, h.ctx());
  expect(result).toEqual({
    ok: false,
    error: "Archived rules cannot be published",
  });
  expect(h.stored).toEqual([]);
}

/** The check is asked with the entry, the path, the body and the resolved organization. */
export async function theCheckIsAskedWithTheResolvedOrganization(): Promise<void> {
  const h = harness();
  await h.tools.dispatch(proposeToolName({ id: "rule.create" }), { body: CREATE_BODY }, h.ctx());
  expect(h.checks.map((call) => [call.entryId, call.organizationId, call.body.name])).toEqual([
    ["rule.create", ORG_X, "Chiller high"],
  ]);
}

/** The stored summary carries the check's note after the entry's sentence. */
export async function theStoredSummaryCarriesTheCheckNote(): Promise<void> {
  const h = harness();
  const result = await h.tools.dispatch(proposeToolName({ id: "rule.create" }), { body: CREATE_BODY }, h.ctx());
  expect(result.ok).toBe(true);
  expect(h.stored[0]?.summary).toBe(`Create the rule "Chiller high" on Chiller high in Org X. ${NOTE}`);
}

/**
 * F4.278 review: a target the resolver refuses (an update to an asset outside the read scope) is
 * refused before the check runs, so the check never reads that asset's telemetry into a note.
 */
export async function aRefusedTargetNeverRunsTheCheck(): Promise<void> {
  const c = checks();
  const h = proposeHarness({ target: null, rules: c.rules });
  const result = await h.tools.dispatch(
    proposeToolName({ id: "rule.update" }),
    { id: RULE, body: { assetId: "66666666-6666-4666-8666-666666666666" } },
    h.ctx(),
  );
  expect([result, c.calls, h.stored]).toEqual([{ ok: false, error: PROPOSE_TARGET_ERROR }, [], []]);
}

/**
 * F4.278 review: the check runs for exactly the catalog's rule entries. A later `rule.*` entry that
 * should skip it must be named in `notChecked`; one missing from `RULE_ENTRY_IDS` would store an unchecked card.
 */
export function theCheckedIdsAreTheCatalogsRuleEntries(): void {
  const notChecked: readonly string[] = [];
  const ruleTargeted = COPILOT_CATALOG.filter((entry) => entry.target.kind === "rule");
  const expected = ruleTargeted.map((entry) => entry.id).filter((id) => !notChecked.includes(id));
  expect([...RULE_ENTRY_IDS].sort()).toEqual([...expected].sort());
}

/** The enable tool defines no body argument and stores `{ enabled: true }`. */
export async function theEnableToolDefinesNoBodyAndStoresEnabledTrue(): Promise<void> {
  const h = harness();
  const definition = h.tools.registry.definitions.find((d) => d.name === proposeToolName({ id: "rule.enable" }));
  expect(Object.keys((definition?.parameters as { properties: Record<string, unknown> }).properties)).toEqual(["id"]);
  await h.tools.dispatch(proposeToolName({ id: "rule.enable" }), { id: RULE }, h.ctx());
  expect(h.stored[0]?.body).toEqual({ enabled: true });
}

/** The disable tool stores `{ enabled: false }` with its hash, and is red (the catalog's risk). */
export async function theDisableToolStoresEnabledFalseWithItsHashAndIsRed(): Promise<void> {
  const h = harness();
  await h.tools.dispatch(proposeToolName({ id: "rule.disable" }), { id: RULE }, h.ctx());
  expect(h.stored[0]).toMatchObject({
    body: { enabled: false },
    bodyHash: bodyHash({ enabled: false }, []),
    risk: "deactivate",
    method: "PATCH",
    path: `/api/v1/rules/${RULE}/enabled`,
  });
}

/** D3: the publish card carries the live line. */
export async function thePublishSummaryCarriesTheLiveLine(): Promise<void> {
  const h = harness("draft");
  await h.tools.dispatch(proposeToolName({ id: "rule.publish" }), { id: RULE, body: {} }, h.ctx());
  expect(h.stored[0]?.summary).toContain(RULE_LIVE_LINE);
}

/** Q10 / D3: an update of a published rule carries the live line. */
export async function anUpdateOfAPublishedRuleCarriesTheLiveLine(): Promise<void> {
  const h = harness("published");
  await h.tools.dispatch(proposeToolName({ id: "rule.update" }), { id: RULE, body: { thresholdValue: 4 } }, h.ctx());
  expect(h.stored[0]?.summary).toContain(RULE_LIVE_LINE);
}

/** The adjacent negative: an update of a draft does not. */
export async function anUpdateOfADraftHasNoLiveLine(): Promise<void> {
  const h = harness("draft");
  const result = await h.tools.dispatch(
    proposeToolName({ id: "rule.update" }),
    { id: RULE, body: { thresholdValue: 4 } },
    h.ctx(),
  );
  expect(result.ok).toBe(true);
  expect(h.stored[0]?.summary).not.toContain(RULE_LIVE_LINE);
}

/** The model body refuses a create without an asset, before the resolver or the check is asked. */
export async function aCreateWithoutAnAssetIsRefusedByTheModelBody(): Promise<void> {
  const h = harness();
  const { assetId: _dropped, ...noAsset } = CREATE_BODY;
  const result = await h.tools.dispatch(proposeToolName({ id: "rule.create" }), { body: noAsset }, h.ctx());
  expect(result.ok).toBe(false);
  expect(result.ok ? "" : result.error).toContain("Invalid body");
  expect(result.ok ? "" : result.error).toContain("assetId");
  expect([h.resolved, h.checks, h.stored]).toEqual([[], [], []]);
}

/** D4 is N/A for rules (no access entry, no clientOnly field): a rule proposal in a follow-up turn is accepted (decision 4.7). */
export async function aRuleProposalInAFollowUpTurnIsAccepted(): Promise<void> {
  const h = harness();
  const identity = {
    id: USER,
    role: "location_admin",
    organizationId: ORG_X,
  } as ResolvedIdentity;
  const result = await h.tools.dispatch(
    proposeToolName({ id: "rule.disable" }),
    { id: RULE },
    h.ctx({ turnKind: "follow_up", identity }),
  );
  expect(result.ok).toBe(true);
  expect(h.stored).toHaveLength(1);
}
