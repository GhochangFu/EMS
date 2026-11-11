import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";

import { workOrders } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload, PutWorkOrderRootCauseBody, WorkOrderCauseCodesResponse, WorkOrderDetail, WorkOrderStatus } from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import { readWorkOrderDetail } from "./work-order-detail";
import { resolveWorkOrderActor, writeWorkOrderEvent } from "./work-order-events";
import { assertActiveCauseCode, readActiveCauseCodes } from "./work-order-findings";
import { rootCauseMissing, rootCauseWriteRefusal, throwIfRefused } from "./work-order-transitions";

const WORK_ORDER_NOT_FOUND = "Work order not found";

type Actor = Pick<JwtPayload, "sub" | "email">;

/**
 * `E3.1` (ADR 0122 decision 5, plan T4.3) — a ticket's findings: the technician's root
 * cause, corrective action, preventive action and coded cause
 * (`PUT /work-orders/:id/root-cause`), and the list of codes to choose from.
 *
 * The write follows the shape of a status write (`WorkOrdersService`): the ticket's
 * organization is resolved on the fleet pool behind the caller's asset scope, then ONE
 * `withTenant` transaction locks the work-order row, replaces the findings, audits and
 * writes a `root_cause_set` timeline event. `WorkOrdersService.updateStatus` takes the
 * same lock and reads the findings under it, so a resolve and a root-cause write cannot
 * interleave: a ticket cannot be resolved on findings that are being cleared.
 *
 * Findings are editable up to `resolved` and frozen at `closed` (decision 5.3); a
 * resolved ticket raised from an alarm must keep the three it resolved with.
 *
 * Authorization is the controller's: the `operational` role gate, then the asset scope
 * it passes in. This service trusts both.
 */
@Injectable()
export class WorkOrderFindingsService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    @Inject(MasterDataAuditService) private readonly audit: MasterDataAuditService,
  ) {}

  /**
   * The active cause codes (`GET /work-orders/cause-codes`). `bms.work_order_cause_codes`
   * is platform vocabulary with no tenant column and no row security, so it is read on
   * the tenant pool with no tenant setting, as `VocabulariesService` reads the others.
   */
  async listCauseCodes(): Promise<WorkOrderCauseCodesResponse> {
    return { items: await readActiveCauseCodes(this.db) };
  }

  /** Replaces a ticket's findings and answers the ticket's detail. */
  async putRootCause(
    workOrderId: string,
    dto: PutWorkOrderRootCauseBody,
    actor: Actor,
    assetIds?: string[] | null,
  ): Promise<WorkOrderDetail> {
    if (assetIds && assetIds.length === 0) {
      throw new NotFoundException(WORK_ORDER_NOT_FOUND);
    }
    // The fleet pool, because no tenant setting can exist before the organization is
    // known. 404 when the ticket is absent or out of scope: the two read the same.
    const [row] = await this.fleetDb
      .select({ organizationId: workOrders.organizationId })
      .from(workOrders)
      .where(and(eq(workOrders.id, workOrderId), ...(assetIds ? [inArray(workOrders.assetId, assetIds)] : [])))
      .limit(1);
    if (!row) {
      throw new NotFoundException(WORK_ORDER_NOT_FOUND);
    }
    const organizationId = row.organizationId;
    const who = await resolveWorkOrderActor(this.fleetDb, actor);
    const next = {
      rootCause: dto.rootCause,
      correctiveAction: dto.correctiveAction,
      preventiveAction: dto.preventiveAction ?? null,
      causeCode: dto.causeCode,
    };

    return withTenant(this.db, organizationId, async (tx) => {
      const [locked] = await tx
        .select({
          id: workOrders.id,
          reference: workOrders.reference,
          status: workOrders.status,
          alarmId: workOrders.alarmId,
          rootCause: workOrders.rootCause,
          correctiveAction: workOrders.correctiveAction,
          preventiveAction: workOrders.preventiveAction,
          causeCode: workOrders.causeCode,
        })
        .from(workOrders)
        .where(eq(workOrders.id, workOrderId))
        .for("update");
      if (!locked) {
        throw new NotFoundException(WORK_ORDER_NOT_FOUND);
      }
      const hasAlarm = locked.alarmId !== null;
      throwIfRefused(
        rootCauseWriteRefusal({
          status: locked.status as WorkOrderStatus,
          hasAlarm,
          missingAfter: rootCauseMissing({ hasAlarm, ...next }),
        }),
      );
      // A code the ticket already carries may stay, retired or not; a new one must be active.
      if (next.causeCode !== null && next.causeCode !== locked.causeCode) {
        await assertActiveCauseCode(tx, next.causeCode);
      }
      const changed =
        next.rootCause !== locked.rootCause ||
        next.correctiveAction !== locked.correctiveAction ||
        next.preventiveAction !== locked.preventiveAction ||
        next.causeCode !== locked.causeCode;
      if (changed) {
        const updated = await tx
          .update(workOrders)
          .set({ ...next, updatedAt: new Date() })
          .where(eq(workOrders.id, workOrderId))
          .returning({ id: workOrders.id });
        if (updated.length === 0) {
          // Under FORCE row security an UPDATE that matches nothing raises nothing.
          throw new NotFoundException(WORK_ORDER_NOT_FOUND);
        }
        await this.audit.write(
          {
            actor,
            organizationId,
            action: "work_order_root_cause_set",
            entityType: "work_order",
            entityId: locked.id,
            reason: "Work order root cause recorded",
            // The findings' text stays on the ticket: the audit row names the coded cause
            // and says which of the three texts are now filled.
            payload: {
              reference: locked.reference,
              causeCode: next.causeCode,
              hasRootCause: next.rootCause !== null,
              hasCorrectiveAction: next.correctiveAction !== null,
              hasPreventiveAction: next.preventiveAction !== null,
              oidcSubject: actor.sub,
              actorEmail: actor.email,
            },
          },
          tx,
        );
        await writeWorkOrderEvent(tx, {
          organizationId,
          workOrderId: locked.id,
          actor: who,
          eventType: "root_cause_set",
          detail: next.causeCode === null ? {} : { causeCode: next.causeCode },
        });
      }
      return readWorkOrderDetail(tx, locked.id, assetIds);
    });
  }
}
