import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  alarmSeverities,
  alarmSkills,
  assetDomains,
  assetRoles,
  dashboardSections,
  ruleCategories,
} from "@bms/db";
import { asc, eq } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import type {
  AlarmSeverityDto,
  AlarmSkillDto,
  AssetDomainDto,
  AssetRoleDto,
  DashboardSectionDto,
  RuleCategoryDto,
  VocabulariesResponse,
} from "@bms/shared";

import { MAX_ECHOED_CELL_CHARS } from "../admin/spreadsheet-guard";
import { TENANT_DRIZZLE } from "../database/database.tokens";

/**
 * Six open vocabularies — rule concerns and plant domains (ADR 0031
 * Amendment 1), alarm severity (ADR 0032), alarm skill (ADR 0034), and the
 * asset role a group membership plays (ADR 0049 decision 5, `F3.37`), and the
 * dashboard section a template belongs to (ADR 0049 Amendment 2 decision 5,
 * `F3.36`).
 *
 * **Why this service exists at all.** Both vocabularies used to be `z.enum`s, so
 * a bad value was rejected by the request schema with a clear 400 naming the
 * field. Now that they are rows in `bms.rule_categories` and
 * `bms.asset_domains`, the request schema can only check *shape* — a non-empty
 * string — and the foreign key is what actually closes the set. Without a check
 * in between, an unknown code would reach Postgres and come back as a
 * constraint violation, i.e. a **500 where there used to be a 400**.
 *
 * That is the whole job here: keep the boundary honest now that the vocabulary
 * moved out of the boundary.
 *
 * Reads are uncached deliberately. These tables are tiny (four to twenty-six
 * rows), the queries are primary-key or full scans of a handful of rows, and a
 * cache would mean a newly seeded domain pack stayed invisible until a restart
 * — which is exactly the friction this design exists to remove.
 */
@Injectable()
export class VocabulariesService {
  constructor(@Inject(TENANT_DRIZZLE) private readonly db: BmsDb) {}

