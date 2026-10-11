import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import {
  assetGroups,
  assetPoints,
  assets,
  assetTemplates,
  type BmsDb,
  calcParameters,
  dashboards,
  dashboardTemplates,
  dashboardWidgets,
  locations,
  organizations,
  templatePoints,
} from "@bms/db";
import type { JwtPayload } from "@bms/shared";
import type { CatalogEntry, CatalogRef } from "@bms/shared/copilot";

import { AccessControlService } from "../auth/access-control.service";
import { TENANT_DRIZZLE } from "../database/database.tokens";
import { type BmsTx, withTenant } from "../database/tenant-context";

/** What a proposal's target resolved to. */
export type ResolvedTarget = {
  readonly organizationId: string;
  readonly organizationName: string;
  /** The row's name (a parameter's key, an asset's name), or the organization's name for a create. */
  readonly targetName: string;
  /** `dashboard` targets: the dashboard's widgets now (decision 4.9's summary). */
  readonly currentWidgetIds?: readonly string[];
  /** `asset` and `assetTemplate` targets: the point keys now, the refs a formula may name. */
  readonly pointKeys?: readonly string[];
  /** `assetTemplate` targets: the stored `content`, which a proposal's sections merge over (ruling Q10). */
  readonly currentContent?: Readonly<Record<string, unknown>>;
};

/** The resolver as the propose tools use it; specs pass a fake. */
export interface CopilotTargets {
  resolve(
    entry: CatalogEntry,
    params: Readonly<Record<string, string>>,
    body: Readonly<Record<string, unknown>>,
    allowedOrganizationIds: readonly string[],
    user: JwtPayload,
  ): Promise<ResolvedTarget | null>;
}

export const COPILOT_TARGETS = Symbol("COPILOT_TARGETS");

type Found = {
  organizationId: string;
  name: string;
  scope?: Scope;
  currentWidgetIds?: string[];
  pointKeys?: string[];
  currentContent?: Record<string, unknown>;
};
type Scope = { locationId: string | null; assetGroupId: string | null; assetId: string | null };

/**
 * `F3.85` PR 8 / ADR 0099 decision 10 (plan §10.2) — the organization and
 * name of a proposed change's target, from the catalog entry's declarative
 * `target` and `refs`.
 *
 * **Only inside the turn's allowed set.** A row named by id is looked for in
 * each allowed organization in turn, under `withTenant` (every target table
 * has FORCE RLS and a tenant policy) and with an explicit organization
 * filter. A row that is in none of them, a row (or, for a create, an
 * organization and scope) the caller may not manage, and a row that does not
 * exist all answer `null` — one refusal, so the tool
 * never tells a model that another tenant's id exists, and never reads a
 * name from outside the scope the turn's key may send.
 *
 * Every id the body names (`refs`) must be a row of the same organization.
 * The route checks all of this again when the change is confirmed; this read
 * only keeps a change that cannot apply off the card.
 */
