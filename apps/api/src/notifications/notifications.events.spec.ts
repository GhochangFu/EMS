import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import { buildDedupeKey } from "./dedupe-key";
import { PROCESS_STARTED_AT } from "./notifications.config";
import {
  MAX_EVENT_ATTEMPTS,
  type DispatchEvent,
  type DispatchInput,
} from "./notifications.service";
import {
  ORG_ID,
  assert,
  captureWarnings,
  channelRow,
  fakeDb,
  fakeTransport,
  input,
  serviceWith,
} from "./notifications.service.spec";

/**
 * `F3.10` U2 — the explicit-channel entry point, the two event kinds and their
 * once-per-key ledger read (ADR 0057 decisions 9 and 10), plus PR 1's review
 * corrections: the three-attempt retry bound (owner ruling Q9), the failed
 * rate-limit read that writes nothing on the event path (H1), the
 * organization floor on the channel list (M2) and the refused alarm-less event
 * (L2). Split out of `notifications.service.spec.ts` at §4.5's cap; the fake
 * database, the builders and the warn capture are that file's exports. No
 * socket, no Postgres — the real `WHERE` of every read is proven in
 * `storm-control.integration.spec.ts`.
 *
 * **`F3.48` (ADR 0057 Amendment 2) rewrote three of these cases.** Case 7 is
 * now the retry: the ceiling writes no row for an escalation step, so the key
 * survives and a later tick sends it (ruling Q1). Case 7b is its boundary —
 * a *cleared* message is dispatched once and never again, so its refusal keeps
 * the visible row (ruling Q-A). Case 14 asserts that ruling Q2's exclusion of
 * `skipped_rate_limited` is in the SQL rather than in the sampled rows.
 *
 * **`F3.51` (ADR 0041 Amendment 5) adds E15–E18, and they are not about an
 * event.** The file's subject is really `offeredAgainWithoutAsking` and the
 * three exits that ask it — cases 6/6b, 7/7b and 10/10b are already paired that
 * way — so the fourth arm belongs beside them even though a re-offered raise
 * carries no `event`. E15 and E17 are the two exits a re-offered raise can
 * reach; E16 and E17's second half are their regression twins on an ordinary
 * raise, without which a change that silenced EVERY raise refusal would pass;
 * E18 pins the key and the subject to the original raise's.
 *
 * What this file does **not** hold: that the exclusion actually releases a key.
 * The fake answers each ledger read from a queue and applies no `WHERE`, so it
 * cannot show a row being filtered out. That claim lives in
 * `storm-control.integration.spec.ts`, against Postgres — and, for the raise
 * key's own read, in `raise-attempts.integration.spec.ts`.
 */