  /**
   * Both axes in one response.
   *
   * Inactive rows are excluded: `active = false` is how a value is retired,
   * because deleting one that plant still references must fail (the foreign
   * keys carry no `ON DELETE` clause, by design). A retired value therefore
   * stops being offered for new work while existing rows keep resolving.
   */
  async list(): Promise<VocabulariesResponse> {
    const [categories, domains, severities, skills, roles, sections] = await Promise.all([
      this.db
        .select({
          code: ruleCategories.code,
          label: ruleCategories.label,
          tone: ruleCategories.tone,
          sortOrder: ruleCategories.sortOrder,
          active: ruleCategories.active,
        })
        .from(ruleCategories)
        .where(eq(ruleCategories.active, true))
        .orderBy(asc(ruleCategories.sortOrder), asc(ruleCategories.code)),
      this.db
        .select({
          code: assetDomains.code,
          label: assetDomains.label,
          sortOrder: assetDomains.sortOrder,
          active: assetDomains.active,
        })
        .from(assetDomains)
        .where(eq(assetDomains.active, true))
        .orderBy(asc(assetDomains.sortOrder), asc(assetDomains.code)),
      // ADR 0032. Ordered by `rank`, not by a separate sort column — for
      // severity the display order *is* the urgency order, and two columns
      // would let them disagree.
      this.db
        .select({
          code: alarmSeverities.code,
          label: alarmSeverities.label,
          tone: alarmSeverities.tone,
          rank: alarmSeverities.rank,
          active: alarmSeverities.active,
        })
        .from(alarmSeverities)
        .where(eq(alarmSeverities.active, true))
        .orderBy(asc(alarmSeverities.rank)),
      // ADR 0034: no urgency, so ordered by sortOrder like assetDomains, not
      // by a rank column the way severity is.
      this.db
        .select({
          code: alarmSkills.code,
          label: alarmSkills.label,
          sortOrder: alarmSkills.sortOrder,
          active: alarmSkills.active,
        })
        .from(alarmSkills)
        .where(eq(alarmSkills.active, true))
        .orderBy(asc(alarmSkills.sortOrder), asc(alarmSkills.code)),
      // ADR 0049 decision 5: ordered by sortOrder like assetDomains and
      // alarmSkills, not by a rank column — a role carries no urgency. The
      // seeded sortOrder is banded per train (Electrical 110-160, Water
      // 210-250, STP 310-360, ETP 410-440, HVAC 510-550), which is what groups
      // a picker. That banding is a convention and not a gate: the lookup
      // table carries no `domain` column, ruled at the F3.37 plan gate because
      // a foreign key to `bms.asset_domains` would have forced `stp` and `etp`
      // rows into the vocabulary every asset's plant domain reads.
      this.db
        .select({
          code: assetRoles.code,
          label: assetRoles.label,
          sortOrder: assetRoles.sortOrder,
          active: assetRoles.active,
        })
        .from(assetRoles)
        .where(eq(assetRoles.active, true))
        .orderBy(asc(assetRoles.sortOrder), asc(assetRoles.code)),
      // ADR 0049 Amendment 2 decision 5 (`F3.36`): the sixth global vocabulary,
      // ordered by sortOrder like assetDomains, alarmSkills and assetRoles — a
      // section carries no urgency, so no rank column.
      //
      // Served HERE and not from the dashboard-template endpoint, because a
      // section picker fed from somewhere else would be the one vocabulary a
      // reader has to go looking for — and `F4.43`'s failure, a hardcoded list
      // that falls behind and silently renders the wrong option, starts with
      // exactly that inconvenience.
      this.db
        .select({
          code: dashboardSections.code,
          label: dashboardSections.label,
          description: dashboardSections.description,
          sortOrder: dashboardSections.sortOrder,
          active: dashboardSections.active,
        })
        .from(dashboardSections)
        .where(eq(dashboardSections.active, true))
        .orderBy(asc(dashboardSections.sortOrder), asc(dashboardSections.code)),
    ]);

    return {
      // `tone` is narrowed rather than parsed: `rule_categories_tone_check`
      // bounds it in the database, and ADR 0030's response validator is what
      // would report a disagreement — the same division of labour every other
      // column here uses.
      ruleCategories: categories as RuleCategoryDto[],
      assetDomains: domains as AssetDomainDto[],
      alarmSeverities: severities as AlarmSeverityDto[],
      alarmSkills: skills as AlarmSkillDto[],
      assetRoles: roles as AssetRoleDto[],
      dashboardSections: sections as DashboardSectionDto[],
    };
  }

  /**
   * Rejects a plant domain that is not a live vocabulary row.
   *
   * Checks `active` too, not merely existence: offering a retired domain on a
   * form and then accepting it by a different route would make retirement
   * meaningless.
   */
  async assertAssetDomain(code: string): Promise<void> {
    const [row] = await this.db
      .select({ active: assetDomains.active })
      .from(assetDomains)
      .where(eq(assetDomains.code, code))
      .limit(1);

    if (!row || !row.active) {
      throw new BadRequestException(await this.unknownCodeMessage("domain", code));
    }
  }

  /** Rejects a rule concern that is not a live vocabulary row. */
  async assertRuleCategory(code: string): Promise<void> {
    const [row] = await this.db
      .select({ active: ruleCategories.active })
      .from(ruleCategories)
      .where(eq(ruleCategories.code, code))
      .limit(1);

    if (!row || !row.active) {
      throw new BadRequestException(await this.unknownCodeMessage("category", code));
    }
  }

  /**
   * Rejects an alarm severity that is not a live vocabulary row (ADR 0032).
   *
   * Reachable because `automationRuleSeveritySchema` stopped being a `z.enum`
   * when the vocabulary became data. Without this the unknown code would travel
   * to Postgres and return as `alarms_severity_fk` /
   * `automation_rules_severity_fk` — a 500 where there used to be a 400.
   */
  async assertAlarmSeverity(code: string): Promise<void> {
    const [row] = await this.db
      .select({ active: alarmSeverities.active })
      .from(alarmSeverities)
      .where(eq(alarmSeverities.code, code))
      .limit(1);

    if (!row || !row.active) {
      throw new BadRequestException(await this.unknownCodeMessage("severity", code));
    }
  }

