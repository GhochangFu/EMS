import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { automationRules } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload, RuleBatchBody, RuleListItem, RulesResponse } from "@bms/shared";

import { MasterDataAuditService, type AuditInput } from "../admin/master-data-audit.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import { assertArmable } from "./rule-arming";
import { applyExcludedRows, duplicateCodeRows } from "./rule-batch-rows";
import { nextRuleCode } from "./rule-codes";
import { mapRuleRow, previewRowFromValues } from "./rule-mapping";
import { resolveWriteOrg } from "./rule-org";
import { selectRuleRowById } from "./rule-reads";
import { RulesService } from "./rules.service";
import type { RuleDraftValues } from "./rules.types";

/** The refusal when the user unticks every row of the card. */
export const EVERY_ROW_EXCLUDED = "Every row is excluded; nothing to create";
/** The refusal when the kept rows' assets lie in more than one organization. */
export const ONE_ORGANIZATION_PER_BATCH = "All rules in a batch must be on one organization's assets";

/**
 * A row's refusal, prefixed with its 1-based number in the sent body. The
 * status is kept: the scope refusal stays a 404 with the route's own sentence
 * (the existence-oracle rule), a validation refusal stays a 400.
 */
function atRow(index: number, err: unknown): unknown {
  if (!(err instanceof HttpException)) return err;
  const message = `Row ${index + 1}: ${err.message}`;
  if (err.getStatus() === 404) return new NotFoundException(message);
  if (err.getStatus() === 400) return new BadRequestException(message);
  return new HttpException(message, err.getStatus());
}

/**
 * `F4.289` (ADR 0099 Amendment 9 E3) — `POST /rules/batch`: up to 25 alarm
 * rules on one organization's assets, created **and published** in one
 * transaction, all or none.
 *
 * A sibling of `RulesService`, not a method on it: that file sits against the
 * §4.5 cap. It reuses the service's `validateRuleDraft` (the one validator every
 * rule write funnels through) and the single-rule helpers, so a batch row is
 * refused for exactly what `POST /rules` and `/publish` would refuse it for.
 *
 * Every pre-write check runs before the transaction opens, in phases: the
 * duplicate codes, then every row's scope, then every row's organization, then
 * every row's validation. Each phase walks the rows in the sent order, and the
 * first refusal stops the batch with `Row N: <sentence>`. So a row 2 outside
 * the caller's scope is refused before a row 1 that would fail validation: the
 * scope phase runs first, as the existence-oracle rule needs.
 * The writes then run in one `withTenant(organization)`: each insert is already
 * published and enabled, and the audit trail is two rows per rule
 * (`rule_draft_create`, `rule_publish`, owner ruling P6) through the funnel in
 * the same transaction, so a confirmed copilot change marks every row
 * `via: "copilot"` and a failed audit write leaves no rule behind.
 */
@Injectable()
export class RulesBatchService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly rules: RulesService,
    @Inject(MasterDataAuditService) private readonly audit: MasterDataAuditService,
  ) {}

  /**
   * `assetIds` is the caller's readable asset set (`null` = unrestricted), as
   * `RulesService.createDraft` takes it: a row on an asset outside it is the
   * route's own `Rule not found`.
   */
  async createAndPublish(
    dto: RuleBatchBody,
    actor: Pick<JwtPayload, "sub" | "email">,
    assetIds?: string[] | null,
  ): Promise<RulesResponse> {
    const kept = applyExcludedRows(dto.rules, dto.excludedRows);
    if (kept.length === 0) throw new BadRequestException(EVERY_ROW_EXCLUDED);
    const duplicate = duplicateCodeRows(kept);
    if (duplicate !== null) {
      throw new BadRequestException(`Row ${duplicate[0] + 1} and row ${duplicate[1] + 1} carry the same code`);
    }

    for (const { index, rule } of kept) {
      if (assetIds !== null && assetIds !== undefined && (!rule.assetId || !assetIds.includes(rule.assetId))) {
        throw atRow(index, new NotFoundException("Rule not found"));
      }
    }

    // Every kept row's organization, compared with the first: a later row on
    // another organization would otherwise be inserted under this one's GUC,
    // stamped with this organization on that organization's asset.
    let organizationId: string | undefined;
    for (const { index, rule } of kept) {
      const org = await resolveWriteOrg(this.fleetDb, rule.assetId ?? null, rule.ruleType).catch((err: unknown) => {
        throw atRow(index, err);
      });
      if (organizationId === undefined) organizationId = org;
      else if (org !== organizationId) throw new BadRequestException(ONE_ORGANIZATION_PER_BATCH);
    }
    const orgId = organizationId as string;

    const validated: { index: number; name: string; values: RuleDraftValues }[] = [];
    const now = new Date();
    for (const { index, rule } of kept) {
      try {
        const values = await this.rules.validateRuleDraft(rule, undefined, orgId);
        assertArmable(previewRowFromValues(values, undefined, now));
        validated.push({ index, name: rule.name, values });
      } catch (err) {
        throw atRow(index, err);
      }
    }

    // Every explicit code is taken before any code is generated, so a generated
    // code never equals a later row's explicit one (two inserts on the
    // `(organization_id, code)` unique index would be a 500, not a row's 400).
    const taken = new Set(validated.flatMap(({ values }) => (values.code ? [values.code] : [])));
    const coded: { name: string; code: string; values: RuleDraftValues }[] = [];
    for (const { name, values } of validated) {
      const code = values.code ?? (await nextRuleCode(this.fleetDb, { organizationId: orgId, seed: name, exclude: taken }));
      taken.add(code);
      coded.push({ name, code, values });
    }

    const items = await withTenant(this.db, orgId, async (tx) => {
      const ids: string[] = [];
      for (const { code, values } of coded) {
        const [row] = await tx
          .insert(automationRules)
          .values({
            ...values,
            organizationId: orgId,
            code,
            source: "operator_rule",
            enabled: true,
            lifecycleStatus: "published",
            publishedAt: now,
            archivedAt: null,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: automationRules.id });
        if (!row) throw new BadRequestException("Could not create rule");
        ids.push(row.id);
      }

      const audits: AuditInput[] = coded.flatMap(({ name, code }, i) => {
        const base = {
          actor,
          organizationId: orgId,
          entityType: "automation_rule",
          entityId: ids[i] as string,
          payload: { code, name, batchSize: coded.length, oidcSubject: actor.sub, actorEmail: actor.email },
        };
        return [
          { ...base, action: "rule_draft_create", reason: "Rule created in a batch" },
          { ...base, action: "rule_publish", reason: "Rule published in a batch" },
        ];
      });
      await this.audit.writeMany(audits, tx);

      const read: RuleListItem[] = [];
      for (const id of ids) {
        const row = await selectRuleRowById(tx, id);
        if (!row) throw new NotFoundException("Rule not found");
        read.push(mapRuleRow(row));
      }
      return read;
    });

    return { items };
  }
}
