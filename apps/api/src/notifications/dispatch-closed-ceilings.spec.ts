import { ClosedCeilings } from "./closed-ceilings";
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
 * `F3.53` — the memo where the ceiling READ is, and what still reads the ledger
 * (ADR 0041 Amendment 7, owner rulings 1 and 2).
 *
 * `closed-ceilings.spec.ts` holds {@link ClosedCeilings} itself, as a pure
 * class: what it remembers, what it refuses to remember, and how the key is
 * built. This file holds the WIRING — that `dispatchToChannel` consults the memo
 * it was handed, with the channel, the organization and the budget of the
 * dispatch in front of it, and that the three paths Amendment 7 §3 deliberately
 * left alone still read the ledger every time.
 *
 * **The wiring is where the cost lives, and where a plausible edit hides.** A
 * literal `"reserved"` at the memo call, a constant channel id, an
 * optional-chain that never reads, or a service-level default instance all
 * leave every pure case in `closed-ceilings.spec.ts` green: the class would
 * still remember exactly what it is asked to remember. S3, S4, S2 and S5–S7 are
 * those four edits, one case each.
 *
 * **Its own file, one exported function per case, one `it()` per function.**
 * `assert` throws, so a pair of claims inside one `it()` never reaches the
 * second once the first reddens, and the block that owns the claim would never
 * run (AGENTS.md §4.6). `dispatch-budget.spec.ts` is the shape.
 *
 * **Every counter here is per fixture.** `fakeDb().reads.rateLimit` counts the
 * ceiling reads of ONE fake and `ClosedCeilings.size` is per instance — neither
 * is a lifetime statistic (§4.6). A case that wants two windows makes two.
 *
 * No Postgres and no socket: the fake database answers the ceiling read with
 * settable counts, exactly as `dispatch-budget.spec.ts` does.
 */

/** Every case runs at the default 60 an hour, where the reserved limit is 48. */
const RATE = "60";

/** Two alarms, so two escalation steps carry two dedupe keys and neither answers the other. */
const ALARM_A = "44444444-4444-4444-4444-44444444444a";
const ALARM_B = "44444444-4444-4444-4444-44444444444b";

/** A transport that always sends, so a refusal below is the ceiling's doing. */
const sendingWebhook = (): ReturnType<typeof fakeTransport> =>
  fakeTransport("webhook", () => Promise.resolve<DeliveryResult>({ status: "sent", error: null }));

/**
 * An escalation step for one alarm — the dispatch `budgetFor` puts on the
 * RESERVED budget, and the only case Amendment 7 §1 measured spinning.
 */
const step = (alarmId: string) => input({ alarmId, event: { kind: "escalation", step: 1 } });

/**
 * S1 — **the saving**: two refused steps on one channel inside one tick cost
 * ONE ceiling read.
 *
 * Sixty `sent` rows against a ceiling of 60, two escalation steps for two
 * different alarms, one channel, one memo. Both are refused; the second is
 * refused from memory.
 *
 * **The positives are what make this a saving rather than a short circuit.**
 * `reads.deliveryExists === 2` says both dispatches really entered
 * `dispatchToChannel` and did their own event-idempotency read — without it,
 * "one ceiling read" would also pass if the second dispatch never ran at all.
 * `recorded.length === 0` is `F3.48` ruling Q1 unchanged: a ceiling-refused step
 * writes nothing, so the next tick can ask again.
 *
 * **Mutation:** the ternary always taking `read()` — the memo consulted and
 * discarded — → `rateLimit === 2`, red here. This is the assertion that reddens
 * if the memo is ever removed from the call site.
 *
 * **Run, not reasoned: S4 reddens too**, at `S4: and three distinct triples are
 * remembered, got 0`, because it also reads `memo.size`. Every other case in
 * this file stays green. The first draft of this note claimed the whole rest of
 * the file was green, which is the §4.6 failure of describing a mutation from
 * the reasoning instead of from the run.
 */
