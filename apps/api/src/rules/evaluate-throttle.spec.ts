import { LIFECYCLE_TICK_MS } from "../alarms/alarm-lifecycle";
import {
  EVALUATE_MIN_INTERVAL_MS,
  EvaluateThrottle,
  GLOBAL_ADMIN_THROTTLE_KEY,
  throttleKeysFor,
} from "./evaluate-throttle";

/**
 * `F3.47` — the minimum interval on `POST /rules/evaluate` (plan D2, D5, D6).
 *
 * **Why the route needed a bound at all.** One press evaluates every enabled,
 * published rule in every organization (ADR 0033 decision 2) and writes one
 * `bms.rule_executions` row plus one `automation_rules.last_evaluated_at`
 * update per rule — 289 of each on the seeded database. Nothing bounded the
 * press rate, and ADR 0033's own Consequences recorded that and left it open.
 *
 * The clock is a parameter, never `Date.now()` inside the throttle (D5), so the
 * boundary is driven exactly — `T + 29_999`, `T + 30_000`, `T + 30_001` — with
 * no fake timers.
 *
 * **One exported function per claim, and one `it()` per function.** These
 * assertions used to run as twelve numbered blocks inside a single `it()`, and
 * `assert` throws: the first failing block aborted every block after it, so a
 * mutation that reddened block 2 left blocks 6, 7, 8, 10, 11 and 12 unreached —
 * including the block that owns the same-tick race. A later claim that cannot
 * run is decoration. (`F4.105` found the same shape elsewhere in this
 * repository.)
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** A fixed instant. Every assertion below is stated as an offset from it, so
 * nothing here depends on when CI happens to run — the grain
 * `alarm-lifecycle.spec.ts` uses. */
const T = 1_700_000_000_000;

/**
 * A distinct organization id per call.
 *
 * These do **not** keep one block from reddening another — every block builds
 * its own `EvaluateThrottle`, so no stamp has ever crossed a block boundary,
 * and attribution is what the one-`it()`-per-block split above buys. What they
 * do is real but narrower: inside the blocks that need two organizations at
 * once — `keepsOneWindowPerOrganization` and
 * `consumesEveryBucketAMultiOrganizationCallerBelongsTo` — the two must differ,
 * or both blocks pass against a throttle that ignores the key entirely.
 */
let organizationsIssued = 0;
function freshOrganizationId(): string {
  organizationsIssued += 1;
  return `aaaaaaaa-0000-0000-0000-${String(organizationsIssued).padStart(12, "0")}`;
}

/** A user id that is not an organization id, for the blocks where only its
 * distinctness matters. */
let usersIssued = 0;
function freshUserId(): string {
  usersIssued += 1;
  return `11111111-1111-1111-1111-${String(usersIssued).padStart(12, "0")}`;
}

/** The refused half of the decision, narrowed. `check` returns a union, and
 * reading `retryAfterSeconds` off the allowed arm is a compile error. */
function refusal(
  decision: ReturnType<EvaluateThrottle["check"]>,
  why: string,
): { allowed: false; retryAfterSeconds: number } {
  if (decision.allowed) {
    throw new Error(`${why}: it was allowed`);
  }
  return decision;
}

/**
 * A fresh throttle that has just swept at `T`, probed once at `T + offset`.
 * Fresh per probe on purpose: sharing one instance across the four boundary
 * probes would let the boundary assertions also catch a re-stamp bug, and the
 * re-stamp claim belongs to its own block below.
 */
function pressAgainAfter(offsetMs: number): ReturnType<EvaluateThrottle["check"]> {
  const throttle = new EvaluateThrottle();
  const organizationId = freshOrganizationId();
  assert(
    throttle.check([organizationId], T).allowed,
    "the first press on a fresh instance is allowed",
  );
  return throttle.check([organizationId], T + offsetMs);
}

/**
 * 9. The Map is per instance, not module-level.
 *
 * First, because a module-level Map leaks into every other block and this is
 * the block whose claim it is. Also the positive statement of the restart trade
 * (D3): the state lives in process memory, so a restart clears it.
 */
