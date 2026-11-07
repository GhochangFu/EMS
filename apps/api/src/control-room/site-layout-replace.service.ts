import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, sql } from "drizzle-orm";

import { assetGroups, auditLog, dashboards, dashboardTabs, dashboardTemplates, users } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { siteLayoutReplaceSkipReasonSchema } from "@bms/shared";
import type {
  JwtPayload,
  SiteLayoutBulkReplaceResultDto,
  SiteLayoutChoice,
  SiteLayoutCopyEdits,
  SiteLayoutHeldCopy,
  SiteLayoutReplacePreviewDto,
  SiteLayoutReplacePreviewSite,
  SiteLayoutReplaceResultDto,
  SiteLayoutReplaceSkipReason,
  SiteLayoutResultDto,
} from "@bms/shared";

import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { type BmsTx, withTenant } from "../database/tenant-context";
import { carriedTabGroups, replaceOutcome } from "./site-layout-replace.pure";
import { SITE_COPY_OTHER_TEMPLATE_MESSAGE, SITE_HAS_NO_COPY_MESSAGE } from "./site-layout.schema";
import {
  mutableAmbiguous,
  type ReplacedCopy,
  SiteLayoutConflict,
  SiteLayoutService,
  type SiteRow,
  type SiteTemplate,
} from "./site-layout.service";

/**
 * `F4.320` PR 2 (ADR 0087 Amendment 4) — "Replace with this version", per site
 * (`POST /admin/locations/:id/site-layout/replace`) and in bulk
 * (`POST /admin/dashboard-templates/:id/replace-site-layouts`), and the two preview reads
 * (`GET …/site-layout/replace-preview`, `GET …/replace-site-layouts/preview`).
 *
 * `F4.336` moved this half out of `SiteLayoutService` for AGENTS.md §4.5's 1000-line cap, with no
 * change of behaviour. It owns no copy logic of its own: the permission rules, the template reads,
 * the per-site locked transaction (`inSiteTransaction`) and the make path (`makeInTransaction`)
 * stay on `SiteLayoutService`, which this provider injects. A Replace is still the copy's delete
 * and the make path re-pointing the same view row, in the one locked transaction.
 */

/**
 * A bulk Replace skip whose message no caller reads (the bulk answer carries the reason only). Per
 * site the same version is allowed, so this sentence never reaches a 409 body.
 */
const SAME_VERSION_SKIP_MESSAGE = "This site's copy already holds this version";

/** The bulk-only `newer_version` skip (owner ruling 2026-11-07): never a 409 body either. */
const NEWER_VERSION_SKIP_MESSAGE = "This site's copy holds a newer version than this template";

function isReplaceSkip(reason: string): reason is SiteLayoutReplaceSkipReason {
  return (siteLayoutReplaceSkipReasonSchema.options as readonly string[]).includes(reason);
}

/** Who may see the newest edit's actor (decision 9): the roles `AuditService` serves. */
function readsAuditActors(role: string): boolean {
  return role === "admin" || role === "organization_admin";
}

