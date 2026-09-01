import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";

import { dashboardTemplates } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { DashboardTemplateDto, JwtPayload, StockDashboardTemplateDto } from "@bms/shared";

import { TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import { MasterDataAuditService } from "../master-data-audit.service";
import { DashboardTemplatesService } from "./dashboard-templates.service";
import { STOCK_DASHBOARD_TEMPLATE_CATALOG } from "./stock-catalog";

/**
 * The stock catalog surface — `F3.36` Part E2, ADR 0049 decision 3.
 *
 * Two operations: **list** what the repository ships, and **import** one entry
 * into a real `bms.dashboard_templates` row the organization then owns and edits
 * freely.
 *
 * ---
 *
 * **THE IMPORT COPIES FROM THE REPOSITORY, NEVER FROM A PEER ORGANIZATION.**
 *
 * ADR 0049 decision 3 states the property this exists to provide, and states it
 * *because* it is easy to lose: *"A plant onboarded later receives the stock
 * current at its import, not whatever the first customer edited — that is the
 * property the stock catalog exists to provide, and it is stated here so it is
 * not lost to an implementation that copies from a peer organization instead."*
 *
 * The obvious wrong implementation is not a silly one. Copying an existing row
 * of the same `code` is a smaller query, needs no catalog import, and produces a
 * plausible result — right up until the first customer edits their Electrical
 * template and every plant onboarded afterwards inherits *their* edits. The test
 * that catches it is one that mutates a peer organization's row and asserts the
 * import still produces the **catalog's** content, which is why that assertion
 * exists rather than a happy-path "the content looks about right".
 *
 * **Seeding six rows per organization was declined** for the mirror-image
 * reason: improving a default would then reach only organizations provisioned
 * afterwards, and the seed and the defaults would drift apart.
 */
@Injectable()
export class DashboardTemplatesStockService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly templates: DashboardTemplatesService,
    private readonly audit: MasterDataAuditService,
  ) {}

  /** What the repository ships. Reads no database — this is code. */
  list(): { items: StockDashboardTemplateDto[] } {
    return { items: [...STOCK_DASHBOARD_TEMPLATE_CATALOG] };
  }

  /**
   * Import one stock entry into an organization.
   *
   * Lands as a **draft**, so the organization edits and publishes on its own
   * schedule — an imported template that arrived published would put six
   * dashboards' worth of canvas into production without anyone reading them.
   *
   * Re-importing an existing code opens the **next version** rather than
   * failing on `dashboard_templates_org_code_version_unique`: taking a newer
   * stock release is a legitimate act, and it is the same version bump editing a
   * published template performs. The partial draft index still refuses a second
   * concurrent import, which is the behaviour that matters.
   */
  async import(
    jwt: JwtPayload,
    code: string,
    organizationId: string,
  ): Promise<DashboardTemplateDto> {
    await this.templates.assertCanAuthor(jwt, organizationId);

    const entry = STOCK_DASHBOARD_TEMPLATE_CATALOG.find((candidate) => candidate.code === code);
    if (!entry) {
      throw new BadRequestException(
        `Unknown stock template "${code}". Available: ${STOCK_DASHBOARD_TEMPLATE_CATALOG.map(
          (candidate) => candidate.code,
        ).join(", ")}`,
      );
    }
    // The section must exist in the live vocabulary. It always does for a
    // shipped entry — `stock-catalog.spec.ts` checks every one against migration
    // `0056`'s seeded set — but the check is here rather than assumed, because
    // the failure mode of a missing section is a foreign-key 500.
    await this.templates.assertSection(entry.section);

    const created = await withTenant(this.tenantDb, organizationId, async (tx) => {
      const [{ next } = { next: 1 }] = await tx
        .select({ next: sql<number>`COALESCE(MAX(${dashboardTemplates.version}), 0)::int + 1` })
        .from(dashboardTemplates)
        .where(
          and(
            eq(dashboardTemplates.organizationId, organizationId),
            eq(dashboardTemplates.code, entry.code),
          ),
        );

      const [row] = await tx
        .insert(dashboardTemplates)
        .values({
          organizationId,
          code: entry.code,
          version: next,
          name: entry.name,
          section: entry.section,
          description: entry.description,
          status: "draft",
          // From the catalog module. Never from another organization's row —
          // see the class docblock.
          content: entry.content,
          stockCode: entry.code,
          stockVersion: entry.stockVersion,
        })
        .returning();
      if (!row) {
        throw new ConflictException("A draft of this template already exists");
      }

      await this.audit.write(
        {
          actor: jwt,
          organizationId,
          action: "import",
          entityType: "dashboard_template",
          entityId: row.id,
          reason: `stock ${entry.code} v${entry.stockVersion}`,
        },
        tx,
      );
      return row;
    });

    return this.templates.map(created);
  }
}