export function keepsItsWindowsPerInstance(): void {
  const organizationId = freshOrganizationId();
  assert(new EvaluateThrottle().check([organizationId], T).allowed, "the first instance stamps");
  assert(
    new EvaluateThrottle().check([organizationId], T + 1).allowed,
    "a fresh instance inherited the stamp — the Map is shared at module scope",
  );
}

/**
 * 1. The press that is allowed — the positive that pairs every absence below.
 * A throttle that refuses everything satisfies 2, 4, 6 and 8 and is useless.
 */
export function allowsTheFirstPressOnAFreshInstance(): void {
  assert(
    new EvaluateThrottle().check([freshOrganizationId()], T).allowed,
    "the first press on a fresh instance is allowed",
  );
}

/** 2. The interval itself. Deleting the elapsed check reddens this one. */
export function refusesASecondPressInsideTheWindow(): void {
  const soon = refusal(pressAgainAfter(1), "a press one millisecond later");
  assert(
    soon.retryAfterSeconds === 30,
    `a press 1 ms in waits the whole interval, got ${soon.retryAfterSeconds}`,
  );
}

/**
 * 4. `Math.ceil`, not `Math.floor` or a round-to-nearest: a part second rounds
 * up, and the last millisecond of the window still asks for a whole second.
 * `Retry-After: 0` invites an immediate retry that is refused again.
 */
export function roundsAPartSecondUpNotDown(): void {
  const partial = refusal(
    pressAgainAfter(28_500),
    "a press with one and a half seconds of the window left",
  );
  assert(
    partial.retryAfterSeconds === 2,
    `a part second rounds up, not down, got ${partial.retryAfterSeconds}`,
  );

  const last = refusal(pressAgainAfter(29_999), "a press one millisecond before the window closes");
  assert(
    last.retryAfterSeconds === 1,
    `the last millisecond of the window still asks for 1 second, got ${last.retryAfterSeconds}`,
  );
}

/** 3. The boundary is inclusive: `elapsed >= INTERVAL`, not `>`. */
export function allowsAPressAtExactlyTheInterval(): void {
  assert(pressAgainAfter(30_000).allowed, "a press at exactly the interval is allowed");
}

/** 5. Pairs with 3. An inverted comparison passes on the exact boundary alone
 * and refuses on both sides of it. */
export function allowsAPressPastTheInterval(): void {
  assert(pressAgainAfter(30_001).allowed, "a press past the interval is allowed");
}

/**
 * 6. A refusal does not re-stamp.
 *
 * Stamping before the elapsed check is the natural way to write this wrong, and
 * it locks a human holding the button out forever while `Retry-After: 30` lies
 * about the wait. The third press is what catches it: it is 31 s after the
 * ALLOWED press and only 16 s after the REFUSED one.
 */
export function doesNotSlideTheWindowForwardOnARefusal(): void {
  const throttle = new EvaluateThrottle();
  const organizationId = freshOrganizationId();
  assert(throttle.check([organizationId], T).allowed, "the sweep runs");

  const held = refusal(throttle.check([organizationId], T + 15_000), "a press halfway through");
  assert(
    held.retryAfterSeconds === 15,
    `half the interval remains after 15 s, got ${held.retryAfterSeconds}`,
  );

  assert(
    throttle.check([organizationId], T + 31_000).allowed,
    "the refused press slid the window forward — the button is locked out permanently",
  );
}

/** 7. The buckets are per organization: a single scalar `lastSweepAt`, or a
 * hardcoded key, reddens here. */
export function keepsOneWindowPerOrganization(): void {
  const throttle = new EvaluateThrottle();
  const first = freshOrganizationId();
  const second = freshOrganizationId();
  assert(throttle.check([first], T).allowed, "the first organization sweeps");
  assert(
    throttle.check([second], T).allowed,
    "a second organization is refused because of the first one's press — the state is one scalar, or the key is hardcoded",
  );
}

