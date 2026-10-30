import { expect } from "vitest";

import { catalogEntry, proposeToolName, RULE_LIVE_LINE } from "@bms/shared/copilot";

import type { RuleBatchCheckResult, RuleBatchRowCheck } from "../rules/rule-proposal-check.service";
import { bodyHash } from "./body-hash";
import { checks } from "./copilot-propose-rules.spec";
import { PROPOSE_OPEN_CHANGE_ERROR } from "./copilot-propose-tools";
import { proposeHarness } from "./copilot-propose-tools.spec";
import type { ResolvedTarget } from "./copilot-target-resolver";
import { COPILOT_RULE_BATCH_PROMPT_RULE, COPILOT_SYSTEM_PROMPT } from "./copilot-turn.service";
import { COPILOT_READ_TOOL_DEFINITIONS } from "./tools/copilot-read-tool-set";

/**
 * `F4.289` (ADR 0099 Amendment 9 E3) — the `rule.createBatch` propose path over
 * the real catalog entry, with a recording fake of `checkBatch`. The stored
 * body is `{ rules }` from the model plus the server's card-only `checks`; the
 * hash binds `rules` alone, so the browser's `excludedRows` and the stored
 * `checks` never move it. Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const ASSET_1 = "55555555-5555-4555-8555-555555555555";
const ASSET_2 = "66666666-6666-4666-8666-666666666666";
const TOOL = proposeToolName({ id: "rule.createBatch" });
const NOTE = "3 rows checked: 1 would match now, 0 with no sample yet; about 4 firings in the last 7 days (an estimate; the live engine sees every sample).";

const row = (name: string, assetId: string) => ({
  name,
  ruleType: "threshold",
  assetId,
  pointKey: "supply_temp_c",
  operator: "gt",
  thresholdValue: 3,
  condition: { window: "latest" },
  action: { type: "notify", target: "Operations" },
});
const RULES = [row("Chiller one", ASSET_1), row("Chiller two", ASSET_1), row("Chiller three", ASSET_2)];

const check = (n: number, matchNow: RuleBatchRowCheck["matchNow"], firings: number): RuleBatchRowCheck => ({
  row: n,
  assetCode: "CH-01",
  pointKey: "supply_temp_c",
  operator: "gt",
  thresholdValue: 3,
  severity: null,
  matchNow,
  firings,
  buckets: 60,
});
const CHECKED: RuleBatchCheckResult = { note: NOTE, rows: [check(1, "yes", 4), check(2, "no", 0), check(3, "no", 0)] };

const TARGET: ResolvedTarget = { organizationId: ORG_X, organizationName: "Org X", targetName: "Org X" };

function harness(options: { refusal?: string; open?: boolean } = {}) {
  const c = checks(options.refusal, CHECKED);
  return { ...proposeHarness({ target: TARGET, rules: c.rules, open: options.open === true }), batchCalls: c.batchCalls, calls: c.calls };
}

/** A batch proposal stores one card whose body is the model's rows beside the server's per-row checks. */
export async function aBatchProposalStoresTheChecksBesideTheRules(): Promise<void> {
  const h = harness();
  const result = await h.tools.dispatch(TOOL, { body: { rules: RULES } }, h.ctx());
  expect(result.ok).toBe(true);
  expect(h.stored).toHaveLength(1);
  expect(h.stored[0]?.body).toEqual({ rules: RULES, checks: CHECKED.rows });
}

/** The hash binds `rules` alone: it equals the hash of `{ rules }`, and differs from one over the checks too. */
export async function theBatchHashBindsTheRulesAlone(): Promise<void> {
  const h = harness();
  await h.tools.dispatch(TOOL, { body: { rules: RULES } }, h.ctx());
  const stored = h.stored[0]?.bodyHash;
  expect(stored).toBe(bodyHash({ rules: RULES }, []));
  expect(stored).not.toBe(bodyHash({ rules: RULES, checks: CHECKED.rows }, []));
}

/** The summary counts the rows and assets, carries the live line, then the check's note; the risk stays `create`. */
export async function theBatchSummaryCarriesTheLiveLineAndTheNote(): Promise<void> {
  const h = harness();
  await h.tools.dispatch(TOOL, { body: { rules: RULES } }, h.ctx());
  expect([h.stored[0]?.summary, h.stored[0]?.risk]).toEqual([
    `Create and publish up to 3 alarm rules on 2 assets in Org X: only the rows left ticked on this card are created. ${RULE_LIVE_LINE} ${NOTE}`,
    "create",
  ]);
}

