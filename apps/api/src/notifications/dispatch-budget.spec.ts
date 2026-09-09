import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import { RESERVED_KEY_PATTERN } from "./dispatch-policy";
import type { DeliveryResult } from "./notification-transport";
import {
  assert,
  channelRow,
  fakeDb,
  fakeTransport,
  input,
  serviceWith,
} from "./notifications.service.spec";

/**
 * `F3.52` — which of `hourlyCeiling`'s two budgets each of the ceiling's THREE
 * callers asks for, and **which rows each limit counts** (ADR 0041 Amendment 6
 * §1, owner rulings 3, 4 and 8).
 *
 * `dispatch-policy.spec.ts` holds the two limits themselves, as pure functions.
 * This file holds the wiring, and the wiring is where a literal `"full"` or
 * `"reserved"` at one call site would make the whole reserve inert with every
 * pure-function case still green.
 *
 * **Owner ruling 8 is why most of this file was rewritten.** The `F3.52`
 * security review found the reserve pointing the wrong way: one unfiltered
 * `count(*)` was compared against both limits, so forty-eight sent RAISES
 * refused every escalation step, cleared message and test send on the channel
 * while raises went on to 60. The reserve existed to protect the raise path and
 * was starving the event path instead. The query now returns TWO numbers from
 * one round trip — every `sent` row, and the `sent` rows written by a dispatch
 * that CHARGED the reserved budget — and each limit is compared against its
 * own. N1 is that defect, and it fails against the code this file was written
 * on.
 *
 * **Its own file, and one `it()` per case.** The fake database, the builders
 * and `serviceWith` are `notifications.service.spec.ts`'s exports, imported the
 * way `notifications.events.spec.ts` already imports them. The plan for this
 * item put these cases INSIDE `runNotificationsServiceTests`, which is one
 * `it()` over some thirty blocks — and `assert` throws, so a mutation there
 * reddens the first failing block and the block that owns the claim never runs
 * (AGENTS.md §4.6). The measurement the plan asked for is not available in that
 * shape, so the cases live here instead.
 *
 * **`setCount(all, reserved)`.** The fake answers the ceiling read with the two
 * numbers the query now projects. The second argument defaults to the first,
 * which is exactly the pre-ruling-8 behaviour — one count answering both limits
 * — so every case elsewhere that calls `setCount(n)` still means what it meant.
 * Here the two are always given explicitly, because the gap between them IS the
 * subject.
 */

/** Every case here runs at the default 60 an hour, where the reserved limit is 48. */
const RATE = "60";

/** A transport that always sends, so a refusal in these cases is the ceiling's doing. */
const sendingWebhook = (): ReturnType<typeof fakeTransport> =>
  fakeTransport("webhook", () => Promise.resolve<DeliveryResult>({ status: "sent", error: null }));

/** An escalation step — the dispatch `budgetFor` puts on the reserved budget. */
const step = () => input({ event: { kind: "escalation", step: 1 } });

/**
 * N1 — **the defect**: a backlog of sent RAISES no longer refuses the event
 * path.
 *
 * Fifty `sent` rows in the trailing hour, every one of them a raise, against a
 * ceiling of 60 and a reserved limit of `floor(60 * 0.8) = 48`. Before ruling 8
 * the step was refused here — 50 counted against 48 — which is what made a step
 * sit until the age budget abandoned it while the raises that filled the pool
 * went out. The reserve is a FLOOR under the raise path, never a ceiling over
 * it, so raise rows must not fill the reserved count.
 *
 * **Mutation:** the reserved limit compared against the unfiltered count
 * (`allSent >= floor(rate * EVENT_SHARE)`, the pre-ruling-8 code) → red here,
 * and green in N2 through N7 and in S9 — measured on the code this file was
 * written against, which is what makes this case the gate for the ruling rather
 * than a restatement of the others.
 *
 * **The `FILTER` itself is not gated here**, and the obvious guess is wrong:
 * dropping it, so both numbers count every row, leaves this case GREEN. The fake
 * answers the ceiling read with the two numbers it was given and never runs the
 * SQL, so no case in this file can tell a filtered aggregate from an unfiltered
 * one by its result. What kills that mutation is N7, which renders the
 * projection.
 *
 * The read count is asserted on the same fixture: ruling 8 asks for ONE round
 * trip, and a second query behind the second limit is the obvious way to write
 * it. One dispatch, one ceiling read.
 */