/**
 * 8. A multi-organization caller consumes every bucket it belongs to.
 *
 * Both halves of the same bypass: stamping only `keys[0]`, and checking only
 * `keys[0]`. Without this a user holding {A, B} and a user holding {A} sit in
 * different buckets and double the real rate against A.
 */
export function consumesEveryBucketAMultiOrganizationCallerBelongsTo(): void {
  const throttle = new EvaluateThrottle();
  const first = freshOrganizationId();
  const second = freshOrganizationId();
  assert(throttle.check([first, second], T).allowed, "the multi-org caller sweeps once");
  refusal(throttle.check([first], T + 1), "the first organization of a multi-org press");
  refusal(throttle.check([second], T + 1), "the second organization of a multi-org press");
}

/**
 * 10. The same-tick race.
 *
 * `check` contains no `await`, so Node cannot interleave the read and the
 * write: two presses in one tick are serialized and the second is refused.
 * Deferring the stamp — to a microtask, past an `await`, or behind a guard that
 * treats "same instant" as "not yet started" — lets both win. This is what
 * makes D6 a rule on the implementation rather than a hope.
 *
 * It is also the block that used to be unreachable: a deferred stamp reddens
 * the interval block first, and under one `it()` this never ran at all.
 */
export function refusesTheSecondOfTwoPressesInTheSameTick(): void {
  const throttle = new EvaluateThrottle();
  const organizationId = freshOrganizationId();
  const now = T;
  const won = [throttle.check([organizationId], now), throttle.check([organizationId], now)].filter(
    (decision) => decision.allowed,
  );
  assert(won.length === 1, `exactly one press in the same tick wins, ${won.length} did`);
}

/**
 * 11. Neither empty case may map to an empty key array.
 *
 * `null` is the unrestricted global admin; `[]` is a `configuration` role with
 * zero grants, which is reachable — a `location_admin` with no
 * `user_location_access` rows. Mapping either to an empty key array makes
 * `check([])` VACUOUSLY ALLOWED and hands both an unthrottled endpoint. Each
 * shape assertion is therefore paired with a press through it; the shapes alone
 * would prove nothing. 11a–11d own the claim that the two are DIFFERENT
 * buckets.
 */
export function givesEveryCallerWithNoOrganizationABucketAnyway(): void {
  const scoped = freshOrganizationId();
  const userId = freshUserId();
  assert(
    throttleKeysFor(null, userId).length === 1 &&
      throttleKeysFor(null, userId)[0] === GLOBAL_ADMIN_THROTTLE_KEY,
    `an unrestricted admin falls in the global-admin bucket, got ${JSON.stringify(throttleKeysFor(null, userId))}`,
  );
  assert(
    throttleKeysFor([], userId).length === 1 && throttleKeysFor([], userId)[0] === `user:${userId}`,
    `a grantless role keys on its own user id, got ${JSON.stringify(throttleKeysFor([], userId))}`,
  );
  assert(
    throttleKeysFor([scoped], userId).length === 1 &&
      throttleKeysFor([scoped], userId)[0] === scoped,
    "a scoped caller keys on its own organization ids, not on its user id",
  );

  const admin = new EvaluateThrottle();
  assert(
    admin.check(throttleKeysFor(null, userId), T).allowed,
    "the global admin's first press runs",
  );
  refusal(admin.check(throttleKeysFor(null, userId), T + 1), "the global admin's second press");

  const grantless = new EvaluateThrottle();
  assert(
    grantless.check(throttleKeysFor([], userId), T).allowed,
    "the grantless role's first press runs",
  );
  refusal(grantless.check(throttleKeysFor([], userId), T + 1), "the grantless role's second press");
}

/**
 * 11a. A grantless caller does not deny a global admin.
 *
 * Both used to be one `"fleet"` key, so either could hold the other's *Evaluate
 * now* button indefinitely by pressing every 30 s. This is an ALLOWED claim, so
 * it is paired on the SAME instance with two refusals: a throttle that allows
 * everything satisfies the allowed half alone.
 */
