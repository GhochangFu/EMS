import { eq, or } from "drizzle-orm";

import { auditLog, users } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

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
 * `F3.7` §4.5 extraction — the `bms.users` lookup that resolves the `actorId`
 * every {@link insertRuleAuditLog} call above stamps.
 *
 * It lived as a private method on `RulesService` until that file reached 992 of
 * the 1000-line cap the pre-commit hook reads whole-file. It belongs here rather
 * than in a new module because the id it returns has exactly one destination:
 * `RuleAuditEntry.actorId`. `ChannelsService.audit` carries its own copy of the
 * same lookup and is deliberately not touched — merging the two is a change to
 * a second module's audit path, not this row's work.
 *
 * Takes `fleetDb`, not the tenant transaction, and unlike `insertRuleAuditLog`
 * every call site is *outside* the enclosing `withTenant`: this is a pre-tenant
 * identity read. A JWT names an actor by OIDC subject or email, neither of which
 * the tenant GUC is set from, so resolving it under the tenant connection would
 * lose the actor for exactly the org-less identity rows `bms.users` holds.
 *
 * `null` when no user matches — an actor who authenticated against the IdP but
 * has no `bms.users` row yet. The audit row is still written, unattributed,
 * rather than the write being refused.
 */
export async function resolveActorId(
  fleetDb: BmsDb,
  actor: Pick<JwtPayload, "sub" | "email">,
): Promise<string | null> {
  const [actorRow] = await fleetDb
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.id, actor.sub), eq(users.email, actor.email)))
    .limit(1);
  return actorRow?.id ?? null;
}
