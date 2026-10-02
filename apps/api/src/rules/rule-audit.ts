import { auditLog } from "@bms/db";

import type { BmsTx } from "../database/tenant-context";

export type RuleAuditEntry = {
  organizationId: string | null;
  actorId: string | null;
  action: string;
  entityId: string | null;
  reason?: string;
  payload?: Record<string, unknown>;
};

/**
 * `E7.1c` (item D) §4.5 extraction — the `tx.insert(auditLog).values({...})`
 * shape every tenant-scoped write in `RulesService` repeats, lifted out so the
 * organizationId stamp (Amendment 5) fits under the 1000-line cap. Same
 * precedent as `rule-reads.ts` / `rule-samples.ts` (E7.1b).
 *
 * `entityType` is always `"automation_rule"` here. `previewRule`'s audit
 * write is NOT this helper — it runs on `fleetDb` with no enclosing `tx` and
 * a permanently `null` organizationId (a preview may evaluate an unsaved
 * draft), so it stays a direct `fleetDb.insert(auditLog)` call in the service.
 *
 * Takes the transaction, not the service's `db`/`fleetDb`: every call site is
 * inside an open `withTenant` transaction, and the whole point of Amendment 5
 * is that the stamped `organizationId` must equal that transaction's own GUC.
 */
export async function insertRuleAuditLog(tx: BmsTx, entry: RuleAuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    organizationId: entry.organizationId,
    actorId: entry.actorId,
    action: entry.action,
    entityType: "automation_rule",
    entityId: entry.entityId,
    reason: entry.reason ?? null,
    payload: entry.payload ?? null,
  });
}

/**
 * The `bms.users` lookup that resolves the `actorId` every
 * {@link insertRuleAuditLog} call above stamps. Since `F3.78` (ADR 0089
 * decision 4) it is a re-export of the shared resolver: the actor is the row
 * whose OIDC subject (or, under local auth, id) the token names, never the row
 * whose email matches. Callers pass `fleetDb`, outside the enclosing
 * `withTenant` — a pre-tenant identity read, so an org-less `admin` row still
 * resolves. `null` when no user matches; the audit row is still written,
 * unattributed.
 */
export { resolveActorId } from "../auth/identity-resolver";
