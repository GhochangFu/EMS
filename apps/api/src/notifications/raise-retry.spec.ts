import type { NotificationChannelRow } from "./notification-transport";
import {
  LostLedgerRows,
  channelsOwedTheRaise,
  unconfiguredWatermark,
  type RaiseAttemptRow,
} from "./raise-retry";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ORG_ID = "aaaaaaaa-0000-0000-0000-00000000000a";
const ALARM_ID = "22222222-2222-2222-2222-222222222222";
const C1 = "33333333-3333-3333-3333-333333333331";
const C2 = "33333333-3333-3333-3333-333333333332";

/** The `maxAttempts` every case passes unless it is the thing being tested. */
const MAX_ATTEMPTS = 3;

/** A process that started at noon, and a channel nobody has edited since 2020. */
const PROCESS_STARTED_AT = new Date("2026-09-08T12:00:00.000Z");
const CHANNEL_EDITED_LONG_AGO = new Date("2020-01-01T00:00:00.000Z");
/** Either side of `max(updatedAt, processStartedAt)` for such a channel. */
const AFTER_THE_WATERMARK = new Date("2026-09-08T12:30:00.000Z");
const BEFORE_THE_WATERMARK = new Date("2026-09-08T11:30:00.000Z");

/**
 * `F3.51` U1 — which of a rule's channels are still owed an alarm's raise
 * (ADR 0041 Amendment 5, ADR 0057 Amendment 5).
 *
 * `channelsOwedTheRaise` must reproduce `NotificationsService.eventDeliveryBlocked`
 * exactly, applied to the raise key instead of an event key, plus ruling Q1's
 * evidence conjunct in front of it. Every case below names the mutation that
 * reddens it, and each was run — a case whose mutation was not measured is a
 * comment, not a gate.
 *
 * **The channel rows are built inside each case, never once above the table.**
 * A suite that builds its fixture once cannot catch a mutation to how the
 * fixture is derived — `F3.50` shipped exactly that hole, where an integration
 * suite built its channel before any row was planted and could not see the
 * watermark move.
 *
 * **What this file cannot prove.** It is pure: no database, no clock. That the
 * ledger read really returns a `skipped_rate_limited` row rather than filtering
 * it out in SQL is `raise-attempts.integration.spec.ts`'s claim, and that the
 * sweep passes the real `MAX_EVENT_ATTEMPTS` and `PROCESS_STARTED_AT` rather
 * than a literal is `alarm-lifecycle-raise-retry.spec.ts`'s.
 */