export async function testTwoRefusedStepsOnOneChannelCostOneCeilingRead(): Promise<void> {
  const { db, recorded, reads, setCount } = fakeDb();
  const webhook = sendingWebhook();
  const service = serviceWith({
    db,
    channels: [],
    webhook: webhook.transport,
    env: { NOTIFY_RATE_LIMIT_PER_HOUR: RATE },
  });
  const memo = new ClosedCeilings();
  const channels = [channelRow()];

  setCount(60, 60);
  const first = await service.dispatchToChannels(channels, step(ALARM_A), memo);
  const second = await service.dispatchToChannels(channels, step(ALARM_B), memo);

  assert(
    first[0]?.status === "skipped_rate_limited" && first[0]?.error === null,
    `S1: the first step is refused by the ceiling, got ${String(first[0]?.status)}`,
  );
  assert(
    second[0]?.status === "skipped_rate_limited" && second[0]?.error === null,
    `S1: and the second is refused the same way, got ${String(second[0]?.status)}`,
  );
  assert(webhook.sent.length === 0, `S1: neither reached the transport, got ${webhook.sent.length}`);
  assert(
    recorded.length === 0,
    `S1: a ceiling-refused step still writes no row, got ${recorded.map((r) => r.status).join(",")}`,
  );
  assert(
    reads.deliveryExists === 2,
    `S1: both dispatches really ran — two event-idempotency reads, got ${reads.deliveryExists}`,
  );
  assert(
    reads.rateLimit === 1,
    `S1: the second refusal comes from the memo — one ceiling read, got ${reads.rateLimit}`,
  );
  assert(memo.size === 1, `S1: one triple remembered, got ${memo.size}`);
}

/**
 * S2 — an OPEN ceiling is read before every dispatch, memo or not.
 *
 * The asymmetry ruling 1 rests on, measured at the call site rather than in the
 * class: a `false` is never remembered, so decision 7's ceiling is still read
 * from the ledger before every dispatch that could be ADMITTED by it, and no
 * send is ever authorised by memory.
 *
 * **Mutation:** the memo answering from a remembered `false` — `closed.add(key)`
 * moved out of its `if (over)` in `closed-ceilings.ts`. **Measured, the block
 * throws at `S2: so does the second, got skipped_rate_limited`** — the STATUS
 * assertion, which runs first: a remembered `false` makes the second dispatch
 * answer `true` from memory and be refused, so the case never reaches the
 * `rateLimit` and `memo.size` assertions below it. An earlier draft of this
 * note named those two counts as the ones that redden, which they do not; §4.6
 * asks the mutation to be run and read, not predicted. (The edit also reddens
 * `closed-ceilings.spec.ts`, which owns the class-level claim; this case is the
 * wiring's own copy of it.)
 */
export async function testAnOpenCeilingIsReadBeforeEveryDispatch(): Promise<void> {
  const { db, reads, setCount } = fakeDb();
  const webhook = sendingWebhook();
  const service = serviceWith({
    db,
    channels: [],
    webhook: webhook.transport,
    env: { NOTIFY_RATE_LIMIT_PER_HOUR: RATE },
  });
  const memo = new ClosedCeilings();
  const channels = [channelRow()];

  setCount(0, 0);
  const first = await service.dispatchToChannels(channels, step(ALARM_A), memo);
  const second = await service.dispatchToChannels(channels, step(ALARM_B), memo);

  assert(first[0]?.status === "sent", `S2: the first step sends, got ${String(first[0]?.status)}`);
  assert(second[0]?.status === "sent", `S2: so does the second, got ${String(second[0]?.status)}`);
  assert(
    reads.rateLimit === 2,
    `S2: an open ceiling is re-read every time — two reads, got ${reads.rateLimit}`,
  );
  assert(memo.size === 0, `S2: and nothing is remembered, got ${memo.size}`);
}

