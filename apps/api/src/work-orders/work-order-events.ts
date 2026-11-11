import { workOrderEvents } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { workOrderEventDetailSchema } from "@bms/shared";
import type { JwtPayload, WorkOrderEventDetail, WorkOrderEventType, WorkOrderStatus } from "@bms/shared";

import { resolveIdentity } from "../auth/identity-resolver";
import type { BmsTx } from "../database/tenant-context";

/**
 * `E3.1` (ADR 0122 decision 7, plan D6 and D16) — the one writer of
 * `bms.work_order_events`, a work order's timeline.
 *
 * Call {@link writeWorkOrderEvent} inside the transaction that makes the change, so the
 * change and its event commit or roll back together. The table is append-only by
 * privilege (migration `0144`): there is no update and no delete to write.
 */

/** Who did it, as the timeline records them. */
export type WorkOrderActor = {
  /** `bms.users.id`, or null for an actor with no user row. */
  readonly id: string | null;
  /** The display name saved on the event (ruling P7). Never an email, never a subject. */
  readonly name: string | null;
};

/**
 * The actor of a write, resolved ONCE per request on the fleet pool.
 *
 * `bms.users` is a pre-tenant identity table: under a tenant setting a global admin's
 * row is not visible, so a tenant-pool read would drop the name of exactly the actor a
 * tenant reader could not otherwise name. One source covers every writer — an
 * organization user, a global admin, and a confirmed copilot change, which is the same
 * route call with the user's own token (plan D16).
 */
export async function resolveWorkOrderActor(
  fleetDb: BmsDb,
  jwt: Pick<JwtPayload, "sub">,
): Promise<WorkOrderActor> {
  const identity = await resolveIdentity(fleetDb, jwt);
  return { id: identity?.id ?? null, name: identity?.displayName ?? null };
}

export type WorkOrderEventInput = {
  readonly organizationId: string;
  readonly workOrderId: string;
  readonly eventType: WorkOrderEventType;
  readonly actor: WorkOrderActor;
  readonly fromStatus?: WorkOrderStatus | null;
  readonly toStatus?: WorkOrderStatus | null;
  readonly detail?: WorkOrderEventDetail;
};

/**
 * The event type of a status move: entering `resolved` is its own type, so the stepper
 * and the SLA can find the moment without reading `to_status`.
 */
export function statusEventType(toStatus: WorkOrderStatus): WorkOrderEventType {
  return toStatus === "resolved" ? "resolved" : "status_changed";
}

/**
 * Inserts one event. `detail` goes through the closed, strict
 * `workOrderEventDetailSchema` first, so a key that is not in the contract — an email,
 * a subject — is refused here instead of reaching the table.
 */
export async function writeWorkOrderEvent(tx: BmsTx, input: WorkOrderEventInput): Promise<void> {
  // `safeParse`, not `parse`: a `ZodError` that escaped here would reach the global
  // filter and tell the caller their request was malformed (ADR 0060). A bad detail is
  // this server's own defect, so it is a plain error and a 500.
  const parsed = workOrderEventDetailSchema.safeParse(input.detail ?? {});
  if (!parsed.success) {
    throw new Error(`work-order event detail does not match its contract (${input.eventType})`);
  }
  const detail = parsed.data;
  await tx.insert(workOrderEvents).values({
    organizationId: input.organizationId,
    workOrderId: input.workOrderId,
    eventType: input.eventType,
    actorId: input.actor.id,
    actorName: input.actor.name,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    detail,
  });
}