/** The check is asked with the model's rows and the resolved organization, and the single-rule check is not. */
export async function theBatchCheckIsAskedWithTheRowsAndTheResolvedOrganization(): Promise<void> {
  const h = harness();
  await h.tools.dispatch(TOOL, { body: { rules: RULES } }, h.ctx());
  expect(h.batchCalls.map((call) => [call.rows, call.organizationId])).toEqual([[RULES, ORG_X]]);
  expect(h.calls).toEqual([]);
}

/** The strict model body refuses `excludedRows` and `checks` from the model: only the user and the server set them. */
export async function theModelCannotSendExcludedRowsOrChecks(): Promise<void> {
  for (const extra of [{ excludedRows: [1] }, { checks: CHECKED.rows }]) {
    const h = harness();
    const result = await h.tools.dispatch(TOOL, { body: { rules: RULES, ...extra } }, h.ctx());
    expect(result.ok ? "" : result.error, Object.keys(extra)[0]).toMatch(/^Invalid body/);
    expect([h.batchCalls, h.stored], Object.keys(extra)[0]).toEqual([[], []]);
  }
}

/** A refused row returns its numbered sentence to the model, and no card is stored. */
export async function aRefusedRowReturnsItsNumberAndStoresNoCard(): Promise<void> {
  const h = harness({ refusal: "Row 2: Point key is not compatible with the asset" });
  const result = await h.tools.dispatch(TOOL, { body: { rules: RULES } }, h.ctx());
  expect(result).toEqual({ ok: false, error: "Row 2: Point key is not compatible with the asset" });
  expect(h.stored).toEqual([]);
}

/** A twenty-sixth row is refused by the model body, before the resolver or the check. */
export async function aTwentySixthRowIsRefusedByTheModelBody(): Promise<void> {
  const h = harness();
  const rules = Array.from({ length: 26 }, (_, i) => row(`Chiller ${i + 1}`, ASSET_1));
  const result = await h.tools.dispatch(TOOL, { body: { rules } }, h.ctx());
  expect(result.ok ? "" : result.error).toMatch(/^Invalid body/);
  expect([h.resolved, h.batchCalls, h.stored]).toEqual([[], [], []]);
}

/** The twenty-five-row twin is stored. */
export async function twentyFiveRowsAreStored(): Promise<void> {
  const h = harness();
  const rules = Array.from({ length: 25 }, (_, i) => row(`Chiller ${i + 1}`, ASSET_1));
  const result = await h.tools.dispatch(TOOL, { body: { rules } }, h.ctx());
  expect([result.ok, h.stored.length]).toEqual([true, 1]);
}

/**
 * Ruling P6 and the plan critic: one open batch card at a time. While a card waits, a second batch
 * is refused with the open-change sentence, before the check runs; the next 25 rows wait for the
 * user's Confirm or Reject.
 */
export async function aSecondBatchWhileOneIsOpenIsRefused(): Promise<void> {
  const h = harness({ open: true });
  const result = await h.tools.dispatch(TOOL, { body: { rules: RULES } }, h.ctx());
  expect(result).toEqual({ ok: false, error: PROPOSE_OPEN_CHANGE_ERROR });
  expect([h.batchCalls, h.stored]).toEqual([[], []]);
}

/** Task 9: the system prompt carries the batch rule as its own line. */
export function thePromptCarriesTheBatchRule(): void {
  expect(COPILOT_SYSTEM_PROMPT.split("\n")).toContain(COPILOT_RULE_BATCH_PROMPT_RULE);
}

/** The line routes a site-wide request through the inventory read, one batch card at a time. */
export function theBatchRuleNamesTheInventoryAndOneCardAtATime(): void {
  for (const words of ["get_site_point_inventory", "rule.createBatch", "up to 25", "Only one card waits at a time"]) {
    expect(COPILOT_RULE_BATCH_PROMPT_RULE, words).toContain(words);
  }
}

/**
 * The anti-drift bound to F4.288: every read tool the line names is in the read registry, and every
 * catalog id it names is a catalog entry, so a renamed tool cannot leave the prompt pointing at nothing.
 */
export function everyToolAndEntryTheBatchRuleNamesExists(): void {
  const reads = [...COPILOT_RULE_BATCH_PROMPT_RULE.matchAll(/\b(?:list|get)_[a-z_]+\b/g)].map((m) => m[0]);
  const ids = [...COPILOT_RULE_BATCH_PROMPT_RULE.matchAll(/\brule\.[A-Za-z]+\b/g)].map((m) => m[0]);
  expect([reads.length, ids.length]).toEqual([1, 3]);
  const registry = new Set(COPILOT_READ_TOOL_DEFINITIONS.map((tool) => tool.name));
  expect(reads.filter((name) => !registry.has(name))).toEqual([]);
  expect(ids.filter((id) => catalogEntry(id) === undefined)).toEqual([]);
}