  /**
   * Rejects an alarm skill/trade that is not a live vocabulary row (ADR
   * 0034). Same shape as `assertAlarmSeverity` — without this, an unknown
   * code would travel to Postgres and return as
   * `alarm_enrichments_skill_code_fkey`, a 500 where there should be a 400.
   */
  async assertAlarmSkill(code: string): Promise<void> {
    const [row] = await this.db
      .select({ active: alarmSkills.active })
      .from(alarmSkills)
      .where(eq(alarmSkills.code, code))
      .limit(1);

    if (!row || !row.active) {
      throw new BadRequestException(await this.unknownCodeMessage("skill", code));
    }
  }

  /**
   * Rejects an asset role that is not a live vocabulary row (ADR 0049
   * decision 5). Same shape as the four above — without this an unknown code
   * would travel to Postgres and return as `asset_group_members_role_fkey`, a
   * 500 where there should be a 400.
   *
   * `assetRoleCodeSchema` is a `z.string()` and not a `z.enum` on purpose, so
   * the request schema checks shape only and this is the whole boundary.
   */
  async assertAssetRole(code: string): Promise<void> {
    const [row] = await this.db
      .select({ active: assetRoles.active })
      .from(assetRoles)
      .where(eq(assetRoles.code, code))
      .limit(1);

    if (!row || !row.active) {
      throw new BadRequestException(await this.unknownCodeMessage("role", code));
    }
  }

