import {
  copilotRuleCreateModelBodySchema,
  ruleDraftBodySchema,
  ruleLifecycleBodySchema,
  ruleToggleBodySchema,
  ruleUpdateBodySchema,
} from "../../contracts/rule-writes";
import { fieldList, quoted, text, uuidParam } from "./summary-text";
import type { CatalogEntry, CatalogStep, CatalogTarget, ExcludedRoute } from "./types";

/**
 * `F4.278` (ADR 0099 Amendment 8, D1–D3, D6, D8, Q9, Q10) — the alarm rules of
 * the Rule Engine page (`apps/api/src/rules/rules.controller.ts`).
 *
 * Seven entries, offered to every copilot role: the route's own gate is the
 * `configuration` role class plus the rule's asset in the caller's **read**
 * scope, and the `rule` target mirrors exactly that (D2). The create's
 * organization is its asset's, as `resolveWriteOrg` derives it; its model body
 * requires the asset (the route refuses an asset-less rule with a 400).
 *
 * D3: `rule.enable` and `rule.disable` are one direction each, a `fixedBody` on
 * the toggle route; `rule.disable` and `rule.archive` are red. `rule.publish`,
 * `rule.enable` and a PATCH of a published rule carry the fixed live-effect
 * line. D6: no rule entry takes a precondition (rules accept decision 4.9's
 * residual). Before a card is stored the server runs the validator, a
 * write-free "would match now" evaluation and a 7-day backtest (Q9) and appends
 * the result to this summary (`apps/api/src/rules/rule-proposal-check.service.ts`).
 */

/** D3's fixed line: the change arms, or changes, a live rule at once. */
export const RULE_LIVE_LINE = "This changes live alarm behaviour now.";

const RULE_ROW: CatalogTarget = { kind: "rule", param: "id" };

const RULE_STEPS: readonly CatalogStep[] = [
  { id: "rule", title: "Rule", fields: ["name", "code", "description", "category", "severity"] },
  {
    id: "condition",
    title: "Condition",
    fields: ["ruleType", "assetId", "pointKey", "operator", "thresholdValue", "clearHoldSeconds", "condition"],
  },
  { id: "action", title: "Action", fields: ["action"] },
];

const REASON_STEP: readonly CatalogStep[] = [{ id: "reason", title: "Reason", fields: ["reason"] }];

/** The fields every entry on one rule row shares. */
const ON_A_RULE = {
  params: { id: uuidParam },
  clientOnly: [],
  target: RULE_ROW,
  refs: [],
  formulas: [],
} as const satisfies Partial<CatalogEntry>;

/** The fields the two direction entries share: one route, one body. */
const TOGGLE = {
  ...ON_A_RULE,
  method: "PATCH",
  path: "/rules/:id/enabled",
  body: ruleToggleBodySchema,
  bodyName: "ruleToggleBodySchema",
  steps: [],
} as const satisfies Partial<CatalogEntry>;

export const RULE_ENTRIES: readonly CatalogEntry[] = [
  {
    id: "rule.create",
    title: "Create an alarm rule",
    method: "POST",
    path: "/rules",
    params: {},
    body: ruleDraftBodySchema,
    bodyName: "ruleDraftBodySchema",
    modelBody: copilotRuleCreateModelBodySchema,
    modelBodyName: "copilotRuleCreateModelBodySchema",
    clientOnly: [],
    risk: "create",
    target: { kind: "rule", field: "assetId" },
    refs: [],
    formulas: [],
    steps: RULE_STEPS,
    summary: ({ body, targetName, organizationName }) => {
      const code = text(body, "code");
      return `Create the rule ${quoted(text(body, "name"))}${code ? ` (${code})` : ""} on ${targetName} in ${organizationName}.`;
    },
  },
  {
    ...ON_A_RULE,
    id: "rule.update",
    title: "Edit an alarm rule",
    method: "PATCH",
    path: "/rules/:id",
    body: ruleUpdateBodySchema,
    bodyName: "ruleUpdateBodySchema",
    risk: "edit",
    // The E7.1b ruling stays: a PATCH does not re-derive the rule's organization, so
    // the copilot's refs rule adds that a new asset belongs to the rule's organization.
    refs: [{ field: "assetId", kind: "asset" }],
    steps: [
      ...RULE_STEPS.slice(0, 2),
      { id: "action", title: "Action", fields: ["action", "reason"] },
    ],
    summary: ({ body, targetName, lifecycle }) =>
      `Change ${fieldList(body)} of the rule ${quoted(targetName)}.${lifecycle === "published" ? ` ${RULE_LIVE_LINE}` : ""}`,
  },
  {
    ...ON_A_RULE,
    id: "rule.duplicate",
    title: "Duplicate an alarm rule",
    method: "POST",
    path: "/rules/:id/duplicate",
    body: ruleLifecycleBodySchema,
    bodyName: "ruleLifecycleBodySchema",
    risk: "create",
    steps: REASON_STEP,
    summary: ({ targetName }) =>
      `Duplicate the rule ${quoted(targetName)} as a new draft copy: the copy is disabled and its notification channel links are not copied.`,
  },
  {
    ...ON_A_RULE,
    id: "rule.publish",
    title: "Publish an alarm rule",
    method: "POST",
    path: "/rules/:id/publish",
    body: ruleLifecycleBodySchema,
    bodyName: "ruleLifecycleBodySchema",
    risk: "edit",
    steps: REASON_STEP,
    summary: ({ targetName }) => `Publish the rule ${quoted(targetName)} and enable it. ${RULE_LIVE_LINE}`,
  },
  {
    ...TOGGLE,
    id: "rule.enable",
    title: "Enable an alarm rule",
    fixedBody: { enabled: true },
    risk: "edit",
    summary: ({ targetName }) => `Enable the rule ${quoted(targetName)}. ${RULE_LIVE_LINE}`,
  },
  {
    ...TOGGLE,
    id: "rule.disable",
    title: "Disable an alarm rule",
    fixedBody: { enabled: false },
    risk: "deactivate",
    summary: ({ targetName }) =>
      `Disable the rule ${quoted(targetName)}: it stops evaluating until it is enabled again.`,
  },
  {
    ...ON_A_RULE,
    id: "rule.archive",
    title: "Archive an alarm rule",
    method: "POST",
    path: "/rules/:id/archive",
    body: ruleLifecycleBodySchema,
    bodyName: "ruleLifecycleBodySchema",
    risk: "deactivate",
    steps: REASON_STEP,
    summary: ({ targetName }) =>
      `Archive the rule ${quoted(targetName)}: it leaves evaluation for good and cannot be edited or published again.`,
  },
];

/**
 * The rule routes that are not entries, and why (Amendment 8, "Not in this amendment"). By D8
 * `PUT /rules/:id/notifications` is the `rule.notifications.set` entry in `notifications.ts`.
 */
export const RULE_PENDING: readonly ExcludedRoute[] = [
  {
    method: "POST",
    path: "/rules/preview",
    reason: "writes a rule_preview audit row on every call; the copilot's own check path evaluates a draft without one",
  },
  {
    method: "POST",
    path: "/rules/evaluate",
    reason: "evaluates every published rule of every organization and raises alarms; not in Amendment 8",
  },
  {
    method: "POST",
    path: "/rules/batch",
    reason: "F4.289 PR 2 makes it the rule.createBatch entry, with its card and its wizard",
  },
];
