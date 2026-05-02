import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";

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
  AutomationRuleLifecycleStatus,
  AutomationRuleOperator,
  AutomationRuleType,
  RuleBuilderCatalogAsset,
  JwtPayload,
  RuleExecutionItem,
  RuleExecutionStatus,
  RuleListItem,
  RulePreviewResult,
} from "@bms/shared";
import {
  CONTROL_ROOM_ELECTRICAL_POINT_KEYS,
  CONTROL_ROOM_ENVIRONMENT_POINT_KEYS,
  CONTROL_ROOM_IT_POINT_KEYS,
  CONTROL_ROOM_UPS_POINT_KEYS,
  ELECTRICAL_POINT_KEYS,
  HVAC_POINT_KEYS,
} from "@bms/shared";

import { DRIZZLE } from "../database/database.tokens";
import type {
  ListRuleExecutionsQuery,
  RuleDraftBody,
  RuleLifecycleBody,
  RulePreviewBody,
  RuleToggleBody,
  RuleUpdateBody,
} from "./rules.schema";

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
  lifecycleStatus: string;
  publishedAt: Date | null;
  archivedAt: Date | null;
  duplicatedFromRuleId: string | null;
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

type RuleDraftValues = {
  code?: string;
  name: string;
  description: string | null;
  category: AutomationRuleCategory;
  ruleType: AutomationRuleType;
  assetId: string | null;
  pointKey: string | null;
  operator: AutomationRuleOperator | null;
  thresholdValue: number | null;
  severity: string | null;
  condition: AutomationRuleCondition;
  action: AutomationRuleAction;
};

const daySlugs = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

@Injectable()
export class RulesService {
  constructor(@Inject(DRIZZLE) private readonly db: BmsDb) {}

  /** Lists Sprint D automation rules with optional asset context. */
  async listRules(assetIds?: string[] | null): Promise<{ items: RuleListItem[] }> {
    const rows = this.filterRuleRows(await this.ruleRows(), assetIds);
    return { items: rows.map((row) => this.mapRuleRow(row)) };
  }

  /** Lists assets and supported telemetry points for the guided rule builder. */
  async getBuilderCatalog(
    assetIds?: string[] | null,
  ): Promise<{ assets: RuleBuilderCatalogAsset[] }> {
    if (assetIds && assetIds.length === 0) {
      return { assets: [] };
    }
    const base = this.db
      .select({
        id: assets.id,
        code: assets.code,
        name: assets.name,
        siteName: assets.siteName,
        domain: assets.domain,
      })
      .from(assets);
    const rows = await (assetIds
      ? base
          .where(inArray(assets.id, assetIds))
          .orderBy(asc(assets.siteName), asc(assets.code))
      : base.orderBy(asc(assets.siteName), asc(assets.code)));

    return {
      assets: rows.map((row) => ({
        ...row,
        pointKeys: this.pointKeysForAsset(row.domain, row.code),
      })),
    };
  }

