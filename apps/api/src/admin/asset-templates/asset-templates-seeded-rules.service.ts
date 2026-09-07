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
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { parseStoredTemplateContent } from "./asset-templates-content.schema";
import type { ReapplySeededRulesBody } from "./asset-templates.schema";
import { driftVerdict, seededBaselineValues, type TemplateAlarm } from "./template-alarm-rules";
import {
  alarmVocabularyMessage,
  findAlarmVocabularyProblem,
} from "./template-alarm-vocabularies";

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
  /**
   * The same alarms in **content order**, kept beside the map because
   * `findAlarmVocabularyProblem` reports `content.alarms.<n>.<axis>` and that
   * index is only true of the stored array. A list rebuilt from the map's
   * values would collapse on a repeated code and point a reader at the wrong
   * alarm; a filtered one would point at the wrong index entirely.
   */
  alarms: readonly TemplateAlarm[];
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
    // Appended, never inserted: the first four positions are what `AdminModule`
    // has wired since this class was added. `VocabulariesModule` is already
    // imported there for `AssetTemplateInstantiationService`, so this needs no
    // module change — see `assertAlarmVocabulariesStillLive`.
    private readonly vocabularies: VocabulariesService,
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
   * asset the caller cannot write, 409 for a version naming a retired
   * vocabulary, 409 for a rule whose provenance does not parse, and 400 for a
   * rule that is not published, whose alarm code the current version no longer
   * carries, whose limit the current version has removed, or whose alarm the
   * current version has moved to a different point. The batch is all or
   * nothing — a mixed batch is refused whole.
   *
   * **The order of those refusals is a security property, not a convenience.**
   * The two 400s that quote a stored alarm code or point key are decided in
   * `planReapply`, which runs *after* the writable-location check, so a caller
   * naming a rule outside their scope learns only that it is outside their
   * scope. Nothing but this ordering holds that, and the crossed case is
   * pinned by an integration assertion.
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

    // After the 403 and before anything derived from stored content is quoted.
    await this.assertAlarmVocabulariesStillLive(current, template);

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
    const alarms = parsed.content.alarms ?? [];
    return {
      id: published.id,
      version: published.version,
      alarmsByCode: new Map(alarms.map((alarm) => [alarm.code, alarm])),
      alarms,
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

  /**
   * The same live-vocabulary gate `instantiate` makes, on the **other** path
   * that stamps `severity` and `category` onto a live rule.
   *
   * Re-apply writes both from stored template content into columns closed by
   * `automation_rules_category_fk` / `automation_rules_severity_fk`, and
   * retirement in this estate is `active = false`, not a delete — so the
   * foreign keys stay satisfied and a code the organization has withdrawn
   * lands on a live rule with nothing to say so. That is exactly the hole
   * `template-alarm-vocabularies.ts` was extracted to close on the publish and
   * instantiate paths, and this route reopened it on a third one. A security
   * review named it; the fix is to call the shared check rather than to spell a
   * fourth version of "is this code live".
   *
   * **The whole version's alarms, not the named rules' alarms.** The problem's
   * `path` is `content.alarms.<n>.<axis>` — an index into the stored array — so
   * a filtered subset would name an alarm the reader cannot find. It is also
   * the same question `instantiate` asks of the same version.
   *
   * **409, and the message never echoes the stored value.** Both properties are
   * `instantiate`'s, for its stated reasons: nothing is wrong with the request,
   * the estate moved under a frozen version; and `content` is `jsonb` with no
   * foreign key, so the offending value is arbitrary stored text. The problem
   * carries the path and the live codes only.
   */
  private async assertAlarmVocabulariesStillLive(
    current: CurrentVersion,
    template: TemplateRow,
  ): Promise<void> {
    // Skipped for a version with no alarms, exactly as `instantiate` skips it:
    // `VocabulariesService.list` is six parallel selects on the tenant handle,
    // and a template with no alarms has nothing for them to answer about.
    if (current.alarms.length === 0) {
      return;
    }
    const { ruleCategories, alarmSeverities, alarmSkills } = await this.vocabularies.list();
    const problem = findAlarmVocabularyProblem(current.alarms, {
      ruleCategories,
      alarmSeverities,
      alarmSkills,
    });
    if (!problem) {
      return;
    }
    throw new ConflictException(
      `Cannot re-apply ${template.code} v${current.version}: ` +
        `${alarmVocabularyMessage(problem)} ` +
        `Reactivate that ${problem.axis}, or publish a new template version that does not ` +
        "use it. Nothing was written.",
    );
  }

  /** The per-rule refusals of D6, then the values the rule will take. */
  private planReapply(
    row: SeededRuleRow,
    current: CurrentVersion,
    template: TemplateRow,
  ): ReapplyPlan {
    // Before the provenance parse, because this is a property of the row rather
    // than of what the row records.
    //
    // `selectSeeded` deliberately does **not** carry this predicate: filtering
    // it there would fold an archived rule into the 404 branch, whose sentence
    // says it was never seeded from this template code — which would be false.
    //
    // Nothing else stops it. The arming write below sets `enabled = true`
    // directly, while `archiveRule` archives with `enabled = false` and
    // `setEnabled` refuses to enable anything that is not published; re-apply
    // goes through neither, so an archived philosophy row that the current
    // version now gives a limit would come out `enabled = true,
    // lifecycle_status = 'archived'` — contradicting `archiveRule`'s
    // postcondition and showing as enabled in the Rule Engine list, which sorts
    // on that column. Spelled `!== "published"`, matching `setEnabled`, so the
    // two cannot drift apart.
    if (row.rule.lifecycleStatus !== "published") {
      throw new BadRequestException(
        `Rule ${row.rule.code} is ${row.rule.lifecycleStatus}, not published, so it cannot be ` +
          "re-applied — re-apply arms a rule the template completes, and only a published rule " +
          "may be armed. Restore it to published first. Nothing was written.",
      );
    }
    const dto = this.toDto(row, current);
    if (!dto) {
      // Widened from the four provenance columns alone: `toDto` also returns
      // `null` when the rule's OWN columns fail `seededRuleValuesSchema` — an
      // operator, severity, category or name outside the values contract — and
      // the narrower sentence sent a reader to inspect four columns that are
      // all intact.
      throw new ConflictException(
        `Rule ${row.rule.code} has no drift verdict, so it cannot be re-applied. Either its ` +
          "template provenance is incomplete (one of source_template_id, " +
          "source_template_version, source_alarm_code or seeded_baseline is missing or " +
          "unreadable), or its own operator, threshold_value, severity, category and name no " +
          "longer read as the seeded-rule values contract. Nothing was written.",
      );
    }
    // One lookup for three questions. `alarm === undefined` and
    // `dto.current === null` are the same fact — `toDto` derives `current` from
    // this very entry — and pairing them here is what narrows both for the two
    // refusals below.
    const alarm = current.alarmsByCode.get(dto.sourceAlarmCode);
    if (alarm === undefined || dto.current === null) {
      throw new BadRequestException(
        `Rule ${row.rule.code} was seeded from alarm "${dto.sourceAlarmCode}", which ` +
          `${template.code} v${current.version} no longer carries; there is nothing to re-apply ` +
          "it from. Nothing was written.",
      );
    }
    // Owner ruling of 2026-09-07, over what ADR 0058 names. A v1 proto-rule
    // seeds an ARMED rule; if v2 restates the same alarm code as a philosophy
    // row, `templateAlarmSchema` permits it and re-apply would write
    // `operator: null, threshold_value: null` while the `armed` filter skips
    // the enable-write — leaving `enabled = true` with a null operator. That
    // rule reads as armed in every list and is dropped by the alarm engine's
    // own filter, with `driftVerdict` reporting `in_sync` because all three
    // sides then agree; and the toggle cannot repair it, because
    // `assertArmable` refuses to re-enable a rule with no limit. Refusing keeps
    // the rule watching at the limit it was commissioned with, so a plant does
    // not silently lose an alarm because someone edited a template.
    //
    // Not conditioned on `enabled`: clearing a disabled rule's commissioned
    // limit destroys the same value, and `assertArmable` then blocks the toggle
    // that would put it back. A philosophy row re-applied from a philosophy row
    // writes null over null and is untouched by this.
    if (
      dto.current.operator === null &&
      dto.current.thresholdValue === null &&
      (dto.live.operator !== null || dto.live.thresholdValue !== null)
    ) {
      throw new BadRequestException(
        `Rule ${row.rule.code} holds a limit (${dto.live.operator ?? "none"} ` +
          `${dto.live.thresholdValue ?? "none"}) and ${template.code} v${current.version} now ` +
          `states alarm "${dto.sourceAlarmCode}" as a philosophy row with no operator and no ` +
          "threshold value. Re-applying would clear the limit without disabling the rule, " +
          "leaving a rule that reads as armed and evaluates nothing. Edit the rule directly, or " +
          "publish a version that carries a limit. Nothing was written.",
      );
    }
    // The second owner ruling of the same day. Re-apply moves decision 5's five
    // fields and never `point_key`, so an alarm that keeps its code and changes
    // its point would put the new point's limit on the old point's rule — and
    // the list would then read `in_sync`. Writing v2's point instead was
    // considered and refused: the asset was instantiated from an earlier
    // version and may hold no `asset_points` row for the new key, so the rule
    // would bind to a point the asset does not have.
    if (alarm.pointKey !== row.rule.pointKey) {
      throw new BadRequestException(
        `Rule ${row.rule.code} watches point "${row.rule.pointKey ?? "(none)"}" and ` +
          `${template.code} v${current.version} now binds alarm "${dto.sourceAlarmCode}" to ` +
          `point "${alarm.pointKey}". Re-applying would set that alarm's limit against a ` +
          "different measurement. Re-apply does not move a rule between points — this asset was " +
          "built from an earlier version and may carry no point of that key. Create the rule on " +
          "the new point instead. Nothing was written.",
      );
    }
    return { row, dto, values: dto.current };
  }
}
