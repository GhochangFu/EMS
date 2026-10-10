import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";

import { isValidOrganizationTimeZone } from "../admin/organizations/organizations.schema";
import type { ResolvedIdentity } from "../auth/identity-resolver";
import { TENANT_DRIZZLE } from "../database/database.tokens";
import { withUser } from "../database/user-context";
import { addLocalDays, formatIsoDate, type LocalDate, localDateOf, toInstant } from "../reports/report-period";
import { COPILOT_USAGE_LIMITS, type CopilotUsageLimits } from "./copilot-config";

/** What `consumeTurn` needs from the caller: who, and their home organization (`null` for the global admin). */
export type UsageIdentity = Pick<ResolvedIdentity, "id" | "organizationId">;

export type ConsumeTurnResult =
  | { ok: true }
  | { ok: false; scope: "user" | "organization"; resetsAt: string };

/** The statements one `consumeTurn` runs, all inside one transaction. */
export interface CopilotUsageTx {
  /** The stored timezone of each named organization that exists. */
  timezonesOf(organizationIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /** +1 on the user's counter for `day` when it is below `limit`; `false` when the limit is reached. */
  incrementUser(userId: string, day: string, limit: number): Promise<boolean>;
  /** The same for the organization's counter. */
  incrementOrganization(organizationId: string, day: string, limit: number): Promise<boolean>;
}

/** Runs `fn` in one transaction; a throw rolls everything back. */
export interface CopilotUsageStore {
  transaction<T>(userId: string, organizationId: string | null, fn: (tx: CopilotUsageTx) => Promise<T>): Promise<T>;
}

const UTC = "UTC";

/** A stored zone this runtime can format, else UTC. The column has no CHECK, so a stray value must not fail a turn. */
function governingZone(stored: string | undefined): string {
  return stored !== undefined && isValidOrganizationTimeZone(stored) ? stored : UTC;
}

/** `report-period`'s helpers refuse a slash-less name, so UTC is computed directly. */
function localDateIn(now: Date, zone: string): LocalDate {
  return zone === UTC
    ? { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() }
    : localDateOf(now, zone);
}

/** The calendar date of `now` in `zone`, `YYYY-MM-DD` — the counter's `day` key (A2). */
export function usageDayIn(now: Date, zone: string): string {
  return formatIsoDate(localDateIn(now, zone));
}

/** The first midnight in `zone` after `now`, as an instant. */
export function nextMidnightIn(now: Date, zone: string): Date {
  const tomorrow = addLocalDays(localDateIn(now, zone), 1);
  return zone === UTC
    ? new Date(Date.UTC(tomorrow.year, tomorrow.month - 1, tomorrow.day))
    : toInstant(tomorrow, { hour: 0, minute: 0 }, zone);
}

/** Thrown inside the transaction so it rolls back; caught outside and turned into the refusal. */
class TurnRefused extends Error {
  constructor(readonly result: Extract<ConsumeTurnResult, { ok: false }>) {
    super(`copilot turn refused: ${result.scope} limit`);
  }
}

/**
 * `consumeTurn` over any store. The user counter's day is taken in the home
 * organization's zone (UTC for the global admin), the organization counter's in
 * the bound organization's zone, so the two days may differ inside one turn.
 * A refusal **throws** inside the transaction: a refused turn counts nowhere,
 * and the user increment is undone by the rollback, never by a `turns - 1`.
 */
export async function consumeTurnWith(
  store: CopilotUsageStore,
  limits: CopilotUsageLimits,
  identity: UsageIdentity,
  organizationId: string | null,
  now: Date,
): Promise<ConsumeTurnResult> {
  try {
    await store.transaction(identity.id, organizationId, async (tx) => {
      const named = [identity.organizationId, organizationId].filter((id): id is string => id !== null);
      const zones = named.length > 0 ? await tx.timezonesOf([...new Set(named)]) : new Map<string, string>();
      const userZone = identity.organizationId === null ? UTC : governingZone(zones.get(identity.organizationId));
      if (!(await tx.incrementUser(identity.id, usageDayIn(now, userZone), limits.userDailyTurns))) {
        throw new TurnRefused({ ok: false, scope: "user", resetsAt: nextMidnightIn(now, userZone).toISOString() });
      }
      if (organizationId !== null) {
        const orgZone = governingZone(zones.get(organizationId));
        if (!(await tx.incrementOrganization(organizationId, usageDayIn(now, orgZone), limits.organizationDailyTurns))) {
          throw new TurnRefused({
            ok: false,
            scope: "organization",
            resetsAt: nextMidnightIn(now, orgZone).toISOString(),
          });
        }
      }
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof TurnRefused) {
      return err.result;
    }
    throw err;
  }
}

/**
 * The real store, on `bms_tenant` inside `withUser(..., { organizationId })`,
 * which sets `app.current_user` and `app.current_organization` in one
 * transaction (Amendment 1 A1).
 *
 * **The timezone read.** `bms.organizations` has no row-level security and
 * `bms_tenant` may select it, so one read in the same transaction serves every
 * caller: a scoped admin with or without a bound organization, and the global
 * admin bound to one.
 *
 * **The increment.** `INSERT … ON CONFLICT DO UPDATE … WHERE turns < $limit
 * RETURNING turns`: no row returned means the limit is reached. The insert path
 * writes `1`, which every limit allows (`copilot-config.ts` never yields < 1).
 * The upsert takes the row lock, so two concurrent turns at `limit - 1` cannot
 * both pass. `day` is bound from the caller's `now`, never `CURRENT_DATE`.
 */
export function sqlCopilotUsageStore(tenantDb: BmsDb): CopilotUsageStore {
  return {
    transaction: (userId, organizationId, fn) =>
      withUser(
        tenantDb,
        userId,
        (db) =>
          fn({
            async timezonesOf(ids) {
              const { rows } = await db.execute<{ id: string; timezone: string }>(sql`
                SELECT id, timezone FROM bms.organizations
                 WHERE id IN (${sql.join(
                   ids.map((id) => sql`${id}::uuid`),
                   sql`, `,
                 )})`);
              return new Map(rows.map((r) => [r.id, r.timezone]));
            },
            async incrementUser(id, day, limit) {
              const { rows } = await db.execute(sql`
                INSERT INTO bms.copilot_usage AS u (user_id, day, turns)
                VALUES (${id}, ${day}::date, 1)
                ON CONFLICT (user_id, day) DO UPDATE SET turns = u.turns + 1
                 WHERE u.turns < ${limit}
                RETURNING u.turns`);
              return rows.length === 1;
            },
            async incrementOrganization(id, day, limit) {
              const { rows } = await db.execute(sql`
                INSERT INTO bms.copilot_org_usage AS o (organization_id, day, turns)
                VALUES (${id}, ${day}::date, 1)
                ON CONFLICT (organization_id, day) DO UPDATE SET turns = o.turns + 1
                 WHERE o.turns < ${limit}
                RETURNING o.turns`);
              return rows.length === 1;
            },
          }),
        organizationId === null ? undefined : { organizationId },
      ),
  };
}

/**
 * `F3.85` PR 6 / ADR 0099 decision 11, Amendment 1 A1 and A2 — the per-user and
 * per-organization daily turn limits. The turn service (PR 7) calls
 * `consumeTurn` before any model call, follow-up turns included.
 */
@Injectable()
export class CopilotUsageService {
  private readonly store: CopilotUsageStore;

  constructor(
    @Inject(TENANT_DRIZZLE) tenantDb: BmsDb,
    @Inject(COPILOT_USAGE_LIMITS) private readonly limits: CopilotUsageLimits,
  ) {
    this.store = sqlCopilotUsageStore(tenantDb);
  }

  consumeTurn(identity: UsageIdentity, organizationId: string | null, now: Date): Promise<ConsumeTurnResult> {
    return consumeTurnWith(this.store, this.limits, identity, organizationId, now);
  }
}
