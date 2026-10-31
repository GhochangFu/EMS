import { expect } from "vitest";

import {
  copilotRuleBatchModelBodySchema,
  copilotRuleCreateModelBodySchema,
  ruleBatchBodySchema,
} from "../../contracts/rule-writes";
import { catalogEntry, EXCLUDED_ROUTES } from "./index";
import { RULE_LIVE_LINE } from "./rules";
import type { CatalogEntry, CatalogSummaryInput } from "./types";

/**
 * `F4.278` (ADR 0099 Amendment 8, D1–D3, D6, D8, Q9, Q10) — the alarm-rule
 * entries. The rules every entry obeys are `catalog.spec.ts`; this file holds
 * what is particular to these seven. Vitest entry point: the sibling `.test.ts`.
 */

const RULE_IDS = [
  "rule.create",
  "rule.update",
  "rule.duplicate",
  "rule.publish",
  "rule.enable",
  "rule.disable",
  "rule.archive",
];
const ROW = "22222222-2222-4222-8222-222222222222";

function entry(id: string): CatalogEntry {
  const found = catalogEntry(id);
  if (!found) throw new Error(`no catalog entry ${id}`);
  return found;
}

function summary(id: string, input: Partial<CatalogSummaryInput> = {}): string {
  return entry(id).summary({
    body: {},
    params: { id: ROW },
    targetName: "Chiller high",
    organizationName: "Pune Works",
    ...input,
  });
}

/** The seven entries name the Rule Engine's own routes and bodies. */
export function theSevenRuleEntriesNameTheirRoutes(): void {
  expect(RULE_IDS.map((id) => [id, entry(id).method, entry(id).path, entry(id).bodyName])).toEqual([
    ["rule.create", "POST", "/rules", "ruleDraftBodySchema"],
    ["rule.update", "PATCH", "/rules/:id", "ruleUpdateBodySchema"],
    ["rule.duplicate", "POST", "/rules/:id/duplicate", "ruleLifecycleBodySchema"],
    ["rule.publish", "POST", "/rules/:id/publish", "ruleLifecycleBodySchema"],
    ["rule.enable", "PATCH", "/rules/:id/enabled", "ruleToggleBodySchema"],
    ["rule.disable", "PATCH", "/rules/:id/enabled", "ruleToggleBodySchema"],
    ["rule.archive", "POST", "/rules/:id/archive", "ruleLifecycleBodySchema"],
  ]);
}

/** D3: one entry per direction, each a fixed body with no step; disable is red. */
export function theDirectionEntriesHaveFixedBodiesAndNoSteps(): void {
  const enable = entry("rule.enable");
  const disable = entry("rule.disable");
  expect([enable.fixedBody, enable.risk, enable.steps]).toEqual([{ enabled: true }, "edit", []]);
  expect([disable.fixedBody, disable.risk, disable.steps]).toEqual([{ enabled: false }, "deactivate", []]);
}

/** D3: archive is one-way, so it is red. */
export function theArchiveEntryIsRed(): void {
  expect(entry("rule.archive").risk).toBe("deactivate");
}

/** D3: publish and enable arm a rule at once; both carry the fixed live line. */
export function thePublishAndEnableSummariesCarryTheLiveLine(): void {
  expect(summary("rule.publish")).toContain(RULE_LIVE_LINE);
  expect(summary("rule.enable")).toContain(RULE_LIVE_LINE);
}

/** Q10 / D3: a PATCH of a published rule carries the live line. */
export function theUpdateSummaryCarriesTheLiveLineForAPublishedRule(): void {
  expect(summary("rule.update", { body: { thresholdValue: 4 }, lifecycle: "published" })).toContain(RULE_LIVE_LINE);
}

/** The adjacent negative: a draft's PATCH changes nothing live, so it carries no live line. */
export function theUpdateSummaryOfADraftHasNoLiveLine(): void {
  const text = summary("rule.update", { body: { thresholdValue: 4 }, lifecycle: "draft" });
  expect(text).toContain("thresholdValue");
  expect(text).not.toContain(RULE_LIVE_LINE);
}

/** The disable summary carries no live line: nothing is armed. */
export function theDisableSummaryHasNoLiveLine(): void {
  expect(summary("rule.disable")).not.toContain(RULE_LIVE_LINE);
}

/** The ADR's drafter choice: the duplicate says a draft copy, disabled, without its channel links. */
export function theDuplicateSummarySaysDraftCopyAndNoLinks(): void {
  const text = summary("rule.duplicate");
  expect(text).toContain("draft copy");
  expect(text).toContain("notification channel links are not copied");
}

/** D2: the create's organization is its asset's; every other entry names the rule row; the update refs its asset. */
export function theRuleTargetsMirrorTheRoute(): void {
  expect(entry("rule.create").target).toEqual({ kind: "rule", field: "assetId" });
  for (const id of RULE_IDS.slice(1)) expect(entry(id).target, id).toEqual({ kind: "rule", param: "id" });
  expect(entry("rule.update").refs).toEqual([{ field: "assetId", kind: "asset" }]);
}

