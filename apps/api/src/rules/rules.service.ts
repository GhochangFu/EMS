import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, or } from "drizzle-orm";

import {
  assets,
  auditLog,
  automationRules,
  pointValues,
  ruleExecutions,
  users,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  AutomationRuleAction,
  AutomationRuleCategory,
  AutomationRuleCondition,
  AutomationRuleOperator,
  AutomationRuleType,
  JwtPayload,
  RuleExecutionItem,
  RuleExecutionStatus,
  RuleListItem,
} from "@bms/shared";

import { DRIZZLE } from "../database/database.tokens";
import type { ListRuleExecutionsQuery, RuleToggleBody } from "./rules.schema";

type RuleRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string;
  ruleType: string;
  source: string;
  enabled: boolean;
  assetId: string | null;
  assetCode: string | null;
  assetName: string | null;
  siteName: string | null;
  pointKey: string | null;
  operator: string | null;
  thresholdValue: number | null;
  severity: string | null;
  condition: unknown;
  action: unknown;
  lastEvaluatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type EvaluationResult = {
  status: RuleExecutionStatus;
  matched: boolean;
  observedValue: number | null;
  message: string;
  trace: Record<string, unknown>;
};

const daySlugs = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

@Injectable()
export class RulesService {
  constructor(@Inject(DRIZZLE) private readonly db: BmsDb) {}

  /** Lists Sprint D automation rules with optional asset context. */
  async listRules(): Promise<{ items: RuleListItem[] }> {
    const rows = await this.ruleRows();
    return { items: rows.map((row) => this.mapRuleRow(row)) };
  }

  /** Lists recent rule execution traces. */
  async listExecutions(
    query: ListRuleExecutionsQuery,
  ): Promise<{ items: RuleExecutionItem[] }> {
    const rows = await this.db
      .select({
        id: ruleExecutions.id,
        ruleId: ruleExecutions.ruleId,
        ruleCode: automationRules.code,
        ruleName: automationRules.name,
        evaluatedAt: ruleExecutions.evaluatedAt,
        status: ruleExecutions.status,
        matched: ruleExecutions.matched,
        observedValue: ruleExecutions.observedValue,
        message: ruleExecutions.message,
        trace: ruleExecutions.trace,
      })
      .from(ruleExecutions)
      .innerJoin(automationRules, eq(ruleExecutions.ruleId, automationRules.id))
      .orderBy(desc(ruleExecutions.evaluatedAt))
      .limit(query.limit);

    return {
      items: rows.map((row) => ({
        id: row.id,
        ruleId: row.ruleId,
        ruleCode: row.ruleCode,
        ruleName: row.ruleName,
        evaluatedAt: row.evaluatedAt.toISOString(),
        status: row.status as RuleExecutionStatus,
        matched: row.matched,
        observedValue: row.observedValue,
        message: row.message,
        trace: this.asTrace(row.trace),
      })),
    };
  }

  /** Toggles a rule and writes a lightweight audit row. */
  async setEnabled(
    id: string,
    dto: RuleToggleBody,
    actor: Pick<JwtPayload, "sub" | "email">,
  ): Promise<RuleListItem> {
    const current = await this.getRuleRow(id);
    const actorId = await this.resolveActorId(actor);
    const now = new Date();

    await this.db.transaction(async (tx) => {
      await tx
        .update(automationRules)
        .set({ enabled: dto.enabled, updatedAt: now })
        .where(eq(automationRules.id, id));

      await tx.insert(auditLog).values({
        actorId,
        action: "rule_enabled_update",
        entityType: "automation_rule",
        entityId: id,
        reason: dto.reason ?? (dto.enabled ? "Rule enabled" : "Rule disabled"),
        payload: {
          code: current.code,
          fromEnabled: current.enabled,
          toEnabled: dto.enabled,
          oidcSubject: actor.sub,
          actorEmail: actor.email,
        },
      });
    });

    return this.mapRuleRow(await this.getRuleRow(id));
  }