  /**
   * Names the valid values back to the caller.
   *
   * The enum did this for free — a Zod `invalid_enum_value` lists its options —
   * and losing it would be a real regression for anyone filling in a form or an
   * import sheet. Costs one extra query on the failure path only.
   */
  private async unknownCodeMessage(
    field: "domain" | "category" | "severity" | "skill" | "role",
    code: string,
  ): Promise<string> {
    // A lookup rather than the nested ternary this was until `F3.37`. Four
    // arms were already at the edge of readable; the fifth made it five deep,
    // and a sixth vocabulary is not hypothetical — ADR 0031 Amendment 1
    // schedules three domain packs. The four existing messages are unchanged
    // byte for byte, which `assertAlarmSkillRejectsUnknownCode` and its three
    // siblings are the gate on.
    const liveCodes: Record<typeof field, () => Promise<{ code: string }[]>> = {
      domain: () =>
        this.db
          .select({ code: assetDomains.code })
          .from(assetDomains)
          .where(eq(assetDomains.active, true))
          .orderBy(asc(assetDomains.sortOrder)),
      category: () =>
        this.db
          .select({ code: ruleCategories.code })
          .from(ruleCategories)
          .where(eq(ruleCategories.active, true))
          .orderBy(asc(ruleCategories.sortOrder)),
      // Ordered by `rank`, not `sortOrder` — for severity the display order
      // *is* the urgency order, and `alarm_severities` has no sort column.
      severity: () =>
        this.db
          .select({ code: alarmSeverities.code })
          .from(alarmSeverities)
          .where(eq(alarmSeverities.active, true))
          .orderBy(asc(alarmSeverities.rank)),
      skill: () =>
        this.db
          .select({ code: alarmSkills.code })
          .from(alarmSkills)
          .where(eq(alarmSkills.active, true))
          .orderBy(asc(alarmSkills.sortOrder)),
      role: () =>
        this.db
          .select({ code: assetRoles.code })
          .from(assetRoles)
          .where(eq(assetRoles.active, true))
          .orderBy(asc(assetRoles.sortOrder)),
    };

    const available = await liveCodes[field]();

    // The rejected code is echoed so the caller can see what was wrong with
    // their input — but it is caller-supplied text, and Nest logs 4xx messages.
    // Stripping control characters closes the log-injection line break (§4.3).
    //
    // **`F4.104` — the length is cut here, and the sentence this replaces said
    // it did not need to be.** It read "the length is already bounded at 64 by
    // the request schema", and that named a mechanism that holds for some
    // callers and not others. Ten call sites reach this method, in seven files,
    // and every one of them *does* arrive bounded at 64 — so no unbounded value
    // was ever echoed — but by four separate routes:
    //
    // - **A request body schema**, on `assets.service.ts:146`/`:227`,
    //   `asset-templates.service.ts:193`/`:279`,
    //   `alarm-enrichment.service.ts:76` and `asset-groups.service.ts:196`.
    //   `rules.service.ts:866`/`:877` reach it this way too from `createRule`
    //   (`:163`) and `previewRule` (`:265`), but not from every path — see the
    //   fourth route.
    // - **A schema re-applied to a row already stored**, which is not a request
    //   schema and is not on the request at all. `onboarding-commit.service.ts`
    //   `:181` is reached from `POST sessions/:id/commit`, a route that takes no
    //   `@Body()`: what bounds `domain` is `onboardingDraftSchema`, run over the
    //   *stored* draft by `OnboardingValidateService.validate` three statements
    //   earlier, whose `readyToCommit` is false for an over-long code so the
    //   call is never made. (`F4.104` added a second, earlier guard at the
    //   workbook parse site, because that producer writes the draft without
    //   parsing anything.) `DashboardTemplatesService.publish` is the same
    //   shape. `F4.108` changed how it is spelled: it used to read
    //   `sectionTemplateContentSchema.parse(template.content)` and now reads
    //   `parseStoredContract(sectionTemplateContentSchema, template.content,
    //   "dashboard_templates.publish.content")`, because ADR 0060 ruling 2
    //   routes every parse of a stored row through an explicit 500 rather than
    //   letting the global `ZodErrorFilter` report the server's own corrupt row
    //   as the caller's 400. What bounds `domain` there is unchanged — it is
    //   still the schema re-applied to a row already stored — so this route
    //   holds exactly as before; only the failure *type* moved. Named by method
    //   rather than by line, which the `F4.108` scanner learned the hard way.
    // - **A parse of in-repo catalog source.** The stock import hands
    //   `AssetTemplatesService.create` the OUTPUT of
    //   `createAssetTemplateBodySchema.parse`, never the raw entry
    //   (`asset-templates-stock.service.ts:184`).
    // - **A column width and a foreign key, with no schema anywhere.**
    //   `publishRule` (`rules.service.ts:364`) hands `validateRuleDraft` the
    //   output of `ruleBodyFromRow(current)`, which reads `row.category` and
    //   `row.severity` off the stored row and **casts** them
    //   (`rule-mapping.ts:146`, `:156`). `updateRule` (`:224`) is the mixed
    //   case: `mergeRuleDraft` takes each field from the patch when it is
    //   present and from the row otherwise. What bounds those is
    //   `automation_rules.category` / `.severity` being `varchar(64)`
    //   (`packages/db/src/schema/alarms-schema.ts:196`, `:212`) — the same 64,
    //   arrived at by a mechanism no schema participates in.
    //
    // What actually holds all four is that the five vocabulary code schemas in
    // `packages/shared/src/contracts/operations.ts` are each
    // `z.string().min(1).max(64)`, and that the columns they are written to were
    // widened to match (ADR 0032's note on `alarms-schema.ts:60-64` is the
    // reasoning). That is a property of every caller today, not of this method,
    // and a caller added tomorrow inherits none of it — which is exactly the
    // assumption the old sentence made and could not keep. So the cut below
    // removes the dependency instead of restating it.
    //
    // `MAX_ECHOED_CELL_CHARS` is the same 64 `quoteCell` applies to sheet text,
    // imported rather than restated. `quoteCell` itself is deliberately *not*
    // used: it wraps in single quotes and this message uses double, and
    // `asset-templates-stock.integration.spec.ts:317` reads that punctuation.
    //
    // The cut runs after the strip, so it bounds the string that is actually
    // interpolated. Every code any assertion in this repo names is far under the
    // bound, so all four of them — `asset-templates-stock.integration.spec.ts`
    // `:317` and `:321`, and `vocabularies.service.integration.spec.ts:85` and
    // `:197` — read the same bytes they always did.
    const safe = code.replace(/[^\x20-\x7e]/g, "");
    const shown =
      safe.length > MAX_ECHOED_CELL_CHARS ? `${safe.slice(0, MAX_ECHOED_CELL_CHARS)}…` : safe;

    return `${field} "${shown}" is not a live value. Expected one of: ${available
      .map((row) => row.code)
      .join(", ")}.`;
  }
}
