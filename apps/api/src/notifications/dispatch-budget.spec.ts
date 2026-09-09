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
 * callers asks for (ADR 0041 Amendment 6 §1, owner rulings 3 and 4).
 *
 * `dispatch-policy.spec.ts` holds the two limits themselves, as pure functions.
 * This file holds the wiring, and the wiring is where a literal `"full"` or
 * `"reserved"` at one call site would make the whole reserve inert with every
 * pure-function case still green.
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
 * **B1 and B2 share one fixture and one `setCount`**, and that is the point of
 * the pair: at a rate of 60 with 50 `sent` rows in the trailing hour, one
 * count answers "under the ceiling" for a raise and "over it" for a step. Two
 * independent fixtures would prove the two statuses and not the one reserve.
 */

/** Every case here runs at the default 60 an hour, where the reserved limit is 48. */
const RATE = "60";

/** A transport that always sends, so a refusal in these cases is the ceiling's doing. */
const sendingWebhook = (): ReturnType<typeof fakeTransport> =>
  fakeTransport("webhook", () => Promise.resolve<DeliveryResult>({ status: "sent", error: null }));

/**
 * B1 + B2 — one count, two limits.
 *
 * Fifty `sent` rows in the trailing hour, a ceiling of 60 and a reserved limit
 * of `floor(60 * 0.8) = 48`. On that ONE fixture the raise sends and the
 * escalation step does not: the twelve slots between 48 and 60 are the reserve,
 * and this is the case that shows they exist.
 *
 * **Mutations:** `dispatchToChannel` passing a literal `"reserved"` → B1 red
 * (the raise is refused with headroom left); a literal `"full"` → B2 red (the
 * step consumes the reserve); `EVENT_SHARE` raised to `1.0` → B2 red, because
 * the two limits collapse into one and 50 is under both. The pair is what kills
 * the third — neither half alone does.
 *
 * B2 also re-asserts `F3.48` ruling Q1 on the new path: a ceiling-refused step
 * writes NO row, so the next tick can retry it. The count is compared against
 * B1's own row rather than against zero, because the two share a fixture.
 */
export async function testTheRaiseReachesSlotsTheEventPathCannot(): Promise<void> {
  const { db, recorded, reads, setCount } = fakeDb();
  const webhook = sendingWebhook();
  const service = serviceWith({
    db,
    channels: [channelRow()],
    webhook: webhook.transport,
    env: { NOTIFY_RATE_LIMIT_PER_HOUR: RATE },
  });

  setCount(50);

  // B1. The raise path keeps the whole ceiling: 50 is under 60.
  const raise = await service.dispatch(input());
  assert(
    raise[0]?.status === "sent",
    `B1: a raise still sends at 50 of 60, got ${String(raise[0]?.status)}`,
  );
  assert(webhook.sent.length === 1, "B1: and it reached the transport");
  const rowsAfterTheRaise = recorded.length;
  assert(rowsAfterTheRaise === 1, `B1: the send is recorded, got ${rowsAfterTheRaise} rows`);

  // B2. The event path stops at the reserve: the SAME 50 is over 48.
  const step = await service.dispatchToChannels(
    [channelRow()],
    input({ event: { kind: "escalation", step: 1 } }),
  );
  assert(
    step[0]?.status === "skipped_rate_limited",
    `B2: the same count refuses a step at the reserved 48, got ${String(step[0]?.status)}`,
  );
  assert(step[0]?.error === null, "B2: a ceiling refusal is not an error");
  assert(webhook.sent.length === 1, "B2: the refused step must not reach the transport");
  assert(
    recorded.length === rowsAfterTheRaise,
    `B2: F3.48 Q1 — a ceiling-refused step writes no row, got ${
      recorded.length - rowsAfterTheRaise
    } new rows`,
  );

  // Amendment 6's "no second query, one count, two limits", which the docblock
  // on `isOverHourlyLimit` asserts in prose and nothing else gates: two
  // dispatches, two ceiling reads, and no third read behind the second limit.
  assert(
    reads.rateLimit === 2,
    `one ceiling read per dispatch and no second query, got ${reads.rateLimit}`,
  );
}

/**
 * B3 — `sendTest` meets the REDUCED event limit (owner ruling 4).
 *
 * Fifty `sent` rows against a ceiling of 60: a raise would send here (B1 above,
 * same numbers), and the manual test does not. A test is not an alarm, so it
 * must never consume headroom held for a critical raise, and the reserve then
 * means exactly one thing — only a real raise may reach the last slots.
 *
 * **Mutation:** `sendTest` passing `"full"` → red here, and nowhere else in the
 * repository. Nothing else gates ruling 4.
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

  setCount(50);
  const result = await service.sendTest(channelRow());
  assert(
    result.status === "skipped_rate_limited",
    `B3: a test stops at the reserved 48, not the full 60, got ${result.status}`,
  );
  assert(webhook.sent.length === 0, "B3: the refused test must not reach the transport");
  assert(
    recorded.length === 1 && recorded[0]?.status === "skipped_rate_limited",
    `B3: the refusal is still recorded, got ${recorded.length} rows`,
  );
}

/**
 * B4 — the reserved limit is 48, and it is `>=`.
 *
 * The paired positive to B3 on the same call, plus the boundary. At 47 the test
 * sends; at 48 it does not.
 *
 * **Mutations:** the reserved limit computed one short (`floor(60 * 0.8) - 1`,
 * or `EVENT_SHARE` at `0.78`) → the 47 half red, and B3 green because 50 is
 * over both. `>=` weakened to `>` → the 48 half red, and both other halves
 * green. The plan for this item named 47 alone as the `>` / `>=` gate; it is
 * not — 47 is under 48 under both comparators, so the boundary count had to be
 * added. On the full budget that comparator is already held by
 * `notifications.service.spec.ts`'s rate-3 ceiling block.
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

  setCount(47);
  const under = await service.sendTest(channelRow());
  assert(
    under.status === "sent",
    `B4: one under the reserved limit still sends, got ${under.status}`,
  );
  assert(webhook.sent.length === 1, "B4: and it reached the transport");

  setCount(48);
  const atTheLimit = await service.sendTest(channelRow());
  assert(
    atTheLimit.status === "skipped_rate_limited",
    `B4: AT the reserved limit it refuses — the count is >=, not > — got ${atTheLimit.status}`,
  );
  assert(webhook.sent.length === 1, "B4: the second test did not reach the transport");
  assert(
    recorded.length === 2 && recorded[1]?.status === "skipped_rate_limited",
    `B4: both attempts are recorded, the second as the refusal, got ${recorded
      .map((r) => r.status)
      .join(",")}`,
  );
}
