import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { dashboardWidgets, mimicLayoutNodes, mimicLayoutPipes, mimicLayouts } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  JwtPayload,
  MimicLayoutDeletedResponse,
  MimicLayoutDto,
  MimicLayoutNodeDto,
  MimicLayoutPipeDto,
  MimicLayoutsListResponse,
  MimicPanelTone,
  MimicSymbol,
  MimicLayoutNodeKind,
} from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import type { BmsTx } from "../database/tenant-context";
import {
  MIMIC_LAYOUT_IN_USE_MESSAGE,
  MIMIC_LAYOUT_STALE_MESSAGE,
} from "./mimic-layouts.schema";
import type { CreateMimicLayoutBody, PutMimicLayoutBody } from "./mimic-layouts.schema";

type LayoutRow = typeof mimicLayouts.$inferSelect;
type Executor = BmsDb | BmsTx;

/** The roles that may draw, besides `admin` (ADR 0081 decision 3). */
const AUTHOR_ROLES = new Set(["admin", "organization_admin"]);

/**
 * The mimic layout library — `F3.32c`, ADR 0081 decisions 1–3, plan U2.
 *
 * **Reads run on `fleetDb`, writes on `tenantDb` inside `withTenant`** — the
 * `DashboardTemplatesService` split. The three tables are `FORCE ROW LEVEL
 * SECURITY` (migration `0088`), so a `tenantDb` read with no GUC sees nothing;
 * `bms_fleet` holds `BYPASSRLS`, so every fleet read below is scoped in its
 * own `where` by `readableOrganizationIds`, and that is the read isolation
 * control. The policy protects the writes.
 *
 * **Any authenticated role reads** (owner ruling OQ4): a dashboard author picks
 * a layout from the library. A layout outside the caller's organizations
 * answers 404, never 403, so an id reveals nothing.
 *
 * **Only `admin` and `organization_admin` write**, and only in an organization
 * they manage. `canManageOrganization` alone would admit a `location_admin`
 * (its writable organizations derive from its locations), which is the
 * `F3.36` finding `DashboardTemplatesService.assertCanAuthor` records — so the
 * role is checked first.
 *
 * **The audit row is written inside the mutation's transaction**, after the
 * mutation proved it wrote, so a refused write leaves no history.
 */