export async function testARaiseBacklogNoLongerRefusesTheEventPath(): Promise<void> {
  const { db, recorded, reads, setCount } = fakeDb();
  const webhook = sendingWebhook();
  const service = serviceWith({
    db,
    channels: [],
    webhook: webhook.transport,
    env: { NOTIFY_RATE_LIMIT_PER_HOUR: RATE },
  });

  setCount(50, 0);
  const results = await service.dispatchToChannels([channelRow()], step());

  assert(
    results[0]?.status === "sent",
    `N1: 50 sent RAISES must not spend the event share, got ${String(results[0]?.status)}`,
  );
  assert(webhook.sent.length === 1, "N1: and the step reached the transport");
  assert(
    recorded.length === 1 && recorded[0]?.status === "sent",
    `N1: the send is recorded, got ${recorded.map((row) => row.status).join(",")}`,
  );
  assert(
    reads.rateLimit === 1,
    `N1: two numbers, one round trip — got ${reads.rateLimit} ceiling read(s)`,
  );
}

/**
 * N2 — the reserved limit still bites on the rows it is meant to bite on.
 *
 * Forty-eight `sent` rows, all of them written by dispatches that charged the
 * reserved budget. The full ceiling has twelve slots left and the step is
 * refused anyway: ruling 8 narrows WHICH rows fill the reserve, and does not
 * lift it.
 *
 * The absent row is half the claim (`F3.48` ruling Q1): a ceiling-refused step
 * writes nothing, so the next tick can retry it. N1 and N2 together are what
 * separate "the reserve counts the right rows" from "the reserve was deleted" —
 * the reserved arm removed outright passes N1 and reddens here.
 *
 * **Mutations:** the reserved arm dropped, or its comparison made against the
 * full `ratePerHour` → red here alone. `>=` weakened to `>` on the reserved arm
 * → red here (N6 holds the same boundary from the `sendTest` side).
 */
export async function testTheReserveStillRefusesAStepOnEventRows(): Promise<void> {
  const { db, recorded, setCount } = fakeDb();
  const webhook = sendingWebhook();
  const service = serviceWith({
    db,
    channels: [],
    webhook: webhook.transport,
    env: { NOTIFY_RATE_LIMIT_PER_HOUR: RATE },
  });

  setCount(48, 48);
  const results = await service.dispatchToChannels([channelRow()], step());

  assert(
    results[0]?.status === "skipped_rate_limited",
    `N2: 48 event rows is the reserved limit, got ${String(results[0]?.status)}`,
  );
  assert(results[0]?.error === null, "N2: a ceiling refusal is not an error");
  assert(webhook.sent.length === 0, "N2: the refused step must not reach the transport");
  assert(
    recorded.length === 0,
    `N2: F3.48 Q1 — a ceiling-refused step writes no row, got ${recorded
      .map((row) => row.status)
      .join(",")}`,
  );
}

/**
 * N3 — the reserve protects the raise path, which is the whole purpose.
 *
 * N2's fixture exactly: forty-eight event rows, the reserved limit reached. The
 * raise still sends, because twelve of the sixty slots are reachable by a raise
 * alone. This is the sentence Amendment 6 §1 was written to make true, and
 * without it the reserve is only a second way to refuse a step.
 *
 * The numbers deliberately match N2's rather than being chosen for this case:
 * one fixture, two answers, and the difference is which budget the dispatch is
 * measured against.
 *
 * **Mutations:** `dispatchToChannel` passing a literal `"reserved"` → red here
 * (the raise is refused with headroom left) and green in N2. `budgetFor`
 * answering `"reserved"` for a dispatch with no event → red here.
 */
export async function testAReserveFullOfEventsStillLetsARaiseThrough(): Promise<void> {
  const { db, recorded, setCount } = fakeDb();
  const webhook = sendingWebhook();
  const service = serviceWith({
    db,
    channels: [],
    webhook: webhook.transport,
    env: { NOTIFY_RATE_LIMIT_PER_HOUR: RATE },
  });

  setCount(48, 48);
  const results = await service.dispatchToChannels([channelRow()], input());

  assert(
    results[0]?.status === "sent",
    `N3: the last twelve slots are the raise's, got ${String(results[0]?.status)}`,
  );
  assert(webhook.sent.length === 1, "N3: and the raise reached the transport");
  assert(
    recorded.length === 1 && recorded[0]?.status === "sent",
    `N3: the send is recorded, got ${recorded.map((row) => row.status).join(",")}`,
  );
}

