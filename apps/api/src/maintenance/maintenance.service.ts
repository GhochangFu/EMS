import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";

import {
  assets,
  auditLog,
  maintenanceHistory,
  maintenanceSchedules,
  maintenanceTaskTemplates,
  users,
  workOrders,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  JwtPayload,
  MaintenanceGenerationMode,
  MaintenanceScheduleItem,
  MaintenanceScheduleCategory,
  WorkOrderListItem,
  WorkOrderPriority,
  WorkOrderStatus,
} from "@bms/shared";

import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import type {
  ConvertMaintenanceBody,
  CreateMaintenanceScheduleBody,
  ListMaintenanceQuery,
  UpdateMaintenanceScheduleBody,
} from "./maintenance.schema";

/**
 * `E7.1b` (ADR 0043 §5) — the four maintenance write tables
 * (`maintenance_task_templates`, `maintenance_schedules`, `maintenance_history`
 * and `work_orders`) each gained an `organization_id` column (migration `0046`)
 * and get a `tenant_isolation` policy + `FORCE` in `0047`. Reads run on
 * `fleetDb` behind the caller's writable-asset scope — the `assetIds` filter is
 * the isolation control (Amendment 3) — and writes run inside
 * `withTenant(db, org, …)`.
 *
 * The org derives from the asset on create and from the schedule row's own
 * column on update/convert. Under `FORCE`, an UPDATE whose row fails the policy
 * `USING` clause affects zero rows *without erroring*, so a divergent or NULL
 * org would silently no-op the template flip or the `next_due_at` advance and
 * still return 200. `resolveScheduleOrg` reads both the schedule's and its
 * template's org and refuses on NULL-or-divergent, turning that silent state
 * corruption into a 4xx. The `audit_log` rows carry no `organization_id` this
 * item (ruling 5, deferred to E7.1c); their inserts pass the NULL-tolerant
 * `WITH CHECK` under the tenant GUC.
 */