@Injectable()
export class MimicLayoutsService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  /** The caller's organizations' layouts, by name. */
  async list(jwt: JwtPayload): Promise<MimicLayoutsListResponse> {
    const orgIds = await this.accessControl.readableOrganizationIds(jwt);
    // `null` is the unrestricted sentinel; an empty array sees nothing.
    if (orgIds !== null && orgIds.length === 0) {
      return { items: [] };
    }
    const rows = await this.fleetDb
      .select()
      .from(mimicLayouts)
      .where(orgIds === null ? undefined : inArray(mimicLayouts.organizationId, orgIds))
      .orderBy(asc(mimicLayouts.name), asc(mimicLayouts.slug), asc(mimicLayouts.id));
    // A second, grouped read rather than a correlated subquery: on a one-table
    // select Drizzle renders columns unqualified, so `layout_id = id` inside a
    // subquery would compare the node table's own columns.
    const counts =
      rows.length === 0
        ? []
        : await this.fleetDb
            .select({ layoutId: mimicLayoutNodes.layoutId, n: sql<number>`count(*)::int` })
            .from(mimicLayoutNodes)
            .where(
              and(
                inArray(
                  mimicLayoutNodes.layoutId,
                  rows.map((row) => row.id),
                ),
                eq(mimicLayoutNodes.kind, "unit"),
              ),
            )
            .groupBy(mimicLayoutNodes.layoutId);
    const unitsByLayout = new Map(counts.map((row) => [row.layoutId, Number(row.n)]));
    return {
      items: rows.map((layout) => ({
        id: layout.id,
        organizationId: layout.organizationId,
        name: layout.name,
        slug: layout.slug,
        canvasW: layout.canvasW,
        canvasH: layout.canvasH,
        version: layout.version,
        unitCount: unitsByLayout.get(layout.id) ?? 0,
        updatedAt: layout.updatedAt.toISOString(),
      })),
    };
  }

  async get(jwt: JwtPayload, id: string): Promise<MimicLayoutDto> {
    const layout = await this.fetchReadable(jwt, id);
    return this.toDto(this.fleetDb, layout);
  }

  async create(jwt: JwtPayload, body: CreateMimicLayoutBody): Promise<MimicLayoutDto> {
    const author = await this.assertCanAuthor(jwt, body.organizationId);
    return withTenant(this.tenantDb, body.organizationId, async (tx) => {
      const [layout] = await tx
        .insert(mimicLayouts)
        .values({
          organizationId: body.organizationId,
          name: body.name,
          slug: body.slug,
          canvasW: body.canvasW,
          canvasH: body.canvasH,
          createdBy: author,
        })
        .returning();
      if (!layout) {
        throw new ConflictException("The layout could not be created");
      }
      await this.writeGraph(tx, layout, body);
      await this.writeAudit(tx, jwt, layout, "create", body);
      return this.toDto(tx, layout);
    }).catch((err: unknown) => {
      throw MimicLayoutsService.translateWriteError(err, body.slug);
    });
  }

  /**
   * Replaces the whole layout (ADR 0081 decision 2): the version-checked
   * `UPDATE` first, so a stale save changes nothing, then every node is deleted
   * (the pipes cascade) and the body's set is written.
   */
  async replace(jwt: JwtPayload, id: string, body: PutMimicLayoutBody): Promise<MimicLayoutDto> {
    const existing = await this.fetchReadable(jwt, id);
    await this.assertCanAuthor(jwt, existing.organizationId);
    return withTenant(this.tenantDb, existing.organizationId, async (tx) => {
      const [layout] = await tx
        .update(mimicLayouts)
        .set({
          name: body.name,
          slug: body.slug,
          canvasW: body.canvasW,
          canvasH: body.canvasH,
          version: sql`${mimicLayouts.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(mimicLayouts.id, id), eq(mimicLayouts.version, body.version)))
        .returning();
      if (!layout) {
        throw new ConflictException(MIMIC_LAYOUT_STALE_MESSAGE);
      }
      await tx.delete(mimicLayoutNodes).where(eq(mimicLayoutNodes.layoutId, id));
      await this.writeGraph(tx, layout, body);
      await this.writeAudit(tx, jwt, layout, "replace", body);
      return this.toDto(tx, layout);
    }).catch((err: unknown) => {
      throw MimicLayoutsService.translateWriteError(err, body.slug);
    });
  }

  /** Deletes a layout no dashboard widget names (ADR 0081 decision 3). */
  async remove(jwt: JwtPayload, id: string): Promise<MimicLayoutDeletedResponse> {
    const existing = await this.fetchReadable(jwt, id);
    await this.assertCanAuthor(jwt, existing.organizationId);
    return withTenant(this.tenantDb, existing.organizationId, async (tx) => {
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(dashboardWidgets)
        .where(
          and(
            eq(dashboardWidgets.widgetType, "mimic"),
            sql`${dashboardWidgets.config}->>'source' = 'layout'`,
            sql`${dashboardWidgets.config}->>'layoutId' = ${id}`,
          ),
        );
      if (Number(n) > 0) {
        throw new ConflictException(MIMIC_LAYOUT_IN_USE_MESSAGE(Number(n)));
      }
      const [deleted] = await tx
        .delete(mimicLayouts)
        .where(eq(mimicLayouts.id, id))
        .returning({ id: mimicLayouts.id });
      if (!deleted) {
        throw new NotFoundException("Mimic layout not found");
      }
      await this.audit.write(
        {
          actor: jwt,
          organizationId: existing.organizationId,
          action: "master.mimic_layout.delete",
          entityType: "mimic_layout",
          entityId: id,
        },
        tx,
      );
      return { id, deleted: true as const };
    });
  }

  /**
   * The authoring gate: a master-data user, of role `admin` or
   * `organization_admin`, managing `organizationId`. Returns the caller's
   * `bms.users` id for `created_by`.
   */
  async assertCanAuthor(jwt: JwtPayload, organizationId: string): Promise<string> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    if (!AUTHOR_ROLES.has(user.role)) {
      throw new ForbiddenException("Only an organization admin can draw a plant mimic layout");
    }
    if (!(await this.accessControl.canManageOrganization(jwt, organizationId))) {
      throw new ForbiddenException("Organization is outside your access scope");
    }
    return user.id;
  }

  /** The layout, if the caller may read its organization; else 404. */
  private async fetchReadable(jwt: JwtPayload, id: string): Promise<LayoutRow> {
    const orgIds = await this.accessControl.readableOrganizationIds(jwt);
    const [layout] = await this.fleetDb.select().from(mimicLayouts).where(eq(mimicLayouts.id, id)).limit(1);
    if (!layout || (orgIds !== null && !orgIds.includes(layout.organizationId))) {
      throw new NotFoundException("Mimic layout not found");
    }
    return layout;
  }

  /** Inserts the body's nodes, then its pipes by the key -> new id map (plan D5). */
  private async writeGraph(
    tx: BmsTx,
    layout: LayoutRow,
    body: Pick<CreateMimicLayoutBody, "nodes" | "pipes">,
  ): Promise<void> {
    if (body.nodes.length === 0) return;
    const inserted = await tx
      .insert(mimicLayoutNodes)
      .values(
        body.nodes.map((node) => ({
          organizationId: layout.organizationId,
          layoutId: layout.id,
          key: node.key,
          kind: node.kind,
          symbol: node.symbol ?? null,
          label: node.label,
          roleCode: node.roleCode ?? null,
          tone: node.tone ?? null,
          x: node.x,
          y: node.y,
          w: node.w,
          h: node.h,
          z: node.z ?? 0,
        })),
      )
      .returning({ id: mimicLayoutNodes.id, key: mimicLayoutNodes.key });
    if (body.pipes.length === 0) return;
    const idByKey = new Map(inserted.map((row) => [row.key, row.id]));
    await tx.insert(mimicLayoutPipes).values(
      body.pipes.map((pipe) => ({
        organizationId: layout.organizationId,
        layoutId: layout.id,
        // The body refine proved both keys name units of this body.
        fromNodeId: idByKey.get(pipe.fromKey) as string,
        toNodeId: idByKey.get(pipe.toKey) as string,
      })),
    );
  }

  private async writeAudit(
    tx: BmsTx,
    jwt: JwtPayload,
    layout: LayoutRow,
    verb: "create" | "replace",
    body: Pick<CreateMimicLayoutBody, "nodes" | "pipes">,
  ): Promise<void> {
    await this.audit.write(
      {
        actor: jwt,
        organizationId: layout.organizationId,
        action: `master.mimic_layout.${verb}`,
        entityType: "mimic_layout",
        entityId: layout.id,
        // Counts only: labels are free text an auditor does not need.
        payload: {
          version: layout.version,
          nodes: body.nodes.length,
          units: body.nodes.filter((node) => node.kind === "unit").length,
          pipes: body.pipes.length,
        },
      },
      tx,
    );
  }

  /** Nodes by (z, y, x, key) and pipes by (fromKey, toKey): a stable order across saves. */
  private async toDto(db: Executor, layout: LayoutRow): Promise<MimicLayoutDto> {
    const nodes = await db
      .select()
      .from(mimicLayoutNodes)
      .where(eq(mimicLayoutNodes.layoutId, layout.id))
      .orderBy(
        asc(mimicLayoutNodes.z),
        asc(mimicLayoutNodes.y),
        asc(mimicLayoutNodes.x),
        asc(mimicLayoutNodes.key),
      );
    const from = alias(mimicLayoutNodes, "from_node");
    const to = alias(mimicLayoutNodes, "to_node");
    const pipes = await db
      .select({ fromKey: from.key, toKey: to.key })
      .from(mimicLayoutPipes)
      .innerJoin(from, eq(from.id, mimicLayoutPipes.fromNodeId))
      .innerJoin(to, eq(to.id, mimicLayoutPipes.toNodeId))
      .where(eq(mimicLayoutPipes.layoutId, layout.id))
      .orderBy(asc(from.key), asc(to.key));
    return {
      id: layout.id,
      organizationId: layout.organizationId,
      name: layout.name,
      slug: layout.slug,
      canvasW: layout.canvasW,
      canvasH: layout.canvasH,
      version: layout.version,
      nodes: nodes.map(
        (node): MimicLayoutNodeDto => ({
          key: node.key,
          kind: node.kind as MimicLayoutNodeKind,
          symbol: (node.symbol ?? null) as MimicSymbol | null,
          label: node.label,
          roleCode: node.roleCode ?? null,
          tone: (node.tone ?? null) as MimicPanelTone | null,
          x: node.x,
          y: node.y,
          w: node.w,
          h: node.h,
          z: node.z,
        }),
      ),
      pipes: pipes.map((pipe): MimicLayoutPipeDto => ({ fromKey: pipe.fromKey, toKey: pipe.toKey })),
      createdAt: layout.createdAt.toISOString(),
      updatedAt: layout.updatedAt.toISOString(),
    };
  }

  /**
   * Maps a database refusal by its **constraint name** — never by its detail,
   * which row security suppresses. Only the two named cases are the caller's;
   * every other error is rethrown unchanged.
   */
  static translateWriteError(err: unknown, slug: string): unknown {
    const pg = err as { constraint?: string; cause?: { constraint?: string } } | null;
    const constraint = pg?.constraint ?? pg?.cause?.constraint;
    if (constraint === "mimic_layouts_organization_slug_key") {
      return new ConflictException(`A layout with slug "${slug}" already exists in this organization`);
    }
    if (constraint === "mimic_layout_nodes_role_code_fkey") {
      // No echo of the code: the message names the class of error only.
      return new BadRequestException("Unknown asset role code");
    }
    return err;
  }
}