/**
 * N4 — the FULL ceiling still applies to a raise, whatever the mix.
 *
 * Sixty `sent` rows of which twenty charged the reserve: the raise is refused,
 * because ruling 8 reallocates one fixed budget between two callers and does
 * not create a second one. Without this case the reserved filter could be read
 * as giving the raise path its own pool, and one hour would then deliver 60
 * raises PLUS 48 events against a configured 60.
 *
 * The row IS written here, unlike N2: an ordinary raise is not re-offered
 * without anyone asking, so its refusal is the only evidence anybody gets
 * (ADR 0041 decision 4).
 *
 * **Mutation:** the full arm narrowed to the raise budget (`budget === "full"
 * && allSent >= ratePerHour`) → still green here, so the case is paired with
 * N2's absent row; the mutation that this case alone kills is the full arm
 * dropped, or `allSent` replaced by `reservedSent` in it — 20 is under 48 and
 * the raise would send.
 */
export async function testTheFullCeilingStillBindsARaise(): Promise<void> {
  const { db, recorded, setCount } = fakeDb();
  const webhook = sendingWebhook();
  const service = serviceWith({
    db,
    channels: [],
    webhook: webhook.transport,
    env: { NOTIFY_RATE_LIMIT_PER_HOUR: RATE },
  });

  setCount(60, 20);
  const results = await service.dispatchToChannels([channelRow()], input());

  assert(
    results[0]?.status === "skipped_rate_limited",
    `N4: 60 of 60 refuses a raise whatever the mix, got ${String(results[0]?.status)}`,
  );
  assert(webhook.sent.length === 0, "N4: the refused raise must not reach the transport");
  assert(
    recorded.length === 1 && recorded[0]?.status === "skipped_rate_limited",
    `N4: an ordinary raise's refusal is recorded, got ${recorded
      .map((row) => row.status)
      .join(",")}`,
  );
}

/**
 * N5 — `sendTest` meets the REDUCED event limit (owner ruling 4).
 *
 * Forty-eight rows that charged the reserve, against a ceiling of 60: a raise
 * sends on this fixture (N3, same numbers) and the manual test does not. A test
 * is not an alarm, so it must never consume headroom held for a critical raise,
 * and the reserve then means exactly one thing — only a real raise may reach the
 * last slots.
 *
 * **Mutation:** `sendTest` passing `"full"` → red here and in N6, and in no
 * other case in `apps/api/src/notifications` — measured across the whole
 * directory, because "nowhere else" is the kind of sentence that is assumed
 * rather than run. N6 reddens on its second half — 48 is under the full 60, so
 * the test sends where it must refuse. Nothing outside these two gates ruling 4.
 *
 * The recorded row is asserted too: a refused test has always written
 * `skipped_rate_limited` and read as a refusal in the UI, and ruling 4 does not
 * change that. The absence of a row would be a different bug wearing the same
 * status.
 */
export async function testAManualTestMeetsTheReducedEventLimit(): Promise<void> {
  const { db, recorded, setCount } = fakeDb();
  const webhook = sendingWebhook();
  const service = serviceWith({
    db,
    channels: [],
    webhook: webhook.transport,
    env: { NOTIFY_RATE_LIMIT_PER_HOUR: RATE },
  });

  setCount(48, 48);
  const result = await service.sendTest(channelRow());
  assert(
    result.status === "skipped_rate_limited",
    `N5: a test stops at the reserved 48, not the full 60, got ${result.status}`,
  );
  assert(webhook.sent.length === 0, "N5: the refused test must not reach the transport");
  assert(
    recorded.length === 1 && recorded[0]?.status === "skipped_rate_limited",
    `N5: the refusal is still recorded, got ${recorded.length} rows`,
  );
}

/**
 * N6 — the reserved limit is 48, and it is `>=`.
 *
 * The paired positive to N5 on the same call, plus the boundary. At 47 reserved
 * rows the test sends; at 48 it does not. Both halves keep the reserved count
 * equal to the total, so neither turns on the filter — that is N7's subject.
 *
 * **Mutations:** the reserved limit computed one short (`floor(60 * 0.8) - 1`,
 * or `EVENT_SHARE` at `0.78`) → the 47 half red, and N5 green because 48 is over
 * both. `>=` weakened to `>` → the 48 half red, and both other halves green. The
 * plan for this item named 47 alone as the `>` / `>=` gate; it is not — 47 is
 * under 48 under both comparators, so the boundary count had to be added. On the
 * full budget that comparator is already held by `notifications.service.spec.ts`'s
 * rate-3 ceiling block.
 */
