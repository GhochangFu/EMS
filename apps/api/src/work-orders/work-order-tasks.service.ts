import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";

import { assets, workOrderChecklistTemplateItems, workOrderChecklistTemplates, workOrders, workOrderTasks } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  JwtPayload,
  UpdateWorkOrderTaskBody,
  WorkOrderChecklistTemplateDto,
  WorkOrderChecklistTemplatesResponse,
  WorkOrderTaskDto,
} from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import { readWorkOrderTask } from "./work-order-checklist";
import { resolveWorkOrderActor, writeWorkOrderEvent } from "./work-order-events";
import { lockWorkOrderForChecklistWrite, readBackTask, resolveTaskWorkOrderOrganization, TASK_NOT_FOUND } from "./work-order-task-write";

type Actor = Pick<JwtPayload, "sub" | "email">;

/**
 * `E3.1` (ADR 0122 decision 4, plan T3.2 and T3.3) — a ticket's checklist: set an item's
 * result or note (`PATCH /work-orders/:id/tasks/:taskId`), and list the templates that
 * fit an asset. Adding an item is `WorkOrderTaskAddService`; see
 * `work-order-task-write.ts` for the shape both writes share.
 *
 * Authorization is the controller's: the `operational` role gate, then the asset scope
 * it passes in. This service trusts both.
 */
