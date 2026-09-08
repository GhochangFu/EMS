import { Injectable } from "@nestjs/common";

/**
 * The minimum interval between two `POST /api/v1/rules/evaluate` sweeps in one
 * organization (`F3.47`, plan D2).
 *
 * 30 000 ms is `LIFECYCLE_TICK_MS` (`../alarms/alarm-lifecycle.ts`) — the
 * on-demand endpoint must not outpace the automatic sweep it imitates. The
 * value is written out here rather than imported from it, because
 * `evaluate-throttle.spec.ts` asserts the two are equal and an import would
 * make that assertion compare a value to itself.
 */
export const EVALUATE_MIN_INTERVAL_MS = 30_000;

/**
 * The bucket for a caller with no organization of their own: an unrestricted
 * global `admin` (`readableOrganizationIds` returns `null`), and a
 * `configuration` role holding zero grants (it returns `[]` — reachable, a
 * `location_admin` with no `user_location_access` rows).
 *
 * Organization ids are UUIDs, so this literal cannot collide with one.
 */
export const FLEET_THROTTLE_KEY = "fleet";

/** Allowed, or refused with the seconds the caller must wait. */
export type EvaluateThrottleDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * The throttle keys for a caller's readable organizations.
 *
 * **Neither empty case may map to an empty key array.** `check([])` is
 * vacuously allowed — no key is inside any window — so mapping `null` or `[]`
 * to `[]` would hand every global admin and every grantless `location_admin` an
 * unthrottled endpoint. Both fall in the shared `FLEET_THROTTLE_KEY` bucket
 * instead, which is the strictest reading available: a caller who can reach
 * every organization's rules occupies one bucket for all of them.
 */
export function throttleKeysFor(organizationIds: string[] | null): string[] {
  if (organizationIds === null || organizationIds.length === 0) {
    return [FLEET_THROTTLE_KEY];
  }
  return organizationIds;
}

/**
 * A per-organization minimum interval on the evaluate-now sweep (`F3.47`).
 *
 * ## Why
 *
 * One press evaluates every enabled, published rule in every organization (ADR
 * 0033 decision 2 makes the sweep deliberately cross-org), writing one
 * `bms.rule_executions` row and one `bms.automation_rules.last_evaluated_at`
 * update per rule — 289 of each on the seeded database. Nothing bounded the
 * press rate; ADR 0033's Consequences recorded that and left it open.
 *
 * ## The state
 *
 * One `Map` in process memory, the trade `PROCESS_STARTED_AT`
 * (`notifications.config.ts`) already makes: no DDL, no read on the hot path,
 * and a restart clears it. The keys come from the database through
 * `AccessControlService.readableOrganizationIds`, never from the caller, so the
 * key space is bounded by `bms.organizations` plus the sentinel and no eviction
 * is owed.
 *
 * ## Two rules on this implementation, not preferences
 *
 * 1. **`check` contains no `await`.** Its whole concurrency guarantee is that
 *    Node cannot interleave a synchronous read-then-write, so two presses in
 *    the same tick are serialized and the second is refused. That guarantee is
 *    void the moment an `await` appears between the read of the Map and the
 *    write.
 * 2. **A refusal does not stamp.** `elapsed` is read for every key first, and
 *    only the allowed branch writes. Stamping before the check slides the
 *    window forward on every attempt, so a human holding the button is locked
 *    out forever while `Retry-After` lies about the wait.
 *
 * The stamp is taken when the sweep *starts* and is never released: a sweep
 * that throws keeps it, because releasing on failure would let an error loop
 * bypass the bound, and a failing sweep still writes rows before it throws.
 *
 * **This bounds one route, not the table.** `AlarmRaiseService` is the other
 * writer of `bms.rule_executions` and is unthrottled, and per-organization
 * keying means K organizations holding a `configuration`-role user can drive K
 * sweeps per interval.
 */
@Injectable()
export class EvaluateThrottle {
  /** Key → the instant that key's last allowed sweep started. */
  private readonly lastSweepStartedAt = new Map<string, number>();

  /**
   * Whether a sweep may start now for these keys, stamping every one of them
   * if so.
   *
   * A caller consumes **every** bucket they belong to: refused if any key is
   * inside its window, and an allowed press stamps all of them. Otherwise a
   * user holding `{A, B}` and a user holding `{A}` would sit in different
   * buckets and double the real rate against A.
   */
  check(keys: string[], now: number): EvaluateThrottleDecision {
    let longestRemainingMs = 0;
    for (const key of keys) {
      const startedAt = this.lastSweepStartedAt.get(key);
      if (startedAt === undefined) {
        continue;
      }
      const remaining = EVALUATE_MIN_INTERVAL_MS - (now - startedAt);
      if (remaining > longestRemainingMs) {
        longestRemainingMs = remaining;
      }
    }

    if (longestRemainingMs > 0) {
      // `Math.ceil`, and no `Math.max(1, …)` around it: the branch is only
      // reached with a strictly positive remainder, and the ceiling of one is
      // already 1. `Math.floor` here would emit `Retry-After: 0` in the last
      // second of the window and invite an immediate retry that is refused
      // again — a `Math.max` floor would hide that in the last millisecond and
      // leave it live everywhere else.
      return { allowed: false, retryAfterSeconds: Math.ceil(longestRemainingMs / 1000) };
    }

    for (const key of keys) {
      this.lastSweepStartedAt.set(key, now);
    }
    return { allowed: true };
  }
}