/** The create's model body requires an asset (the route refuses an asset-less rule). */
export function theCreateModelBodyRequiresAnAsset(): void {
  const create = entry("rule.create");
  expect(create.modelBodyName).toBe("copilotRuleCreateModelBodySchema");
  expect(create.modelBody).toBe(copilotRuleCreateModelBodySchema);
}

/** D6: rules accept decision 4.9's residual, so no rule entry takes a precondition. */
export function noRuleEntryTakesAPrecondition(): void {
  for (const id of RULE_IDS) expect(entry(id).precondition, id).toBeUndefined();
}

/** D1: every copilot role in the configuration class is offered the rules; no entry narrows the roles. */
export function noRuleEntryNarrowsTheRoles(): void {
  for (const id of RULE_IDS) expect(entry(id).offeredTo, id).toBeUndefined();
}

/**
 * "Not in this amendment": the rule routes that are not entries are excluded, each with its
 * reason. `F4.279` (D8) made `PUT /rules/:id/notifications` the `rule.notifications.set` entry.
 * `F4.289` PR 2 made `POST /rules/batch` (excluded by PR 1) the `rule.createBatch` entry.
 */
export function theTwoRuleRoutesAreExcludedWithTheirReasons(): void {
  const reasons = Object.fromEntries(
    EXCLUDED_ROUTES.filter((route) => route.path.startsWith("/rules")).map((route) => [
      `${route.method} ${route.path}`,
      route.reason,
    ]),
  );
  expect(Object.keys(reasons).sort()).toEqual([
    "POST /rules/evaluate",
    "POST /rules/preview",
  ]);
  expect(reasons["POST /rules/preview"]).toContain("rule_preview audit row");
}

// ---------------------------------------------------------------------------
// `F4.289` (ADR 0099 Amendment 9 E3) — `rule.createBatch`.

const ASSET_2 = "33333333-3333-4333-8333-333333333333";
const batchRow = (assetId: string) => ({ name: "Chiller high", ruleType: "threshold", assetId, condition: {}, action: {} });

/** The batch entry names the batch route, its body and its model body, by identity. */
export function theBatchEntryNamesItsRouteAndBodies(): void {
  const batch = entry("rule.createBatch");
  expect([batch.method, batch.path, batch.bodyName, batch.modelBodyName]).toEqual([
    "POST",
    "/rules/batch",
    "ruleBatchBodySchema",
    "copilotRuleBatchModelBodySchema",
  ]);
  expect([batch.body, batch.modelBody]).toEqual([ruleBatchBodySchema, copilotRuleBatchModelBodySchema]);
}

/** `excludedRows` is the browser's alone and `checks` the card's alone, so the hash binds `rules`. */
export function theBatchExcludedRowsAreClientOnlyAndChecksCardOnly(): void {
  const batch = entry("rule.createBatch");
  expect([batch.clientOnly, batch.cardOnly]).toEqual([["excludedRows"], ["checks"]]);
}

/** Owner ruling P2: the batch card is red, and its risk stays `create`. */
export function theBatchEntryIsRedWithRiskCreate(): void {
  const batch = entry("rule.createBatch");
  expect([batch.red, batch.risk]).toEqual([true, "create"]);
}

/** The adjacent negative: no other rule entry sets the flag (their colour follows the risk). */
export function noOtherRuleEntryIsFlaggedRed(): void {
  for (const id of RULE_IDS) expect(entry(id).red, id).toBeUndefined();
}

/** The batch target is the rows' assets, one organization (`ruleBatch` over `rules`). */
export function theBatchTargetIsTheRows(): void {
  expect(entry("rule.createBatch").target).toEqual({ kind: "ruleBatch", field: "rules" });
}

/** The batch summary counts rules and distinct assets, names the organization and carries the live line. */
export function theBatchSummaryCountsRulesAndAssetsAndCarriesTheLiveLine(): void {
  const text = summary("rule.createBatch", { body: { rules: [batchRow(ROW), batchRow(ROW), batchRow(ASSET_2)] } });
  expect(text).toBe(
    `Create and publish up to 3 alarm rules on 2 assets in Pune Works: only the rows left ticked on this card are created. ${RULE_LIVE_LINE}`,
  );
}

/**
 * Plan critic: the outcome line repeats the summary after a Confirm that may have left rows out, so
 * the summary never states the count as created — it says "up to", and names the ticked rows.
 */
export function theBatchSummaryNeverStatesTheAppliedCount(): void {
  const text = summary("rule.createBatch", { body: { rules: [batchRow(ROW), batchRow(ROW)] } });
  expect(text).toContain("up to 2 alarm rules");
  expect(text).not.toContain("publish 2 alarm rules");
}