export async function runNotificationEventTests(): Promise<void> {
  const channelA = channelRow({ id: "aaaaaaaa-0000-0000-0000-000000000001", code: "a" });
  const channelB = channelRow({ id: "aaaaaaaa-0000-0000-0000-000000000002", code: "b" });
  const eventInput = (event: DispatchEvent, overrides: Partial<DispatchInput> = {}) =>
    input({ ruleCode: "RULE-1", severity: "warning", raised: true, event, ...overrides });
  const sendingWebhook = () =>
    fakeTransport("webhook", () => Promise.resolve({ status: "sent", error: null }));

  // --- 2. `dispatchToChannels` never asks for the rule's channels ----------
  //
  // The sweep hands it the step's channels (or the cleared recipients); a
  // `loadForRule` here would send an escalation to the rule's raise channels
  // instead of the step's. Results come back one per channel, in the order
  // given, not code order.
  {
    const { db, recorded } = fakeDb();
    const webhook = sendingWebhook();
    let loads = 0;
    const service = serviceWith({
      db,
      channels: () => {
        loads += 1;
        return Promise.resolve([channelRow()]);
      },
      webhook: webhook.transport,
    });

    const results = await service.dispatchToChannels([channelB, channelA], input());
    assert(loads === 0, `dispatchToChannels must not call loadForRule, got ${loads} calls`);
    assert(results.length === 2, `two channels, two results, got ${results.length}`);
    assert(
      results.every((r) => r.status === "sent"),
      `both sent, got ${results.map((r) => r.status).join(",")}`,
    );
    assert(
      recorded.map((r) => r.channelId).join(",") === `${channelB.id},${channelA.id}`,
      "one row per channel, in the order the caller gave",
    );
    assert(recorded.every((r) => r.organizationId === ORG_ID), "stamped with the rule's org");
    // And the raise path still goes through the loader: same input, one load.
    await service.dispatch(input());
    assert(loads === 1, `dispatch still loads the rule's channels, got ${loads} loads`);
  }

  // --- 3. An event already in the ledger is answered from it ---------------
  //
  // Decision 10: the read comes before the send, and the original row IS the
  // record — nothing is written, nothing is sent.
  {
    const { db, recorded, reads, setDeliveryRecorded } = fakeDb();
    const webhook = sendingWebhook();
    const service = serviceWith({ db, channels: [], webhook: webhook.transport });

    setDeliveryRecorded(["sent"]);
    const results = await service.dispatchToChannels(
      [channelRow()],
      eventInput({ kind: "escalation", step: 1 }),
    );
    assert(
      results.length === 1 && results[0]?.status === "skipped_deduped",
      `an already-sent step is skipped_deduped, got ${results.map((r) => r.status).join(",")}`,
    );
    assert(results[0]?.error === null, "an answered event is not an error");
    assert(recorded.length === 0, `the original row is the record; got ${recorded.length} new rows`);
    assert(webhook.sent.length === 0, "an already-sent step must not reach the transport");
    assert(reads.deliveryExists === 1, `one ledger read, got ${reads.deliveryExists}`);
  }

  // --- 4. A step not yet in the ledger is sent, keyed and attributed -------
  {
    const { db, recorded, reads, setDeliveryRecorded } = fakeDb();
    const webhook = sendingWebhook();
    const service = serviceWith({ db, channels: [], webhook: webhook.transport });

    setDeliveryRecorded([]);
    const step = eventInput({ kind: "escalation", step: 1 });
    const results = await service.dispatchToChannels([channelRow()], step);
    assert(results[0]?.status === "sent", `a new step sends, got ${String(results[0]?.status)}`);
    assert(reads.deliveryExists === 1, `the ledger was asked first, got ${reads.deliveryExists}`);
    assert(
      webhook.sent[0]?.subject === "escalation 1 · warning: RULE-1",
      `the subject names the step, got ${String(webhook.sent[0]?.subject)}`,
    );
    assert(webhook.sent[0]?.body === step.message, "the body is the caller's message, untouched");
    assert(webhook.sent[0]?.alarmId === step.alarmId, "the transport sees the alarm");
    assert(recorded.length === 1 && recorded[0]?.status === "sent", "one sent row");
    assert(
      recorded[0]?.dedupeKey === buildDedupeKey(step) && recorded[0].dedupeKey.endsWith(":escalation:1"),
      `the row's key carries the step, got ${String(recorded[0]?.dedupeKey)}`,
    );
    assert(recorded[0]?.alarmId === step.alarmId, "the row is attributed to the alarm");
  }

  // --- 5. The cleared message -------------------------------------------------
  {
    const { db, recorded } = fakeDb();
    const webhook = sendingWebhook();
    const service = serviceWith({ db, channels: [], webhook: webhook.transport });

    const cleared = eventInput({ kind: "cleared" });
    const results = await service.dispatchToChannels([channelRow()], cleared);
    assert(results[0]?.status === "sent", "the cleared message sends");
    assert(
      webhook.sent[0]?.subject === "cleared · warning: RULE-1",
      `the subject says cleared, got ${String(webhook.sent[0]?.subject)}`,
    );
    assert(
      recorded[0]?.dedupeKey.endsWith(":cleared") === true,
      `the row's key says cleared, got ${String(recorded[0]?.dedupeKey)}`,
    );
  }

  // --- 6. An unreadable ledger on an event: no row, no send, one warn ------
  //
  // D3: writing a row would poison the key for every later tick; sending
  // would risk the duplicate the read exists to prevent. The failure is
  // reported and the next tick retries. This is the opposite of the raise
  // path's fallback (case `F3.46` D2 in the service spec), and deliberately so.
  {
    const { db, recorded, reads, failDeliveryReads } = fakeDb();
    const webhook = sendingWebhook();
    const service = serviceWith({ db, channels: [], webhook: webhook.transport });

    failDeliveryReads(true);
    const step = eventInput({ kind: "escalation", step: 2 });
    const { result: results, warnings } = await captureWarnings(() =>
      service.dispatchToChannels([channelRow({ code: "ops-webhook" })], step),
    );
    assert(reads.deliveryExists === 1, `the read was attempted, got ${reads.deliveryExists}`);
    assert(
      results.length === 1 && results[0]?.status === "failed",
      `an unreadable ledger fails the event, got ${results.map((r) => r.status).join(",")}`,
    );
    assert(
      results[0]?.error === "delivery ledger read failed",
      `the reason is named, got ${String(results[0]?.error)}`,
    );
    assert(recorded.length === 0, `no row on a failed event read, got ${recorded.length}`);
    assert(webhook.sent.length === 0, "a failed event read must never become a send");
    assert(warnings.length === 1, `exactly one warn line, got ${warnings.length}`);
    const warned = warnings[0] ?? "";
    assert(
      warned.includes("channel=ops-webhook") && warned.includes("rule=RULE-1"),
      `the warn names the channel and rule codes, got: ${warned}`,
    );
    assert(!warned.includes(step.message), "§9.6: the warn never carries the alarm text");
  }

  // --- 6b. `F3.54`: the same failed read, for a CLEARED message, writes a row
  //
  // ADR 0057 Amendment 4 ruling 1. Case 6's argument — "the write would be
  // permanent and silence is the cost" — is an argument about a key a later
  // tick will come back to. A clear has no later tick: `notifyCleared` runs
  // once from the clear phase and `loadActiveAlarms` filters
  // `cleared_at IS NULL`, so the alarm leaves the sweep's selection the moment
  // it clears. Writing nothing there buys no retry and costs the only evidence
  // the refusal happened, which is exactly what ruling Q-A refused to accept at
  // the ceiling exit twenty lines below.
  //
  // **What this holds is that the insert is ATTEMPTED, not that a row exists.**
  // This branch fires because the ledger read failed, and `record()`'s insert
  // runs on the same connection and swallows its own failure. The fake makes
  // that distinction available on purpose: `failDeliveryReads` and
  // `failInserts` are independent flags, and `recorded` is the insert spy. The
  // row really landing in Postgres is `storm-control.integration.spec.ts`'s
  // claim, not this one.
  //
  // Deliberately NOT written here: the both-flags variant asserting "the
  // result is still failed and nothing rejects". It passes identically when
  // `record()` is never called — the `F3.48` shape, an absence that cannot
  // prove an action.
  {
    const { db, recorded, reads, failDeliveryReads } = fakeDb();
    const webhook = sendingWebhook();
    const service = serviceWith({ db, channels: [], webhook: webhook.transport });

    failDeliveryReads(true);
    const cleared = eventInput({ kind: "cleared" });
    const { result: results, warnings } = await captureWarnings(() =>
      service.dispatchToChannels([channelRow({ code: "ops-webhook" })], cleared),
    );
    assert(reads.deliveryExists === 1, `the read was attempted, got ${reads.deliveryExists}`);
    // The RESULT is unchanged by this row — only the ledger write is added.
    assert(
      results.length === 1 &&
        results[0]?.status === "failed" &&
        results[0].error === "delivery ledger read failed",
      `an unreadable ledger still fails the clear by name, got ${JSON.stringify(results)}`,
    );
    assert(
      recorded.length === 1,
      `F3.54: a refused CLEARED message must attempt its row, got ${recorded.length}`,
    );
    assert(
      recorded[0]?.status === "failed" && recorded[0]?.error === "delivery ledger read failed",
      `the row carries the refusal and its reason, got ${JSON.stringify(recorded[0])}`,
    );
    assert(
      String(recorded[0]?.dedupeKey).endsWith(":cleared"),
      `the row is filed under the cleared key, got ${String(recorded[0]?.dedupeKey)}`,
    );
    assert(webhook.sent.length === 0, "a failed event read must never become a send");
    assert(warnings.length === 1, `still exactly one warn line, got ${warnings.length}`);
  }

  // --- 7. `F3.48` Q1: the ceiling writes no row for a step, and the next
  //        tick retries ----------------------------------------------------
  //
  // ADR 0041 decision 7 still applies to every send, and a step is a send, so
  // the RESULT is unchanged. What changes is the ledger: nothing is written
  // (ADR 0057 Amendment 2, ruling Q1), so the key is not spent, and the sweep
  // — which re-dispatches every due step every tick and ignores the results —
  // gets its send once `isOverHourlyLimit`'s trailing-hour count of `sent`
  // rows has fallen back under the ceiling. Before this, the tail of a first
  // mapping's burst was lost for the life of the ledger (ruling Q7, 52 alarms
  // measured on the stack).
  {
    const { db, recorded, reads, setCount, setDeliveryRecorded } = fakeDb();
    const webhook = sendingWebhook();
    const service = serviceWith({
      db,
      channels: [],
      webhook: webhook.transport,
      env: { NOTIFY_RATE_LIMIT_PER_HOUR: "1" },
    });
    const step = eventInput({ kind: "escalation", step: 1 });

    setDeliveryRecorded([], []);
    setCount(1);
    const refused = await service.dispatchToChannels([channelRow()], step);
    assert(
      refused[0]?.status === "skipped_rate_limited",
      `at the ceiling a step still skips, got ${String(refused[0]?.status)}`,
    );
    assert(refused[0]?.error === null, "a ceiling refusal is not an error");
    assert(webhook.sent.length === 0, "the rate-limited step must not reach the transport");
    assert(
      recorded.length === 0,
      `Q1: the ceiling writes no row on the escalation path, got ${recorded.length}`,
    );

    // The ceiling lifts by itself: it counts `sent` rows over a trailing hour.
    setCount(0);
    const retry = await service.dispatchToChannels([channelRow()], step);
    assert(
      retry[0]?.status === "sent",
      `the next tick retries the refused step, got ${String(retry[0]?.status)}`,
    );
    assert(webhook.sent.length === 1, "the retry reaches the transport exactly once");
    assert(
      recorded.length === 1 &&
        recorded[0]?.status === "sent" &&
        recorded[0].dedupeKey.endsWith(":escalation:1"),
      "only the send is recorded, under the event's key",
    );
    assert(
      reads.deliveryExists === 2,
      `the key was read on both ticks, got ${reads.deliveryExists}`,
    );
  }

  // --- 7b. Q-A: a ceiling-refused CLEARED message KEEPS its row ------------
  //
  // `notifyCleared` runs once, from the clear phase, and `loadActiveAlarms`
  // filters `cleared_at IS NULL` — the sweep never sees that alarm again, so
  // there is no tick to retry it. Dropping the row would make the refusal
  // invisible and buy nothing, so ADR 0041 decision 4's visible refusal is
  // kept exactly where no retry replaces it (ADR 0057 Amendment 2, Q-A).
  {
    const { db, recorded, setCount, setDeliveryRecorded } = fakeDb();
    const webhook = sendingWebhook();
    const service = serviceWith({
      db,
      channels: [],
      webhook: webhook.transport,
      env: { NOTIFY_RATE_LIMIT_PER_HOUR: "1" },
    });

    setDeliveryRecorded([]);
    setCount(1);
    const results = await service.dispatchToChannels([channelRow()], eventInput({ kind: "cleared" }));
    assert(
      results[0]?.status === "skipped_rate_limited",
      `at the ceiling a clear skips, got ${String(results[0]?.status)}`,
    );
    assert(webhook.sent.length === 0, "the rate-limited clear must not reach the transport");
    assert(
      recorded.length === 1 &&
        recorded[0]?.status === "skipped_rate_limited" &&
        recorded[0].dedupeKey.endsWith(":cleared"),
      `Q-A: the clear's refusal IS recorded, got ${recorded.length} rows`,
    );
  }

  // --- 8. The event branch comes first; `raised` is not consulted ----------
  //
  // `raised: false` with an event set is not an input production builds. The
  // order still matters: if the raise-path refusal ran first, an event would
  // read the skip ledger, find nothing, and write a `skipped_deduped` row
  // under the event's key — after which decision 10 would never send it.
  {
    const { db, recorded, reads } = fakeDb();
    const webhook = sendingWebhook();
    const service = serviceWith({ db, channels: [], webhook: webhook.transport });

    const results = await service.dispatchToChannels(
      [channelRow()],
      eventInput({ kind: "escalation", step: 1 }, { raised: false }),
    );
    assert(reads.skipExists === 0, `an event must not read the skip ledger, got ${reads.skipExists}`);
    assert(reads.deliveryExists === 1, `an event reads its own ledger, got ${reads.deliveryExists}`);
    assert(
      results[0]?.status === "sent" && recorded[0]?.status === "sent",
      `an event with no row sends whatever \`raised\` says, got ${String(results[0]?.status)}`,
    );
  }

  // --- 9. The cleared recipients: every channel with a `sent` row, once ----
  {
    const { db, reads, setSentChannels } = fakeDb();
    const webhook = sendingWebhook();
    const service = serviceWith({ db, channels: [], webhook: webhook.transport });

    setSentChannels(channelA.id, channelB.id, channelA.id);
    const ids = await service.sentChannelIdsForAlarm(input().alarmId as string, ORG_ID);
    assert(
      ids.join(",") === `${channelA.id},${channelB.id}`,
      `distinct channel ids in first-seen order, got ${ids.join(",")}`,
    );
    assert(reads.sentChannels === 1, `one read, got ${reads.sentChannels}`);

    setSentChannels();
    const none = await service.sentChannelIdsForAlarm(input().alarmId as string, ORG_ID);
    assert(none.length === 0, "an alarm nobody was told about clears to nobody");
  }

  // --- 10. H1: a failed rate-limit read on an event writes no row ----------
  //
  // The raise path records `failed` here and that is right for it: the write
  // is bounded by the transition, and the next raise is a new alarm with a
  // new key. An event's key is for the life of the ledger. A `failed` row
  // under it would spend one of the key's `MAX_EVENT_ATTEMPTS` (Q9) on a read
  // that never reached the transport — and before Q9 it blocked the key for
  // ever. Same shape as case 6: result `failed`, nothing written, one warn.
  {
    const { db, recorded, reads, failRateLimitReads } = fakeDb();
    const webhook = sendingWebhook();
    const service = serviceWith({ db, channels: [], webhook: webhook.transport });

    failRateLimitReads(true);
    const { result: results, warnings } = await captureWarnings(() =>
      service.dispatchToChannels(
        [channelRow({ code: "ops-webhook" })],
        eventInput({ kind: "escalation", step: 1 }),
      ),
    );
    assert(
      reads.deliveryExists === 1 && reads.rateLimit === 1,
      `the ledger and then the ceiling were asked, got ${reads.deliveryExists}/${reads.rateLimit}`,
    );
    assert(
      results.length === 1 &&
        results[0]?.status === "failed" &&
        results[0].error === "rate-limit check failed",
      `an unreadable ceiling fails the event by name, got ${JSON.stringify(results)}`,
    );
    assert(recorded.length === 0, `H1: no row on a failed ceiling read, got ${recorded.length}`);
    assert(webhook.sent.length === 0, "an unreadable ceiling is not a licence to send");
    assert(
      warnings.length === 1 && (warnings[0] ?? "").includes("channel=ops-webhook"),
      `one warn naming the channel, got ${JSON.stringify(warnings)}`,
    );
  }

  // --- 10b. `F3.54`: the same failed ceiling read, for a CLEARED message ----
  //
  // Ruling 1 again, at the second of the two exits. Case 10's reason for
  // writing nothing — a `failed` row would spend one of the key's
  // `MAX_EVENT_ATTEMPTS` on a read that never reached the transport — is about
  // attempts a later tick will use. A clear has no later tick, so there is no
  // attempt to conserve and nothing to gain by staying silent.
  //
  // After this, the line above is textually identical to the ceiling's
  // `input.event?.kind === "escalation"` twenty lines below it, which is the
  // inconsistency `F3.54` was filed about: two adjacent exits that
  // discriminated differently, with nothing in the code saying why.
  {
    const { db, recorded, reads, failRateLimitReads } = fakeDb();
    const webhook = sendingWebhook();
    const service = serviceWith({ db, channels: [], webhook: webhook.transport });

    failRateLimitReads(true);
    const { result: results, warnings } = await captureWarnings(() =>
      service.dispatchToChannels(
        [channelRow({ code: "ops-webhook" })],
        eventInput({ kind: "cleared" }),
      ),
    );
    assert(
      reads.deliveryExists === 1 && reads.rateLimit === 1,
      `the ledger and then the ceiling were asked, got ${reads.deliveryExists}/${reads.rateLimit}`,
    );
    assert(
      results.length === 1 &&
        results[0]?.status === "failed" &&
        results[0].error === "rate-limit check failed",
      `an unreadable ceiling still fails the clear by name, got ${JSON.stringify(results)}`,
    );
    assert(
      recorded.length === 1,
      `F3.54: a ceiling read that fails a CLEARED message must attempt its row, got ${recorded.length}`,
    );
    assert(
      recorded[0]?.status === "failed" &&
        String(recorded[0]?.dedupeKey).endsWith(":cleared"),
      `the row is a failed one under the cleared key, got ${JSON.stringify(recorded[0])}`,
    );
    assert(webhook.sent.length === 0, "an unreadable ceiling is not a licence to send");
    assert(warnings.length === 1, `still exactly one warn line, got ${warnings.length}`);
  }
  {
    // The other direction: the raise path keeps its `failed` row.
    const { db, recorded, failRateLimitReads } = fakeDb();
    const webhook = sendingWebhook();
    const service = serviceWith({ db, channels: [channelRow()], webhook: webhook.transport });

    failRateLimitReads(true);
    const { result: results } = await captureWarnings(() => service.dispatch(input()));
    assert(
      results[0]?.status === "failed" && recorded.length === 1 && recorded[0]?.status === "failed",
      `the raise path still records the failed ceiling read, got ${recorded.length} rows`,
    );
    assert(webhook.sent.length === 0, "and still does not send");
  }

  // --- 11. Q9: `failed` is retried, three attempts; anything else blocks ---
  //
  // A transport failure is not a decision, so the next tick tries again — but
  // a dead endpoint must not grow the ledger by a row per tick for the life
  // of the alarm, so the key is blocked at `MAX_EVENT_ATTEMPTS` rows. Every
  // status except `failed` and — since `F3.48` — `skipped_rate_limited`
  // consumed the key the moment it was written. The fake slices the queued
  // rows to the `LIMIT` the service asks for, so the three-`failed` case also
  // proves the read asks for at least three rows.
  //
  // **`skipped_rate_limited` is deliberately not in this table.** The fake
  // answers the read from a queue and cannot apply a `WHERE`, and ruling Q2
  // excludes that status IN THE SQL — so a queued rate-limited row would still
  // come back here and still block, and the case would pass while asserting
  // the opposite of production. Its two honest homes are block 14 below (the
  // read really names the exclusion) and `storm-control.integration.spec.ts`
  // (the exclusion really releases the key). `skipped_unconfigured` takes its
  // place, and what it kills here is a narrowing of the TypeScript predicate to
  // `status === "sent"` — not a narrowing of the SQL, which this file cannot
  // see and must not claim to hold. The SQL form of that claim is storm-control's.
  //
  // **`F3.50` leaves it in this table for the same reason**, one level down.
  // That exclusion is conditional — it drops an unconfigured row only when the
  // row predates `max(channel.updatedAt, PROCESS_STARTED_AT)` — and the fake
  // applies no `WHERE`, so a queued row here stands for one the SQL KEPT. That
  // is a real production state, not an artefact: the retry writes a fresh row
  // every time, and a fresh row blocks.
  {
    assert(MAX_EVENT_ATTEMPTS === 3, `Q9 says three attempts, got ${MAX_EVENT_ATTEMPTS}`);
    const table: Array<{ ledger: string[]; want: "sent" | "skipped_deduped" }> = [
      { ledger: [], want: "sent" },
      { ledger: ["failed"], want: "sent" },
      { ledger: ["failed", "failed"], want: "sent" },
      { ledger: ["failed", "failed", "failed"], want: "skipped_deduped" },
      { ledger: ["failed", "sent"], want: "skipped_deduped" },
      // `F3.50` did NOT make this row stale. It stands for an unconfigured
      // refusal the SQL kept — one written since the channel was last edited
      // and since this process started — which still blocks, and which is also
      // the growth bound: the released key is re-offered, writes exactly one
      // fresh row, and is blocked again at the next tick.
      { ledger: ["skipped_unconfigured"], want: "skipped_deduped" },
    ];
    for (const { ledger, want } of table) {
      const { db, recorded, reads, deliveryLimits, setDeliveryRecorded } = fakeDb();
      const webhook = sendingWebhook();
      const service = serviceWith({ db, channels: [], webhook: webhook.transport });
      const label = `ledger [${ledger.join(",")}]`;

      setDeliveryRecorded(ledger);
      const results = await service.dispatchToChannels(
        [channelRow()],
        eventInput({ kind: "escalation", step: 1 }),
      );
      assert(
        results.length === 1 && results[0]?.status === want,
        `${label}: expected ${want}, got ${results.map((r) => r.status).join(",")}`,
      );
      assert(
        reads.deliveryExists === 1 && deliveryLimits[0] === MAX_EVENT_ATTEMPTS,
        `${label}: one read bounded to ${MAX_EVENT_ATTEMPTS} rows, got limit ${String(
          deliveryLimits[0],
        )}`,
      );
      if (want === "sent") {
        assert(
          webhook.sent.length === 1 && recorded.length === 1 && recorded[0]?.status === "sent",
          `${label}: one send and one sent row, got ${webhook.sent.length}/${recorded.length}`,
        );
      } else {
        assert(
          webhook.sent.length === 0 && recorded.length === 0,
          `${label}: nothing sent and nothing written, got ${webhook.sent.length}/${recorded.length}`,
        );
      }
    }
  }

  // --- 12. M2: a channel in another organization is dropped, with a warn ---
  //
  // `setRuleChannels` refuses the pairing when a rule's join is written, and
  // plan U8's profile write path mirrors it; this is the floor that holds
  // whatever the caller loaded. A delivery is stamped with the rule's
  // organization (`E7.1c`), so a channel of another tenant would carry one
  // tenant's alarm into another's inbox. A fleet-wide (`null`) channel passes.
  // The dropped channel gets no result entry, so `results.length` still says
  // how many channels were really tried.
  {
    const OTHER_ORG = "bbbbbbbb-0000-0000-0000-00000000000b";
    const foreign = channelRow({
      id: "aaaaaaaa-0000-0000-0000-000000000003",
      code: "b",
      organizationId: OTHER_ORG,
    });
    const global = channelRow({
      id: "aaaaaaaa-0000-0000-0000-000000000004",
      code: "g",
      organizationId: null,
    });
    const { db, recorded } = fakeDb();
    const webhook = sendingWebhook();
    const service = serviceWith({ db, channels: [], webhook: webhook.transport });

    const { result: results, warnings } = await captureWarnings(() =>
      service.dispatchToChannels([channelA, foreign, global], input()),
    );
    assert(results.length === 2, `two channels kept, two results, got ${results.length}`);
    assert(
      webhook.sent.map((m) => m.channel.code).join(",") === "a,g",
      `the foreign channel never reaches the transport, got ${webhook.sent
        .map((m) => m.channel.code)
        .join(",")}`,
    );
    assert(
      recorded.map((r) => r.channelId).join(",") === `${channelA.id},${global.id}`,
      "no row for the dropped channel, one for each kept",
    );
    assert(warnings.length === 1, `one warn per dropped channel, got ${warnings.length}`);
    const warned = warnings[0] ?? "";
    assert(
      warned.includes("channel=b") && warned.includes(OTHER_ORG) && warned.includes(ORG_ID),
      `the warn names the channel code and both organization ids, got: ${warned}`,
    );
  }

  // --- 13. L2: an event with no alarm is refused ---------------------------
  //
  // The key would be `<rule>:no-alarm:<severity>:escalation:<n>` — one key
  // for every alarm the rule ever raises — so the first step sent for any of
  // them would answer every later one from the ledger. Plan U7 never builds
  // this input; the service refuses it anyway, because the sweep is not the
  // only possible caller. Refused before any read: nothing to read for.
  {
    const { db, recorded, reads } = fakeDb();
    const webhook = sendingWebhook();
    const service = serviceWith({ db, channels: [], webhook: webhook.transport });

    const { result: results, warnings } = await captureWarnings(() =>
      service.dispatchToChannels(
        [channelRow()],
        eventInput({ kind: "escalation", step: 1 }, { alarmId: null }),
      ),
    );
    assert(results.length === 0, `an alarm-less event has no results, got ${results.length}`);
    assert(
      webhook.sent.length === 0 && recorded.length === 0,
      `nothing sent, nothing written, got ${webhook.sent.length}/${recorded.length}`,
    );
    assert(
      reads.deliveryExists === 0 && reads.rateLimit === 0,
      `refused before any read, got ${reads.deliveryExists}/${reads.rateLimit}`,
    );
    const warned = warnings[0] ?? "";
    assert(
      warnings.length === 1 && warned.includes("rule=RULE-1") && warned.includes("escalation"),
      `one warn naming the rule code and the event kind, got ${JSON.stringify(warnings)}`,
    );
  }

  // --- 14. `F3.48` Q2: the exclusion is in the SQL, not in the sampled rows -
  //
  // `eventDeliveryBlocked` takes `MAX_EVENT_ATTEMPTS` rows with no `ORDER BY`,
  // and its own comment gives order-independence as the reason that is sound.
  // Filtering the sample in TypeScript would break exactly that: a key holding
  // three `failed` rows and three rate-limited ones could return three
  // rate-limited ones and leave both arms false for a key ruling Q9 blocks.
  //
  // A fake cannot see a `WHERE`, so this renders one instead. `sqlToQuery` is
  // the same conversion drizzle's own `PgSession` runs before handing the query
  // to `pg`, so this is the text the database will see — the idiom, and the
  // argument, are `asset-health/health-rollup-sql.spec.ts`'s.
  {
    const { db, deliveryConditions, setDeliveryRecorded } = fakeDb();
    const webhook = sendingWebhook();
    const service = serviceWith({ db, channels: [], webhook: webhook.transport });

    setDeliveryRecorded([]);
    await service.dispatchToChannels([channelRow()], eventInput({ kind: "escalation", step: 1 }));
    assert(deliveryConditions.length === 1, `the event read ran once, got ${deliveryConditions.length}`);
    const rendered = new PgDialect().sqlToQuery(deliveryConditions[0] as SQL);
    assert(
      /"status"\s*<>\s*\$\d+/.test(rendered.sql),
      `Q2: the event read must exclude a status in SQL, got: ${rendered.sql}`,
    );
    assert(
      rendered.params.includes("skipped_rate_limited"),
      `Q2: the excluded status is bound as a parameter, got: ${JSON.stringify(rendered.params)}`,
    );
    assert(
      !/"status"\s*=\s*\$\d+/.test(rendered.sql),
      `Q2: an equality on status would block every key that is NOT rate-limited, got: ${rendered.sql}`,
    );
  }

  // --- 15. `F3.50`: the unconfigured exclusion, and the later of two clocks -
  //
  // ADR 0057 Amendment 3 ruling Q1. A `skipped_unconfigured` row answers an
  // event key only while it is NEWER than
  // `max(channel.updatedAt, PROCESS_STARTED_AT)`; an older one is drawn out of
  // the sample in SQL, so the step is offered again once the configuration
  // that refused it has moved.
  //
  // Written as `or(ne(status, …), gt(attempted_at, …))` and not as the literal
  // `NOT (status = … AND attempted_at <= …)`: the second renders
  // `"status" = $n`, which reddens case 14's third assertion above. The two are
  // the same predicate — both columns are `NOT NULL` — so the De Morgan twin
  // costs nothing and keeps case 14 as a free gate on this clause's shape too.
  //
  // **Scoped to one status against a timestamp, never a watermark over the
  // whole read.** Hoisting the `gt(...)` out of the `or` would drop a `failed`
  // row older than the watermark out of the sample, and ruling Q9's
  // three-attempt cap would reset on every channel edit. That mutation is
  // caught in `storm-control.integration.spec.ts`, where the `WHERE` is real.
  //
  // **What no suite in this repository can hold:** the `PROCESS_STARTED_AT`
  // half itself. It is one constant fixed at module load, one value per run,
  // and no test can restart the API. 15c below proves the watermark USES it;
  // that a restart releases a stranded key is a live-stack item (plan §7 step
  // 5), recorded there and not gated here.
  {
    const past = new Date("2020-01-01T00:00:00.000Z");
    const future = new Date("2099-01-01T00:00:00.000Z");
    const boundTimes = (rows: readonly unknown[]): number[] =>
      rows
        .map((p) => (p instanceof Date ? p.getTime() : new Date(String(p)).getTime()))
        .filter((t) => Number.isFinite(t));

    const { db, deliveryConditions, setDeliveryRecorded } = fakeDb();
    const service = serviceWith({ db, channels: [], webhook: sendingWebhook().transport });

    setDeliveryRecorded([]);
    await service.dispatchToChannels(
      [channelRow({ updatedAt: past })],
      eventInput({ kind: "escalation", step: 1 }),
    );
    setDeliveryRecorded([]);
    await service.dispatchToChannels(
      [channelRow({ updatedAt: future })],
      eventInput({ kind: "escalation", step: 2 }),
    );
    assert(deliveryConditions.length === 2, `two event reads, got ${deliveryConditions.length}`);

    const stale = new PgDialect().sqlToQuery(deliveryConditions[0] as SQL);
    const edited = new PgDialect().sqlToQuery(deliveryConditions[1] as SQL);

    // 15a — the clause exists, and points the right way. Dropping the `gt(...)`
    // disjunct, or inverting it to `lt`/`lte`, reddens only this one.
    assert(
      /"attempted_at"\s*>\s*\$\d+/.test(stale.sql),
      `F3.50: the read must keep only unconfigured rows NEWER than the watermark, got: ${stale.sql}`,
    );
    // 15b — and it is scoped to the one status.
    assert(
      stale.params.includes("skipped_unconfigured"),
      `F3.50: the excluded status is bound as a parameter, got: ${JSON.stringify(stale.params)}`,
    );

    // 15c — a channel nobody has edited since boot uses PROCESS_STARTED_AT.
    // Replacing `Math.max(...)` with `channel.updatedAt.getTime()` reddens this.
    assert(
      boundTimes(stale.params).includes(PROCESS_STARTED_AT.getTime()),
      `F3.50: with an old channel the watermark is PROCESS_STARTED_AT (${PROCESS_STARTED_AT.toISOString()}), got: ${JSON.stringify(stale.params)}`,
    );
    // 15d — and a channel edited later uses its own `updated_at`. Replacing
    // `Math.max(...)` with `PROCESS_STARTED_AT.getTime()` reddens this.
    assert(
      boundTimes(edited.params).includes(future.getTime()),
      `F3.50: with a newly edited channel the watermark is its updated_at, got: ${JSON.stringify(edited.params)}`,
    );
  }

  // --- E15. `F3.51`: a RE-OFFERED raise refused by the ceiling writes no row -
  //
  // ADR 0041 Amendment 5. The fourth exception to decision 4, and the first
  // that is not an event — `offeredAgainWithoutAsking` is a property, not a
  // kind, which is exactly why `F3.54` named it.
  //
  // Without this the retry is worse than the defect it fixes. The lifecycle
  // sweep re-offers an undelivered raise every 30 s, so three ceiling refusals
  // land inside 90 seconds and spend `MAX_EVENT_ATTEMPTS`, while
  // `isOverHourlyLimit` counts `sent` rows over a trailing HOUR — the retry
  // burns out before the ceiling can lift. That is `F3.48`'s measured finding,
  // reproduced on the raise path, and its fix applies unchanged.
  {
    const { db, recorded, reads, setCount } = fakeDb();
    const webhook = sendingWebhook();
    const service = serviceWith({
      db,
      channels: [],
      webhook: webhook.transport,
      env: { NOTIFY_RATE_LIMIT_PER_HOUR: "1" },
    });

    setCount(1);
    const results = await service.dispatchToChannels([channelRow()], input({ reoffered: true }));
    assert(
      results[0]?.status === "skipped_rate_limited",
      `the result is unchanged — a refusal is still a refusal, got ${String(results[0]?.status)}`,
    );
    assert(webhook.sent.length === 0, "a rate-limited raise must not reach the transport");
    assert(
      recorded.length === 0,
      `F3.51: a re-offered raise writes no row at the ceiling, got ${recorded.length}`,
    );
    // And it took the raise path to get there: `reoffered` is not an event, so
    // neither ledger read ran and `buildDedupeKey` saw no suffix.
    assert(
      reads.deliveryExists === 0 && reads.skipExists === 0,
      `a re-offered raise is not an event, got ${reads.deliveryExists}/${reads.skipExists} reads`,
    );
  }

  // --- E16. An ORDINARY raise still records its ceiling refusal --------------
  //
  // The regression twin, and E15 alone would pass a change that silenced every
  // raise refusal in the service. An ordinary raise is offered once, by the
  // rule evaluation that raised the alarm; nothing re-offers it, so dropping
  // its row would drop the only evidence — which is `F3.51`'s own premise.
  {
    const { db, recorded, setCount } = fakeDb();
    const webhook = sendingWebhook();
    const service = serviceWith({
      db,
      channels: [],
      webhook: webhook.transport,
      env: { NOTIFY_RATE_LIMIT_PER_HOUR: "1" },
    });

    setCount(1);
    const results = await service.dispatchToChannels([channelRow()], input());
    assert(
      results[0]?.status === "skipped_rate_limited",
      `an ordinary raise is refused the same way, got ${String(results[0]?.status)}`,
    );
    assert(
      recorded.length === 1 && recorded[0]?.status === "skipped_rate_limited",
      `decision 4: the ordinary raise's refusal IS recorded, got ${recorded.length} rows`,
    );
    assert(
      recorded[0]?.dedupeKey === buildDedupeKey(input()),
      `and under the raise key, got ${String(recorded[0]?.dedupeKey)}`,
    );
  }

  // --- E17. The failed rate-limit READ, both ways ----------------------------
  //
  // Review H1's exit, reached by the same call. A re-offered raise writes
  // nothing — a `failed` row here records a read that never reached the
  // transport, and the next tick will ask again — while an ordinary raise keeps
  // the `failed` row it has always written. Paired on purpose: the absence is
  // only a gate because the second half proves the row is written when nobody
  // re-offers the dispatch.
  {
    const { db, recorded, failRateLimitReads } = fakeDb();
    const webhook = sendingWebhook();
    const service = serviceWith({ db, channels: [], webhook: webhook.transport });

    failRateLimitReads(true);
    const { result: retry, warnings } = await captureWarnings(() =>
      service.dispatchToChannels([channelRow({ code: "ops-webhook" })], input({ reoffered: true })),
    );
    assert(
      retry[0]?.status === "failed" && retry[0].error === "rate-limit check failed",
      `an unreadable ceiling still fails the re-offer by name, got ${JSON.stringify(retry)}`,
    );
    assert(
      recorded.length === 0,
      `F3.51: no row on a failed ceiling read for a re-offered raise, got ${recorded.length}`,
    );
    assert(
      warnings.length === 1 && (warnings[0] ?? "").includes("channel=ops-webhook"),
      `one warn naming the channel, got ${JSON.stringify(warnings)}`,
    );

    const ordinary = await service.dispatchToChannels([channelRow()], input());
    assert(
      ordinary[0]?.status === "failed",
      `an ordinary raise fails the same way, got ${String(ordinary[0]?.status)}`,
    );
    assert(
      recorded.length === 1 && recorded[0]?.status === "failed",
      `and it keeps its row — the bounded write the transition pays for, got ${recorded.length}`,
    );
  }

  // --- E18. `reoffered` reaches neither the key nor the subject --------------
  //
  // The identity of a re-offered raise with the original one is the mechanism,
  // not a convenience: the sweep decides who is owed by reading rows under the
  // ORIGINAL key, so a `:retry` suffix would orphan every row it matched on,
  // and a subject prefix would tell the operator this is a different alarm.
  // This is the assertion that stops anyone "improving" the message later —
  // the staleness complaint is `F3.52`'s, and it is inherited here, not fixed.
  {
    const { db, recorded } = fakeDb();
    const webhook = sendingWebhook();
    const service = serviceWith({ db, channels: [], webhook: webhook.transport });

    const original = input();
    const reoffered = input({ reoffered: true });
    assert(
      buildDedupeKey(reoffered) === buildDedupeKey(original),
      `the flag must not reach the key: ${buildDedupeKey(reoffered)} vs ${buildDedupeKey(original)}`,
    );

    const results = await service.dispatchToChannels([channelRow()], reoffered);
    assert(results[0]?.status === "sent", `a re-offered raise sends, got ${String(results[0]?.status)}`);
    assert(
      recorded.length === 1 && recorded[0]?.dedupeKey === buildDedupeKey(original),
      `the row it writes holds the raise's own key, got ${String(recorded[0]?.dedupeKey)}`,
    );
    assert(
      webhook.sent[0]?.subject === `${original.severity as string}: ${original.ruleCode}`,
      `the subject is the raise's, with no retry marker, got ${String(webhook.sent[0]?.subject)}`,
    );
    assert(
      webhook.sent[0]?.body === original.message,
      "and the body is the alarm's message, untouched",
    );
  }
}
