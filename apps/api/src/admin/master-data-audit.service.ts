import { Inject, Injectable } from "@nestjs/common";
import { or, eq } from "drizzle-orm";

import { auditLog, users } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";

type AuditInput = {
  actor: Pick<JwtPayload, "sub" | "email">;
  action: string;
  entityType: string;
  /**
   * `F3.40` — `string | null`, because `bms.audit_log.entity_id` is `uuid` and
   * not every audited entity is keyed by one.
   *
   * The column has always been nullable; every caller before `F3.40` happened
   * to audit a table with a `uuid` primary key, so the type could be narrower
   * than the column without anyone noticing. `bms.asset_roles` is the first
   * that is not: `0051` made `code varchar(64)` its primary key deliberately,
   * and passing `'meter'` here would reach Postgres as `22P02 invalid input
   * syntax for type uuid` — a 500 on a write that had already succeeded.
   *
   * **Pass `null` and put the key in `payload`.** A vocabulary edit is
   * identified by `entityType` plus the code in its payload, which is what the
   * audit read surface already renders; inventing a synthetic uuid, or widening
   * the column to text, would both cost more than they buy. Do not relax this
   * to `string | undefined` — `undefined` would make the field skippable, and
   * a caller that simply forgets it is exactly what the `E7.1c` note below
   * refuses for `organizationId`.
   */
  entityId: string | null;
  /**
   * E7.1c (item D) — required, not optional. `bms.audit_log.organization_id`
   * keeps a legitimate `NULL` (ADR 0043 decision 5: a platform event belongs
   * to no tenant), but after `0048` the `NULL` branch of `audit_log`'s
   * `WITH CHECK` is scoped `TO bms_fleet`. That turns "which pool, which
   * value" into a decision every caller must make by hand:
   *
   * - A tenant-scoped mutation: pass the **enclosing `withTenant` transaction's
   *   own organization id**, and pass that same transaction as `executor` (see
   *   below) — the stamped value and the GUC must agree or the strict
   *   `WITH CHECK` on `bms_tenant` refuses the row.
   * - A genuine platform/fleet event (no tenant owns the action, e.g.
   *   `organizations.service.ts` creating the organization itself): pass
   *   `null` **and** pass `this.fleetDb` as `executor` explicitly — `NULL` is
   *   only admitted `TO bms_fleet` now, never `TO bms_tenant`.
   *
   * Making the field required is deliberate: every call site had to be
   * touched and reasoned about once, rather than silently inheriting a
   * default that is wrong half the time.
   */
  organizationId: string | null;
  reason?: string;
  payload?: Record<string, unknown>;
};

/** Writes audit rows for master-data mutations. */
@Injectable()
export class MasterDataAuditService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
  ) {}

  /**
   * Persists a master-data audit log entry.
   *
   * `executor` lets a caller pass its own open `tx` instead of `this.db`.
   * **Required** when the write happens inside a transaction: `pg`'s pool
   * defaults to `max: 10` with no acquisition timeout
   * (`apps/api/src/database/database.module.ts`), so asking the pool for a
   * *second* client while the first sits inside an open transaction can wedge
   * every pooled client waiting on one another with no timeout to break the
   * deadlock. Passing `tx` also makes the audit row atomic with the mutation
   * it describes — without it, a rolled-back transaction can leave an audit
   * row on disk describing a write that never happened.
   *
   * **E7.1c (item D) — the default `executor = this.db` is now a trap, not a
   * convenience.** `this.db` is the plain tenant pool with no GUC set. After
   * `0048` BOTH a `null` and a real `organizationId` fail on it: `null` fails
   * because the tenant-role `NULL` branch is gone (scoped `TO bms_fleet`
   * only), and a real id fails because the strict `WITH CHECK`
   * (`organization_id = current_setting('app.current_organization')`) sees an
   * unset GUC on that connection. There is no longer a safe default — every
   * caller must pass an `executor` that matches the `organizationId` it is
   * stamping: the enclosing `withTenant` transaction for a tenant-scoped
   * `organizationId`, or `this.fleetDb` for `null`. The parameter keeps its
   * default only so a caller that already opened its own tenant transaction
   * reads naturally as `write(input, tx)`; it is not a "leave it out and it
   * will still work" default any more.
   *
   * E7.1b Amendment 4 — the actor identity read runs on `fleetDb` (`bms_fleet`,
   * BYPASSRLS), not on the write `executor`. `bms.users` gains a NULL-tolerant
   * `tenant_isolation` policy + FORCE in `0047`. The audit-outside-`withTenant`
   * callers (assets, rtus, point-keys) invoke `write` with no
   * `app.current_organization` set, so a bare tenant read there would see only
   * NULL-org users — and a scoped actor's `organization_id` is non-NULL after
   * the `0046` backfill, so `actorId` would silently resolve to NULL and the
   * audit row would lose its actor. The fleet pool sees the row regardless of
   * org, and it is a separate `pg` pool from the tenant one, so this second
   * lookup never contends with an open tenant transaction on `executor`. That
   * split survives E7.1c unchanged: only the insert's `organization_id` and
   * its `executor` changed, never the actor lookup.
   */
  async write(input: AuditInput, executor: BmsDb = this.db): Promise<void> {
    const [actorRow] = await this.fleetDb
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.id, input.actor.sub), eq(users.email, input.actor.email)))
      .limit(1);

    await executor.insert(auditLog).values({
      organizationId: input.organizationId,
      actorId: actorRow?.id ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      reason: input.reason ?? null,
      payload: input.payload ?? null,
    });
  }
}