  /** Evaluates all enabled Sprint D rules and records execution traces. */
  async evaluateEnabledRules(
    actor: Pick<JwtPayload, "sub" | "email">,
  ): Promise<{ items: RuleExecutionItem[] }> {
    const rows = (await this.ruleRows()).filter((row) => row.enabled);
    const items: RuleExecutionItem[] = [];

    for (const row of rows) {
      const result = await this.evaluateRule(row);
      const [created] = await this.db
        .insert(ruleExecutions)
        .values({
          ruleId: row.id,
          status: result.status,
          matched: result.matched,
          observedValue: result.observedValue,
          message: result.message,
          trace: {
            ...result.trace,
            evaluatedBy: actor.email,
            source: row.source,
          },
        })
        .returning({
          id: ruleExecutions.id,
          evaluatedAt: ruleExecutions.evaluatedAt,
        });

      await this.db
        .update(automationRules)
        .set({ lastEvaluatedAt: created?.evaluatedAt ?? new Date(), updatedAt: new Date() })
        .where(eq(automationRules.id, row.id));

      if (created) {
        items.push({
          id: created.id,
          ruleId: row.id,
          ruleCode: row.code,
          ruleName: row.name,
          evaluatedAt: created.evaluatedAt.toISOString(),
          status: result.status,
          matched: result.matched,
          observedValue: result.observedValue,
          message: result.message,
          trace: result.trace,
        });
      }
    }

    return { items };
  }

  private async ruleRows(): Promise<RuleRow[]> {
    return this.db
      .select({
        id: automationRules.id,
        code: automationRules.code,
        name: automationRules.name,
        description: automationRules.description,
        category: automationRules.category,
        ruleType: automationRules.ruleType,
        source: automationRules.source,
        enabled: automationRules.enabled,
        assetId: automationRules.assetId,
        assetCode: assets.code,
        assetName: assets.name,
        siteName: assets.siteName,
        pointKey: automationRules.pointKey,
        operator: automationRules.operator,
        thresholdValue: automationRules.thresholdValue,
        severity: automationRules.severity,
        condition: automationRules.condition,
        action: automationRules.action,
        lastEvaluatedAt: automationRules.lastEvaluatedAt,
        createdAt: automationRules.createdAt,
        updatedAt: automationRules.updatedAt,
      })
      .from(automationRules)
      .leftJoin(assets, eq(automationRules.assetId, assets.id))
      .orderBy(desc(automationRules.enabled), automationRules.category, automationRules.name);
  }

  private async getRuleRow(id: string): Promise<RuleRow> {
    const [row] = (await this.ruleRows()).filter((item) => item.id === id);
    if (!row) {
      throw new NotFoundException("Rule not found");
    }
    return row;
  }

