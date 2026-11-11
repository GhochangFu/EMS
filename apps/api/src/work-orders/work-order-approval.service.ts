import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";

import { workOrders } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { CancelWorkOrderBody, CloseWorkOrderBody, JwtPayload, RejectWorkOrderBody, WorkOrderListItem, WorkOrderStatus } from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant, type BmsTx } from "../database/tenant-context";
import { resolveWorkOrderActor, writeWorkOrderEvent } from "./work-order-events";
import { readWorkOrderListItem } from "./work-order-projection";
import { approvalRefusal, cancelRefusal, isSelfApproval, rejectRefusal, throwIfRefused } from "./work-order-transitions";

const WORK_ORDER_NOT_FOUND = "Work order not found";

/** The 403 of an approval-class write whose caller has no `bms.users` row to stamp. */
export const WORK_ORDER_APPROVER_UNKNOWN = "Your user record was not found, so the work order was not changed";

type Actor = Pick<JwtPayload, "sub" | "email">;

/** The ticket as the row lock shows it: what each of the three decisions reads. */
type LockedWorkOrder = {
  readonly id: string;
  readonly reference: string;
  readonly status: WorkOrderStatus;
  readonly resolvedBy: string | null;
};

/** What one decision is handed inside its transaction. */
type Decision = {
  readonly tx: BmsTx;
  readonly organizationId: string;
  readonly locked: LockedWorkOrder;
  /** The approver's `bms.users.id`: never null here. */
  readonly approverId: string;
  readonly approverName: string | null;
  readonly now: Date;
};

/**
 * `E3.1` (ADR 0122 decision 6, plan T5.2) — the three writes of the `approval` class:
 *
 * - {@link approve}: `POST /work-orders/:id/close`. A `resolved` ticket becomes `closed`
 *   and takes `approved_by`, `approved_at` and `closed_at`. Self-approval is allowed and
 *   recorded (ruling Q11).
 * - {@link reject}: `POST /work-orders/:id/reject`. A `resolved` ticket goes back to
 *   `in_progress`, its resolve stamps cleared, with the approver's reason.
 * - {@link cancel}: `POST /work-orders/:id/cancel`. A live or resolved ticket becomes
 *   `cancelled`, terminal, with a reason; neither resolve gate is read (decision 6.8).
 *
 * Each follows the shape of a status write (`WorkOrdersService`): the ticket's
 * organization is resolved on the fleet pool behind the caller's asset scope, then ONE
 * `withTenant` transaction locks the work-order row, decides from the locked status,
 * writes, audits and writes the timeline event. The status route, the checklist routes
 * and the root-cause route take the same lock, so none of them can interleave with an
 * approval.
 *
 * Authorization is the controller's: the `approval` role gate, then the asset scope it
 * passes in. This service trusts both, and adds one check of its own — the caller must
 * have a `bms.users` row, because all three stamp who did it.
 */
