import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { assetTemplates } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AssetInstantiationResultDto, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import type { BmsTx } from "../../database/tenant-context";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { AssetDashboardsInstantiateService } from "./asset-dashboards-instantiate.service";
import type { InstantiateAssetsBody } from "./asset-templates.schema";
import { instantiateTemplateCore } from "./asset-templates-instantiate-core";
import { translateAssetCodeCollision } from "./asset-templates-instantiate-guards";

/**
 * `F2.2` — building assets from a published template (ADR 0015 §6/§7 as
 * amended 2026-08-05).
 *
 * Split out of `AssetTemplatesAdminService` rather than added to it. That
 * service owns the *version lifecycle* — create, publish, archive, draft — and
 * was at 982 lines against AGENTS.md §4.5's 1000-line cap, with `F2.6` and
 * `F3.22` both queued against the same feature area. Instantiation is also the
 * only operation here that writes outside `asset_templates`/`template_points`,
 * so the seam is a real boundary and not just a size fix.
 */

/**
 * **`E2.4` / ADR 0058.** Instantiation used to write exactly two tables. It now
 * writes three: every `content.alarms[]` entry of the published version becomes
 * one `bms.automation_rules` row per created asset, inside the same
 * transaction, with `source = 'template_alarm'` and the four provenance columns
 * migration `0067` added. The row derivation itself is pure and lives in
 * `template-alarm-rules.ts`; `bms.rule_notifications` is deliberately **not**
 * written — decision 2 makes a seeded rule `review`, which raises an alarm and
 * pages nobody until someone joins a channel on purpose.
 *
 * **`F3.22` PR 1 / ADR 0091 decision 1.** The guards and the writes live in
 * `instantiateTemplateCore` (`asset-templates-instantiate-core.ts`), which reads
 * every guard through the transaction it is handed. This service is the door to
 * it: `instantiate` opens `withTenant` for the template's organization and runs
 * the core inside it; `instantiateInTransaction` runs the core on a transaction
 * the caller already holds (the onboarding commit, PR 2). E7.1b: `assets`,
 * `asset_points`, `template_points` and `automation_rules` are `FORCE`d tenant
 * tables, so every row stamps the template's organization — a single-org batch,
 * since the core refuses a target in a different organization.
 */
@Injectable()
export class AssetTemplateInstantiationService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
    // `E2.4`: the same service `AssetTemplatesAdminService` publishes through,
    // so "live" means one thing on both sides of a published version. Reads are
    // uncached by design there, which is what makes a retirement visible to the
    // very next instantiate rather than after a restart.
    private readonly vocabularies: VocabulariesService,
    // `F3.2` / ADR 0067 d4 — required; an optional adapter would be inert.
    private readonly assetDashboards: AssetDashboardsInstantiateService,
  ) {}

  /**
   * Builds assets from a published template — model-once-deploy-many.
   *
   * A thin wrapper: the master-data role check (today's first statement, so a
   * non-master-data caller with a bad id still gets the 403 before the 404),
   * the template's organization (the 404 for an unknown id), then the core in
   * one `withTenant` transaction. Every guard runs inside the core, before its
   * first insert; the transaction exists so that a race no guard pre-checked (a
   * concurrent create taking one of our codes) still leaves nothing behind.
   */
  async instantiate(
    jwt: JwtPayload,
    templateId: string,
    body: InstantiateAssetsBody,
  ): Promise<AssetInstantiationResultDto> {
    await this.accessControl.requireMasterDataUser(jwt);
    const organizationId = await this.templateOrganization(templateId);
    // `translateAssetCodeCollision` rewrites only a `23505` on
    // `assets_code_unique` / `automation_rules_org_code_idx`; a guard's own
    // refusal, and any other error, passes through unchanged.
    return withTenant(this.tenantDb, organizationId, (tx) =>
      this.instantiateInTransaction(tx, jwt, templateId, body),
    ).catch((err: unknown) => {
      throw translateAssetCodeCollision(err);
    });
  }

  /**
   * `F3.22` — the core on a transaction the caller already holds, opened by
   * `withTenant` for the template's organization. Rows written earlier in that
   * transaction are visible to every guard. The caller owns the
   * constraint-name translation (`translateAssetCodeCollision`).
   */
  instantiateInTransaction(
    tx: BmsTx,
    jwt: JwtPayload,
    templateId: string,
    body: InstantiateAssetsBody,
  ): Promise<AssetInstantiationResultDto> {
    return instantiateTemplateCore(
      {
        fleetDb: this.fleetDb,
        accessControl: this.accessControl,
        audit: this.audit,
        vocabularies: this.vocabularies,
        assetDashboards: this.assetDashboards,
      },
      tx,
      jwt,
      templateId,
      body,
    );
  }

  /**
   * The template's organization — the GUC `withTenant` needs — on `fleetDb`,
   * because the organization is what is not known yet. An organization lookup,
   * not a guard: the core re-reads the row on `tx` and holds every check.
   */
  private async templateOrganization(templateId: string): Promise<string> {
    const [row] = await this.fleetDb
      .select({ organizationId: assetTemplates.organizationId })
      .from(assetTemplates)
      .where(eq(assetTemplates.id, templateId))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Asset template not found");
    }
    return row.organizationId;
  }
}