export function runRaiseRetryTests(): void {
  const channel = (overrides: Partial<NotificationChannelRow> = {}): NotificationChannelRow => ({
    id: C1,
    organizationId: ORG_ID,
    code: "ops-webhook",
    name: "Operations webhook",
    kind: "webhook",
    config: { url: "https://hooks.example.com/x" },
    secret: null,
    secretState: "none",
    enabled: true,
    updatedAt: CHANNEL_EDITED_LONG_AGO,
    ...overrides,
  });

  const row = (overrides: Partial<RaiseAttemptRow> = {}): RaiseAttemptRow => ({
    alarmId: ALARM_ID,
    organizationId: ORG_ID,
    channelId: C1,
    status: "failed",
    attemptedAt: BEFORE_THE_WATERMARK,
    ...overrides,
  });

  const times = (count: number, overrides: Partial<RaiseAttemptRow> = {}): RaiseAttemptRow[] =>
    Array.from({ length: count }, () => row(overrides));

  // --- P1..P11: one channel, one table ---------------------------------------
  //
  // The predicate in three stages, and the ORDER of the stages is the whole
  // file: evidence over EVERY row for the channel, then the two status
  // exclusions, then the two blocking arms over what is left.
  const cases: {
    id: string;
    rows: RaiseAttemptRow[];
    owed: boolean;
    maxAttempts?: number;
    why: string;
  }[] = [
    {
      id: "P1",
      rows: [],
      owed: false,
      why:
        "ruling Q1: a channel with no row under the key has not been offered the raise yet — " +
        "dropping this conjunct re-offers it on the same tick the raise is dispatching",
    },
    {
      id: "P2",
      rows: [row({ status: "sent" })],
      owed: false,
      why: "a delivered raise is never re-offered — the `some(status !== 'failed')` arm",
    },
    {
      id: "P3",
      rows: times(1),
      owed: true,
      why: "one transport failure is a retry, not a decision",
    },
    {
      id: "P4",
      rows: times(2),
      owed: true,
      why: "two failures are still under the cap — `>=` on the count, not `>`",
    },
    {
      id: "P4b",
      rows: times(2),
      owed: false,
      maxAttempts: 2,
      why:
        "the cap is the PARAMETER, not a literal 3 — the same two rows block when the caller " +
        "says two. Nothing else in this file would notice a hard-coded bound",
    },
    {
      id: "P5",
      rows: times(MAX_ATTEMPTS),
      owed: false,
      why: "`MAX_EVENT_ATTEMPTS` failures spend the key, as they do on an event key",
    },
    {
      id: "P6",
      rows: [row({ status: "skipped_rate_limited" })],
      owed: true,
      why:
        "`F3.48` ruling Q2: a ceiling refusal never blocks. It IS evidence, so the exclusion " +
        "belongs to the eligible set and never to the evidence test",
    },
    {
      id: "P7",
      rows: times(5, { status: "skipped_rate_limited" }),
      owed: true,
      why:
        "the `F3.48` trap: rate-limited rows must not count toward the cap either, or a channel " +
        "held over its ceiling burns three ticks in 90 seconds and is lost for the alarm's life",
    },
    {
      id: "P8",
      rows: [row({ status: "skipped_unconfigured", attemptedAt: AFTER_THE_WATERMARK })],
      owed: false,
      why:
        "`F3.50` ruling Q1: an unconfigured refusal newer than the configuration that produced " +
        "it still answers the key",
    },
    {
      id: "P9",
      rows: [row({ status: "skipped_unconfigured", attemptedAt: BEFORE_THE_WATERMARK })],
      owed: true,
      why: "and it stops answering once the watermark passes it — configure SMTP and the raise goes",
    },
    {
      id: "P10",
      rows: times(MAX_ATTEMPTS, {
        status: "skipped_unconfigured",
        attemptedAt: BEFORE_THE_WATERMARK,
      }),
      owed: true,
      why: "an excluded row is out of the sample entirely, so it cannot spend an attempt either",
    },
    {
      id: "P11",
      rows: [row({ status: "sent" }), ...times(2)],
      owed: false,
      why:
        "the `sent` arm is evaluated with the count, not after it: three rows here, two of them " +
        "`failed`, and it is the `sent` one that decides",
    },
  ];

  for (const c of cases) {
    const owed = channelsOwedTheRaise({
      channels: [channel()],
      rows: c.rows,
      maxAttempts: c.maxAttempts ?? MAX_ATTEMPTS,
      processStartedAt: PROCESS_STARTED_AT,
    });
    assert(
      owed.length === (c.owed ? 1 : 0),
      `${c.id}: expected the channel to be ${c.owed ? "owed" : "not owed"} — ${c.why}; ` +
        `got ${owed.length} channel(s) for [${c.rows.map((r) => r.status).join(",")}]`,
    );
  }

  // --- P12: rows are matched per channel, not per alarm -----------------------
  //
  // The plan's own wording for this case was unsatisfiable — with the evidence
  // conjunct a channel with NO rows is never owed, so "only the other is owed"
  // cannot happen. The discriminating fixture is the other way round: C1 holds
  // the one `failed` row and C2 holds nothing, so C1 alone is owed. A predicate
  // that matched rows by alarm and ignored `channelId` would lend C1's row to
  // C2 and return both.
  {
    const c1 = channel({ id: C1, code: "a" });
    const c2 = channel({ id: C2, code: "b" });
    const owed = channelsOwedTheRaise({
      channels: [c1, c2],
      rows: [row({ channelId: C1 })],
      maxAttempts: MAX_ATTEMPTS,
      processStartedAt: PROCESS_STARTED_AT,
    });
    assert(
      owed.length === 1 && owed[0] === c1,
      `P12: only the channel holding the failed row is owed, got [${owed.map((ch) => ch.code).join(",")}]`,
    );
  }

  // --- P13: the CHANNEL ROWS come back, in the order given --------------------
  //
  // The caller hands the result straight to `dispatchToChannels`, which sends
  // in the order it is given and needs the whole row (its kind, its secret, its
  // `updatedAt`). Returning ids, or sorting by code, would both compile.
  {
    const c2 = channel({ id: C2, code: "b" });
    const c1 = channel({ id: C1, code: "a" });
    const owed = channelsOwedTheRaise({
      channels: [c2, c1],
      rows: [row({ channelId: C1 }), row({ channelId: C2 })],
      maxAttempts: MAX_ATTEMPTS,
      processStartedAt: PROCESS_STARTED_AT,
    });
    assert(
      owed.length === 2 && owed[0] === c2 && owed[1] === c1,
      `P13: the caller's order is kept and the rows are the channels themselves, got [${owed
        .map((ch) => ch.code)
        .join(",")}]`,
    );
  }

  // --- P14: the watermark is the LATER of the two clocks ----------------------
  //
  // `F3.50` ruling Q1, extracted from `dispatchToChannel` so that both call
  // sites compute it the same way. Reading only `updatedAt` reddens the first
  // assertion; reading only `processStartedAt` reddens the second.
  {
    const old = unconfiguredWatermark({ updatedAt: CHANNEL_EDITED_LONG_AGO }, PROCESS_STARTED_AT);
    assert(
      old.getTime() === PROCESS_STARTED_AT.getTime(),
      `P14: a channel nobody has edited since boot uses the process start, got ${old.toISOString()}`,
    );
    const edited = unconfiguredWatermark({ updatedAt: AFTER_THE_WATERMARK }, PROCESS_STARTED_AT);
    assert(
      edited.getTime() === AFTER_THE_WATERMARK.getTime(),
      `P14: a channel edited after boot uses its own updated_at, got ${edited.toISOString()}`,
    );
  }

  // --- P15: the lost-row memory keys on the KEY as well as the pair ----------
  //
  // `F3.51` review (High). A raise key is `rule:alarm:severity`, and
  // `raiseRetryDispatchInput` reads the ALARM's severity, so an alarm whose
  // severity is edited under it acquires a genuinely different key with
  // genuinely no rows under it. Keying the memory on `(alarm, channel)` alone
  // would then suppress a raise that has never been offered at all.
  //
  // **Mutation:** dropping `dedupeKey` from the key → the second `has` returns
  // `true` and the case reddens. The first `has` is its paired positive: the
  // same pair under the SAME key IS remembered, so the case cannot pass on a
  // `has` that always answers `false`.
  {
    const lost = new LostLedgerRows();
    assert(lost.add(ALARM_ID, C1, "rule-1:alarm-1:warning"), "P15: the first entry is recorded");
    assert(
      lost.has(ALARM_ID, C1, "rule-1:alarm-1:warning"),
      "P15: the pair is remembered under the key it was lost on",
    );
    assert(
      !lost.has(ALARM_ID, C1, "rule-1:alarm-1:critical"),
      "P15: and not under a different key — a re-severitied alarm has never been offered",
    );
    assert(!lost.has(ALARM_ID, C2, "rule-1:alarm-1:warning"), "P15: nor on another channel");
  }

  // --- P16: the memory is capped, and refuses rather than forgets -------------
  //
  // At the cap `add` reports `false` and the pair falls back to today's
  // behaviour — the retry keeps re-offering it. That is the honest
  // degradation, and it is deliberately preferred to evicting an existing
  // entry, which would silently un-blacklist a real loss.
  //
  // **Mutation:** an unbounded `Map` → `size` exceeds the cap and the first
  // assertion reddens. Dropping the entry instead of refusing → the last
  // assertion reddens, because the first pair would no longer be remembered.
  {
    const lost = new LostLedgerRows(2);
    assert(lost.add("a1", C1, "k") && lost.add("a2", C1, "k"), "P16: the first two fit");
    assert(!lost.add("a3", C1, "k"), "P16: the third is refused at the cap");
    assert(lost.size === 2, `P16: and the map does not grow past it, got ${lost.size}`);
    assert(!lost.has("a3", C1, "k"), "P16: the refused pair is not remembered");
    assert(lost.has("a1", C1, "k"), "P16: and the pair already there is not forgotten for it");
  }

  // --- P17: an alarm that leaves the active set is evicted --------------------
  //
  // The paired positive is in the same case: the alarm still active keeps its
  // entry, so the case cannot pass on a `retainAlarms` that clears everything.
  //
  // **Mutation:** no eviction at all → `size` stays 2 and the first assertion
  // reddens. Evicting the whole map → the second reddens.
  {
    const lost = new LostLedgerRows();
    lost.add("still-open", C1, "k");
    lost.add("cleared", C1, "k");
    lost.retainAlarms(new Set(["still-open"]));
    assert(lost.size === 1, `P17: the cleared alarm's entry is evicted, got ${lost.size}`);
    assert(lost.has("still-open", C1, "k"), "P17: the still-active alarm keeps its entry");
  }
}