  /** Creates an operator rule draft without enabling it. */
  async createDraft(
    dto: RuleDraftBody,
    actor: Pick<JwtPayload, "sub" | "email">,
    assetIds?: string[] | null,
  ): Promise<RuleListItem> {
    this.assertAssetInScope(dto.assetId ?? null, assetIds);
    const values = await this.validateRuleDraft(dto);
    const actorId = await this.resolveActorId(actor);
    const now = new Date();

    const [created] = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(automationRules)
        .values({
          ...values,
          code: values.code ?? (await this.nextRuleCode(dto.name)),
          source: "operator_rule",
          enabled: false,
          lifecycleStatus: "draft",
          publishedAt: null,
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: automationRules.id });

      if (!row) {
        throw new BadRequestException("Could not create rule draft");
      }

      await tx.insert(auditLog).values({
        actorId,
        action: "rule_draft_create",
        entityType: "automation_rule",
        entityId: row.id,
        reason: "Operator created rule draft",
        payload: {
          code: values.code,
          name: dto.name,
          oidcSubject: actor.sub,
          actorEmail: actor.email,
        },
      });

      return [row];
    });

    return this.mapRuleRow(await this.getRuleRow(created.id));
  }

  /** Updates a draft or published operator-created rule after validation. */
  async updateRule(
    id: string,
    dto: RuleUpdateBody,
    actor: Pick<JwtPayload, "sub" | "email">,
    assetIds?: string[] | null,
  ): Promise<RuleListItem> {
    const current = await this.getRuleRow(id);
    this.assertAssetInScope(current.assetId, assetIds);
    if (current.lifecycleStatus === "archived") {
      throw new BadRequestException("Archived rules cannot be edited");
    }
    const merged = this.mergeRuleDraft(current, dto);
    this.assertAssetInScope(merged.assetId ?? null, assetIds);
    const values = await this.validateRuleDraft(merged, id);
    const actorId = await this.resolveActorId(actor);
    const now = new Date();

    await this.db.transaction(async (tx) => {
      await tx
        .update(automationRules)
        .set({ ...values, updatedAt: now })
        .where(eq(automationRules.id, id));

      await tx.insert(auditLog).values({
        actorId,
        action: "rule_update",
        entityType: "automation_rule",
        entityId: id,
        reason: dto.reason ?? "Operator updated rule",
        payload: {
          code: current.code,
          lifecycleStatus: current.lifecycleStatus,
          oidcSubject: actor.sub,
          actorEmail: actor.email,
        },
      });
    });

    return this.mapRuleRow(await this.getRuleRow(id));
  }

  /** Evaluates a draft payload against current data without enabling it. */
  async previewRule(
    dto: RulePreviewBody,
    actor: Pick<JwtPayload, "sub" | "email">,
    assetIds?: string[] | null,
  ): Promise<RulePreviewResult> {
    this.assertAssetInScope(dto.assetId ?? null, assetIds);
    const values = await this.validateRuleDraft(dto, dto.id);
    const actorId = await this.resolveActorId(actor);
    const result = await this.evaluateRule({
      id: dto.id ?? "00000000-0000-0000-0000-000000000000",
      code: values.code ?? "DRAFT",
      name: values.name,
      description: values.description,
      category: values.category,
      ruleType: values.ruleType,
      source: "operator_rule",
      enabled: false,
      assetId: values.assetId ?? null,
      assetCode: null,
      assetName: null,
      siteName: null,
      pointKey: values.pointKey ?? null,
      operator: values.operator ?? null,
      thresholdValue: values.thresholdValue ?? null,
      severity: values.severity ?? null,
      condition: values.condition,
      action: values.action,
      lastEvaluatedAt: null,
      lifecycleStatus: "draft",
      publishedAt: null,
      archivedAt: null,
      duplicatedFromRuleId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await this.db.insert(auditLog).values({
      actorId,
      action: "rule_preview",
      entityType: "automation_rule",
      entityId: dto.id ?? null,
      reason: "Operator previewed rule draft",
      payload: {
        code: values.code,
        name: values.name,
        status: result.status,
        matched: result.matched,
        oidcSubject: actor.sub,
        actorEmail: actor.email,
      },
    });

    return result;
  }

  /** Publishes a valid rule draft and enables it for evaluation. */
  async publishRule(
    id: string,
    dto: RuleLifecycleBody,
    actor: Pick<JwtPayload, "sub" | "email">,
    assetIds?: string[] | null,
  ): Promise<RuleListItem> {
    const current = await this.getRuleRow(id);
    this.assertAssetInScope(current.assetId, assetIds);
    if (current.lifecycleStatus === "archived") {
      throw new BadRequestException("Archived rules cannot be published");
    }
    await this.validateRuleDraft(this.ruleBodyFromRow(current), id);
    await this.writeLifecycleUpdate(id, "rule_publish", dto, actor, {
      lifecycleStatus: "published",
      enabled: true,
      publishedAt: new Date(),
      archivedAt: null,
    });
    return this.mapRuleRow(await this.getRuleRow(id));
  }

  /** Archives a rule and removes it from active evaluation. */
  async archiveRule(
    id: string,
    dto: RuleLifecycleBody,
    actor: Pick<JwtPayload, "sub" | "email">,
    assetIds?: string[] | null,
  ): Promise<RuleListItem> {
    const current = await this.getRuleRow(id);
    this.assertAssetInScope(current.assetId, assetIds);
    await this.writeLifecycleUpdate(id, "rule_archive", dto, actor, {
      lifecycleStatus: "archived",
      enabled: false,
      archivedAt: new Date(),
    });
    return this.mapRuleRow(await this.getRuleRow(id));
  }

  /** Copies an existing rule into a disabled draft for operator editing. */
  async duplicateRule(
    id: string,
    dto: RuleLifecycleBody,
    actor: Pick<JwtPayload, "sub" | "email">,
    assetIds?: string[] | null,
  ): Promise<RuleListItem> {
    const current = await this.getRuleRow(id);
    this.assertAssetInScope(current.assetId, assetIds);
    const actorId = await this.resolveActorId(actor);
    const now = new Date();
    const code = await this.nextRuleCode(`${current.code}-COPY`);

    const [created] = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(automationRules)
        .values({
          code,
          name: `${current.name} copy`,
          description: current.description,
          category: current.category,
          ruleType: current.ruleType,
          source: "operator_rule",
          enabled: false,
          assetId: current.assetId,
          pointKey: current.pointKey,
          operator: current.operator,
          thresholdValue: current.thresholdValue,
          severity: current.severity,
          condition: current.condition,
          action: current.action,
          lifecycleStatus: "draft",
          publishedAt: null,
          archivedAt: null,
          duplicatedFromRuleId: current.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: automationRules.id });

      if (!row) {
        throw new BadRequestException("Could not duplicate rule");
      }

      await tx.insert(auditLog).values({
        actorId,
        action: "rule_duplicate",
        entityType: "automation_rule",
        entityId: row.id,
        reason: dto.reason ?? "Operator duplicated rule",
        payload: {
          fromRuleId: current.id,
          fromCode: current.code,
          code,
          oidcSubject: actor.sub,
          actorEmail: actor.email,
        },
      });

      return [row];
    });

    return this.mapRuleRow(await this.getRuleRow(created.id));
  }

  /** Lists recent rule execution traces. */
  async listExecutions(
    query: ListRuleExecutionsQuery,
    assetIds?: string[] | null,
  ): Promise<{ items: RuleExecutionItem[] }> {
    if (assetIds && assetIds.length === 0) {
      return { items: [] };
    }
    const base = this.db
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
      .innerJoin(automationRules, eq(ruleExecutions.ruleId, automationRules.id));
    const rows = await (assetIds
      ? base
          .where(inArray(automationRules.assetId, assetIds))
          .orderBy(desc(ruleExecutions.evaluatedAt))
          .limit(query.limit)
      : base.orderBy(desc(ruleExecutions.evaluatedAt)).limit(query.limit));

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
    assetIds?: string[] | null,
  ): Promise<RuleListItem> {
    const current = await this.getRuleRow(id);
    this.assertAssetInScope(current.assetId, assetIds);
    if (current.lifecycleStatus !== "published") {
      throw new BadRequestException("Only published rules can be enabled or disabled");
    }
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
    assetIds?: string[] | null,
  ): Promise<{ items: RuleExecutionItem[] }> {
    const rows = this.filterRuleRows(await this.ruleRows(), assetIds).filter(
      (row) => row.enabled && row.lifecycleStatus === "published",
    );
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

  private filterRuleRows(rows: RuleRow[], assetIds?: string[] | null): RuleRow[] {
    if (assetIds === null || assetIds === undefined) {
      return rows;
    }
    return rows.filter((row) => row.assetId !== null && assetIds.includes(row.assetId));
  }

  private assertAssetInScope(assetId: string | null, assetIds?: string[] | null): void {
    if (assetIds === null || assetIds === undefined) {
      return;
    }
    if (!assetId || !assetIds.includes(assetId)) {
      throw new NotFoundException("Rule asset is outside your access scope");
    }
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
        lifecycleStatus: automationRules.lifecycleStatus,
        publishedAt: automationRules.publishedAt,
        archivedAt: automationRules.archivedAt,
        duplicatedFromRuleId: automationRules.duplicatedFromRuleId,
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
      lifecycleStatus: row.lifecycleStatus as AutomationRuleLifecycleStatus,
      condition: this.asCondition(row.condition),
      action: this.asAction(row.action),
      lastEvaluatedAt: row.lastEvaluatedAt?.toISOString() ?? null,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      duplicatedFromRuleId: row.duplicatedFromRuleId,
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

  private async validateRuleDraft(
    dto: RuleDraftBody,
    currentId?: string,
  ): Promise<RuleDraftValues> {
    const code = dto.code?.trim().toUpperCase();
    if (code) {
      const existingRules = await this.db
        .select({
          id: automationRules.id,
          code: automationRules.code,
          lifecycleStatus: automationRules.lifecycleStatus,
        })
        .from(automationRules)
        .orderBy(automationRules.createdAt);
      const existing = existingRules.find(
        (rule) =>
          rule.id !== currentId &&
          rule.lifecycleStatus !== "archived" &&
          rule.code.trim().toUpperCase() === code,
      );
      if (existing) {
        throw new BadRequestException("Rule code already exists");
      }
    }

    if (dto.ruleType === "threshold") {
      if (
        !dto.assetId ||
        !dto.pointKey ||
        !dto.operator ||
        dto.thresholdValue === null ||
        dto.thresholdValue === undefined
      ) {
        throw new BadRequestException(
          "Threshold rules require asset, point, operator, and threshold value",
        );
      }
      await this.assertCompatiblePoint(dto.assetId, dto.pointKey);
      if (!("window" in dto.condition) || dto.condition.window !== "latest") {
        throw new BadRequestException("Threshold rules must use the latest-value window");
      }
      return {
        code,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        category: dto.category,
        ruleType: dto.ruleType,
        assetId: dto.assetId,
        pointKey: dto.pointKey,
        operator: dto.operator,
        thresholdValue: dto.thresholdValue,
        severity: dto.severity ?? "warning",
        condition: dto.condition,
        action: dto.action,
      };
    }

    if (!("days" in dto.condition)) {
      throw new BadRequestException("Time-window rules require days and start/end times");
    }

    return {
      code,
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      category: dto.category,
      ruleType: dto.ruleType,
      assetId: dto.assetId ?? null,
      pointKey: null,
      operator: null,
      thresholdValue: null,
      severity: dto.severity ?? "info",
      condition: dto.condition,
      action: dto.action,
    };
  }

  private async assertCompatiblePoint(assetId: string, pointKey: string): Promise<void> {
    const [asset] = await this.db
      .select({ code: assets.code, domain: assets.domain })
      .from(assets)
      .where(eq(assets.id, assetId))
      .limit(1);
    if (!asset) {
      throw new BadRequestException("Selected asset does not exist");
    }
    if (!this.pointKeysForAsset(asset.domain, asset.code).includes(pointKey)) {
      throw new BadRequestException("Selected telemetry point is not compatible with asset");
    }
  }

  private pointKeysForAsset(domain: string, code: string): string[] {
    if (code.startsWith("CR-RACK") || code.startsWith("CR-PDU")) {
      return [...CONTROL_ROOM_IT_POINT_KEYS];
    }
    if (code.startsWith("CR-UPS") || code.startsWith("CR-BATT")) {
      return [...CONTROL_ROOM_UPS_POINT_KEYS];
    }
    if (domain === "environment" || code.startsWith("CR-ENV") || code.startsWith("CR-LEAK") || code.startsWith("CR-SMOKE")) {
      return [...CONTROL_ROOM_ENVIRONMENT_POINT_KEYS];
    }
    if (domain === "hvac") {
      return [...HVAC_POINT_KEYS];
    }
    if (code.startsWith("CR-")) {
      return [...CONTROL_ROOM_ELECTRICAL_POINT_KEYS];
    }
    return [...ELECTRICAL_POINT_KEYS];
  }

  private mergeRuleDraft(row: RuleRow, dto: RuleUpdateBody): RuleDraftBody {
    const current = this.ruleBodyFromRow(row);
    return {
      ...current,
      ...dto,
      description: dto.description === undefined ? current.description : dto.description,
      assetId: dto.assetId === undefined ? current.assetId : dto.assetId,
      pointKey: dto.pointKey === undefined ? current.pointKey : dto.pointKey,
      operator: dto.operator === undefined ? current.operator : dto.operator,
      thresholdValue:
        dto.thresholdValue === undefined ? current.thresholdValue : dto.thresholdValue,
      severity: dto.severity === undefined ? current.severity : dto.severity,
      condition: dto.condition === undefined ? current.condition : dto.condition,
      action: dto.action === undefined ? current.action : dto.action,
    };
  }

  private ruleBodyFromRow(row: RuleRow): RuleDraftBody {
    return {
      code: row.code,
      name: row.name,
      description: row.description,
      category: row.category as AutomationRuleCategory,
      ruleType: row.ruleType as AutomationRuleType,
      assetId: row.assetId,
      pointKey: row.pointKey,
      operator: row.operator as AutomationRuleOperator | null,
      thresholdValue: row.thresholdValue,
      severity: row.severity as "info" | "warning" | "critical" | null,
      condition: this.asCondition(row.condition),
      action: this.asAction(row.action),
    };
  }

  private async writeLifecycleUpdate(
    id: string,
    action: "rule_publish" | "rule_archive",
    dto: RuleLifecycleBody,
    actor: Pick<JwtPayload, "sub" | "email">,
    values: Partial<{
      lifecycleStatus: AutomationRuleLifecycleStatus;
      enabled: boolean;
      publishedAt: Date | null;
      archivedAt: Date | null;
    }>,
  ): Promise<void> {
    const actorId = await this.resolveActorId(actor);
    await this.db.transaction(async (tx) => {
      await tx
        .update(automationRules)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(automationRules.id, id));

      await tx.insert(auditLog).values({
        actorId,
        action,
        entityType: "automation_rule",
        entityId: id,
        reason:
          dto.reason ?? (action === "rule_publish" ? "Rule published" : "Rule archived"),
        payload: {
          oidcSubject: actor.sub,
          actorEmail: actor.email,
        },
      });
    });
  }

  private async nextRuleCode(seed: string): Promise<string> {
    const base = seed
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48);
    const prefix = base.length >= 3 ? base : "OPERATOR-RULE";

    for (let index = 0; index < 100; index += 1) {
      const candidate = index === 0 ? prefix : `${prefix}-${index + 1}`;
      const [existing] = await this.db
        .select({ id: automationRules.id })
        .from(automationRules)
        .where(eq(automationRules.code, candidate))
        .limit(1);
      if (!existing) {
        return candidate;
      }
    }

    throw new BadRequestException("Could not generate a unique rule code");
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