  private mapRuleRow(row: RuleRow): RuleListItem {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      category: row.category as AutomationRuleCategory,
      ruleType: row.ruleType as AutomationRuleType,
      source: row.source as "operator_rule" | "simulator_threshold",
      enabled: row.enabled,
      assetId: row.assetId,
      assetCode: row.assetCode,
      assetName: row.assetName,
      siteName: row.siteName,
      pointKey: row.pointKey,
      operator: row.operator as AutomationRuleOperator | null,
      thresholdValue: row.thresholdValue,
      severity: row.severity,
      condition: this.asCondition(row.condition),
      action: this.asAction(row.action),
      lastEvaluatedAt: row.lastEvaluatedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async evaluateRule(row: RuleRow): Promise<EvaluationResult> {
    if (row.ruleType === "threshold") {
      return this.evaluateThresholdRule(row);
    }
    if (row.ruleType === "time_window") {
      return this.evaluateTimeWindowRule(row);
    }
    return {
      status: "error",
      matched: false,
      observedValue: null,
      message: `Unsupported rule type ${row.ruleType}`,
      trace: { ruleType: row.ruleType },
    };
  }

  private async evaluateThresholdRule(row: RuleRow): Promise<EvaluationResult> {
    if (!row.assetId || !row.pointKey || !row.operator || row.thresholdValue === null) {
      return {
        status: "error",
        matched: false,
        observedValue: null,
        message: "Threshold rule is missing asset, point, operator, or value",
        trace: { ruleType: row.ruleType },
      };
    }

    const sample = await this.latestPointValue(row.assetId, row.pointKey);
    if (!sample) {
      return {
        status: "skipped",
        matched: false,
        observedValue: null,
        message: "No telemetry sample available for this rule",
        trace: { assetId: row.assetId, pointKey: row.pointKey },
      };
    }

    const operator = row.operator as AutomationRuleOperator;
    const matched = this.compare(sample.value, operator, row.thresholdValue);
    return {
      status: matched ? "matched" : "not_matched",
      matched,
      observedValue: sample.value,
      message: matched
        ? `${row.name} matched at ${sample.value}`
        : `${row.name} did not match at ${sample.value}`,
      trace: {
        assetId: row.assetId,
        pointKey: row.pointKey,
        operator,
        thresholdValue: row.thresholdValue,
        sampleTime: sample.time.toISOString(),
        unit: sample.unit,
      },
    };
  }

  private async latestPointValue(
    assetId: string,
    pointKey: string,
  ): Promise<{ time: Date; value: number; unit: string | null } | null> {
    const [sample] = await this.db
      .select({
        time: pointValues.time,
        value: pointValues.value,
        unit: pointValues.unit,
      })
      .from(pointValues)
      .where(and(eq(pointValues.assetId, assetId), eq(pointValues.pointKey, pointKey)))
      .orderBy(desc(pointValues.time))
      .limit(1);
    return sample ?? null;
  }

  private evaluateTimeWindowRule(row: RuleRow): EvaluationResult {
    const condition = this.asCondition(row.condition);
    if (!("days" in condition)) {
      return {
        status: "error",
        matched: false,
        observedValue: null,
        message: "Time-window rule has invalid condition",
        trace: { condition },
      };
    }

    const now = new Date();
    const day = daySlugs[now.getDay()] ?? "sun";
    const minuteOfDay = now.getHours() * 60 + now.getMinutes();
    const start = this.parseTime(condition.startTime);
    const end = this.parseTime(condition.endTime);
    const dayMatches = condition.days.includes(day);
    const timeMatches =
      start <= end
        ? minuteOfDay >= start && minuteOfDay <= end
        : minuteOfDay >= start || minuteOfDay <= end;
    const matched = dayMatches && timeMatches;

    return {
      status: matched ? "matched" : "not_matched",
      matched,
      observedValue: null,
      message: matched
        ? `${row.name} matched the configured time window`
        : `${row.name} is outside the configured time window`,
      trace: {
        day,
        minuteOfDay,
        startTime: condition.startTime,
        endTime: condition.endTime,
      },
    };
  }

  private compare(
    value: number,
    operator: AutomationRuleOperator,
    threshold: number,
  ): boolean {
    switch (operator) {
      case "gt":
        return value > threshold;
      case "gte":
        return value >= threshold;
      case "lt":
        return value < threshold;
      case "lte":
        return value <= threshold;
      case "eq":
        return value === threshold;
    }
  }

  private parseTime(value: string): number {
    const [h, m] = value.split(":").map(Number);
    if (
      h === undefined ||
      m === undefined ||
      Number.isNaN(h) ||
      Number.isNaN(m) ||
      h < 0 ||
      h > 23 ||
      m < 0 ||
      m > 59
    ) {
      throw new BadRequestException(`Invalid rule time ${value}`);
    }
    return h * 60 + m;
  }

  private async resolveActorId(
    actor: Pick<JwtPayload, "sub" | "email">,
  ): Promise<string | null> {
    const [actorRow] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.id, actor.sub), eq(users.email, actor.email)))
      .limit(1);
    return actorRow?.id ?? null;
  }

  private asCondition(value: unknown): AutomationRuleCondition {
    if (this.isRecord(value) && value.window === "latest") {
      return {
        window: "latest",
        unit: typeof value.unit === "string" ? value.unit : undefined,
      };
    }
    if (
      this.isRecord(value) &&
      Array.isArray(value.days) &&
      typeof value.startTime === "string" &&
      typeof value.endTime === "string"
    ) {
      return {
        days: value.days.filter((item): item is string => typeof item === "string"),
        startTime: value.startTime,
        endTime: value.endTime,
      };
    }
    return { window: "latest" };
  }

  private asAction(value: unknown): AutomationRuleAction {
    if (
      this.isRecord(value) &&
      (value.type === "notify" || value.type === "review" || value.type === "trace_only") &&
      typeof value.target === "string"
    ) {
      return { type: value.type, target: value.target };
    }
    return { type: "trace_only", target: "Operations" };
  }

  private asTrace(value: unknown): Record<string, unknown> | null {
    return this.isRecord(value) ? value : null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
