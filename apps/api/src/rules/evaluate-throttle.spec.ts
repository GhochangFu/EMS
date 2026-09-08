import { LIFECYCLE_TICK_MS } from "../alarms/alarm-lifecycle";
import {
  EVALUATE_MIN_INTERVAL_MS,
  EvaluateThrottle,
  FLEET_THROTTLE_KEY,
  throttleKeysFor,
} from "./evaluate-throttle";

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
 * A distinct organization id per block, so no block can be reddened by another
 * block's stamp. That is what lets a mutation be attributed to the assertion
 * that owns its claim rather than to whichever one happens to run first.
 */
let organizationsIssued = 0;
function freshOrganizationId(): string {
  organizationsIssued += 1;
  return `aaaaaaaa-0000-0000-0000-${String(organizationsIssued).padStart(12, "0")}`;
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
 * `F3.47` — the per-organization minimum interval on `POST /rules/evaluate`
 * (plan D2, D5, D6).
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
 */
export function runEvaluateThrottleTests(): void {
  // --- 9. the Map is per instance, not module-level ------------------------
  //
  // First, because a module-level Map leaks into every block below and this is
  // the block whose claim it is. Also the positive statement of the restart
  // trade (D3): the state lives in process memory, so a restart clears it.
  {
    const organizationId = freshOrganizationId();
    assert(new EvaluateThrottle().check([organizationId], T).allowed, "the first instance stamps");
    assert(
      new EvaluateThrottle().check([organizationId], T + 1).allowed,
      "a fresh instance inherited the stamp — the Map is shared at module scope",
    );
  }

  // --- 1. the press that is allowed ----------------------------------------
  //
  // The positive that pairs every absence below. A throttle that refuses
  // everything satisfies 2, 4, 6 and 8 and is useless.
  {
    assert(
      new EvaluateThrottle().check([freshOrganizationId()], T).allowed,
      "the first press on a fresh instance is allowed",
    );
  }

  // --- 2, 3, 4, 5. the interval and its boundary ---------------------------
  {
    // 2. The interval itself.
    const soon = refusal(pressAgainAfter(1), "a press one millisecond later");
    assert(
      soon.retryAfterSeconds === 30,
      `a press 1 ms in waits the whole interval, got ${soon.retryAfterSeconds}`,
    );

    // 4. `Math.ceil`, not `Math.floor` or a round-to-nearest: a part second
    //    rounds up. 1.5 s of window left asks for 2 …
    const partial = refusal(
      pressAgainAfter(28_500),
      "a press with one and a half seconds of the window left",
    );
    assert(
      partial.retryAfterSeconds === 2,
      `a part second rounds up, not down, got ${partial.retryAfterSeconds}`,
    );

    //    … and the last millisecond still asks for a whole second. A
    //    `Retry-After: 0` invites an immediate retry that is refused again.
    const last = refusal(
      pressAgainAfter(29_999),
      "a press one millisecond before the window closes",
    );
    assert(
      last.retryAfterSeconds === 1,
      `the last millisecond of the window still asks for 1 second, got ${last.retryAfterSeconds}`,
    );

    // 3. The boundary is inclusive: `elapsed >= INTERVAL`, not `>`.
    assert(pressAgainAfter(30_000).allowed, "a press at exactly the interval is allowed");

    // 5. Pairs with 3. An inverted comparison passes on the exact boundary
    //    alone and refuses on both sides of it.
    assert(pressAgainAfter(30_001).allowed, "a press past the interval is allowed");
  }

  // --- 6. a refusal does not re-stamp --------------------------------------
  //
  // Stamping before the elapsed check is the natural way to write this wrong,
  // and it locks a human holding the button out forever while `Retry-After: 30`
  // lies about the wait. The third press is what catches it: it is 31 s after
  // the ALLOWED press and only 16 s after the REFUSED one.
  {
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

  // --- 7. the buckets are per organization ---------------------------------
  {
    const throttle = new EvaluateThrottle();
    const first = freshOrganizationId();
    const second = freshOrganizationId();
    assert(throttle.check([first], T).allowed, "the first organization sweeps");
    assert(
      throttle.check([second], T).allowed,
      "a second organization is refused because of the first one's press — the state is one scalar, or the key is hardcoded",
    );
  }

  // --- 8. a multi-organization caller consumes every bucket ----------------
  //
  // Both halves of the same bypass: stamping only `keys[0]`, and checking only
  // `keys[0]`. Without this a user holding {A, B} and a user holding {A} sit in
  // different buckets and double the real rate against A.
  {
    const throttle = new EvaluateThrottle();
    const first = freshOrganizationId();
    const second = freshOrganizationId();
    assert(throttle.check([first, second], T).allowed, "the multi-org caller sweeps once");
    refusal(throttle.check([first], T + 1), "the first organization of a multi-org press");
    refusal(throttle.check([second], T + 1), "the second organization of a multi-org press");
  }

  // --- 10. the same-tick race ----------------------------------------------
  //
  // `check` contains no `await`, so Node cannot interleave the read and the
  // write: two presses in one tick are serialized and the second is refused.
  // Deferring the stamp — to a microtask, past an `await`, or behind a guard
  // that treats "same instant" as "not yet started" — lets both win. This is
  // what makes D6 a rule on the implementation rather than a hope.
  {
    const throttle = new EvaluateThrottle();
    const organizationId = freshOrganizationId();
    const now = T;
    const won = [
      throttle.check([organizationId], now),
      throttle.check([organizationId], now),
    ].filter((decision) => decision.allowed);
    assert(won.length === 1, `exactly one press in the same tick wins, ${won.length} did`);
  }

  // --- 11. the sentinel, and what happens without it -----------------------
  //
  // `null` is the unrestricted global admin; `[]` is a `configuration` role with
  // zero grants, which is reachable — a `location_admin` with no
  // `user_location_access` rows. Mapping either to an empty key array makes
  // `check([])` VACUOUSLY ALLOWED and hands both an unthrottled endpoint. Each
  // shape assertion is therefore paired with a press through it; the shapes
  // alone would prove nothing.
  {
    const scoped = freshOrganizationId();
    assert(
      throttleKeysFor(null).length === 1 && throttleKeysFor(null)[0] === FLEET_THROTTLE_KEY,
      `an unrestricted admin falls in the sentinel bucket, got ${JSON.stringify(throttleKeysFor(null))}`,
    );
    assert(
      throttleKeysFor([]).length === 1 && throttleKeysFor([])[0] === FLEET_THROTTLE_KEY,
      `a grantless role falls in the sentinel bucket, got ${JSON.stringify(throttleKeysFor([]))}`,
    );
    assert(
      throttleKeysFor([scoped]).length === 1 && throttleKeysFor([scoped])[0] === scoped,
      "a scoped caller keys on its own organization ids",
    );

    const admin = new EvaluateThrottle();
    assert(admin.check(throttleKeysFor(null), T).allowed, "the global admin's first press runs");
    refusal(admin.check(throttleKeysFor(null), T + 1), "the global admin's second press");

    const grantless = new EvaluateThrottle();
    assert(
      grantless.check(throttleKeysFor([]), T).allowed,
      "the grantless role's first press runs",
    );
    refusal(grantless.check(throttleKeysFor([]), T + 1), "the grantless role's second press");
  }

  // --- 12. the interval is the lifecycle tick ------------------------------
  //
  // 30 s is not an arbitrary number: it is `LIFECYCLE_TICK_MS`, so the on-demand
  // endpoint cannot outpace the automatic sweep it imitates. This is the only
  // assertion that fails if the tick moves and the throttle does not.
  // `RulesModule` already imports `AlarmsModule`, so the edge is acyclic.
  assert(
    EVALUATE_MIN_INTERVAL_MS === LIFECYCLE_TICK_MS,
    `the interval matches the lifecycle tick, got ${EVALUATE_MIN_INTERVAL_MS} vs ${LIFECYCLE_TICK_MS}`,
  );
  assert(EVALUATE_MIN_INTERVAL_MS === 30_000, `both are 30 s, got ${EVALUATE_MIN_INTERVAL_MS}`);
}