/**
 * S3 — the BUDGET is part of the key: a `reserved` refusal must not refuse a
 * `full` dispatch.
 *
 * Forty-eight `sent` rows, all of them written by dispatches that charged the
 * reserve. The step is refused at the reserved limit; the raise behind it has
 * twelve slots of the full ceiling left and must get them. That is the whole
 * reason the last twelve slots of every hour exist (Amendment 6 §1) — a key
 * without the budget in it would let one refused step close them inside one
 * tick.
 *
 * **Mutation:** a literal `"reserved"` at the memo call, or `budgetFor` dropped
 * from the key — the memo asked with the channel and the organization only — →
 * the raise is answered `true` from the step's refusal, `skipped_rate_limited`
 * and `rateLimit === 1`, red here. Green in S1, S2 and S4, which never mix two
 * budgets on one memo.
 */
export async function testAReservedRefusalDoesNotRefuseTheFullBudget(): Promise<void> {
  const { db, reads, setCount } = fakeDb();
  const webhook = sendingWebhook();
  const service = serviceWith({
    db,
    channels: [],
    webhook: webhook.transport,
    env: { NOTIFY_RATE_LIMIT_PER_HOUR: RATE },
  });
  const memo = new ClosedCeilings();
  const channels = [channelRow()];

  setCount(48, 48);
  const refused = await service.dispatchToChannels(channels, step(ALARM_A), memo);
  assert(
    refused[0]?.status === "skipped_rate_limited",
    `S3: the step meets the reserved limit, got ${String(refused[0]?.status)}`,
  );

  const raise = await service.dispatchToChannels(channels, input({ reoffered: true }), memo);
  assert(
    raise[0]?.status === "sent",
    `S3: the raise keeps the full ceiling and must not inherit the step's refusal, got ${String(
      raise[0]?.status,
    )}`,
  );
  assert(
    reads.rateLimit === 2,
    `S3: a different budget is a different key, so the raise reads — got ${reads.rateLimit}`,
  );
}

/**
 * S4 — the CHANNEL is part of the key: one step over three channels costs three
 * reads.
 *
 * Amendment 7 §1's own figure ("three channels on one step cost three reads")
 * survives the memo. The ceiling is per channel, so a refusal on one says
 * nothing about the next.
 *
 * **Mutation:** a constant channel id at the memo call — the memo asked with
 * something that is not `channel.id` — → `rateLimit === 1` and `memo.size === 1`,
 * red here. Every other case in this file uses one channel and stays green.
 */
export async function testOneStepOverThreeChannelsCostsThreeReads(): Promise<void> {
  const { db, reads, setCount } = fakeDb();
  const webhook = sendingWebhook();
  const service = serviceWith({
    db,
    channels: [],
    webhook: webhook.transport,
    env: { NOTIFY_RATE_LIMIT_PER_HOUR: RATE },
  });
  const memo = new ClosedCeilings();
  // Three channels in ONE organization: `dispatchToChannels` drops a channel of
  // another tenant before the ceiling is ever reached, which would give the
  // right read count for the wrong reason.
  const channels = [
    channelRow({ id: "55555555-5555-5555-5555-55555555555a", code: "ops-a" }),
    channelRow({ id: "55555555-5555-5555-5555-55555555555b", code: "ops-b" }),
    channelRow({ id: "55555555-5555-5555-5555-55555555555c", code: "ops-c" }),
  ];

  setCount(60, 60);
  const results = await service.dispatchToChannels(channels, step(ALARM_A), memo);

  assert(results.length === 3, `S4: all three channels were tried, got ${results.length}`);
  assert(
    results.every((result) => result.status === "skipped_rate_limited"),
    `S4: each is refused by its own ceiling, got ${results.map((r) => r.status).join(",")}`,
  );
  assert(
    reads.rateLimit === 3,
    `S4: the ceiling is per channel — three reads, got ${reads.rateLimit}`,
  );
  assert(memo.size === 3, `S4: and three distinct triples are remembered, got ${memo.size}`);
}

