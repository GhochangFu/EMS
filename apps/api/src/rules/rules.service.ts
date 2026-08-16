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
  AssetDomain,
  AutomationRuleLifecycleStatus,
  RuleBuilderCatalogAsset,
  JwtPayload,
  RuleExecutionItem,
  RuleExecutionStatus,
  RuleListItem,
  RulePreviewResult,
} from "@bms/shared";

import { DRIZZLE } from "../database/database.tokens";
import { VocabulariesService } from "../vocabularies/vocabularies.service";
// The three modules extracted for AGENTS.md §4.5 (1000-line cap). Each holds
// pure logic — no database, no clock — which is why it sits outside the service
// and carries its own spec instead of needing one here.
import {
  evaluateThresholdRule,
  evaluateTimeWindowRule,
  unsupportedRuleType,
} from "./rule-evaluation";
import { asTrace, mapRuleRow, mergeRuleDraft, ruleBodyFromRow } from "./rule-mapping";
import { pointKeysForAsset } from "./rule-points";
import type {
  ListRuleExecutionsQuery,
  RuleDraftBody,
  RuleLifecycleBody,
  RulePreviewBody,
  RuleToggleBody,
  RuleUpdateBody,
} from "./rules.schema";
import type { EvaluationResult, RuleDraftValues, RuleRow } from "./rules.types";

@Injectable()
export class RulesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: BmsDb,
    private readonly vocabularies: VocabulariesService,
  ) {}

  /** Lists Sprint D automation rules with optional asset context. */
  async listRules(assetIds?: string[] | null): Promise<{ items: RuleListItem[] }> {
    const rows = this.filterRuleRows(await this.ruleRows(), assetIds);
    return { items: rows.map((row) => mapRuleRow(row)) };
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
        // `assets_domain_fk` (migration 0029) is what guarantees this code is a
        // live `bms.asset_domains` row. `AssetDomain` is a `string` since ADR
        // 0031 Amendment 1, so this is not a narrowing cast any more — the
        // vocabulary is data, and the foreign key is the enforcement.
        domain: row.domain as AssetDomain,
        pointKeys: pointKeysForAsset(row.domain, row.code),
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

    return mapRuleRow(await this.getRuleRow(created.id));
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
    const merged = mergeRuleDraft(current, dto);
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

    return mapRuleRow(await this.getRuleRow(id));
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
      // A preview is evaluated against a draft, not a joined row — the asset
      // columns are null here by construction, and the domain is one of them.
      assetDomain: null,
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
    await this.validateRuleDraft(ruleBodyFromRow(current), id);
    await this.writeLifecycleUpdate(id, "rule_publish", dto, actor, {
      lifecycleStatus: "published",
      enabled: true,
      publishedAt: new Date(),
      archivedAt: null,
    });
    return mapRuleRow(await this.getRuleRow(id));
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
    return mapRuleRow(await this.getRuleRow(id));
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

    return mapRuleRow(await this.getRuleRow(created.id));
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
        trace: asTrace(row.trace),
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

    return mapRuleRow(await this.getRuleRow(id));
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
        // ADR 0031's second axis. It rides the LEFT JOIN that was already here
        // for `assetCode`/`assetName`/`siteName` — no extra query, no extra
        // round trip, and null exactly when the rule targets no asset.
        assetDomain: assets.domain,
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

  /**
   * Routes a rule to its evaluator. The service supplies the two things the
   * evaluators cannot have — the telemetry loader and the clock — and owns
   * nothing else about the decision.
   */
  private async evaluateRule(row: RuleRow): Promise<EvaluationResult> {
    if (row.ruleType === "threshold") {
      return evaluateThresholdRule(row, (assetId, pointKey) =>
        this.latestPointValue(assetId, pointKey),
      );
    }
    if (row.ruleType === "time_window") {
      return evaluateTimeWindowRule(row, new Date());
    }
    return unsupportedRuleType(row);
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

  private async validateRuleDraft(
    dto: RuleDraftBody,
    currentId?: string,
  ): Promise<RuleDraftValues> {
    // ADR 0031 Amendment 1: the category vocabulary is data, so this is where a
    // bad one is caught — `categorySchema` can only check shape now.
    //
    // Four write paths funnel through here: `createDraft`, `updateRule`,
    // `previewRule` and `publishRule`.
    //
    // **`duplicateRule` does not**, and an earlier version of this comment
    // claimed the opposite. It opens its own transaction and inlines the insert
    // with `category: current.category`. That is not a hole in the foreign key
    // — the source row is already valid, so the copy is too — but it does mean
    // duplication is the one path that never re-checks, and the FK tests
    // *existence*, not `active`. Duplicating a rule whose category has since
    // been retired therefore propagates the retired code. Small, and recorded
    // rather than fixed here because retiring a category is not yet a workflow
    // anything performs.
    await this.vocabularies.assertRuleCategory(dto.category);

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
    if (!pointKeysForAsset(asset.domain, asset.code).includes(pointKey)) {
      throw new BadRequestException("Selected telemetry point is not compatible with asset");
    }
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
}
