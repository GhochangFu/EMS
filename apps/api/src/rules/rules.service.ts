import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { asc, desc, eq, inArray, or } from "drizzle-orm";

import {
  assets,
  auditLog,
  automationRules,
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

import {
  AlarmRaiser,
  isSampleFreshEnoughToRaise,
  shouldRaise,
} from "../alarms/alarm-raise.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import { VocabulariesService } from "../vocabularies/vocabularies.service";
import { alarmMessageFieldsFromCondition } from "./alarm-message";
// The three modules extracted for AGENTS.md §4.5 (1000-line cap). Each holds
// pure logic — no database, no clock — which is why it sits outside the service
// and carries its own spec instead of needing one here.
import {
  evaluateThresholdRule,
  evaluateTimeWindowRule,
  unsupportedRuleType,
  type LatestSampleLoader,
} from "./rule-evaluation";
import { asTrace, mapRuleRow, mergeRuleDraft, ruleBodyFromRow } from "./rule-mapping";
import { pointKeysForAsset } from "./rule-points";
import { batchedLatestPointValues, latestPointValue } from "./rule-samples";
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
  private readonly logger = new Logger(RulesService.name);

  constructor(
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    // E7.1b (ADR 0043): rule reads are cross-org system reads (the evaluate-now
    // sweep, the global code scan) or caller-scoped reads behind `assetIds`
    // (Amendment 3), plus a pre-tenant actor read — all on `fleetDb`
    // (BYPASSRLS). Writes run inside `withTenant(org)`. `rule_notifications`
    // stays in `ChannelsService` and belongs to the notifications unit.
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly vocabularies: VocabulariesService,
    private readonly alarmRaiser: AlarmRaiser,
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
    // fleetDb: the caller's `assetIds` (the WHERE below) is the isolation control.
    const base = this.fleetDb
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
    const organizationId = await this.resolveWriteOrg(values.assetId);
    const actorId = await this.resolveActorId(actor);
    const code = values.code ?? (await this.nextRuleCode(dto.name));
    const now = new Date();

    const created = await withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .insert(automationRules)
        .values({
          ...values,
          organizationId,
          code,
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

      // The audit row carries no organization_id in E7.1b (deferred to E7.1c);
      // Task 4's audit_log policy must tolerate this NULL-org insert (4 services).
      await tx.insert(auditLog).values({
        actorId,
        action: "rule_draft_create",
        entityType: "automation_rule",
        entityId: row.id,
        reason: "Operator created rule draft",
        payload: {
          code,
          name: dto.name,
          oidcSubject: actor.sub,
          actorEmail: actor.email,
        },
      });

      return row;
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
    // The rule keeps its existing tenant: E7.1b does not re-derive org on an
    // asset change (the streaming raise's divergence guard is the backstop), so
    // the update never touches the org column.
    const organizationId = this.requireRuleOrg(current);
    const actorId = await this.resolveActorId(actor);
    const now = new Date();

    await withTenant(this.db, organizationId, async (tx) => {
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
      // A preview evaluates a draft, not a persisted rule — no org on either axis.
      organizationId: null,
      assetOrganizationId: null,
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
    await this.writeLifecycleUpdate(
      id,
      "rule_publish",
      dto,
      actor,
      {
        lifecycleStatus: "published",
        enabled: true,
        publishedAt: new Date(),
        archivedAt: null,
      },
      this.requireRuleOrg(current),
    );
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
    await this.writeLifecycleUpdate(
      id,
      "rule_archive",
      dto,
      actor,
      {
        lifecycleStatus: "archived",
        enabled: false,
        archivedAt: new Date(),
      },
      this.requireRuleOrg(current),
    );
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
    // The copy inherits the source rule's tenant. `duplicateRule` bypasses
    // `validateRuleDraft`, so it carries its own `organizationId` stamp.
    const organizationId = this.requireRuleOrg(current);
    const actorId = await this.resolveActorId(actor);
    const now = new Date();
    const code = await this.nextRuleCode(`${current.code}-COPY`);

    const created = await withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .insert(automationRules)
        .values({
          organizationId,
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

      return row;
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
    // fleetDb: the caller's `assetIds` (the WHERE below) is the isolation control.
    const base = this.fleetDb
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
    const organizationId = this.requireRuleOrg(current);
    const actorId = await this.resolveActorId(actor);
    const now = new Date();

    await withTenant(this.db, organizationId, async (tx) => {
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

  /**
   * Evaluates every enabled, published rule and records an execution trace
   * for each — matched or not, which is the whole point of an "evaluate now"
   * button. **Unscoped** (ADR 0033 decision 2): alarms are facts about the
   * plant, not a view scoped to whoever clicked the button, so a
   * location-scoped operator triggering this raises the same alarms a global
   * admin would. Only the *returned* trace list is filtered to the caller's
   * `assetIds` — matching how the streaming path (`AlarmEngineService`) has
   * always raised without regard to who is watching.
   */
  async evaluateEnabledRules(
    actor: Pick<JwtPayload, "sub" | "email">,
    assetIds?: string[] | null,
  ): Promise<{ items: RuleExecutionItem[] }> {
    const allRows = (await this.ruleRows()).filter(
      (row) => row.enabled && row.lifecycleStatus === "published",
    );
    const scopedIds = new Set(this.filterRuleRows(allRows, assetIds).map((row) => row.id));
    const items: RuleExecutionItem[] = [];

    // Decision 2 makes this evaluate every enabled+published rule regardless
    // of the caller's scope — 337 on the seeded dev database as of F3.6, and
    // growing (E5.1 alone adds a domain pack's worth). One query per rule for
    // its telemetry sample measured at 4.3s for that count; this collapses it
    // to one query total, keyed by the same `(assetId, pointKey)` pair
    // `evaluateThresholdRule`'s loader already takes.
    const sampleLookup = await batchedLatestPointValues(this.db, allRows);

    for (const row of allRows) {
      // E7.1b: the trace insert + `lastEvaluatedAt` update run under the rule's
      // tenant GUC. A rule with no org — none exists on real data (the 0046
      // backfill aborts on it) — is skipped with a warning, so one un-orgd rule
      // cannot 500 the evaluate-now sweep for every other tenant.
      if (!row.organizationId) {
        this.logger.warn(
          `evaluate-now: skipping rule ${row.code} (${row.id}) with no organization_id`,
        );
        continue;
      }
      const ruleOrg = row.organizationId;

      const result = await this.evaluateRule(row, sampleLookup);

      // Raise before the trace insert below, so a successful raise's
      // `alarmId` has somewhere to land in the SAME trace row rather than a
      // second one — `recordTrace: false` because the insert two lines down
      // already covers this evaluation, matched or not, and a second row
      // would duplicate it. Code review caught an earlier draft that raised
      // here but never actually read the result, so the comment's own claim
      // was untrue and every on-demand-raised alarm's trace omitted
      // `alarmId` — the one thing `evaluatedBy`/`source` don't already say.
      let raisedAlarmId: string | null = null;
      if (
        shouldRaise(row, result) &&
        row.assetId &&
        row.pointKey &&
        result.observedValue !== null
      ) {
        // Security review, F3.6: `result`'s sample can be of any age (see
        // `batchedLatestPointValues`'s doc comment) — bounding it here, not
        // in the loader, keeps the trace above honest about a genuinely
        // stale match while still refusing to raise, or re-open, an alarm
        // from telemetry an asset stopped sending long ago.
        const sample = await sampleLookup(row.assetId, row.pointKey);
        if (sample && isSampleFreshEnoughToRaise(sample.time, new Date())) {
          const { alarmMessage, unit } = alarmMessageFieldsFromCondition(row.condition);
          // E7.1b: raise takes the asset's org (GUC + `alarms.org`) and the
          // rule's own org (`rule_executions.org`), both now on the rule row
          // (ruleRows on fleetDb) — the transitional per-rule lookup is gone.
          // AlarmRaiser refuses and logs a raise where the two disagree.
          if (row.assetOrganizationId) {
            const raised = await this.alarmRaiser.raise(
              row.assetId,
              row.assetOrganizationId,
              {
                id: row.id,
                code: row.code,
                name: row.name,
                pointKey: row.pointKey,
                severity: row.severity,
                organizationId: ruleOrg,
                alarmMessage,
                unit,
              },
              result.observedValue,
              { recordTrace: false },
            );
            raisedAlarmId = raised.alarmId;
          }
        }
      }

      // Under the rule's GUC, stamping `rule_executions.org` from the rule. The
      // raise above ran in its own withTenant(asset org) — a separate write, as
      // the raise and the trace already were before E7.1b.
      const created = await withTenant(this.db, ruleOrg, async (tx) => {
        const [inserted] = await tx
          .insert(ruleExecutions)
          .values({
            organizationId: ruleOrg,
            ruleId: row.id,
            status: result.status,
            matched: result.matched,
            observedValue: result.observedValue,
            message: result.message,
            trace: {
              ...result.trace,
              ...(raisedAlarmId ? { alarmId: raisedAlarmId } : {}),
              // The OIDC subject, not the email (security review, F3.6): this
              // trace is now written for every enabled rule regardless of the
              // caller's assetIds (ADR 0033 decision 2), and `listExecutions`
              // scopes reads by asset, not by who evaluated — so an operator at
              // location B can read a location-A operator's trace on assets B
              // can see. `sub` is still an actionable identifier for an admin
              // correlating against `bms.users`, without handing every scoped
              // reader a plaintext email address they have no other route to.
              evaluatedBy: actor.sub,
              source: row.source,
            },
          })
          .returning({
            id: ruleExecutions.id,
            evaluatedAt: ruleExecutions.evaluatedAt,
          });

        await tx
          .update(automationRules)
          .set({ lastEvaluatedAt: inserted?.evaluatedAt ?? new Date(), updatedAt: new Date() })
          .where(eq(automationRules.id, row.id));

        return inserted;
      });

      if (created && scopedIds.has(row.id)) {
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

  /**
   * Throws unless the caller may act on this rule (`F3.8`, AGENTS.md §4.7).
   *
   * The public door onto the private check below, added because the
   * notification-join routes live in this controller but write through
   * `ChannelsService`. Without it those routes had a role check and NO scope
   * check, so a location-scoped admin could attach a channel they own to any
   * rule in any other location and quietly redirect its alarms. Found by the
   * F3.8 compliance review.
   *
   * It reuses `getRuleRow` and `assertAssetInScope` rather than restating
   * either: a second copy of "is this rule mine" is how the two drift.
   */
  async assertRuleInScope(ruleId: string, assetIds?: string[] | null): Promise<void> {
    const row = await this.getRuleRow(ruleId);
    this.assertAssetInScope(row.assetId, assetIds);
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
    // fleetDb (BYPASSRLS), deliberately cross-org: the evaluate-now sweep reads
    // every tenant's rules (ADR 0033 decision 2), and `listRules`'s isolation
    // control is the `filterRuleRows` post-filter, not a WHERE here.
    return this.fleetDb
      .select({
        id: automationRules.id,
        code: automationRules.code,
        name: automationRules.name,
        description: automationRules.description,
        category: automationRules.category,
        ruleType: automationRules.ruleType,
        source: automationRules.source,
        enabled: automationRules.enabled,
        // E7.1b: the rule's own org and its asset's org, both off the leftJoin.
        organizationId: automationRules.organizationId,
        assetOrganizationId: assets.organizationId,
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
   *
   * `loader` defaults to one query per call — fine for `previewRule`, a
   * single rule. `evaluateEnabledRules` passes its own batched loader
   * (`batchedLatestPointValues`) instead, so evaluating N rules costs one
   * query rather than N.
   */
  private async evaluateRule(row: RuleRow, loader?: LatestSampleLoader): Promise<EvaluationResult> {
    if (row.ruleType === "threshold") {
      return evaluateThresholdRule(
        row,
        loader ?? ((assetId, pointKey) => latestPointValue(this.db, assetId, pointKey)),
      );
    }
    if (row.ruleType === "time_window") {
      return evaluateTimeWindowRule(row, new Date());
    }
    return unsupportedRuleType(row);
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

    // ADR 0032. `severity` stopped being a `z.enum` when the vocabulary became
    // data, so the request schema now checks shape only and this is where an
    // unknown code becomes a 400 instead of a foreign-key 500.
    //
    // Guarded on null rather than asserted unconditionally: a rule may hold no
    // severity — `F4.46`'s write-path fix established that, and
    // `automation_rules.severity` is nullable — and a nullable foreign key does
    // not check NULL against the referenced table, so neither does this.
    if (dto.severity != null) {
      await this.vocabularies.assertAlarmSeverity(dto.severity);
    }

    const code = dto.code?.trim().toUpperCase();
    if (code) {
      // fleetDb, and deliberately cross-org: `automation_rules_code_unique` is
      // still a global unique index — the `(organization_id, code)` re-key is
      // E7.1c (decision 7) — so this scan must see every tenant's codes to turn
      // a collision into a 400 here rather than a 500 from the index.
      const existingRules = await this.fleetDb
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
        // `F4.46`. No default here, on purpose. `severity` is nullable in the
        // schema and every other layer round-trips the null, so substituting
        // one on this path meant an update that merely omitted the field
        // overwrote a stored null — `updateRule` funnels through here after
        // `mergeRuleDraft` has carefully preserved it.
        //
        // The `NOT NULL` that a default exists to satisfy is `alarms.severity`,
        // and that boundary already has its own: `defaultAlarmSeverity`
        // (`alarm-severity-default.ts:21`) maps a null rule to `"warning"` when
        // `AlarmRaiser` raises it. One default, at the edge that needs it.
        severity: dto.severity ?? null,
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
      // `F4.46`, and this one defended nothing even in principle: the alarm
      // engine's cache query filters to `ruleType = "threshold"`
      // (`alarm-engine.service.ts:81`), so a time-window rule never reaches the
      // code that requires a severity. `shouldRaise` (F3.6,
      // `alarm-raise.service.ts`) makes the same exclusion explicit for the
      // on-demand evaluator, which has no such query to filter on. The seed
      // agrees — `weekday_energy_review` is the only time-window rule and the
      // only row with no severity.
      severity: dto.severity ?? null,
      condition: dto.condition,
      action: dto.action,
    };
  }

  private async assertCompatiblePoint(assetId: string, pointKey: string): Promise<void> {
    // fleetDb: a pre-write asset lookup, already scope-checked by the caller.
    const [asset] = await this.fleetDb
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

  /**
   * The organization a new rule is written into: its asset's org (read on
   * fleetDb before the GUC). An asset-less `time_window` rule is refused with a
   * 4xx (ruling 4) — never a NULL insert — until the E7.1d org-picker lands.
   */
  private async resolveWriteOrg(assetId: string | null): Promise<string> {
    if (!assetId) {
      throw new BadRequestException(
        "Select an organization for this rule: an asset-less time-window rule has no organization to derive one from",
      );
    }
    const [asset] = await this.fleetDb
      .select({ organizationId: assets.organizationId })
      .from(assets)
      .where(eq(assets.id, assetId))
      .limit(1);
    if (!asset) {
      throw new BadRequestException("Selected asset does not exist");
    }
    if (!asset.organizationId) {
      throw new BadRequestException("Asset has no organization; run the 0046 backfill");
    }
    return asset.organizationId;
  }

  /** The stored org of a rule being mutated; refuses a pre-0046 NULL. */
  private requireRuleOrg(row: RuleRow): string {
    if (!row.organizationId) {
      throw new BadRequestException("Rule has no organization; run the 0046 backfill");
    }
    return row.organizationId;
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
    organizationId: string,
  ): Promise<void> {
    const actorId = await this.resolveActorId(actor);
    await withTenant(this.db, organizationId, async (tx) => {
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
      // fleetDb: the code space is global until E7.1c re-keys it (decision 7).
      const [existing] = await this.fleetDb
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
    // fleetDb: a pre-tenant identity read (pre-empts the Task-4 actor-loss).
    const [actorRow] = await this.fleetDb
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.id, actor.sub), eq(users.email, actor.email)))
      .limit(1);
    return actorRow?.id ?? null;
  }
}
