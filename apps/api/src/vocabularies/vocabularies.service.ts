import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { alarmSeverities, assetDomains, ruleCategories } from "@bms/db";
import { asc, eq } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import type {
  AlarmSeverityDto,
  AssetDomainDto,
  RuleCategoryDto,
  VocabulariesResponse,
} from "@bms/shared";

import { DRIZZLE } from "../database/database.tokens";

/**
 * The two open vocabularies — rule concerns and plant domains (ADR 0031
 * Amendment 1).
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
 * Reads are uncached deliberately. These tables are tiny (four and five rows),
 * the queries are primary-key or full scans of a handful of rows, and a cache
 * would mean a newly seeded domain pack stayed invisible until a restart —
 * which is exactly the friction this design exists to remove.
 */
@Injectable()
export class VocabulariesService {
  constructor(@Inject(DRIZZLE) private readonly db: BmsDb) {}

  /**
   * Both axes in one response.
   *
   * Inactive rows are excluded: `active = false` is how a value is retired,
   * because deleting one that plant still references must fail (the foreign
   * keys carry no `ON DELETE` clause, by design). A retired value therefore
   * stops being offered for new work while existing rows keep resolving.
   */
  async list(): Promise<VocabulariesResponse> {
    const [categories, domains, severities] = await Promise.all([
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
    ]);

    return {
      // `tone` is narrowed rather than parsed: `rule_categories_tone_check`
      // bounds it in the database, and ADR 0030's response validator is what
      // would report a disagreement — the same division of labour every other
      // column here uses.
      ruleCategories: categories as RuleCategoryDto[],
      assetDomains: domains as AssetDomainDto[],
      alarmSeverities: severities as AlarmSeverityDto[],
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
   * Names the valid values back to the caller.
   *
   * The enum did this for free — a Zod `invalid_enum_value` lists its options —
   * and losing it would be a real regression for anyone filling in a form or an
   * import sheet. Costs one extra query on the failure path only.
   */
  private async unknownCodeMessage(
    field: "domain" | "category" | "severity",
    code: string,
  ): Promise<string> {
    const available =
      field === "domain"
        ? await this.db
            .select({ code: assetDomains.code })
            .from(assetDomains)
            .where(eq(assetDomains.active, true))
            .orderBy(asc(assetDomains.sortOrder))
        : field === "category"
          ? await this.db
              .select({ code: ruleCategories.code })
              .from(ruleCategories)
              .where(eq(ruleCategories.active, true))
              .orderBy(asc(ruleCategories.sortOrder))
          : await this.db
              .select({ code: alarmSeverities.code })
              .from(alarmSeverities)
              .where(eq(alarmSeverities.active, true))
              .orderBy(asc(alarmSeverities.rank));

    // The rejected code is echoed so the caller can see what was wrong with
    // their input — but it is caller-supplied text, and Nest logs 4xx messages.
    // Stripping control characters closes the log-injection line break (§4.3);
    // the length is already bounded at 64 by the request schema.
    const safe = code.replace(/[^\x20-\x7e]/g, "");

    return `${field} "${safe}" is not a live value. Expected one of: ${available
      .map((row) => row.code)
      .join(", ")}.`;
  }
}