export async function testTheReservedLimitIsFortyEightAndItIsInclusive(): Promise<void> {
  const { db, recorded, setCount } = fakeDb();
  const webhook = sendingWebhook();
  const service = serviceWith({
    db,
    channels: [],
    webhook: webhook.transport,
    env: { NOTIFY_RATE_LIMIT_PER_HOUR: RATE },
  });

  setCount(47, 47);
  const under = await service.sendTest(channelRow());
  assert(
    under.status === "sent",
    `N6: one under the reserved limit still sends, got ${under.status}`,
  );
  assert(webhook.sent.length === 1, "N6: and it reached the transport");

  setCount(48, 48);
  const atTheLimit = await service.sendTest(channelRow());
  assert(
    atTheLimit.status === "skipped_rate_limited",
    `N6: AT the reserved limit it refuses — the count is >=, not > — got ${atTheLimit.status}`,
  );
  assert(webhook.sent.length === 1, "N6: the second test did not reach the transport");
  assert(
    recorded.length === 2 && recorded[1]?.status === "skipped_rate_limited",
    `N6: both attempts are recorded, the second as the refusal, got ${recorded
      .map((r) => r.status)
      .join(",")}`,
  );
}

/**
 * N7 — a test send's OWN row is counted against the reserved limit.
 *
 * This is ruling 8's invariant, and it is the half a fixture cannot state: the
 * rows counted against the reserved limit must be exactly the rows written by
 * dispatches that CHARGED it. `sendTest` charges the reserve (N5), so its row
 * must fill the reserve — otherwise a burst of test sends fills the FULL ceiling
 * and eats the raise headroom without ever tripping the reserved limit, which is
 * the same starvation ruling 8 exists to remove, arriving by another door.
 *
 * Two measured facts, and the composition is the gate:
 *
 * 1. A successful `sendTest` writes a row whose `dedupe_key` is **NULL** — the
 *    only path in the service that does. `record()` is the single insert, every
 *    other caller passes `buildDedupeKey`'s output, and the three `sendTest`
 *    call sites pass `null`.
 * 2. The reserved aggregate's `FILTER` carries an `IS NULL` disjunct on that
 *    column, so a row of exactly that shape is one it counts.
 *
 * **What this does NOT gate**, stated because the sentence above is a claim
 * too: no unit case here executes the `FILTER` over rows. The fake answers the
 * ceiling read with settable numbers, so nothing in this file shows Postgres
 * counting a NULL-keyed row. That is `storm-control.integration.spec.ts`'s
 * layer, where every other `WHERE` in this service is proven against real rows.
 * It ran green against Postgres with this aggregate — so `count(*) FILTER
 * (WHERE …)::int` is valid SQL and the read executes — but this unit added no
 * case there, so which rows the filter SELECTS is still unmeasured against a
 * database.
 *
 * **Mutations:** the `IS NULL` disjunct dropped from the filter → red here, and
 * green in every other case in this file and in every other suite — a test send
 * would then charge the full ceiling only. `sendTest` passing a real dedupe key
 * to `record()` → red on the first assertion. The `LIKE` pattern replaced by a
 * literal that is not `RESERVED_KEY_PATTERN` → red on the last.
 */
export async function testATestSendsOwnRowIsCountedAgainstTheReserve(): Promise<void> {
  const { db, recorded, rateLimitProjections, setCount } = fakeDb();
  const webhook = sendingWebhook();
  const service = serviceWith({
    db,
    channels: [],
    webhook: webhook.transport,
    env: { NOTIFY_RATE_LIMIT_PER_HOUR: RATE },
  });

  setCount(0, 0);
  const result = await service.sendTest(channelRow());
  assert(result.status === "sent", `N7: the test send goes through, got ${result.status}`);

  // `Recorded.dedupeKey` is declared `string` in the shared fake and the COLUMN
  // is nullable. Narrowed here rather than widened there, where four suites
  // call `.endsWith()` on it.
  const testRow = recorded[0] as { dedupeKey: string | null } | undefined;
  assert(recorded.length === 1, `N7: the test send wrote one row, got ${recorded.length}`);
  assert(
    testRow?.dedupeKey === null,
    `N7: a test send's row carries NO dedupe key — that is what the filter matches it by, got "${String(
      testRow?.dedupeKey,
    )}"`,
  );

  assert(
    rateLimitProjections.length === 1,
    `N7: one ceiling read to inspect, got ${rateLimitProjections.length}`,
  );
  const projection = rateLimitProjections[0] as Record<string, unknown>;
  const rendered = new PgDialect().sqlToQuery(projection.reservedSent as SQL);
  assert(
    /filter\s*\(\s*where/i.test(rendered.sql),
    `N7: the reserved count is a FILTER aggregate on the one query, got: ${rendered.sql}`,
  );
  assert(
    /"dedupe_key"\s+is\s+null/i.test(rendered.sql),
    `N7: a NULL key — a test send's row — must be counted as reserved, got: ${rendered.sql}`,
  );
  assert(
    rendered.params.includes(RESERVED_KEY_PATTERN),
    `N7: and the event keys are matched by RESERVED_KEY_PATTERN, got: ${JSON.stringify(
      rendered.params,
    )}`,
  );
}