export function aGrantlessCallerDoesNotDenyAGlobalAdmin(): void {
  const throttle = new EvaluateThrottle();
  const grantless = throttleKeysFor([], freshUserId());
  const globalAdmin = throttleKeysFor(null, freshUserId());

  assert(throttle.check(grantless, T).allowed, "the grantless caller's first press runs");
  assert(
    throttle.check(globalAdmin, T).allowed,
    "a grantless caller's press denied a global admin — the two share one bucket",
  );
  refusal(throttle.check(grantless, T + 1), "the grantless caller's second press");
  refusal(throttle.check(globalAdmin, T + 1), "the global admin's second press");
}

/**
 * 11b. And a global admin does not deny a grantless caller.
 *
 * The same claim in the other order, because a fixture that only ever stamps
 * one of the two first cannot see a collapse that depends on which one arrives
 * first.
 */
export function aGlobalAdminDoesNotDenyAGrantlessCaller(): void {
  const throttle = new EvaluateThrottle();
  const grantless = throttleKeysFor([], freshUserId());
  const globalAdmin = throttleKeysFor(null, freshUserId());

  assert(throttle.check(globalAdmin, T).allowed, "the global admin's first press runs");
  assert(
    throttle.check(grantless, T).allowed,
    "a global admin's press denied a grantless caller — the two share one bucket",
  );
  refusal(throttle.check(globalAdmin, T + 1), "the global admin's second press");
  refusal(throttle.check(grantless, T + 1), "the grantless caller's second press");
}

/** 11c. Two different grantless callers are two buckets, not one shared one. */
export function twoGrantlessCallersDoNotDenyEachOther(): void {
  const throttle = new EvaluateThrottle();
  const first = throttleKeysFor([], freshUserId());
  const second = throttleKeysFor([], freshUserId());

  assert(throttle.check(first, T).allowed, "the first grantless caller's press runs");
  assert(
    throttle.check(second, T).allowed,
    "one grantless caller denied another — every grantless caller is in one shared bucket",
  );
  refusal(throttle.check(first, T + 1), "the first grantless caller's second press");
  refusal(throttle.check(second, T + 1), "the second grantless caller's second press");
}

/**
 * 11d. Neither stand-in key can collide with an organization id.
 *
 * Stated behaviourally, not as a regex on the literal: a grantless caller whose
 * user id IS an organization id must not fall in that organization's bucket.
 * That is what the `user:` prefix buys, and dropping the prefix is the mutation
 * this block owns.
 */
export function keepsBothStandInKeysOutOfEveryOrganizationBucket(): void {
  const throttle = new EvaluateThrottle();
  const organizationId = freshOrganizationId();

  assert(
    throttle.check(throttleKeysFor([organizationId], freshUserId()), T).allowed,
    "the scoped caller sweeps",
  );
  assert(
    throttle.check(throttleKeysFor([], organizationId), T).allowed,
    "a grantless caller whose user id equals an organization id fell in that organization's bucket — the user key carries no prefix",
  );
  assert(
    throttle.check(throttleKeysFor(null, organizationId), T).allowed,
    "a global admin fell in an organization's bucket, or in the grantless caller's",
  );
  refusal(
    throttle.check(throttleKeysFor([organizationId], freshUserId()), T + 1),
    "the scoped organization's second press",
  );
}

/**
 * 12. The interval is the lifecycle tick.
 *
 * 30 s is not an arbitrary number: it is `LIFECYCLE_TICK_MS`, so the on-demand
 * endpoint cannot outpace the automatic sweep it imitates. This is the only
 * assertion that fails if the tick moves and the throttle does not.
 * `RulesModule` already imports `AlarmsModule`, so the edge is acyclic.
 */
export function holdsTheSameIntervalAsTheAutomaticSweep(): void {
  assert(
    EVALUATE_MIN_INTERVAL_MS === LIFECYCLE_TICK_MS,
    `the interval matches the lifecycle tick, got ${EVALUATE_MIN_INTERVAL_MS} vs ${LIFECYCLE_TICK_MS}`,
  );
  assert(EVALUATE_MIN_INTERVAL_MS === 30_000, `both are 30 s, got ${EVALUATE_MIN_INTERVAL_MS}`);
}