/**
 * S5 — `dispatch()`, the fire-and-forget raise path, is unaffected.
 *
 * Amendment 7 §3's second omission, and the row's own stated doubt: `dispatch()`
 * runs concurrently with the sweep and outside it, so it passes no memo and
 * reads the ledger exactly as it did before this unit. Two presses, two reads.
 *
 * **Mutation (shared with S6 and S7):** a service-level field memo —
 * `private readonly closedCeilings = new ClosedCeilings()`, consulted when the
 * argument is absent — → `rateLimit === 1` here, red. This case asserts its own
 * caller: it never touches `dispatchToChannels`, and the ordinary raise's row is
 * asserted with it, because `dispatch()` is also the one path where a
 * ceiling-refused dispatch still WRITES (`offeredAgainWithoutAsking` is false
 * for a raise nobody re-offers).
 */
export async function testTheFireAndForgetRaisePathIsUnaffected(): Promise<void> {
  const { db, recorded, reads, setCount } = fakeDb();
  const webhook = sendingWebhook();
  const service = serviceWith({
    db,
    channels: [channelRow()],
    webhook: webhook.transport,
    env: { NOTIFY_RATE_LIMIT_PER_HOUR: RATE },
  });

  setCount(60, 60);
  await service.dispatch(input());
  await service.dispatch(input());

  assert(
    reads.rateLimit === 2,
    `S5: dispatch() carries no memo and reads every time, got ${reads.rateLimit}`,
  );
  assert(
    recorded.length === 2 &&
      recorded.every((row) => row.status === "skipped_rate_limited"),
    `S5: an ordinary raise still records each refusal, got ${recorded
      .map((row) => row.status)
      .join(",")}`,
  );
}

/**
 * S6 — `sendTest` is unaffected, and it is not a caller of
 * `dispatchToChannels` at all.
 *
 * Amendment 7 §3 first said `dispatchToChannels` had FOUR production callers and
 * named `sendTest` as one; that was corrected in place in the ADR. `sendTest`
 * calls `isOverHourlyLimit` directly, so it cannot see a memo on any reading.
 * This case is the corrected sentence made measurable rather than repeated.
 *
 * Forty-eight reserved rows: ruling 4 holds a manual test to the reduced event
 * limit, so both presses are refused — and both WRITE, because `sendTest` has no
 * next tick to conserve anything for.
 *
 * **Mutation (shared with S5 and S7):** the service-level field memo, with
 * `sendTest`'s own read routed through it → `rateLimit === 1`, red here. Applied
 * at `dispatchToChannel` alone it cannot reach this path, which is exactly the
 * claim.
 */
export async function testTheManualTestPathIsUnaffected(): Promise<void> {
  const { db, recorded, reads, setCount } = fakeDb();
  const webhook = sendingWebhook();
  const service = serviceWith({
    db,
    channels: [],
    webhook: webhook.transport,
    env: { NOTIFY_RATE_LIMIT_PER_HOUR: RATE },
  });

  setCount(48, 48);
  const first = await service.sendTest(channelRow());
  const second = await service.sendTest(channelRow());

  assert(
    first.status === "skipped_rate_limited" && second.status === "skipped_rate_limited",
    `S6: a manual test still meets the reduced limit, got ${first.status} then ${second.status}`,
  );
  assert(
    reads.rateLimit === 2,
    `S6: sendTest never enters dispatchToChannels, so it reads every time, got ${reads.rateLimit}`,
  );
  assert(
    recorded.length === 2,
    `S6: and each refusal is still recorded, got ${recorded.length} row(s)`,
  );
}

