import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  assetRoles,
  dashboardWidgets,
  mimicLayoutNodes,
  mimicLayoutPipes,
  mimicLibrarySettings,
  mimicLayouts,
  mimicOrgSymbolLibraries,
  mimicOrgSymbols,
  mimicSymbolLibraries,
  mimicSymbols,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  JwtPayload,
  MimicLayoutDeletedResponse,
  MimicLayoutDto,
  MimicLayoutNodeDto,
  MimicLayoutPipeDto,
  MimicLayoutsListResponse,
  MimicPanelTone,
  MimicOrgSymbolDto,
  MimicSymbol,
  MimicSymbolLibrarySelection,
  MimicLayoutNodeKind,
} from "@bms/shared";
import { isOrgLibraryKey, isOrgSymbolKey, libraryOfSymbol } from "@bms/shared";

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
import { KNOWN_LIBRARY_CODES, splitLibraryCodes } from "./mimic-library-codes";
import { orgSymbolsOf } from "./mimic-org-symbols";

type LayoutRow = typeof mimicLayouts.$inferSelect;
type Executor = BmsDb | BmsTx;

/** An unknown or retired role code: the class of error only, never the code. */
const UNKNOWN_ROLE_MESSAGE = "Unknown asset role code";

/** A library code with no active `bms.mimic_symbol_libraries` row (`F3.32e`, plan D7). */
const UNKNOWN_LIBRARY_MESSAGE = "Unknown symbol library";

/**
 * A unit symbol with no `bms.mimic_symbols` row, or an inactive one (`F3.32f`, ADR 0086
 * decision 5): the class of error only, never the key.
 */
const UNKNOWN_SYMBOL_MESSAGE = "Unknown mimic symbol";

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
 *
 * **A save refuses a retired role, library or symbol, except one the stored layout
 * already carries** (`F3.32f`, ADR 0086 decision 5, the mapping-sheet retired-code rule):
 * the foreign keys admit an inactive row, so the service checks `active` before any write,
 * and a re-save of an unchanged layout never fails on a code retired after it was drawn.
 */
