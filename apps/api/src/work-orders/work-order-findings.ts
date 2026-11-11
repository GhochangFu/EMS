import { and, asc, eq } from "drizzle-orm";

import { alarmEnrichments, workOrderCauseCodes, workOrders } from "@bms/db";
import type { WorkOrderAlarmSnapshot, WorkOrderCauseCodeDto } from "@bms/shared";
import { BadRequestException } from "@nestjs/common";

import type { BmsTx } from "../database/tenant-context";

/**
 * `E3.1` (ADR 0122 decisions 5 and 5a) — the reads behind a ticket's findings and its
 * alarm snapshot. Each takes the caller's executor and reads on it.
 *
 * `bms.work_order_cause_codes` is platform vocabulary: it has no tenant column and no
 * row security, so reading it needs no tenant setting. `bms.alarm_enrichments` is a
 * tenant table: {@link readAlarmEnrichmentForSnapshot} must run inside the write's
 * tenant transaction, where an alarm of another organization reads as absent.
 */

/** The one sentence for a cause code that cannot be used. */
export const CAUSE_CODE_REFUSAL = "Unknown or retired cause code";

type CauseCodeReader = Pick<BmsTx, "select">;

/** The active cause codes in display order (`GET /work-orders/cause-codes`). A retired code is not offered. */
export async function readActiveCauseCodes(db: CauseCodeReader): Promise<WorkOrderCauseCodeDto[]> {
  return db
    .select({ code: workOrderCauseCodes.code, label: workOrderCauseCodes.label, sortOrder: workOrderCauseCodes.sortOrder })
    .from(workOrderCauseCodes)
    .where(eq(workOrderCauseCodes.active, true))
    .orderBy(asc(workOrderCauseCodes.sortOrder), asc(workOrderCauseCodes.code));
}

/**
 * 400 for a cause code that is not an ACTIVE row of the vocabulary. Checked here so the
 * caller reads a sentence, not a foreign-key error; a retired code stays on the tickets
 * that already carry it and cannot be given to another.
 */
export async function assertActiveCauseCode(db: CauseCodeReader, code: string): Promise<void> {
  const [row] = await db
    .select({ code: workOrderCauseCodes.code })
    .from(workOrderCauseCodes)
    .where(and(eq(workOrderCauseCodes.code, code), eq(workOrderCauseCodes.active, true)))
    .limit(1);
  if (!row) {
    throw new BadRequestException(CAUSE_CODE_REFUSAL);
  }
}

/** The four values `insertWorkOrder` copies from an alarm's enrichment (`E3.4`). */
export type AlarmEnrichmentForSnapshot = {
  readonly rootCause: string | null;
  readonly correctiveActions: string | null;
  readonly skillCode: string | null;
  readonly etrAt: Date | null;
};

/**
 * The alarm's enrichment as it stands now, or `null` when it has none. Read inside the
 * create's tenant transaction (plan D17): the values come from the server's own row,
 * never from the request, and another organization's enrichment is invisible here. A
 * retired skill code already on the enrichment is copied as it is.
 */
export async function readAlarmEnrichmentForSnapshot(
  tx: BmsTx,
  input: { readonly organizationId: string; readonly alarmId: string },
): Promise<AlarmEnrichmentForSnapshot | null> {
  const [row] = await tx
    .select({
      rootCause: alarmEnrichments.rootCause,
      correctiveActions: alarmEnrichments.correctiveActions,
      skillCode: alarmEnrichments.skillCode,
      etrAt: alarmEnrichments.etrAt,
    })
    .from(alarmEnrichments)
    .where(and(eq(alarmEnrichments.alarmId, input.alarmId), eq(alarmEnrichments.organizationId, input.organizationId)))
    .limit(1);
  return row ?? null;
}

/** What the detail read adds from the ticket's own row: the findings, who resolved it, and the alarm snapshot. */
export type WorkOrderFindingsRead = {
  readonly rootCause: string | null;
  readonly correctiveAction: string | null;
  readonly preventiveAction: string | null;
  readonly resolvedBy: string | null;
  readonly alarmSnapshot: WorkOrderAlarmSnapshot | null;
};

const NO_FINDINGS: WorkOrderFindingsRead = {
  rootCause: null,
  correctiveAction: null,
  preventiveAction: null,
  resolvedBy: null,
  alarmSnapshot: null,
};

/**
 * The findings and the snapshot of one ticket. The snapshot is `null` when all four of
 * its columns are: a ticket with no alarm, an alarm that had no enrichment, or a ticket
 * older than the columns (decision 5a.4).
 */
export async function readWorkOrderFindings(tx: BmsTx, workOrderId: string): Promise<WorkOrderFindingsRead> {
  const [row] = await tx
    .select({
      rootCause: workOrders.rootCause,
      correctiveAction: workOrders.correctiveAction,
      preventiveAction: workOrders.preventiveAction,
      resolvedBy: workOrders.resolvedBy,
      snapshotRootCause: workOrders.alarmRootCause,
      snapshotCorrectiveActions: workOrders.alarmCorrectiveActions,
      snapshotSkillCode: workOrders.alarmSkillCode,
      snapshotEtrAt: workOrders.alarmEtrAt,
    })
    .from(workOrders)
    .where(eq(workOrders.id, workOrderId))
    .limit(1);
  if (!row) {
    return NO_FINDINGS;
  }
  const hasSnapshot =
    row.snapshotRootCause !== null ||
    row.snapshotCorrectiveActions !== null ||
    row.snapshotSkillCode !== null ||
    row.snapshotEtrAt !== null;
  return {
    rootCause: row.rootCause,
    correctiveAction: row.correctiveAction,
    preventiveAction: row.preventiveAction,
    resolvedBy: row.resolvedBy,
    alarmSnapshot: hasSnapshot
      ? {
          rootCause: row.snapshotRootCause,
          correctiveActions: row.snapshotCorrectiveActions,
          skillCode: row.snapshotSkillCode,
          etrAt: row.snapshotEtrAt?.toISOString() ?? null,
        }
      : null,
  };
}