@Injectable()
export class SiteLayoutReplaceService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly siteLayout: SiteLayoutService,
  ) {}

  /**
   * `F4.320` PR 2 (ADR 0087 Amendment 4 decisions 2–5, 10) — "Replace with this version" on one
   * site: delete the site's template copy and make it again, in one transaction after the Make
   * lock. The Make permission rule. `templateId` absent means the newest published version of the
   * copy's own template code (decision 5: Replace never crosses codes). The same version is
   * allowed: an explicit rebuild that discards the copy's edits.
   */
  async replaceForSite(
    jwt: JwtPayload,
    input: { locationId: string; templateId?: string; tabGroups?: SiteLayoutChoice },
  ): Promise<SiteLayoutReplaceResultDto> {
    const { user, site } = await this.siteLayout.authorizeSite(jwt, input.locationId);
    const named =
      input.templateId === undefined
        ? null
        : this.siteLayout.checkedTemplate(await this.siteLayout.readTemplate(input.templateId, site.organizationId));
    const updatedBy = await this.siteLayout.provisionedUserId(user.id);
    return this.siteLayout.inSiteTransaction(site, (tx) =>
      this.replaceInTransaction(
        tx,
        jwt,
        site,
        async (held) =>
          named ?? (await this.siteLayout.newestPublishedSiteTemplate(site.organizationId, held.templateCode)),
        "site",
        input.tabGroups ?? {},
        updatedBy,
      ),
    );
  }

  /**
   * `F4.320` PR 2 (decisions 5, 10) — "Replace existing copies": every active site whose copy is
   * of this template's code at an older version (owner ruling 2026-11-07), one transaction each. The bulk Make rule
   * (organization admin or `admin`). A skip is reported, never raised; a site replaced stays
   * replaced when a later one is skipped.
   */
  async replaceForOrganization(jwt: JwtPayload, templateId: string): Promise<SiteLayoutBulkReplaceResultDto> {
    const { user, template } = await this.siteLayout.authorizeBulk(jwt, templateId);
    const sites = await this.siteLayout.activeSites(template.organizationId);

    const updatedBy = await this.siteLayout.provisionedUserId(user.id);
    const replaced: SiteLayoutReplaceResultDto[] = [];
    const skipped: SiteLayoutBulkReplaceResultDto["skipped"] = [];
    for (const site of sites) {
      try {
        replaced.push(
          await this.siteLayout.inSiteTransaction(site, (tx) =>
            this.replaceInTransaction(tx, jwt, site, async () => template, "bulk", {}, updatedBy),
          ),
        );
      } catch (err) {
        const reason = err instanceof SiteLayoutConflict ? (err.reason === "has_view" ? "no_copy" : err.reason) : null;
        if (!(err instanceof SiteLayoutConflict) || reason === null || !isReplaceSkip(reason)) {
          throw err;
        }
        skipped.push({
          locationId: site.id,
          reason,
          ...(err.ambiguous !== undefined ? { ambiguous: mutableAmbiguous(err.ambiguous) } : {}),
        });
      }
    }
    return { replaced, skipped };
  }

  /**
   * `F4.320` PR 2 (decisions 8, 9) — the per-site confirm step's read: the version Replace would
   * copy, the copy held, the outcome and the edit flag. The Make permission rule, as the Replace
   * it previews. Writes nothing.
   */
  async previewReplaceForSite(jwt: JwtPayload, locationId: string): Promise<SiteLayoutReplacePreviewDto> {
    const { user, site } = await this.siteLayout.authorizeSite(jwt, locationId);
    return withTenant(this.tenantDb, site.organizationId, async (tx) => {
      const held = await this.readHeldCopy(tx, site.id);
      // With no copy, the version Make would use (the outcome is `no_copy` whichever it is).
      const template = await this.siteLayout.newestPublishedSiteTemplate(site.organizationId, held?.templateCode);
      const row = await this.previewSite(tx, user.role, site, held, template, "site");
      return { templateId: template.id, templateCode: template.code, version: template.version, sites: [row] };
    });
  }

  /**
   * `F4.320` PR 2 (decisions 8, 9) — the apply-to-sites dialog's read before "Replace existing
   * copies": every active site of the template's organization, by name, with its held version,
   * its edit flag and what the bulk Replace would do. The bulk permission rule. Writes nothing.
   */
  async previewReplaceForOrganization(jwt: JwtPayload, templateId: string): Promise<SiteLayoutReplacePreviewDto> {
    const { user, template } = await this.siteLayout.authorizeBulk(jwt, templateId);
    const sites = await this.siteLayout.activeSites(template.organizationId);
    return withTenant(this.tenantDb, template.organizationId, async (tx) => {
      const rows: SiteLayoutReplacePreviewSite[] = [];
      for (const site of sites) {
        rows.push(await this.previewSite(tx, user.role, site, await this.readHeldCopy(tx, site.id), template, "bulk"));
      }
      return { templateId: template.id, templateCode: template.code, version: template.version, sites: rows };
    });
  }

  /**
   * `F4.320` PR 2 (decisions 2–4, 6) — Replace on the caller's transaction, after its lock. The
   * copy must be a template copy (else `no_copy`) of the same code (else `other_template`); in
   * bulk at an older version (else `same_version` or `newer_version`, owner ruling 2026-11-07).
   * The old tabs' groups are read, the copy's
   * dashboard is deleted (its tabs, widgets, points and sources cascade; a drawn mimic's
   * `mimic_layouts` row is owned by no widget and stays), and the view row, now the removed-copy
   * state by `ON DELETE SET NULL`, is re-pointed in place by the make path. Not
   * `DashboardsService.remove`: its operations-role gate is not the Make rule (Consequences).
   */
  private async replaceInTransaction(
    tx: BmsTx,
    jwt: JwtPayload,
    site: SiteRow,
    resolveTemplate: (held: SiteLayoutHeldCopy) => Promise<SiteTemplate>,
    mode: "site" | "bulk",
    choice: SiteLayoutChoice,
    updatedBy: string | null,
  ): Promise<SiteLayoutReplaceResultDto> {
    const held = await this.readHeldCopy(tx, site.id);
    if (held === null) {
      throw new SiteLayoutConflict("no_copy", SITE_HAS_NO_COPY_MESSAGE);
    }
    const template = await resolveTemplate(held);
    const outcome = replaceOutcome(held, template, mode);
    if (outcome === "other_template") {
      throw new SiteLayoutConflict("other_template", SITE_COPY_OTHER_TEMPLATE_MESSAGE);
    }
    if (outcome === "same_version") {
      throw new SiteLayoutConflict("same_version", SAME_VERSION_SKIP_MESSAGE);
    }
    if (outcome === "newer_version") {
      throw new SiteLayoutConflict("newer_version", NEWER_VERSION_SKIP_MESSAGE);
    }

    const oldTabs = await tx
      .select({ tabKey: dashboardTabs.tabKey, assetGroupId: dashboardTabs.assetGroupId })
      .from(dashboardTabs)
      .where(eq(dashboardTabs.dashboardId, held.dashboardId))
      .orderBy(asc(dashboardTabs.sortOrder), asc(dashboardTabs.tabKey));
    const deleted = await tx
      .delete(dashboards)
      .where(and(eq(dashboards.id, held.dashboardId), eq(dashboards.organizationId, site.organizationId)))
      .returning({ id: dashboards.id });
    if (deleted.length !== 1) {
      throw new SiteLayoutConflict("no_copy", SITE_HAS_NO_COPY_MESSAGE);
    }
    const groups = await tx
      .select({ id: assetGroups.id, domain: assetGroups.domain })
      .from(assetGroups)
      .where(and(eq(assetGroups.locationId, site.id), eq(assetGroups.organizationId, site.organizationId)));
    const carried = carriedTabGroups(template.content.tabs, oldTabs, groups, choice);

    const replaced: ReplacedCopy = {
      previousDashboardId: held.dashboardId,
      previousTemplateId: held.templateId,
      previousVersion: held.version,
    };
    let made: SiteLayoutResultDto;
    try {
      made = await this.siteLayout.makeInTransaction(tx, jwt, site, template, carried, updatedBy, replaced);
    } catch (err) {
      // The view row went live between the read and the delete (a view `PUT` takes no copy
      // lock): the site no longer holds the copy this Replace was for.
      if (err instanceof SiteLayoutConflict && err.reason === "has_view") {
        throw new SiteLayoutConflict("no_copy", SITE_HAS_NO_COPY_MESSAGE);
      }
      throw err;
    }
    return { ...made, templateId: template.id, version: template.version, ...replaced };
  }

  /**
   * The site's template copy (decision 2): a view row `kind = 'dashboard'` whose dashboard is at
   * this site and carries the stamp of a `target = 'site'` template. `null` for anything else — no
   * row, a builtin or generated view, a removed copy, a dashboard with no or another stamp.
   */
  private async readHeldCopy(tx: BmsTx, locationId: string): Promise<SiteLayoutHeldCopy | null> {
    const view = await this.siteLayout.viewRowFor(tx, locationId);
    if (view === null || view.kind !== "dashboard" || view.dashboardId === null) {
      return null;
    }
    const [row] = await tx
      .select({
        dashboardId: dashboards.id,
        templateId: dashboardTemplates.id,
        templateCode: dashboardTemplates.code,
        version: dashboardTemplates.version,
        target: dashboardTemplates.target,
      })
      .from(dashboards)
      .innerJoin(dashboardTemplates, eq(dashboardTemplates.id, dashboards.templateId))
      .where(and(eq(dashboards.id, view.dashboardId), eq(dashboards.locationId, locationId)))
      .limit(1);
    if (!row || row.target !== "site") {
      return null;
    }
    return { dashboardId: row.dashboardId, templateId: row.templateId, templateCode: row.templateCode, version: row.version };
  }

  /** One preview row: the held copy, the outcome and, for a copy, its edit flag. */
  private async previewSite(
    tx: BmsTx,
    role: string,
    site: SiteRow,
    held: SiteLayoutHeldCopy | null,
    template: SiteTemplate,
    mode: "site" | "bulk",
  ): Promise<SiteLayoutReplacePreviewSite> {
    return {
      locationId: site.id,
      locationName: site.name,
      held,
      outcome: replaceOutcome(held, template, mode),
      edits: held === null ? null : await this.copyEdits(tx, held.dashboardId, readsAuditActors(role)),
    };
  }

  /**
   * Decision 9 — the edit flag: the `entity_type = 'dashboard'` audit rows on the copy's
   * dashboard id (a builder save, a widget replace or append; the make row is on the location, so
   * a copy nobody touched counts none). Read from `bms.audit_log` on the tenant transaction, not
   * through `AuditService`, whose read scope refuses a `location_admin`. Only the count, the
   * newest time and — for an `admin` or `organization_admin` — the newest actor's email, the form
   * `AuditService` serves them; no payload leaves this read, so no `oidcSubject` either.
   */
  private async copyEdits(tx: BmsTx, dashboardId: string, withActor: boolean): Promise<SiteLayoutCopyEdits> {
    const onTheCopy = and(eq(auditLog.entityType, "dashboard"), eq(auditLog.entityId, dashboardId));
    const [counted] = await tx.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(onTheCopy);
    const [newest] = await tx
      .select({ createdAt: auditLog.createdAt, actorId: auditLog.actorId })
      .from(auditLog)
      .where(onTheCopy)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(1);
    const edits: SiteLayoutCopyEdits = {
      count: counted?.n ?? 0,
      lastEditedAt: newest === undefined ? null : newest.createdAt.toISOString(),
    };
    if (!withActor) {
      return edits;
    }
    return { ...edits, lastEditedBy: newest?.actorId == null ? null : await this.actorEmail(newest.actorId) };
  }

  /**
   * The actor's email, on `fleetDb`: `bms.users` is row-scoped to the GUC's organization for
   * `bms_tenant`, and a global admin's row has none, so the tenant transaction would read it as
   * absent. `AuditService` joins `users` on `fleetDb` for the same reason.
   */
  private async actorEmail(actorId: string): Promise<string | null> {
    const [row] = await this.fleetDb.select({ email: users.email }).from(users).where(eq(users.id, actorId)).limit(1);
    return row?.email ?? null;
  }
}