@Injectable()
export class WorkOrderApprovalService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    @Inject(MasterDataAuditService) private readonly audit: MasterDataAuditService,
  ) {}

  /** Approves a `resolved` work order: it becomes `closed`. 409 from any other live status. */
  async approve(id: string, dto: CloseWorkOrderBody, actor: Actor, assetIds?: string[] | null): Promise<WorkOrderListItem> {
    return this.decide(id, actor, assetIds, async ({ tx, organizationId, locked, approverId, approverName, now }) => {
      throwIfRefused(approvalRefusal(locked.status));
      const selfApproved = isSelfApproval(locked.resolvedBy, approverId);
      await tx
        .update(workOrders)
        .set({
          status: "closed",
          sortOrder: dto.sortOrder,
          approvedBy: approverId,
          approvedAt: now,
          closedAt: now,
          updatedAt: now,
        })
        .where(eq(workOrders.id, id));
      await this.audit.write(
        {
          actor,
          organizationId,
          action: "work_order_approve",
          entityType: "work_order",
          entityId: id,
          reason: dto.reason,
          payload: {
            reference: locked.reference,
            fromStatus: locked.status,
            toStatus: "closed",
            // Only when true (decision 6.3): its absence reads "approved by someone else".
            ...(selfApproved ? { selfApproved: true } : {}),
            oidcSubject: actor.sub,
            actorEmail: actor.email,
          },
        },
        tx,
      );
      await writeWorkOrderEvent(tx, {
        organizationId,
        workOrderId: id,
        actor: { id: approverId, name: approverName },
        eventType: "approved",
        fromStatus: locked.status,
        toStatus: "closed",
        detail: { reason: dto.reason, ...(selfApproved ? { selfApproved: true } : {}) },
      });
    });
  }

  /** Sends a `resolved` work order back to `in_progress`, with the approver's reason. */
  async reject(id: string, dto: RejectWorkOrderBody, actor: Actor, assetIds?: string[] | null): Promise<WorkOrderListItem> {
    return this.decide(id, actor, assetIds, async ({ tx, organizationId, locked, approverId, approverName, now }) => {
      throwIfRefused(rejectRefusal(locked.status));
      await tx
        .update(workOrders)
        // Not resolved any more: the stamps go, and the SLA clock runs again (ruling P3).
        .set({ status: "in_progress", resolvedAt: null, resolvedBy: null, updatedAt: now })
        .where(eq(workOrders.id, id));
      await this.audit.write(
        {
          actor,
          organizationId,
          action: "work_order_reject",
          entityType: "work_order",
          entityId: id,
          reason: dto.reason,
          payload: {
            reference: locked.reference,
            fromStatus: locked.status,
            toStatus: "in_progress",
            oidcSubject: actor.sub,
            actorEmail: actor.email,
          },
        },
        tx,
      );
      await writeWorkOrderEvent(tx, {
        organizationId,
        workOrderId: id,
        actor: { id: approverId, name: approverName },
        eventType: "rejected",
        fromStatus: locked.status,
        toStatus: "in_progress",
        detail: { reason: dto.reason },
      });
    });
  }

  /** Cancels a live or resolved work order, with a reason. A cancelled ticket is terminal. */
  async cancel(id: string, dto: CancelWorkOrderBody, actor: Actor, assetIds?: string[] | null): Promise<WorkOrderListItem> {
    return this.decide(id, actor, assetIds, async ({ tx, organizationId, locked, approverId, approverName, now }) => {
      throwIfRefused(cancelRefusal(locked.status));
      await tx
        .update(workOrders)
        // The resolve stamps stay as history; `cancelled` alone makes the SLA read `none`.
        .set({ status: "cancelled", cancelledBy: approverId, cancelledAt: now, updatedAt: now })
        .where(eq(workOrders.id, id));
      await this.audit.write(
        {
          actor,
          organizationId,
          action: "work_order_cancel",
          entityType: "work_order",
          entityId: id,
          reason: dto.reason,
          payload: {
            reference: locked.reference,
            fromStatus: locked.status,
            toStatus: "cancelled",
            oidcSubject: actor.sub,
            actorEmail: actor.email,
          },
        },
        tx,
      );
      await writeWorkOrderEvent(tx, {
        organizationId,
        workOrderId: id,
        actor: { id: approverId, name: approverName },
        eventType: "cancelled",
        fromStatus: locked.status,
        toStatus: "cancelled",
        detail: { reason: dto.reason },
      });
    });
  }

  /**
   * The part the three writes share: scope, actor, the row lock, and the read-back in
   * the same transaction. `write` decides from `locked` and throws to refuse.
   */
  private async decide(
    id: string,
    actor: Actor,
    assetIds: string[] | null | undefined,
    write: (decision: Decision) => Promise<void>,
  ): Promise<WorkOrderListItem> {
    if (assetIds && assetIds.length === 0) {
      throw new NotFoundException(WORK_ORDER_NOT_FOUND);
    }
    // The fleet pool, because no tenant setting can exist before the organization is
    // known. 404 when the ticket is absent or out of scope: the two read the same.
    const [row] = await this.fleetDb
      .select({ organizationId: workOrders.organizationId })
      .from(workOrders)
      .where(and(eq(workOrders.id, id), ...(assetIds ? [inArray(workOrders.assetId, assetIds)] : [])))
      .limit(1);
    if (!row) {
      throw new NotFoundException(WORK_ORDER_NOT_FOUND);
    }
    const organizationId = row.organizationId;
    // Every approval-class write stamps a user (`approved_by`, `cancelled_by`) and the
    // self-approval mark compares one. A caller with no `bms.users` row cannot be
    // stamped, so it is refused rather than recorded as nobody.
    const who = await resolveWorkOrderActor(this.fleetDb, actor);
    if (who.id === null) {
      throw new ForbiddenException(WORK_ORDER_APPROVER_UNKNOWN);
    }
    const approverId = who.id;

    return withTenant(this.db, organizationId, async (tx) => {
      const [locked] = await tx
        .select({
          id: workOrders.id,
          reference: workOrders.reference,
          status: workOrders.status,
          resolvedBy: workOrders.resolvedBy,
        })
        .from(workOrders)
        .where(eq(workOrders.id, id))
        .for("update");
      if (!locked) {
        throw new NotFoundException(WORK_ORDER_NOT_FOUND);
      }
      await write({
        tx,
        organizationId,
        locked: { ...locked, status: locked.status as WorkOrderStatus },
        approverId,
        approverName: who.name,
        now: new Date(),
      });
      return readWorkOrderListItem(tx, id, assetIds);
    });
  }
}
