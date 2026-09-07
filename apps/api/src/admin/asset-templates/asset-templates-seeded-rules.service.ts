import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { assetTemplates, assets, automationRules } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { seededRuleValuesSchema } from "@bms/shared";
import type {
  JwtPayload,
  ReapplySeededRulesResponse,
  SeededRuleDto,
  SeededRulesListResponse,
  SeededRuleValues,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import { MasterDataAuditService } from "../master-data-audit.service";
import { parseStoredTemplateContent } from "./asset-templates-content.schema";
import type { ReapplySeededRulesBody } from "./asset-templates.schema";
import { driftVerdict, seededBaselineValues, type TemplateAlarm } from "./template-alarm-rules";

type TemplateRow = typeof assetTemplates.$inferSelect;

/** One seeded rule joined to its asset, as the tenant read returns it. */
type SeededRuleRow = {
  rule: typeof automationRules.$inferSelect;
  asset: { id: string; code: string; name: string; locationId: string };
};

/**
 * The currently published version of a template code, with its alarms keyed
 * by code — what decision 8's `current` is computed from. `null` when no
 * version of the code is published (every one archived, or a draft only).
 */
type CurrentVersion = {
  id: string;
  version: number;
  alarmsByCode: ReadonlyMap<string, TemplateAlarm>;
};

/** A named rule with the values re-apply will write to it. */
type ReapplyPlan = {
  row: SeededRuleRow;
  dto: SeededRuleDto;
  values: SeededRuleValues;
};

/**
 * `E2.4` / ADR 0058 decision 8 — the seeded-rules drift list and the
 * per-rule re-apply, as two routes on the template.
 *
 * **Both routes key on the template code, not on the row `:id` names.** A rule
 * is seeded from one version (`source_template_id`) and the question decision
 * 8 asks is how it stands against the version published *now*, so the list
 * gathers every rule seeded from any version of the code and compares each
 * against the current one (plan D5). Listing through v1's id or v2's id
 * returns the same rows.
 *
 * **Scope is writable locations, not the organization** — the owner's ruling
 * of 2026-09-07 over the ADR's text, owed to ADR 0058 Amendment 1. `instantiate`
 * checks `canManageOrganization` on the template and then `canManageLocation`
 * on the target, so a `location_admin` who could never have created these
 * rules must not be able to list or re-apply a threshold on them. The list
 * filters on `writableLocationIds`; re-apply refuses a named rule outside that
 * set with a 403 and writes nothing.
 *
 * **All three verdict inputs speak one dialect.** `seededBaselineValues` is the
 * only way a `SeededRuleValues` is built from a template alarm here — the
 * baseline was written by it, and `current` is built by calling it on the
 * published version's alarm. `driftVerdict`'s docblock names the hazard: a
 * `current` assembled from `alarm.message` raw reads `template_moved` on every
 * rule whose message is long, short or padded.
 *
 * **A row whose provenance does not parse has no verdict.** Nothing makes the
 * four `0067` columns all-or-none, and no live path writes half of them; the
 * list leaves such a row out rather than throwing (plan §9 note 7), and
 * re-apply refuses it by name with a 409.
 *
 * `F4.16` / E7.1b — `asset_templates` reads run on `fleetDb` behind the
 * `canManageOrganization` check; `automation_rules` and `assets` are policied
 * tenant tables, so every read and write of them runs inside
 * `withTenant(this.tenantDb, template.organizationId, …)` (plan D9).
 */
@Injectable()
export class AssetTemplateSeededRulesService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  /**
   * `GET /admin/asset-templates/:id/seeded-rules` — every rule seeded from any
   * version of this template's code, on an asset the caller can write, with
   * its verdict against the currently published version.
   */
  async list(jwt: JwtPayload, templateId: string): Promise<SeededRulesListResponse> {
    const template = await this.authorize(jwt, templateId);
    const versionIds = await this.versionIds(template);
    const current = await this.resolveCurrent(template, versionIds);
    const summary = current ? { id: current.id, version: current.version } : null;

    // `null` is the unrestricted sentinel; an empty array is a real user with
    // no grants, who must see nothing rather than everything.
    const writable = await this.accessControl.writableLocationIds(jwt);
    if (writable !== null && writable.length === 0) {
      return { templateCode: template.code, currentVersion: summary, items: [] };
    }

    const rows = await withTenant(this.tenantDb, template.organizationId, (tx) =>
      this.selectSeeded(tx, versionIds, { locationIds: writable }),
    );
    return {
      templateCode: template.code,
      currentVersion: summary,
      items: rows.flatMap((row) => {
        const dto = this.toDto(row, current);
        return dto ? [dto] : [];
      }),
    };
  }

  /**
   * `POST /admin/asset-templates/:id/seeded-rules/reapply` — applies the
   * currently published version's alarm values to the named rules (plan D6).
   *
   * Every refusal is decided before the transaction opens and writes nothing:
   * 404 for an id not seeded from this template code, 403 for a rule whose
   * asset the caller cannot write, 409 for a rule whose provenance does not
   * parse, 400 for a rule whose alarm code the current version no longer
   * carries. The batch is all or nothing — a mixed batch is refused whole.
   *
   * What moves is decision 5's five fields (`operator`, `threshold_value`,
   * `severity`, `category`, `name`) plus the three provenance stamps
   * (`source_template_id`, `source_template_version`, `seeded_baseline`).
   * `action`, `description`, `point_key` and `condition` are the rule's own
   * and stay as they are. `enabled` becomes `true` only for a rule whose
   * `operator` and `threshold_value` were both `NULL` and are now both set —
   * decision 8's "re-apply arms a rule it completes" — and is otherwise never
   * touched, so a rule an engineer turned off stays off.
   */
  async reapply(
    jwt: JwtPayload,
    templateId: string,
    body: ReapplySeededRulesBody,
  ): Promise<ReapplySeededRulesResponse> {
    const template = await this.authorize(jwt, templateId);
    const versionIds = await this.versionIds(template);
    const current = await this.resolveCurrent(template, versionIds);
    if (!current) {
      throw new ConflictException(
        `${template.code} has no published version, so there are no alarm values to re-apply. ` +
          "Nothing was written.",
      );
    }

    // Read the named ids unscoped, so an id from another template and an id
    // outside the caller's locations get different answers.
    const rows = await withTenant(this.tenantDb, template.organizationId, (tx) =>
      this.selectSeeded(tx, versionIds, { locationIds: null, ruleIds: body.ruleIds }),
    );
    const found = new Map(rows.map((row) => [row.rule.id, row]));
    const missing = body.ruleIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new NotFoundException(
        `These rule ids were not seeded from template ${template.code}: ${missing.join(", ")}. ` +
          "Nothing was written.",
      );
    }

    // Counted, not named — `asset-templates-migrate.service.ts` (`F4.64`)
    // answers the same question the same way: the caller supplied the ids, and
    // the asset codes behind them are what they may not see.
    const writable = await this.accessControl.writableLocationIds(jwt);
    const refused =
      writable === null
        ? 0
        : rows.filter((row) => !writable.includes(row.asset.locationId)).length;
    if (refused > 0) {
      const noun = refused === 1 ? "rule is" : "rules are";
      throw new ForbiddenException(
        `${refused} of these ${noun} on an asset outside your access scope. Nothing was written.`,
      );
    }

    const plans = body.ruleIds.map((id) => this.planReapply(found.get(id) as SeededRuleRow, current, template));
    const armed = plans
      .filter(
        (plan) =>
          plan.dto.live.operator === null &&
          plan.dto.live.thresholdValue === null &&
          plan.values.operator !== null &&
          plan.values.thresholdValue !== null,
      )
      .map((plan) => plan.row.rule.id);
    const now = new Date();

    const items = await withTenant(this.tenantDb, template.organizationId, async (tx) => {
      // Rules seeded from the same alarm take the same values: one UPDATE per
      // alarm code, not one per rule.
      const byAlarm = new Map<string, ReapplyPlan[]>();
      for (const plan of plans) {
        const group = byAlarm.get(plan.dto.sourceAlarmCode) ?? [];
        group.push(plan);
        byAlarm.set(plan.dto.sourceAlarmCode, group);
      }
      let updatedCount = 0;
      for (const group of byAlarm.values()) {
        const values = group[0].values;
        const updated = await tx
          .update(automationRules)
          .set({
            name: values.message,
            category: values.category,
            operator: values.operator,
            thresholdValue: values.thresholdValue,
            severity: values.severity,
            sourceTemplateId: current.id,
            sourceTemplateVersion: current.version,
            seededBaseline: values,
            updatedAt: now,
          })
          .where(
            inArray(
              automationRules.id,
              group.map((plan) => plan.row.rule.id),
            ),
          )
          .returning({ id: automationRules.id });
        updatedCount += updated.length;
      }
      // Under `FORCE ROW LEVEL SECURITY` an UPDATE whose row fails the tenant
      // policy affects zero rows without erroring. A short count means a rule
      // is outside the template's org — turn it into a loud rollback rather
      // than a 200 that moved only some of the batch.
      if (updatedCount !== plans.length) {
        throw new ConflictException(
          `Re-apply matched ${updatedCount} of ${plans.length} named rules under the template ` +
            "organization's tenant boundary; the rest are outside it. Nothing was written.",
        );
      }
      if (armed.length > 0) {
        await tx
          .update(automationRules)
          .set({ enabled: true, updatedAt: now })
          .where(inArray(automationRules.id, armed));
      }

      // The open `tx`, not a second client — `MasterDataAuditService.write`'s
      // docblock requires it, and it makes the audit row atomic with the write.
      await this.audit.write(
        {
          actor: jwt,
          action: "master.asset_template.reapply_alarms",
          entityType: "asset_template",
          entityId: current.id,
          organizationId: template.organizationId,
          payload: {
            code: template.code,
            requestedTemplateId: template.id,
            appliedVersion: current.version,
            ruleIds: body.ruleIds,
            armedRuleIds: armed,
          },
        },
        tx,
      );

      // Read back on the write's tenant GUC, so the response is the row.
      const after = await this.selectSeeded(tx, versionIds, {
        locationIds: null,
        ruleIds: body.ruleIds,
      });
      return after.flatMap((row) => {
        const dto = this.toDto(row, current);
        return dto ? [dto] : [];
      });
    });

    return { appliedVersion: current.version, items };
  }

  // -------------------------------------------------------------------------

  /**
   * The gate both routes share, in `instantiate`'s order: the template is
   * authorized before anything else about it is read, so a caller outside
   * the org learns only that they cannot see it.
   */
  private async authorize(jwt: JwtPayload, templateId: string): Promise<TemplateRow> {
    await this.accessControl.requireMasterDataUser(jwt);
    const [template] = await this.fleetDb
      .select()
      .from(assetTemplates)
      .where(eq(assetTemplates.id, templateId))
      .limit(1);
    if (!template) {
      throw new NotFoundException("Asset template not found");
    }
    if (!(await this.accessControl.canManageOrganization(jwt, template.organizationId))) {
      throw new ForbiddenException("Template is outside your access scope");
    }
    return template;
  }

  /** Every version id of this template's code, in its organization. */
  private async versionIds(template: TemplateRow): Promise<string[]> {
    const rows = await this.fleetDb
      .select({ id: assetTemplates.id })
      .from(assetTemplates)
      .where(
        and(
          eq(assetTemplates.organizationId, template.organizationId),
          eq(assetTemplates.code, template.code),
        ),
      );
    return rows.map((row) => row.id);
  }

  /**
   * The published version of the code with the highest version number, and
   * its alarms by code.
   *
   * Stored content that no longer parses is a 409 naming the structure-only
   * detail, the same refusal `instantiate` makes (plan D7): a list that
   * silently treated every alarm as removed would report `template_moved` on
   * every rule for a reason no reader could see.
   */
  private async resolveCurrent(
    template: TemplateRow,
    versionIds: string[],
  ): Promise<CurrentVersion | null> {
    const [published] = await this.fleetDb
      .select({
        id: assetTemplates.id,
        version: assetTemplates.version,
        content: assetTemplates.content,
      })
      .from(assetTemplates)
      .where(and(inArray(assetTemplates.id, versionIds), eq(assetTemplates.status, "published")))
      .orderBy(desc(assetTemplates.version))
      .limit(1);
    if (!published) {
      return null;
    }
    const parsed = parseStoredTemplateContent(published.content);
    if (!parsed.ok) {
      throw new ConflictException(
        `Cannot read the alarms of ${template.code} v${published.version}: its stored content ` +
          "no longer matches the current content contract. A published version is immutable — " +
          "create a new draft from it, repair the content and publish that version instead. " +
          parsed.detail,
      );
    }
    return {
      id: published.id,
      version: published.version,
      alarmsByCode: new Map((parsed.content.alarms ?? []).map((alarm) => [alarm.code, alarm])),
    };
  }

  /**
   * The seeded rules of these versions joined to their assets, on the caller's
   * tenant handle. `locationIds: null` is unscoped; `ruleIds` narrows to the
   * named ones.
   */
  private async selectSeeded(
    tx: BmsDb,
    versionIds: string[],
    scope: { locationIds: string[] | null; ruleIds?: string[] },
  ): Promise<SeededRuleRow[]> {
    if (versionIds.length === 0) {
      return [];
    }
    return tx
      .select({
        rule: automationRules,
        asset: { id: assets.id, code: assets.code, name: assets.name, locationId: assets.locationId },
      })
      .from(automationRules)
      .innerJoin(assets, eq(automationRules.assetId, assets.id))
      .where(
        and(
          inArray(automationRules.sourceTemplateId, versionIds),
          scope.locationIds === null ? undefined : inArray(assets.locationId, scope.locationIds),
          scope.ruleIds === undefined ? undefined : inArray(automationRules.id, scope.ruleIds),
        ),
      )
      .orderBy(asc(assets.code), asc(automationRules.sourceAlarmCode));
  }

  /**
   * One list item, or `null` for a row with no defined verdict.
   *
   * `live` is the rule's own columns with `name` as `message` — the rule
   * table has no message column, and `name` is what `seededRuleValues` wrote
   * the derived message to. `baseline` is the stored jsonb. Both go through
   * `seededRuleValuesSchema`, so a NULL baseline, a half-written provenance or
   * a column value outside the contract all land on the same answer: leave
   * the row out.
   */
  private toDto(row: SeededRuleRow, current: CurrentVersion | null): SeededRuleDto | null {
    const { rule, asset } = row;
    if (
      rule.sourceTemplateId === null ||
      rule.sourceTemplateVersion === null ||
      rule.sourceAlarmCode === null
    ) {
      return null;
    }
    const baseline = seededRuleValuesSchema.safeParse(rule.seededBaseline);
    const live = seededRuleValuesSchema.safeParse({
      operator: rule.operator,
      thresholdValue: rule.thresholdValue,
      severity: rule.severity,
      category: rule.category,
      message: rule.name,
    });
    if (!baseline.success || !live.success) {
      return null;
    }
    const alarm = current?.alarmsByCode.get(rule.sourceAlarmCode);
    // The ONLY derivation of `current` — see the class docblock.
    const currentValues = alarm ? seededBaselineValues(alarm) : null;
    return {
      ruleId: rule.id,
      ruleCode: rule.code,
      enabled: rule.enabled,
      assetId: asset.id,
      assetCode: asset.code,
      assetName: asset.name,
      locationId: asset.locationId,
      sourceTemplateId: rule.sourceTemplateId,
      sourceTemplateVersion: rule.sourceTemplateVersion,
      sourceAlarmCode: rule.sourceAlarmCode,
      live: live.data,
      seededBaseline: baseline.data,
      current: currentValues,
      verdict: driftVerdict(live.data, baseline.data, currentValues),
    };
  }

  /** The two per-rule refusals of D6, then the values the rule will take. */
  private planReapply(
    row: SeededRuleRow,
    current: CurrentVersion,
    template: TemplateRow,
  ): ReapplyPlan {
    const dto = this.toDto(row, current);
    if (!dto) {
      throw new ConflictException(
        `Rule ${row.rule.code} carries incomplete template provenance (one of source_template_id, ` +
          "source_template_version, source_alarm_code or seeded_baseline is missing or unreadable), " +
          "so it has no drift verdict and cannot be re-applied. Nothing was written.",
      );
    }
    if (dto.current === null) {
      throw new BadRequestException(
        `Rule ${row.rule.code} was seeded from alarm "${dto.sourceAlarmCode}", which ` +
          `${template.code} v${current.version} no longer carries; there is nothing to re-apply ` +
          "it from. Nothing was written.",
      );
    }
    return { row, dto, values: dto.current };
  }
}