/**
 * S7 — no third argument, no memory.
 *
 * The optional parameter's whole promise (ruling 2): a caller that passes no
 * memo behaves exactly as it did before this unit. `notifyCleared` is the
 * production caller that relies on it — a cleared message has no next tick to be
 * postponed to — and it is asserted here in the general form, on the same
 * refused-step fixture as S1, so the pair differ in one thing only.
 *
 * **Mutation (shared with S5 and S6):** a memo defaulted at the service level,
 * or a default instance at the parameter (`closedCeilings = new ClosedCeilings()`
 * as a default value would be a fresh one per call and stay green here, but a
 * field would not) → `rateLimit === 1`, red here.
 */
export async function testNoThirdArgumentMeansNoMemory(): Promise<void> {
  const { db, reads, setCount } = fakeDb();
  const webhook = sendingWebhook();
  const service = serviceWith({
    db,
    channels: [],
    webhook: webhook.transport,
    env: { NOTIFY_RATE_LIMIT_PER_HOUR: RATE },
  });
  const channels = [channelRow()];

  setCount(60, 60);
  const first = await service.dispatchToChannels(channels, step(ALARM_A));
  const second = await service.dispatchToChannels(channels, step(ALARM_B));

  assert(
    first[0]?.status === "skipped_rate_limited" && second[0]?.status === "skipped_rate_limited",
    `S7: both steps are refused, got ${String(first[0]?.status)} then ${String(second[0]?.status)}`,
  );
  assert(
    reads.rateLimit === 2,
    `S7: without a memo the ledger answers every dispatch, got ${reads.rateLimit}`,
  );
}

/**
 * S8 — a FAILED read is not remembered, and it still writes no row for a step.
 *
 * A ledger that cannot answer is not a channel over its ceiling. One transient
 * failure must not refuse every later dispatch on that key for the rest of the
 * sweep — which is what a memo that remembered a rejection would do, silently,
 * for up to a tick.
 *
 * The same memo and the same step are used on both halves on purpose: the second
 * call is the one that could be answered from a poisoned memory, and it is the
 * only way to tell "not remembered" from "never asked". The H1 branch is
 * unchanged with it — `failed`, and no row, because an escalation step's key
 * lasts the life of the ledger.
 *
 * **Mutation:** the read remembered on rejection — `read()` wrapped so a throw
 * adds the key before it propagates → the second dispatch answers
 * `skipped_rate_limited` from memory, red here. (The same defect written inside
 * `closed-ceilings.ts` also reddens `closed-ceilings.spec.ts`, which owns the
 * class-level claim.)
 */
export async function testAFailedReadIsNotRemembered(): Promise<void> {
  const { db, recorded, reads, setCount, failRateLimitReads } = fakeDb();
  const webhook = sendingWebhook();
  const service = serviceWith({
    db,
    channels: [],
    webhook: webhook.transport,
    env: { NOTIFY_RATE_LIMIT_PER_HOUR: RATE },
  });
  const memo = new ClosedCeilings();
  const channels = [channelRow()];

  failRateLimitReads(true);
  const failed = await service.dispatchToChannels(channels, step(ALARM_A), memo);
  assert(
    failed[0]?.status === "failed",
    `S8: an unreadable ceiling is not a licence to send, got ${String(failed[0]?.status)}`,
  );
  assert(
    recorded.length === 0,
    `S8: and a step's failed read still writes no row, got ${recorded
      .map((row) => row.status)
      .join(",")}`,
  );
  assert(memo.size === 0, `S8: a rejection is not a closed ceiling, got ${memo.size}`);

  failRateLimitReads(false);
  setCount(0, 0);
  const retried = await service.dispatchToChannels(channels, step(ALARM_A), memo);
  assert(
    retried[0]?.status === "sent",
    `S8: the same key sends once the ledger answers again, got ${String(retried[0]?.status)}`,
  );
  assert(
    reads.rateLimit === 2,
    `S8: both dispatches reached the ledger, got ${reads.rateLimit}`,
  );
}