@Injectable()
export class WorkOrderTasksService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    @Inject(MasterDataAuditService) private readonly audit: MasterDataAuditService,
  ) {}

  /**
   * Sets one item's result, its note, or both (`PATCH /work-orders/:id/tasks/:taskId`).
   * Leaving `pending` stamps who and when; going back to `pending` clears both. A write
   * that changes nothing writes no audit row and no event; a note-only write audits and
   * writes no event.
   */
  async updateTask(
    workOrderId: string,
    taskId: string,
    dto: UpdateWorkOrderTaskBody,
    actor: Actor,
    assetIds?: string[] | null,
  ): Promise<WorkOrderTaskDto> {
    const organizationId = await resolveTaskWorkOrderOrganization(this.fleetDb, workOrderId, assetIds);
    const who = await resolveWorkOrderActor(this.fleetDb, actor);
    return withTenant(this.db, organizationId, async (tx) => {
      const ticket = await lockWorkOrderForChecklistWrite(tx, workOrderId);
      // The work-order match is part of the read: a task id of another ticket is a 404
      // here, never a write on that other ticket.
      const before = await readWorkOrderTask(tx, workOrderId, taskId);
      if (before === null) {
        throw new NotFoundException(TASK_NOT_FOUND);
      }
      const result = dto.result ?? before.result;
      const note = dto.note === undefined ? before.note : dto.note;
      const resultChanged = result !== before.result;
      const noteChanged = note !== before.note;
      if (!resultChanged && !noteChanged) {
        return before;
      }

      const now = new Date();
      const [updated] = await tx
        .update(workOrderTasks)
        .set({
          result,
          note,
          ...(resultChanged
            ? result === "pending"
              ? { completedAt: null, completedBy: null }
              : { completedAt: now, completedBy: who.id }
            : {}),
        })
        .where(and(eq(workOrderTasks.id, taskId), eq(workOrderTasks.workOrderId, workOrderId)))
        .returning({ id: workOrderTasks.id });
      if (!updated) {
        // Under FORCE row security an UPDATE that matches nothing raises nothing.
        throw new NotFoundException(TASK_NOT_FOUND);
      }
      await tx.update(workOrders).set({ updatedAt: now }).where(eq(workOrders.id, workOrderId));

      await this.audit.write(
        {
          actor,
          organizationId,
          action: "work_order_task_update",
          entityType: "work_order",
          entityId: workOrderId,
          reason: resultChanged ? `Checklist item marked ${result}` : "Checklist item note changed",
          // The note's text stays on the task: the audit row says only that it changed.
          payload: {
            reference: ticket.reference,
            taskId: before.id,
            fromResult: before.result,
            toResult: result,
            noteChanged,
            oidcSubject: actor.sub,
            actorEmail: actor.email,
          },
        },
        tx,
      );
      // The timeline records a result change only: it carries the item and its new result,
      // never the note (decision 7.4: `detail` holds no free text beyond a typed reason).
      // A note-only edit is in the audit row above and writes no event, so the timeline
      // never reads "marked pending" for a ticket where only a note was typed.
      if (resultChanged) {
        await writeWorkOrderEvent(tx, {
          organizationId,
          workOrderId,
          actor: who,
          eventType: "task_updated",
          // The database's own spelling of the id: the path's may be upper case.
          detail: { taskId: before.id, result },
        });
      }
      return readBackTask(tx, workOrderId, taskId);
    });
  }

  /**
   * The active checklist templates that fit one asset: those of the asset's organization
   * whose domain is the asset's or none (`GET /work-orders/checklist-templates?assetId=`,
   * ruling P6). For anyone who can read the asset, so an operator's create form can
   * offer them; an asset outside the caller's read scope answers an empty list, the
   * same as an asset that does not exist.
   */
  async listTemplatesForAsset(assetId: string, assetIds?: string[] | null): Promise<WorkOrderChecklistTemplatesResponse> {
    // Postgres answers a uuid in lower case, and so does the scope list; the query's may be upper case.
    const id = assetId.toLowerCase();
    if (assetIds && !assetIds.includes(id)) {
      return { items: [] };
    }
    // The fleet pool, because the asset's organization must be known before a tenant
    // setting can exist. The caller's scope was checked on the line above.
    const [asset] = await this.fleetDb
      .select({ organizationId: assets.organizationId, domain: assets.domain })
      .from(assets)
      .where(eq(assets.id, id))
      .limit(1);
    if (!asset?.organizationId) {
      return { items: [] };
    }
    const organizationId = asset.organizationId;
    return withTenant(this.db, organizationId, async (tx) => {
      const templates = await tx
        .select({
          id: workOrderChecklistTemplates.id,
          organizationId: workOrderChecklistTemplates.organizationId,
          name: workOrderChecklistTemplates.name,
          domain: workOrderChecklistTemplates.domain,
          active: workOrderChecklistTemplates.active,
          createdAt: workOrderChecklistTemplates.createdAt,
          updatedAt: workOrderChecklistTemplates.updatedAt,
        })
        .from(workOrderChecklistTemplates)
        .where(
          and(
            eq(workOrderChecklistTemplates.organizationId, organizationId),
            eq(workOrderChecklistTemplates.active, true),
            or(isNull(workOrderChecklistTemplates.domain), eq(workOrderChecklistTemplates.domain, asset.domain)),
          ),
        )
        .orderBy(asc(workOrderChecklistTemplates.name), asc(workOrderChecklistTemplates.id));
      if (templates.length === 0) {
        return { items: [] };
      }
      const items = await tx
        .select({
          id: workOrderChecklistTemplateItems.id,
          templateId: workOrderChecklistTemplateItems.templateId,
          title: workOrderChecklistTemplateItems.title,
          mandatory: workOrderChecklistTemplateItems.mandatory,
          sortOrder: workOrderChecklistTemplateItems.sortOrder,
        })
        .from(workOrderChecklistTemplateItems)
        .where(
          inArray(
            workOrderChecklistTemplateItems.templateId,
            templates.map((template) => template.id),
          ),
        )
        .orderBy(asc(workOrderChecklistTemplateItems.sortOrder), asc(workOrderChecklistTemplateItems.id));
      return {
        items: templates.map(
          (template): WorkOrderChecklistTemplateDto => ({
            id: template.id,
            organizationId: template.organizationId,
            name: template.name,
            domain: template.domain,
            active: template.active,
            items: items
              .filter((item) => item.templateId === template.id)
              .map((item) => ({ id: item.id, title: item.title, mandatory: item.mandatory, sortOrder: item.sortOrder })),
            createdAt: template.createdAt.toISOString(),
            updatedAt: template.updatedAt.toISOString(),
          }),
        ),
      };
    });
  }
}