@Injectable()
export class MaintenanceService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
  ) {}

  private mapWorkOrderRow(r: {
    id: string;
    assetId: string;
    alarmId: string | null;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    sortOrder: number;
    assignedTo: string | null;
    createdBy: string | null;
    dueAt: Date | null;
    resolvedAt: Date | null;
    closedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    assetCode: string;
    assetName: string;
    siteName: string;
  }): WorkOrderListItem {
    return {
      id: r.id,
      assetId: r.assetId,
      alarmId: r.alarmId,
      title: r.title,
      description: r.description,
      status: r.status as WorkOrderStatus,
      priority: r.priority as WorkOrderPriority,
      sortOrder: r.sortOrder,
      assignedTo: r.assignedTo,
      createdBy: r.createdBy,
      dueAt: r.dueAt?.toISOString() ?? null,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      closedAt: r.closedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      assetCode: r.assetCode,
      assetName: r.assetName,
      siteName: r.siteName,
    };
  }

  private mapScheduleRow(
    r: {
      id: string;
      templateId: string;
      assetId: string;
      title: string;
      description: string | null;
      category: string;
      generationMode: string;
      ownerTeam: string | null;
      vendorName: string | null;
      complianceRef: string | null;
      triggerSummary: string | null;
      safetyCritical: boolean;
      priority: string;
      estimatedMinutes: number;
      intervalDays: number;
      nextDueAt: Date;
      lastCompletedAt: Date | null;
      assetCode: string;
      assetName: string;
      siteName: string;
    },
    activeWorkOrderId: string | null,
  ): MaintenanceScheduleItem {
    return {
      id: r.id,
      templateId: r.templateId,
      assetId: r.assetId,
      title: r.title,
      description: r.description,
      category: r.category as MaintenanceScheduleCategory,
      generationMode: r.generationMode as MaintenanceGenerationMode,
      ownerTeam: r.ownerTeam,
      vendorName: r.vendorName,
      complianceRef: r.complianceRef,
      triggerSummary: r.triggerSummary,
      safetyCritical: r.safetyCritical,
      priority: r.priority as WorkOrderPriority,
      estimatedMinutes: r.estimatedMinutes,
      intervalDays: r.intervalDays,
      nextDueAt: r.nextDueAt.toISOString(),
      lastCompletedAt: r.lastCompletedAt?.toISOString() ?? null,
      dueState: r.nextDueAt.getTime() < Date.now() ? "overdue" : "upcoming",
      assetCode: r.assetCode,
      assetName: r.assetName,
      siteName: r.siteName,
      activeWorkOrderId,
    };
  }

  /**
   * Resolves the acting user's row id. `bms.users` is a pre-tenant identity
   * table (Amendment 4 territory), so this reads on `fleetDb`: after `0047`'s
   * NULL-tolerant `users` policy a scoped actor's row is invisible to the bare
   * tenant pool (no `current_org`), which would silently drop the audit actor.
   */
  private async resolveActorId(
    actor: Pick<JwtPayload, "sub" | "email">,
  ): Promise<string | null> {
    const [actorRow] = await this.fleetDb
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, actor.sub))
      .limit(1);
    if (actorRow) {
      return actorRow.id;
    }
    const [emailRow] = await this.fleetDb
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, actor.email))
      .limit(1);
    return emailRow?.id ?? null;
  }

  /**
   * The one organization a schedule and its template both belong to. Read on
   * `fleetDb` behind the caller's writable-asset scope. A NULL on either side or
   * a divergence means the `0046` backfill did not resolve the row — refused
   * with a 4xx rather than silently no-op'ing an UPDATE under `FORCE`.
   */
  private assertResolvedOrg(
    scheduleOrg: string | null,
    templateOrg: string | null,
  ): string {
    if (!scheduleOrg || !templateOrg) {
      throw new BadRequestException(
        "Maintenance schedule has no organization; run the 0046 backfill",
      );
    }
    if (scheduleOrg !== templateOrg) {
      throw new BadRequestException(
        "Maintenance schedule and its template disagree on organization",
      );
    }
    return scheduleOrg;
  }

  private async resolveScheduleOrg(
    id: string,
    assetIds?: string[] | null,
  ): Promise<string> {
    const [row] = await this.fleetDb
      .select({
        scheduleOrg: maintenanceSchedules.organizationId,
        templateOrg: maintenanceTaskTemplates.organizationId,
      })
      .from(maintenanceSchedules)
      .innerJoin(
        maintenanceTaskTemplates,
        eq(maintenanceSchedules.templateId, maintenanceTaskTemplates.id),
      )
      .where(
        and(
          eq(maintenanceSchedules.id, id),
          ...(assetIds ? [inArray(maintenanceTaskTemplates.assetId, assetIds)] : []),
        ),
      )
      .limit(1);
    if (!row) {
      throw new NotFoundException("Maintenance schedule not found");
    }
    return this.assertResolvedOrg(row.scheduleOrg, row.templateOrg);
  }

  /**
   * Maps each schedule to its open work order, if any. Reads on `fleetDb`
   * across organizations by design: this is the duplicate-work-order guard for
   * `convertToWorkOrder`, so on the bare tenant pool (no `current_org`) it would
   * see zero rows and stop guarding. Behind the caller's `assetIds` scope in
   * every caller; on `fleetDb` it can only over-refuse, never leak.
   */
  private async getActiveWorkOrdersBySchedule(
    scheduleIds: string[],
  ): Promise<Map<string, string>> {
    if (scheduleIds.length === 0) {
      return new Map();
    }
    const rows = await this.fleetDb
      .select({
        scheduleId: maintenanceHistory.scheduleId,
        workOrderId: maintenanceHistory.workOrderId,
        workOrderStatus: workOrders.status,
        createdAt: maintenanceHistory.createdAt,
      })
      .from(maintenanceHistory)
      .innerJoin(workOrders, eq(maintenanceHistory.workOrderId, workOrders.id))
      .where(
        and(
          inArray(maintenanceHistory.scheduleId, scheduleIds),
          ne(workOrders.status, "closed"),
        ),
      )
      .orderBy(desc(maintenanceHistory.createdAt));
    const bySchedule = new Map<string, string>();
    for (const row of rows) {
      if (row.workOrderId && !bySchedule.has(row.scheduleId)) {
        bySchedule.set(row.scheduleId, row.workOrderId);
      }
    }
    return bySchedule;
  }

  /** Lists upcoming and overdue maintenance schedules for the Schedule Centre. */
  async list(
    query: ListMaintenanceQuery,
    assetIds?: string[] | null,
  ): Promise<{ items: MaintenanceScheduleItem[] }> {
    if (assetIds && assetIds.length === 0) {
      return { items: [] };
    }
    const horizon = new Date(Date.now() + query.horizonDays * 24 * 60 * 60 * 1000);
    const filters = [
      eq(maintenanceSchedules.active, true),
      eq(maintenanceTaskTemplates.active, true),
    ];
    if (assetIds) {
      filters.push(inArray(maintenanceTaskTemplates.assetId, assetIds));
    }
    if (query.assetId) {
      filters.push(eq(maintenanceTaskTemplates.assetId, query.assetId));
    }
    if (query.category) {
      filters.push(eq(maintenanceTaskTemplates.category, query.category));
    }
    if (query.priority !== "all") {
      filters.push(eq(maintenanceTaskTemplates.priority, query.priority));
    }
    const rows = await this.fleetDb
      .select({
        id: maintenanceSchedules.id,
        templateId: maintenanceSchedules.templateId,
        assetId: maintenanceTaskTemplates.assetId,
        title: maintenanceTaskTemplates.title,
        description: maintenanceTaskTemplates.description,
        category: maintenanceTaskTemplates.category,
        generationMode: maintenanceTaskTemplates.generationMode,
        ownerTeam: maintenanceTaskTemplates.ownerTeam,
        vendorName: maintenanceTaskTemplates.vendorName,
        complianceRef: maintenanceTaskTemplates.complianceRef,
        triggerSummary: maintenanceTaskTemplates.triggerSummary,
        safetyCritical: maintenanceTaskTemplates.safetyCritical,
        priority: maintenanceTaskTemplates.priority,
        estimatedMinutes: maintenanceTaskTemplates.estimatedMinutes,
        intervalDays: maintenanceSchedules.intervalDays,
        nextDueAt: maintenanceSchedules.nextDueAt,
        lastCompletedAt: maintenanceSchedules.lastCompletedAt,
        assetCode: assets.code,
        assetName: assets.name,
        siteName: assets.siteName,
      })
      .from(maintenanceSchedules)
      .innerJoin(
        maintenanceTaskTemplates,
        eq(maintenanceSchedules.templateId, maintenanceTaskTemplates.id),
      )
      .innerJoin(assets, eq(maintenanceTaskTemplates.assetId, assets.id))
      .where(and(...filters))
      .orderBy(asc(maintenanceSchedules.nextDueAt), asc(assets.code))
      .limit(100);
    const activeBySchedule = await this.getActiveWorkOrdersBySchedule(
      rows.map((row) => row.id),
    );
    return {
      items: rows
        .filter((row) => {
          const dueState = row.nextDueAt.getTime() < Date.now() ? "overdue" : "upcoming";
          const dueMatch = query.dueState === "all" || dueState === query.dueState;
          return dueMatch && row.nextDueAt <= horizon;
        })
        .map((row) =>
          this.mapScheduleRow(row, activeBySchedule.get(row.id) ?? null),
        ),
    };
  }

  /** Creates a maintenance template with its first recurring schedule. */
  async createSchedule(
    dto: CreateMaintenanceScheduleBody,
    actor: Pick<JwtPayload, "sub" | "email">,
    assetIds?: string[] | null,
  ): Promise<MaintenanceScheduleItem> {
    if (assetIds && !assetIds.includes(dto.assetId)) {
      throw new NotFoundException("Asset not found or outside your access scope");
    }
    const [asset] = await this.fleetDb
      .select({ id: assets.id, organizationId: assets.organizationId })
      .from(assets)
      .where(eq(assets.id, dto.assetId))
      .limit(1);
    if (!asset) {
      throw new NotFoundException("Asset not found");
    }
    if (!asset.organizationId) {
      throw new BadRequestException(
        "Asset has no organization; run the 0046 backfill",
      );
    }
    const organizationId = asset.organizationId;

    const actorId = await this.resolveActorId(actor);
    const firstDueAt = new Date(dto.firstDueAt);
    const createdId = await withTenant(this.db, organizationId, async (tx) => {
      const [template] = await tx
        .insert(maintenanceTaskTemplates)
        .values({
          organizationId,
          assetId: dto.assetId,
          title: dto.title,
          description: dto.description,
          category: dto.category,
          generationMode: dto.generationMode,
          ownerTeam: dto.ownerTeam,
          vendorName: dto.vendorName,
          complianceRef: dto.complianceRef,
          triggerSummary: dto.triggerSummary,
          safetyCritical: dto.safetyCritical,
          priority: dto.priority,
          estimatedMinutes: dto.estimatedMinutes,
        })
        .returning({ id: maintenanceTaskTemplates.id });
      if (!template) {
        throw new BadRequestException("Could not create maintenance template");
      }

      const [schedule] = await tx
        .insert(maintenanceSchedules)
        .values({
          organizationId,
          templateId: template.id,
          intervalDays: dto.intervalDays,
          nextDueAt: firstDueAt,
        })
        .returning({ id: maintenanceSchedules.id });
      if (!schedule) {
        throw new BadRequestException("Could not create maintenance schedule");
      }

      await tx.insert(auditLog).values({
        actorId,
        action: "maintenance_schedule_create",
        entityType: "maintenance_schedule",
        entityId: schedule.id,
        reason: "Maintenance schedule created",
        payload: {
          templateId: template.id,
          assetId: dto.assetId,
          category: dto.category,
          generationMode: dto.generationMode,
          intervalDays: dto.intervalDays,
          firstDueAt: firstDueAt.toISOString(),
          oidcSubject: actor.sub,
          actorEmail: actor.email,
        },
      });

      return schedule.id;
    });

    return this.getScheduleItem(createdId, assetIds);
  }

  private async getScheduleItem(
    id: string,
    assetIds?: string[] | null,
  ): Promise<MaintenanceScheduleItem> {
    const [row] = await this.fleetDb
      .select({
        id: maintenanceSchedules.id,
        templateId: maintenanceSchedules.templateId,
        assetId: maintenanceTaskTemplates.assetId,
        title: maintenanceTaskTemplates.title,
        description: maintenanceTaskTemplates.description,
        category: maintenanceTaskTemplates.category,
        generationMode: maintenanceTaskTemplates.generationMode,
        ownerTeam: maintenanceTaskTemplates.ownerTeam,
        vendorName: maintenanceTaskTemplates.vendorName,
        complianceRef: maintenanceTaskTemplates.complianceRef,
        triggerSummary: maintenanceTaskTemplates.triggerSummary,
        safetyCritical: maintenanceTaskTemplates.safetyCritical,
        priority: maintenanceTaskTemplates.priority,
        estimatedMinutes: maintenanceTaskTemplates.estimatedMinutes,
        intervalDays: maintenanceSchedules.intervalDays,
        nextDueAt: maintenanceSchedules.nextDueAt,
        lastCompletedAt: maintenanceSchedules.lastCompletedAt,
        assetCode: assets.code,
        assetName: assets.name,
        siteName: assets.siteName,
      })
      .from(maintenanceSchedules)
      .innerJoin(
        maintenanceTaskTemplates,
        eq(maintenanceSchedules.templateId, maintenanceTaskTemplates.id),
      )
      .innerJoin(assets, eq(maintenanceTaskTemplates.assetId, assets.id))
      .where(
        and(
          eq(maintenanceSchedules.id, id),
          ...(assetIds ? [inArray(maintenanceTaskTemplates.assetId, assetIds)] : []),
        ),
      )
      .limit(1);
    if (!row) {
      throw new NotFoundException("Maintenance schedule not found");
    }
    const active = await this.getActiveWorkOrdersBySchedule([id]);
    return this.mapScheduleRow(row, active.get(id) ?? null);
  }

  /** Activates or deactivates a maintenance schedule and template. */
  async updateSchedule(
    id: string,
    dto: UpdateMaintenanceScheduleBody,
    actor: Pick<JwtPayload, "sub" | "email">,
    assetIds?: string[] | null,
  ): Promise<MaintenanceScheduleItem> {
    const existing = await this.getScheduleItem(id, assetIds);
    const organizationId = await this.resolveScheduleOrg(id, assetIds);
    const actorId = await this.resolveActorId(actor);
    const now = new Date();
    await withTenant(this.db, organizationId, async (tx) => {
      await tx
        .update(maintenanceSchedules)
        .set({ active: dto.active, updatedAt: now })
        .where(eq(maintenanceSchedules.id, id));
      await tx
        .update(maintenanceTaskTemplates)
        .set({ active: dto.active })
        .where(eq(maintenanceTaskTemplates.id, existing.templateId));
      await tx.insert(auditLog).values({
        actorId,
        action: dto.active
          ? "maintenance_schedule_activate"
          : "maintenance_schedule_deactivate",
        entityType: "maintenance_schedule",
        entityId: id,
        reason:
          dto.reason ??
          (dto.active
            ? "Maintenance schedule activated"
            : "Maintenance schedule deactivated"),
        payload: {
          templateId: existing.templateId,
          assetId: existing.assetId,
          oidcSubject: actor.sub,
          actorEmail: actor.email,
        },
      });
    });
    return this.getScheduleItem(id, assetIds);
  }

  /** Converts a maintenance schedule occurrence into an audited work order. */
  async convertToWorkOrder(
    scheduleId: string,
    dto: ConvertMaintenanceBody,
    actor: Pick<JwtPayload, "sub" | "email">,
    assetIds?: string[] | null,
  ): Promise<{ workOrder: WorkOrderListItem }> {
    if (assetIds && assetIds.length === 0) {
      throw new NotFoundException("Maintenance schedule not found");
    }
    const [schedule] = await this.fleetDb
      .select({
        id: maintenanceSchedules.id,
        templateId: maintenanceSchedules.templateId,
        intervalDays: maintenanceSchedules.intervalDays,
        nextDueAt: maintenanceSchedules.nextDueAt,
        scheduleOrg: maintenanceSchedules.organizationId,
        templateOrg: maintenanceTaskTemplates.organizationId,
        assetId: maintenanceTaskTemplates.assetId,
        title: maintenanceTaskTemplates.title,
        description: maintenanceTaskTemplates.description,
        priority: maintenanceTaskTemplates.priority,
      })
      .from(maintenanceSchedules)
      .innerJoin(
        maintenanceTaskTemplates,
        eq(maintenanceSchedules.templateId, maintenanceTaskTemplates.id),
      )
      .where(
        and(
          eq(maintenanceSchedules.id, scheduleId),
          eq(maintenanceSchedules.active, true),
          eq(maintenanceTaskTemplates.active, true),
          ...(assetIds ? [inArray(maintenanceTaskTemplates.assetId, assetIds)] : []),
        ),
      )
      .limit(1);
    if (!schedule) {
      throw new NotFoundException("Maintenance schedule not found");
    }
    const organizationId = this.assertResolvedOrg(
      schedule.scheduleOrg,
      schedule.templateOrg,
    );

    const active = await this.getActiveWorkOrdersBySchedule([scheduleId]);
    if (active.has(scheduleId)) {
      throw new BadRequestException(
        "This maintenance item already has an active work order",
      );
    }

    const actorId = await this.resolveActorId(actor);
    const now = new Date();
    const nextDueBase =
      schedule.nextDueAt.getTime() > now.getTime() ? schedule.nextDueAt : now;
    const nextDueAt = new Date(
      nextDueBase.getTime() + schedule.intervalDays * 24 * 60 * 60 * 1000,
    );

    const createdWorkOrderId = await withTenant(this.db, organizationId, async (tx) => {
      const [workOrder] = await tx
        .insert(workOrders)
        .values({
          organizationId,
          assetId: schedule.assetId,
          title: `Maintenance: ${schedule.title}`,
          description:
            schedule.description ??
            `Preventive maintenance generated from schedule ${scheduleId}.`,
          status: "open",
          priority: schedule.priority,
          createdBy: actorId,
          dueAt: schedule.nextDueAt,
        })
        .returning({ id: workOrders.id });
      if (!workOrder) {
        throw new BadRequestException("Could not create work order");
      }

      await tx.insert(maintenanceHistory).values({
        organizationId,
        templateId: schedule.templateId,
        scheduleId,
        assetId: schedule.assetId,
        workOrderId: workOrder.id,
        eventType: "converted",
        notes: dto.notes ?? "Converted scheduled maintenance into a work order",
        createdBy: actorId,
      });

      await tx
        .update(maintenanceSchedules)
        .set({ nextDueAt, updatedAt: now })
        .where(eq(maintenanceSchedules.id, scheduleId));

      await tx.insert(auditLog).values({
        actorId,
        action: "maintenance_convert_to_work_order",
        entityType: "maintenance_schedule",
        entityId: scheduleId,
        reason: dto.notes ?? "Scheduled maintenance converted to work order",
        payload: {
          workOrderId: workOrder.id,
          templateId: schedule.templateId,
          assetId: schedule.assetId,
          oidcSubject: actor.sub,
          actorEmail: actor.email,
        },
      });

      return workOrder.id;
    });

    const workOrder = await this.getWorkOrder(createdWorkOrderId, assetIds);
    return { workOrder };
  }

  private async getWorkOrder(
    id: string,
    assetIds?: string[] | null,
  ): Promise<WorkOrderListItem> {
    const [row] = await this.fleetDb
      .select({
        id: workOrders.id,
        assetId: workOrders.assetId,
        alarmId: workOrders.alarmId,
        title: workOrders.title,
        description: workOrders.description,
        status: workOrders.status,
        priority: workOrders.priority,
        sortOrder: workOrders.sortOrder,
        assignedTo: workOrders.assignedTo,
        createdBy: workOrders.createdBy,
        dueAt: workOrders.dueAt,
        resolvedAt: workOrders.resolvedAt,
        closedAt: workOrders.closedAt,
        createdAt: workOrders.createdAt,
        updatedAt: workOrders.updatedAt,
        assetCode: assets.code,
        assetName: assets.name,
        siteName: assets.siteName,
      })
      .from(workOrders)
      .innerJoin(assets, eq(workOrders.assetId, assets.id))
      .where(
        and(
          eq(workOrders.id, id),
          ...(assetIds ? [inArray(workOrders.assetId, assetIds)] : []),
        ),
      )
      .limit(1);
    if (!row) {
      throw new NotFoundException("Work order not found");
    }
    return this.mapWorkOrderRow(row);
  }
}
