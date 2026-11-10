import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { organizations, workOrderSlaPolicies } from "@bms/db";
import type { BmsDb } from "@bms/db";
import {
  type JwtPayload,
  type PutWorkOrderSlaPoliciesBody,
  WORK_ORDER_SLA_DEFAULT_MINUTES,
  type WorkOrderPriority,
  type WorkOrderSlaPoliciesResponse,
  type WorkOrderSlaPolicyDto,
} from "@bms/shared";

import { resolveActorId } from "../../auth/identity-resolver";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant, type BmsTx } from "../../database/tenant-context";
import { MasterDataAuditService } from "../master-data-audit.service";

/** The read's row order: the most urgent first (plan D8). */
const PRIORITY_ORDER: readonly WorkOrderPriority[] = ["critical", "high", "medium", "low"];

/** Minutes per priority, as the audit payload records them. */
function minutesByPriority(items: readonly WorkOrderSlaPolicyDto[]): Record<WorkOrderPriority, number> {
  return Object.fromEntries(items.map((item) => [item.priority, item.resolutionMinutes])) as Record<
    WorkOrderPriority,
    number
  >;
}

/**
 * `E3.1` (ADR 0122 decision 3.2, plan D8) — an organization's work-order SLA policy.
 *
 * The read always answers the four priorities: the organization's own row where one
 * exists (`source: "organization"`), else `WORK_ORDER_SLA_DEFAULT_MINUTES`
 * (`"default"`). The write replaces the organization's whole set — a priority left out
 * goes back to the default — and audits once, all inside one `withTenant` transaction so
 * the `tenant_isolation` policy binds the delete, the insert, the read-back and the
 * audit row (ADR 0043 decision 1).
 *
 * Authorization is the controller's: the role gate, then the organization-level check.
 * This service trusts the organization id it is handed.
 */
@Injectable()
export class WorkOrderSlaPoliciesAdminService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    @Inject(MasterDataAuditService) private readonly audit: MasterDataAuditService,
  ) {}

  /** The four priorities of one organization, read under its own tenant setting. */
  /**
   * 404 for an id that names no organization. Only a global admin passes the
   * controller's check with such an id; without this the read would answer four default
   * rows for nothing, and the write would end in a foreign-key error.
   */
  private async assertOrganizationExists(organizationId: string): Promise<void> {
    const [row] = await this.fleetDb
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Organization not found");
    }
  }

  async get(organizationId: string): Promise<WorkOrderSlaPoliciesResponse> {
    await this.assertOrganizationExists(organizationId);
    return withTenant(this.db, organizationId, (tx) => this.read(tx, organizationId));
  }

  /** Replaces the organization's set, audits once, and answers the read-back. */
  async put(
    actor: Pick<JwtPayload, "sub" | "email">,
    body: PutWorkOrderSlaPoliciesBody,
  ): Promise<WorkOrderSlaPoliciesResponse> {
    const { organizationId } = body;
    await this.assertOrganizationExists(organizationId);
    // `bms.users` is a pre-tenant identity table: the actor resolves on the fleet pool (F3.78).
    const updatedBy = await resolveActorId(this.fleetDb, actor);
    return withTenant(this.db, organizationId, async (tx) => {
      const before = await this.read(tx, organizationId);
      await tx.delete(workOrderSlaPolicies).where(eq(workOrderSlaPolicies.organizationId, organizationId));
      if (body.policies.length > 0) {
        await tx.insert(workOrderSlaPolicies).values(
          body.policies.map((policy) => ({
            organizationId,
            priority: policy.priority,
            resolutionMinutes: policy.resolutionMinutes,
            updatedBy,
          })),
        );
      }
      const after = await this.read(tx, organizationId);
      await this.audit.write(
        {
          actor,
          organizationId,
          action: "work_order_sla_policy_update",
          entityType: "work_order_sla_policy",
          entityId: null,
          reason: "Work-order SLA policy replaced",
          payload: {
            before: minutesByPriority(before.items),
            after: minutesByPriority(after.items),
            oidcSubject: actor.sub,
            actorEmail: actor.email,
          },
        },
        tx,
      );
      return after;
    });
  }

  private async read(tx: BmsTx, organizationId: string): Promise<WorkOrderSlaPoliciesResponse> {
    const rows = await tx
      .select({ priority: workOrderSlaPolicies.priority, resolutionMinutes: workOrderSlaPolicies.resolutionMinutes })
      .from(workOrderSlaPolicies)
      .where(eq(workOrderSlaPolicies.organizationId, organizationId));
    const own = new Map(rows.map((row) => [row.priority, row.resolutionMinutes]));
    return {
      organizationId,
      items: PRIORITY_ORDER.map((priority): WorkOrderSlaPolicyDto => {
        const minutes = own.get(priority);
        return minutes === undefined
          ? { priority, resolutionMinutes: WORK_ORDER_SLA_DEFAULT_MINUTES[priority], source: "default" }
          : { priority, resolutionMinutes: minutes, source: "organization" };
      }),
    };
  }
}
