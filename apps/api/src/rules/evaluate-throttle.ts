import { Injectable } from "@nestjs/common";

/**
 * The minimum interval between two `POST /api/v1/rules/evaluate` sweeps in one
 * throttle bucket — an organization, or one of the two stand-ins below for a
 * caller that has none (`F3.47`, plan D2).
 *
 * 30 000 ms is `LIFECYCLE_TICK_MS` (`../alarms/alarm-lifecycle.ts`) — the
 * on-demand endpoint must not outpace the automatic sweep it imitates. The
 * value is written out here rather than imported from it, because
 * `evaluate-throttle.spec.ts` asserts the two are equal and an import would
 * make that assertion compare a value to itself.
 */
export const EVALUATE_MIN_INTERVAL_MS = 30_000;

/**
 * The bucket every unrestricted global `admin` shares
 * (`readableOrganizationIds` returns `null` for them).
 *
 * One bucket for all of them on purpose: each one sweeps the whole fleet, and
 * no organization of theirs distinguishes one from another, so a shared bucket
 * is the strictest reading available. They can therefore hold each other's
 * button — that is the accepted cost of not handing an unrestricted role a
 * per-user bucket.
 *
 * The colon is load-bearing: organization ids are UUIDs, which contain none, so
 * this literal cannot collide with one. It cannot collide with a grantless
 * caller's key either, which carries a different prefix.
 */
export const GLOBAL_ADMIN_THROTTLE_KEY = "fleet:admin";

/**
 * The bucket a **grantless** caller gets: a `configuration` role holding zero
 * grant rows, keyed by its own user id.
 *
 * All three scoped admin roles are `configuration: true` and each has exactly
 * one read-scope source (`access-scope.ts`), so `readableOrganizationIds`
 * returns `[]` for any of them holding no grant row. Folding that into
 * {@link GLOBAL_ADMIN_THROTTLE_KEY} let one grantless `location_admin` hold
 * every global admin's *Evaluate now* button indefinitely, and the reverse.
 *
 * **This is not the per-user bypass the ruling forbids.** A caller with grants
 * is still keyed by organization; only a caller with no organization at all is
 * keyed by user, and such a caller has no organization to bypass. The prefix is
 * what keeps a user id from landing in the organization bucket that happens to
 * carry the same UUID.
 */
const USER_THROTTLE_KEY_PREFIX = "user:";

/** Allowed, or refused with the seconds the caller must wait. */
export type EvaluateThrottleDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * The throttle keys for a caller: their readable organizations, or the bucket
 * that stands in when they have none.
 *
 * **Neither empty case may map to an empty key array.** `check([])` is
 * vacuously allowed — no key is inside any window — so mapping `null` or `[]`
 * to `[]` would hand every global admin and every grantless `location_admin` an
 * unthrottled endpoint.
 *
 * **And the two empty cases are not the same bucket.** `userId` is required
 * rather than optional for that reason: an optional parameter would let a call
 * site drop it and fall back silently to one shared bucket, which is the defect
 * this signature exists to prevent.
 */
export function throttleKeysFor(
  organizationIds: string[] | null,
  userId: string,
): string[] {
  if (organizationIds === null) {
    return [GLOBAL_ADMIN_THROTTLE_KEY];
  }
  if (organizationIds.length === 0) {
    return [`${USER_THROTTLE_KEY_PREFIX}${userId}`];
  }
  return organizationIds;
}

/**
 * A minimum interval on the evaluate-now sweep: one window per organization,
 * and one for each caller that has none (`F3.47`).
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
 * and a restart clears it.
 *
 * The key space is `bms.organizations`, plus one global-admin bucket, plus one
 * bucket per **grantless** `configuration`-role principal. The organization
 * keys come from the database through
 * `AccessControlService.readableOrganizationIds`. The grantless key is the
 * caller's `sub`, and it is the one key that does not correspond to a row:
 * ADR 0044 keeps `resolveDbUser`'s row-absent fallback for every role except
 * `admin`, so a validly signed token claiming `location_admin` and matching no
 * `bms.users` row resolves to zero grants and takes a bucket of its own. That
 * token still has to be signed by the IdP, so the space is bounded by the
 * principals it will issue for — not by a caller, and not by a table either.
 *
 * No eviction, and none owed at that size: entries are overwritten in place and
 * a restart clears them. A prune would exist only to be white-box tested.
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
 * writer of `bms.rule_executions` and is unthrottled, and `POST /rules/preview`
 * still writes an audit row per call.
 *
 * ## The bound, stated exactly
 *
 * **K + 1 + G full cross-organization sweeps per interval, per API process:**
 * one per organization holding a granted `configuration`-role user (K), one
 * shared by every global admin, and one per grantless `configuration`-role
 * principal (G). Every one of those is a whole ~289-rule sweep — ADR 0033
 * decision 2 makes the sweep ignore the caller's scope, so a caller with no
 * grants at all still drives a full one.
 *
 * This shipped saying "K organizations can drive K sweeps", and that was
 * already wrong before the buckets were split: the stand-in bucket was always
 * its own, and a global admin's press stamps no organization key.
 *
 * **Per API process.** The state is a `Map` in this process's memory, so N
 * processes serving this route give N times the bound and nothing in this
 * repository detects it. `docker-compose.yml` runs one `api` container with no
 * `deploy.replicas`, and its `api-replica` service is on its own port under a
 * separate profile with no load balancer in front, so the bound holds as
 * deployed today. The note lives on both of those services as well, because
 * that is where someone adding a replica would meet it.
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