@Injectable()
export class MimicLayoutsService {
  private readonly logger = new Logger(MimicLayoutsService.name);

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
    const orgLibraries = await this.orgLibraryKeysOf(this.fleetDb, [...new Set(rows.map((row) => row.organizationId))]);
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
        symbolLibraries: this.readLibraries(layout, orgLibraries.get(layout.organizationId)),
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
    await this.assertLibrariesLive(body.symbolLibraries, new Set(), body.organizationId);
    await this.assertRolesLive(body.nodes, new Set());
    await this.assertSymbolsLive(body.nodes, new Set(), body.organizationId);
    return withTenant(this.tenantDb, body.organizationId, async (tx) => {
      const [layout] = await tx
        .insert(mimicLayouts)
        .values({
          organizationId: body.organizationId,
          name: body.name,
          slug: body.slug,
          canvasW: body.canvasW,
          canvasH: body.canvasH,
          symbolLibraries: body.symbolLibraries,
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
    // A code the stored drawing already carries stays valid after it is retired, so a
    // re-save of an unchanged layout never fails on it (the mapping-sheet retired-code rule).
    await this.assertLibrariesLive(body.symbolLibraries, new Set(existing.symbolLibraries), existing.organizationId);
    const stored = await this.fleetDb
      .selectDistinct({
        roleCode: mimicLayoutNodes.roleCode,
        symbol: mimicLayoutNodes.symbol,
        orgSymbolKey: mimicLayoutNodes.orgSymbolKey,
      })
      .from(mimicLayoutNodes)
      .where(eq(mimicLayoutNodes.layoutId, existing.id));
    const keptRoles = new Set(stored.flatMap((row) => (row.roleCode === null ? [] : [row.roleCode])));
    // `F3.32f` slice 3: an organization unit stores its key in `org_symbol_key`, with `symbol` null.
    const keptSymbols = new Set(stored.flatMap((row) => [row.symbol, row.orgSymbolKey].filter((key): key is string => key !== null)));
    await this.assertRolesLive(body.nodes, keptRoles);
    await this.assertSymbolsLive(body.nodes, keptSymbols, existing.organizationId);
    return withTenant(this.tenantDb, existing.organizationId, async (tx) => {
      const [layout] = await tx
        .update(mimicLayouts)
        .set({
          name: body.name,
          slug: body.slug,
          canvasW: body.canvasW,
          canvasH: body.canvasH,
          symbolLibraries: body.symbolLibraries,
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

  /**
   * Deletes a layout no dashboard widget names (ADR 0081 decision 3).
   *
   * **The row lock comes before the count.** `FOR UPDATE` conflicts with the
   * `FOR KEY SHARE` a widget save takes on every layout it names
   * (`assertMimicLayoutsInOrganization`), so a save in flight finishes first,
   * and the count below then sees its committed widget. Counting first would
   * read zero while that save is still open, and delete a layout it names.
   */
  async remove(jwt: JwtPayload, id: string): Promise<MimicLayoutDeletedResponse> {
    const existing = await this.fetchReadable(jwt, id);
    await this.assertCanAuthor(jwt, existing.organizationId);
    return withTenant(this.tenantDb, existing.organizationId, async (tx) => {
      const [locked] = await tx
        .select({ id: mimicLayouts.id })
        .from(mimicLayouts)
        .where(eq(mimicLayouts.id, id))
        .for("update");
      if (!locked) {
        throw new NotFoundException("Mimic layout not found");
      }
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(dashboardWidgets)
        .where(
          and(
            eq(dashboardWidgets.widgetType, "mimic"),
            sql`${dashboardWidgets.config}->>'source' = 'layout'`,
            // The database's own id, lowercase, against the stored text lowercased: a path id
            // in uppercase is the same uuid, and a text compare with it would count zero. No
            // `::uuid` cast, so a malformed stored value cannot fail the delete.
            sql`lower(${dashboardWidgets.config}->>'layoutId') = ${locked.id}`,
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

  /**
   * Every role code the body's nodes name is an **active** `bms.asset_roles`
   * row, except the codes in `kept`. The foreign key admits a retired role
   * (`active = false`), so it cannot be the check. An unknown code and a
   * retired one answer the same 400, and neither is echoed.
   */
  private async assertRolesLive(
    nodes: Pick<CreateMimicLayoutBody, "nodes">["nodes"],
    kept: ReadonlySet<string>,
  ): Promise<void> {
    const codes = [
      ...new Set(nodes.flatMap((node) => (node.roleCode == null || kept.has(node.roleCode) ? [] : [node.roleCode]))),
    ];
    if (codes.length === 0) return;
    const live = await this.fleetDb
      .select({ code: assetRoles.code })
      .from(assetRoles)
      .where(and(inArray(assetRoles.code, codes), eq(assetRoles.active, true)));
    if (live.length !== codes.length) {
      throw new BadRequestException(UNKNOWN_ROLE_MESSAGE);
    }
  }

  /**
   * Every library the body chose is an **active** `bms.mimic_symbol_libraries` row (`F3.32e`,
   * plan D7), checked before any write. The Zod enum admits every code the contract names, so a
   * retired library reaches here. `bms_fleet` may read the lookup table. The codes are made
   * unique first, because a body that skipped the schema may repeat one.
   *
   * A code in `kept` — one the stored layout already chose — is exempt (`F3.32f`, ADR 0086
   * decision 5), so an unchanged layout re-saves after its library is retired or disabled.
   */
  private async assertLibrariesLive(
    symbolLibraries: readonly string[],
    kept: ReadonlySet<string>,
    organizationId: string,
  ): Promise<void> {
    const codes = [...new Set(symbolLibraries)].filter((code) => !kept.has(code));
    if (codes.length === 0) return;
    const live = await this.liveLibraryCodes(codes, organizationId);
    if (live.size !== codes.length) {
      throw new BadRequestException(UNKNOWN_LIBRARY_MESSAGE);
    }
  }

  /**
   * The codes of `codes` a new unit may draw from in `organizationId` (`F3.32f` slice 3, ADR 0086
   * decisions 4 and 5, plan D6): a global code whose `bms.mimic_symbol_libraries` row is active
   * **and** that the organization did not switch off (`bms.mimic_library_settings.enabled =
   * false`; no row means enabled), or `org.<code>` naming an **active** library **of that
   * organization**. The fleet pool bypasses row security, so the `organization_id` predicate on
   * both organization tables is the isolation: without it, another organization's `org.plant`
   * would count as live.
   */
  private async liveLibraryCodes(codes: readonly string[], organizationId: string): Promise<Set<string>> {
    const global = codes.filter((code) => !isOrgLibraryKey(code));
    const org = codes.filter((code) => isOrgLibraryKey(code)).map((code) => code.slice("org.".length));
    const live = new Set<string>();
    if (global.length > 0) {
      const rows = await this.fleetDb
        .select({ code: mimicSymbolLibraries.code })
        .from(mimicSymbolLibraries)
        .leftJoin(
          mimicLibrarySettings,
          and(
            eq(mimicLibrarySettings.libraryCode, mimicSymbolLibraries.code),
            eq(mimicLibrarySettings.organizationId, organizationId),
          ),
        )
        .where(
          and(
            inArray(mimicSymbolLibraries.code, global),
            eq(mimicSymbolLibraries.active, true),
            sql`coalesce(${mimicLibrarySettings.enabled}, true)`,
          ),
        );
      for (const row of rows) live.add(row.code);
    }
    if (org.length > 0) {
      const rows = await this.fleetDb
        .select({ code: mimicOrgSymbolLibraries.code })
        .from(mimicOrgSymbolLibraries)
        .where(
          and(
            eq(mimicOrgSymbolLibraries.organizationId, organizationId),
            inArray(mimicOrgSymbolLibraries.code, org),
            eq(mimicOrgSymbolLibraries.active, true),
          ),
        );
      for (const row of rows) live.add(`org.${row.code}`);
    }
    return live;
  }

  /**
   * Every unit symbol the body draws is an **active** `bms.mimic_symbols` row, except the keys in
   * `kept` — the symbols the stored layout already draws (`F3.32f`, ADR 0086 decision 5). The
   * foreign key admits a retired symbol, so it cannot be the check. An unknown key and a retired
   * one answer the same 400 as the foreign key's, and neither is echoed.
   *
   * A symbol not in `kept` must also come from a live library: retiring a library flips only
   * its row, so its symbols stay active, and the layout's stored-library exemption would
   * otherwise carry a newly placed unit (ADR 0086 decision 5). This goes through
   * `liveLibraryCodes`, so slice 3's per-organization switch binds new units too.
   *
   * `F3.32f` slice 3: an `org.<code>:<name>` key must be an **active** `bms.mimic_org_symbols`
   * row **of the layout's organization** — the `organization_id` predicate is the isolation on
   * the fleet pool, ahead of the composite foreign key that would refuse it at the insert.
   */
  private async assertSymbolsLive(
    nodes: Pick<CreateMimicLayoutBody, "nodes">["nodes"],
    kept: ReadonlySet<string>,
    organizationId: string,
  ): Promise<void> {
    const codes = [
      ...new Set(nodes.flatMap((node) => (node.symbol == null || kept.has(node.symbol) ? [] : [node.symbol]))),
    ];
    if (codes.length === 0) return;
    const staticKeys = codes.filter((code) => !isOrgSymbolKey(code));
    const orgKeys = codes.filter((code) => isOrgSymbolKey(code));
    const live =
      staticKeys.length === 0
        ? []
        : await this.fleetDb
            .select({ key: mimicSymbols.key })
            .from(mimicSymbols)
            .where(and(inArray(mimicSymbols.key, staticKeys), eq(mimicSymbols.active, true)));
    const liveOrg =
      orgKeys.length === 0
        ? []
        : await this.fleetDb
            .select({ key: mimicOrgSymbols.key })
            .from(mimicOrgSymbols)
            .where(
              and(
                eq(mimicOrgSymbols.organizationId, organizationId),
                inArray(mimicOrgSymbols.key, orgKeys),
                eq(mimicOrgSymbols.active, true),
              ),
            );
    if (live.length !== staticKeys.length || liveOrg.length !== orgKeys.length) {
      throw new BadRequestException(UNKNOWN_SYMBOL_MESSAGE);
    }
    const libraries = [...new Set(codes.map((code) => libraryOfSymbol(code)))];
    const liveLibraries = await this.liveLibraryCodes(libraries, organizationId);
    if (liveLibraries.size !== libraries.length) {
      throw new BadRequestException(UNKNOWN_SYMBOL_MESSAGE);
    }
  }

  /**
   * The stored library codes the response contract can carry (`F3.32f`, ADR 0086 decision 10):
   * a global code, or `org.<code>` naming one of the layout organization's own libraries
   * (`orgLibraries`, retired ones included — a stored drawing keeps its choice). Any other stored
   * code is dropped with a warning rather than cast through, so one bad row no longer fails the
   * whole list at the contract parse; the write path already refuses one.
   */
  private readLibraries(layout: LayoutRow, orgLibraries: ReadonlySet<string> = new Set()): MimicSymbolLibrarySelection[] {
    const known = orgLibraries.size === 0 ? KNOWN_LIBRARY_CODES : new Set([...KNOWN_LIBRARY_CODES, ...orgLibraries]);
    const { kept, dropped } = splitLibraryCodes(layout.symbolLibraries, known);
    if (dropped.length > 0) {
      this.logger.warn(`mimic layout ${layout.id}: dropped unknown symbol library code(s): ${dropped.join(", ")}`);
    }
    return kept;
  }

  /**
   * `F3.32f` slice 3: each organization's own libraries as `org.<code>`, by organization —
   * what `readLibraries` may keep beside the global codes. Every row is filtered by
   * organization, so the fleet pool's bypass reads nothing else.
   */
  private async orgLibraryKeysOf(db: Executor, organizationIds: readonly string[]): Promise<Map<string, Set<string>>> {
    const byOrganization = new Map<string, Set<string>>();
    if (organizationIds.length === 0) return byOrganization;
    const rows = await db
      .select({ organizationId: mimicOrgSymbolLibraries.organizationId, code: mimicOrgSymbolLibraries.code })
      .from(mimicOrgSymbolLibraries)
      .where(inArray(mimicOrgSymbolLibraries.organizationId, [...organizationIds]));
    for (const row of rows) {
      const keys = byOrganization.get(row.organizationId) ?? new Set<string>();
      keys.add(`org.${row.code}`);
      byOrganization.set(row.organizationId, keys);
    }
    return byOrganization;
  }

  /**
   * `F3.32f` slice 3 (ADR 0086 decision 7, plan D6): the organization symbols the layout's units
   * draw, retired ones included (a stored drawing still draws), once each, by key. Both tables
   * are filtered by the layout's organization and the library is joined on the organization too,
   * so a fleet-pool read reaches no other organization's row. Each row is re-checked by the
   * response contract (`orgSymbolsOf`).
   */
  private async readOrgSymbols(db: Executor, layout: LayoutRow): Promise<MimicOrgSymbolDto[]> {
    const used = db
      .selectDistinct({ key: mimicLayoutNodes.orgSymbolKey })
      .from(mimicLayoutNodes)
      .where(and(eq(mimicLayoutNodes.layoutId, layout.id), eq(mimicLayoutNodes.organizationId, layout.organizationId)));
    const rows = await db
      .select({
        id: mimicOrgSymbols.id,
        libraryId: mimicOrgSymbols.libraryId,
        key: mimicOrgSymbols.key,
        label: mimicOrgSymbols.label,
        groupCode: mimicOrgSymbols.groupCode,
        style: mimicOrgSymbolLibraries.style,
        viewBox: mimicOrgSymbols.viewBox,
        shapes: mimicOrgSymbols.shapes,
        active: mimicOrgSymbols.active,
        sourceFilename: mimicOrgSymbols.sourceFilename,
        sha256: mimicOrgSymbols.sha256,
        updatedAt: mimicOrgSymbols.updatedAt,
      })
      .from(mimicOrgSymbols)
      .innerJoin(
        mimicOrgSymbolLibraries,
        and(
          eq(mimicOrgSymbolLibraries.id, mimicOrgSymbols.libraryId),
          eq(mimicOrgSymbolLibraries.organizationId, layout.organizationId),
        ),
      )
      .where(and(eq(mimicOrgSymbols.organizationId, layout.organizationId), inArray(mimicOrgSymbols.key, used)))
      .orderBy(asc(mimicOrgSymbols.key));
    return orgSymbolsOf(rows, (message) => this.logger.warn(message));
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
          // `F3.32f` slice 3 (ADR 0086 decision 3): an organization key goes to `org_symbol_key`,
          // whose composite foreign key names the layout's own organization.
          symbol: node.symbol == null || isOrgSymbolKey(node.symbol) ? null : node.symbol,
          orgSymbolKey: node.symbol != null && isOrgSymbolKey(node.symbol) ? node.symbol : null,
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
    const orgLibraries = await this.orgLibraryKeysOf(db, [layout.organizationId]);
    const orgSymbols = await this.readOrgSymbols(db, layout);
    return {
      id: layout.id,
      organizationId: layout.organizationId,
      name: layout.name,
      slug: layout.slug,
      canvasW: layout.canvasW,
      canvasH: layout.canvasH,
      version: layout.version,
      symbolLibraries: this.readLibraries(layout, orgLibraries.get(layout.organizationId)),
      nodes: nodes.map(
        (node): MimicLayoutNodeDto => ({
          key: node.key,
          kind: node.kind as MimicLayoutNodeKind,
          // `F3.32f` slice 3 (ADR 0086 decision 3): a unit holds exactly one of the two columns.
          symbol: (node.symbol ?? node.orgSymbolKey ?? null) as MimicSymbol | null,
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
      orgSymbols,
      createdAt: layout.createdAt.toISOString(),
      updatedAt: layout.updatedAt.toISOString(),
    };
  }

  /**
   * Maps a database refusal by its **constraint name** — never by its detail,
   * which row security suppresses. Only the named cases are the caller's;
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
      return new BadRequestException(UNKNOWN_ROLE_MESSAGE);
    }
    if (constraint === "mimic_layout_nodes_symbol_fkey") {
      // `F3.32e` migration `0090`: the symbol names a `bms.mimic_symbols` row. No echo of the key.
      return new BadRequestException(UNKNOWN_SYMBOL_MESSAGE);
    }
    if (constraint === "mimic_layout_nodes_org_symbol_fkey") {
      // `F3.32f` migration `0093`: no such symbol in the layout's organization. No echo of the key.
      return new BadRequestException(UNKNOWN_SYMBOL_MESSAGE);
    }
    return err;
  }
}
