import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import { assets } from "@bms/db";
import type { BmsDb } from "@bms/db";
import {
  type AutomationRuleOperator,
  ruleDraftBodySchema,
  ruleUpdateBodySchema,
} from "@bms/shared";

import { DEFAULT_CLEAR_HOLD_SECONDS } from "../alarms/alarm-lifecycle";
import { TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import { assertArmable } from "./rule-arming";
import { backtestRule, type BacktestResult } from "./rule-backtest";
import { evaluateRule } from "./rule-evaluation";
import { asCondition, mergeRuleDraft, previewRowFromValues, ruleBodyFromRow } from "./rule-mapping";
import { selectRuleRowById } from "./rule-reads";
import { latestPointValue } from "./rule-samples";
import {
  ARCHIVED_CANNOT_BE_EDITED,
  ARCHIVED_CANNOT_BE_PUBLISHED,
  ONLY_PUBLISHED_CAN_TOGGLE,
  RulesService,
} from "./rules.service";
import type { EvaluationResult, RuleRow } from "./rules.types";

/** What the propose tool asks of the check: one rule entry's proposal, already resolved to its organization. */
export type RuleProposalCheckInput = {
  readonly entryId: string;
  readonly params: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, unknown>>;
  readonly organizationId: string;
  readonly now: Date;
};

export type RuleProposalCheckResult = {
  /** The sentences the card shows after the summary: the condition, "would match now" and the backtest. */
  readonly note: string;
};

const OPERATOR_WORDS: Readonly<Record<AutomationRuleOperator, string>> = {
  gt: "above",
  gte: "at or above",
  lt: "below",
  lte: "at or below",
  eq: "equal to",
};

/**
 * `F4.278` (ADR 0099 Amendment 8, Q9) — what the server checks before a rule
 * card is stored, and the sentences the card shows. It mirrors the route's own
 * refusals (the validator, `assertArmable` for publish and enable — Q9: publish
 * is stricter than today's route, as ruled — and the three lifecycle sentences,
 * each the route's own constant), evaluates the draft once against the latest
 * sample, and for a threshold rule runs the 7-day backtest.
 *
 * **It writes nothing.** No `rule_preview` audit row (the reason `POST
 * /rules/preview` is excluded), no `rule_executions` row: it calls the
 * validator and the pure evaluator, never `previewRule`. A refusal is the
 * route's `HttpException`, which the propose tool returns as the tool's error.
 */
@Injectable()
export class RuleProposalCheckService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    @Inject(RulesService) private readonly rules: Pick<RulesService, "validateRuleDraft">,
  ) {}

  async check(input: RuleProposalCheckInput): Promise<RuleProposalCheckResult> {
    const { entryId, organizationId, now } = input;
    if (entryId === "rule.create") {
      const parsed = ruleDraftBodySchema.safeParse(input.body);
      if (!parsed.success) throw new BadRequestException("Invalid body");
      const values = await this.rules.validateRuleDraft(parsed.data, undefined, organizationId);
      return this.note(previewRowFromValues(values, undefined, now), organizationId, now, true);
    }

    const id = input.params.id;
    if (id === undefined) throw new BadRequestException("A rule proposal needs the rule's id");
    const row = await withTenant(this.db, organizationId, (tx) => selectRuleRowById(tx, id));
    if (!row) throw new NotFoundException("Rule not found");

    switch (entryId) {
      case "rule.update": {
        if (row.lifecycleStatus === "archived") throw new BadRequestException(ARCHIVED_CANNOT_BE_EDITED);
        const parsed = ruleUpdateBodySchema.safeParse(input.body);
        if (!parsed.success) throw new BadRequestException("Invalid body");
        const values = await this.rules.validateRuleDraft(mergeRuleDraft(row, parsed.data), id, organizationId);
        return this.note(previewRowFromValues(values, id, now), organizationId, now, true);
      }
      case "rule.publish": {
        if (row.lifecycleStatus === "archived") throw new BadRequestException(ARCHIVED_CANNOT_BE_PUBLISHED);
        await this.rules.validateRuleDraft(ruleBodyFromRow(row), id, organizationId);
        assertArmable(row);
        return this.note(row, organizationId, now, true);
      }
      case "rule.enable": {
        if (row.lifecycleStatus !== "published") throw new BadRequestException(ONLY_PUBLISHED_CAN_TOGGLE);
        assertArmable(row);
        return this.note(row, organizationId, now, true);
      }
      case "rule.disable": {
        if (row.lifecycleStatus !== "published") throw new BadRequestException(ONLY_PUBLISHED_CAN_TOGGLE);
        return this.note(row, organizationId, now, false);
      }
      case "rule.duplicate":
      case "rule.archive":
        return this.note(row, organizationId, now, false);
      default:
        throw new BadRequestException(`${entryId} is not a rule entry`);
    }
  }

  /** The condition line, then — for an entry that arms or changes the rule — "would match now" and the backtest. */
  private async note(row: RuleRow, organizationId: string, now: Date, evaluate: boolean): Promise<RuleProposalCheckResult> {
    const condition = await this.conditionLine(row, organizationId);
    if (!evaluate) return { note: condition };
    const result = await evaluateRule(row, (assetId, pointKey) => latestPointValue(this.db, assetId, pointKey), now);
    const sentences = [condition, matchSentence(row, result)];
    if (row.ruleType === "threshold" && row.assetId && row.pointKey && row.operator && row.thresholdValue !== null) {
      const backtest = await backtestRule(
        this.db,
        {
          assetId: row.assetId,
          pointKey: row.pointKey,
          operator: row.operator as AutomationRuleOperator,
          thresholdValue: row.thresholdValue,
          clearHoldSeconds: row.clearHoldSeconds ?? DEFAULT_CLEAR_HOLD_SECONDS,
        },
        now,
      );
      sentences.push(backtestSentence(backtest));
    }
    return { note: sentences.join(" ") };
  }

  private async conditionLine(row: RuleRow, organizationId: string): Promise<string> {
    if (row.ruleType !== "threshold") {
      const condition = asCondition(row.condition);
      if ("days" in condition && Array.isArray(condition.days)) {
        return `Condition: ${condition.days.join(", ")} ${condition.startTime}–${condition.endTime}.`;
      }
      return "Condition: a time window.";
    }
    const asset = row.assetCode ?? (row.assetId ? await this.assetCode(row.assetId, organizationId) : null) ?? "(no asset)";
    const operator = row.operator ? (OPERATOR_WORDS[row.operator as AutomationRuleOperator] ?? row.operator) : "(no operator)";
    const hold = row.clearHoldSeconds ?? DEFAULT_CLEAR_HOLD_SECONDS;
    return `Condition: ${asset} ${row.pointKey ?? "(no point)"} ${operator} ${row.thresholdValue ?? "(no threshold)"} (latest value; clear hold ${hold} s).`;
  }

  /** A draft's asset code (a draft row carries no joined asset columns), read under the change's own organization. */
  private async assetCode(assetId: string, organizationId: string): Promise<string | null> {
    const [row] = await withTenant(this.db, organizationId, (tx) =>
      tx
        .select({ code: assets.code })
        .from(assets)
        .where(and(eq(assets.id, assetId), eq(assets.organizationId, organizationId)))
        .limit(1),
    );
    return row?.code ?? null;
  }
}

/** "Would match now", from the one evaluation. */
function matchSentence(row: RuleRow, result: EvaluationResult): string {
  if (row.ruleType !== "threshold") return `Would match now: ${result.matched ? "yes" : "no"}.`;
  if (result.status === "skipped") return "Would match now: no sample yet.";
  if (result.status === "error") return `Would match now: cannot tell (${result.message}).`;
  const trace = result.trace as { sampleTime?: unknown; unit?: unknown };
  const unit = typeof trace.unit === "string" && trace.unit !== "" ? ` ${trace.unit}` : "";
  const time = typeof trace.sampleTime === "string" ? ` at ${trace.sampleTime.slice(0, 16).replace("T", " ")} UTC` : "";
  return `Would match now: ${result.matched ? "yes" : "no"} — latest value ${result.observedValue ?? ""}${unit}${time}.`;
}

/** The backtest, labelled an estimate. */
function backtestSentence(backtest: BacktestResult): string {
  if (backtest.buckets === 0) return "No 1-minute history in the last 7 days to estimate from.";
  const times = backtest.firings === 1 ? "1 time" : `${backtest.firings} times`;
  return `Would have fired about ${times} in the last 7 days (an estimate from 1-minute averages; the live engine sees every sample).`;
}