@Injectable()
export class CopilotTargetResolver implements CopilotTargets {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    @Inject(AccessControlService) private readonly access: AccessControlService,
  ) {}

  async resolve(
    entry: CatalogEntry,
    params: Readonly<Record<string, string>>,
    body: Readonly<Record<string, unknown>>,
    allowedOrganizationIds: readonly string[],
    user: JwtPayload,
  ): Promise<ResolvedTarget | null> {
    const target = entry.target;
    let found: Found | null;
    if (target.kind === "organization") {
      const organizationId = body.organizationId;
      if (typeof organizationId !== "string" || !allowedOrganizationIds.includes(organizationId)) return null;
      const name = await this.organizationName(organizationId);
      found = name === null ? null : { organizationId, name };
      if (found !== null && !(await this.safely(() => this.mayCreate(target.manage, organizationId, body, user)))) found = null;
    } else {
      const id = params[target.param];
      if (id === undefined) return null;
      found = await this.findRow(target.kind, id, allowedOrganizationIds);
      if (found !== null && !(await this.safely(() => this.mayManage(target.kind, id, found as Found, user)))) found = null;
    }
    if (found === null) return null;
    for (const ref of entry.refs) {
      const value = body[ref.field];
      if (value === undefined || value === null) continue;
      if (typeof value !== "string" || !(await this.refBelongs(ref, value, found.organizationId))) return null;
    }
    const organizationName =
      target.kind === "organization" ? found.name : ((await this.organizationName(found.organizationId)) ?? "");
    return {
      organizationId: found.organizationId,
      organizationName,
      targetName: found.name,
      ...(found.currentWidgetIds ? { currentWidgetIds: found.currentWidgetIds } : {}),
      ...(found.pointKeys ? { pointKeys: found.pointKeys } : {}),
      ...(found.currentContent ? { currentContent: found.currentContent } : {}),
    };
  }

  private async organizationName(organizationId: string): Promise<string | null> {
    // `bms.organizations` carries no row-level security (`LlmResolver.listOrganizationIds`).
    const [row] = await this.tenantDb
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    return row?.name ?? null;
  }

  private async findRow(
    kind: Exclude<CatalogEntry["target"]["kind"], "organization">,
    id: string,
    allowed: readonly string[],
  ): Promise<Found | null> {
    for (const organizationId of allowed) {
      const found = await withTenant(this.tenantDb, organizationId, (tx) => this.readRow(tx, kind, id, organizationId));
      if (found !== null) return found;
    }
    return null;
  }

  private async readRow(
    tx: BmsTx,
    kind: Exclude<CatalogEntry["target"]["kind"], "organization">,
    id: string,
    organizationId: string,
  ): Promise<Found | null> {
    switch (kind) {
      case "dashboard": {
        const [row] = await tx
          .select({
            name: dashboards.name,
            locationId: dashboards.locationId,
            assetGroupId: dashboards.assetGroupId,
            assetId: dashboards.assetId,
          })
          .from(dashboards)
          .where(and(eq(dashboards.id, id), eq(dashboards.organizationId, organizationId)))
          .limit(1);
        if (!row) return null;
        const widgets = await tx
          .select({ id: dashboardWidgets.id })
          .from(dashboardWidgets)
          .where(and(eq(dashboardWidgets.dashboardId, id), eq(dashboardWidgets.organizationId, organizationId)));
        return {
          organizationId,
          name: row.name,
          scope: { locationId: row.locationId, assetGroupId: row.assetGroupId, assetId: row.assetId },
          currentWidgetIds: widgets.map((widget) => widget.id),
        };
      }
      case "dashboardTemplate": {
        const [row] = await tx
          .select({ name: dashboardTemplates.name })
          .from(dashboardTemplates)
          .where(and(eq(dashboardTemplates.id, id), eq(dashboardTemplates.organizationId, organizationId)))
          .limit(1);
        return row ? { organizationId, name: row.name } : null;
      }
      case "calcParameter": {
        const [row] = await tx
          .select({ key: calcParameters.key, locationId: calcParameters.locationId, assetId: calcParameters.assetId })
          .from(calcParameters)
          .where(and(eq(calcParameters.id, id), eq(calcParameters.organizationId, organizationId)))
          .limit(1);
        return row
          ? { organizationId, name: row.key, scope: { locationId: row.locationId, assetGroupId: null, assetId: row.assetId } }
          : null;
      }
      case "asset": {
        const [row] = await tx
          .select({ name: assets.name })
          .from(assets)
          .where(and(eq(assets.id, id), eq(assets.organizationId, organizationId)))
          .limit(1);
        if (!row) return null;
        const points = await tx
          .select({ pointKey: assetPoints.pointKey })
          .from(assetPoints)
          .where(and(eq(assetPoints.assetId, id), eq(assetPoints.organizationId, organizationId)));
        return { organizationId, name: row.name, pointKeys: points.map((point) => point.pointKey) };
      }
      case "assetTemplate": {
        const [row] = await tx
          .select({ name: assetTemplates.name, content: assetTemplates.content })
          .from(assetTemplates)
          .where(and(eq(assetTemplates.id, id), eq(assetTemplates.organizationId, organizationId)))
          .limit(1);
        if (!row) return null;
        const points = await tx
          .select({ pointKey: templatePoints.pointKey })
          .from(templatePoints)
          .where(and(eq(templatePoints.templateId, id), eq(templatePoints.organizationId, organizationId)));
        const content = row.content;
        return {
          organizationId,
          name: row.name,
          pointKeys: points.map((point) => point.pointKey),
          // The column is `jsonb NOT NULL`; anything but an object merges as empty (ruling Q10).
          currentContent:
            typeof content === "object" && content !== null && !Array.isArray(content) ? (content as Record<string, unknown>) : {},
        };
      }
    }
  }

  /**
   * A manage check that throws (`assertMasterDataRole` refuses an
   * `asset_group_admin` with a 403) is a `false`: otherwise the tool's answer
   * would differ between "not found" and "found but forbidden" (review L1).
   */
  private async safely(check: () => Promise<boolean>): Promise<boolean> {
    try {
      return await check();
    } catch {
      return false;
    }
  }

  /** A create's authority: the route's own check, on the body's organization and scope. */
  private async mayCreate(
    manage: Extract<CatalogEntry["target"], { kind: "organization" }>["manage"],
    organizationId: string,
    body: Readonly<Record<string, unknown>>,
    user: JwtPayload,
  ): Promise<boolean> {
    const id = (key: string): string | null => (typeof body[key] === "string" ? (body[key] as string) : null);
    switch (manage) {
      case "dashboard":
        return this.access.canManageDashboard(user, organizationId, {
          locationId: id("locationId"),
          assetGroupId: id("assetGroupId"),
          assetId: id("assetId"),
        });
      case "template":
        return this.access.canManageTemplate(user, organizationId);
      case "calcParameter": {
        const assetId = id("assetId");
        const locationId = id("locationId");
        if (assetId !== null) return this.access.canManageAsset(user, assetId);
        if (locationId !== null) return this.access.canManageLocation(user, locationId);
        return this.access.canManageOrganization(user, organizationId);
      }
    }
  }

  /** The same authority the route checks, so a card the caller could never apply is not offered. */
  private async mayManage(
    kind: Exclude<CatalogEntry["target"]["kind"], "organization">,
    id: string,
    found: Found,
    user: JwtPayload,
  ): Promise<boolean> {
    switch (kind) {
      case "dashboard":
        return this.access.canManageDashboard(user, found.organizationId, found.scope as Scope);
      case "dashboardTemplate":
        return this.access.canManageTemplate(user, found.organizationId);
      // The route's `assertCanAuthor`: `requireMasterDataUser`, no `location_admin`, then this
      // check, which is already false for a `location_admin`; a throw is the same refusal (`safely`).
      case "assetTemplate":
        return this.access.canManageTemplate(user, found.organizationId);
      case "calcParameter": {
        const scope = found.scope as Scope;
        if (scope.assetId !== null) return this.access.canManageAsset(user, scope.assetId);
        if (scope.locationId !== null) return this.access.canManageLocation(user, scope.locationId);
        return this.access.canManageOrganization(user, found.organizationId);
      }
      case "asset":
        return this.access.canManageAsset(user, id);
    }
  }

  private async refBelongs(ref: CatalogRef, id: string, organizationId: string): Promise<boolean> {
    const table = { location: locations, assetGroup: assetGroups, asset: assets }[ref.kind];
    const rows = await withTenant(this.tenantDb, organizationId, (tx) =>
      tx
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.id, id), eq(table.organizationId, organizationId)))
        .limit(1),
    );
    return rows.length === 1;
  }
}
