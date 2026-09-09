import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, gte, isNull, like, or, sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import { notificationDeliveries } from "@bms/db";

import { FLEET_DRIZZLE } from "../database/database.tokens";
import { ChannelsService } from "./channels.service";
import type { ClosedCeilings } from "./closed-ceilings";
import { buildDedupeKey, type DispatchEvent } from "./dedupe-key";
import {
  RESERVED_KEY_PATTERN,
  type CeilingBudget,
  type DispatchOutcome,
  budgetFor,
  hourlyCeiling,
  offeredAgainWithoutAsking,
} from "./dispatch-policy";
import { notRecorded, sendTestResult, subjectFor } from "./dispatch-shapes";
import { EmailTransport } from "./email.transport";
import { eventDeliveryBlocked, hasRecordedSkip } from "./ledger-reads";
import { reasonOf, storable } from "./ledger-text";
import { LogTransport } from "./log.transport";
import type {
  DeliveryResult,
  NotificationChannelRow,
  NotificationTransport,
} from "./notification-transport";
import {
  NOTIFICATIONS_CONFIG,
  PROCESS_STARTED_AT,
  type NotificationsConfig,
} from "./notifications.config";
import { unconfiguredWatermark } from "./raise-retry";
import { WebhookTransport } from "./webhook.transport";

export type { DispatchEvent } from "./dedupe-key";

/**
 * `F3.8` — the service that turns an alarm into deliveries (ADR 0041), and
 * since `F3.10` the one the alarm lifecycle sweep sends through as well (ADR
 * 0057 decision 9).
 *
 * **Two entry points, one per-channel path.** `dispatch(input)` is the raise
 * path's: it loads the channels joined to the rule and hands them on.
 * `dispatchToChannels(channels, input)` is the sweep's: an escalation step
 * names its own channels, and a cleared message goes to whoever holds a `sent`
 * row for the alarm (`sentChannelIdsForAlarm`), so the caller supplies the
 * list. Both funnel into `dispatchToChannel`, and **both dedupes live inside
 * it** — the raise path's once-recorded refusal (`F3.46`) and the event's
 * ledger read (decision 10), which answers a key that holds a `sent` or
 * `skipped_deduped` row, a `failed` one too once there are
 * `MAX_EVENT_ATTEMPTS` of them (owner ruling Q9), and a `skipped_unconfigured`
 * one only until the channel is reconfigured or the process restarts (`F3.50`
 * ruling Q1). `F3.8` refused a second entry point because it
 * would be a second place for the dedupe to be forgotten; the answer here is
 * that neither entry point holds a dedupe to forget.
 *
 * **What `dispatchToChannels` refuses before the per-channel path** (PR 1's
 * security review): an event with no alarm id, whole (L2 — its key would be
 * shared by every alarm of the rule), and any channel whose organization is
 * neither `null` nor the input's (M2 — the floor under every caller, whatever
 * list it loaded). Both warn with codes and ids only (§9.6).
 *
 * **Neither entry point rejects** (ADR 0041 decision 1). `dispatch` is called
 * fire-and-forget from the alarm raise path, so a rejection would surface as
 * an unhandled promise rather than in front of anyone; `dispatchToChannels` is
 * called from a sweep whose one warn line would hide which channel failed.
 * Every failure becomes a `failed` result and the promise resolves. It is
 * recorded as a row, with **three exits that all ask one question** —
 * `offeredAgainWithoutAsking`, in `dispatch-policy.ts` since the `F3.51`
 * review, and since `F3.54` they ask it in one call rather than three inline
 * tests. A dispatch that the sweep will re-offer on its own writes no row when
 * the ledger read throws (plan D3), when the rate-limit read throws (review
 * H1), or when the hourly ceiling refuses it (`F3.48` ruling Q1). The first two
 * are failed reads and the third is a decision, but the reason is one reason:
 * that key must survive for the next tick to retry the dispatch.
 *
 * **A row that could not be written is reported, not swallowed** (`F3.51`
 * review, High). Not rejecting is decision 1 and stands; but `record()`'s
 * insert can fail while every read succeeds, and then NO row appears under the
 * key — so `MAX_EVENT_ATTEMPTS` has nothing to count, `isOverHourlyLimit` has
 * no `sent` row to count, and the callers that re-offer a dispatch on their own
 * have nothing that can ever stop them. Every result therefore carries
 * `rowLost` (`DispatchOutcome`), and **both** re-offering phases of the alarm
 * lifecycle sweep — the raise retry and the escalation, each under its own
 * dedupe key — keep the triples it names out of the next tick's offer. The
 * escalation phase discarded its outcomes until the second review; the first
 * review's "the one caller" was already two.
 *
 * **Two kinds of dispatch answer yes, and since `F3.51` only one of them is an
 * event** (ADR 0041 Amendment 5). An escalation step is re-dispatched by
 * `runEscalationPhase` on every 30 s tick. A raise carrying `reoffered` is
 * re-dispatched by the same sweep's raise-retry phase, for an alarm whose
 * original raise reached nobody — it is not an event, it carries no event
 * suffix, and it is the fourth exception to decision 4.
 *
 * A CLEARED message is none of those cases. It is dispatched once from the
 * clear phase and never re-offered, so a missing row buys no retry and costs
 * the only evidence: it keeps its row at all three exits (ruling Q-A for the
 * ceiling, `F3.54` ADR 0057 Amendment 4 for the two reads).
 *
 * **An ORDINARY raise keeps its row at the two of those exits it can reach** —
 * nothing re-offers it, so the row is the only evidence it was refused, which
 * is `F3.51`'s own premise. Two, not the three this paragraph claimed until the
 * second review: the first exit is step 0's failed ledger read, which sits
 * inside `if (input.event !== undefined)`, and a dispatch with no event never
 * enters that branch. Its two are step 2's — the failed rate-limit read and the
 * ceiling's refusal. But not everywhere in this method, and the
 * difference matters: an ordinary raise carrying `raised: false` reaches step
 * 1 instead of any of them, and the transition dedupe there writes nothing
 * once a refusal for that key is already recorded (`F3.46`) — the
 * most-executed refusal in the service. That is a separate case with its own
 * reason, not another exception to this one. A CLEARED message carries an
 * event, so it takes step 0 and never reaches step 1 at all.
 */

/** What a caller knows at the moment a rule raised (or did not raise) an alarm. */
export type DispatchInput = {
  ruleId: string;
  ruleCode: string;
  /**
   * `E7.1c` (decision 7, `0048`): `notification_deliveries.organization_id`
   * is `NOT NULL`, and a dispatch's only source for it is the rule —
   * `automation_rules.organization_id` has been `NOT NULL` since `0047`, so
   * this is never `null` in practice. `F3.7`'s `toDispatchInput`
   * (`rules/rule-actions.ts`) is where production builds one, for both raise
   * paths, and it builds nothing for a rule with no organization rather than
   * invent one.
   */
  organizationId: string;
  alarmId: string | null;
  severity: string | null;
  message: string;
  /**
   * `AlarmRaiseResult.raised`. `false` means `alarms_open_per_rule_uidx`
   * (migration 0032) found this rule already open for this asset — the
   * condition still matches, but nothing transitioned, so nobody needs telling
   * again.
   */
  raised: boolean;
  /**
   * `F3.10` (ADR 0057 decision 9). Absent on the raise path. The alarm
   * lifecycle sweep sets it for an escalation step or the cleared message; the
   * kind rides in the dedupe key (`:escalation:<n>` / `:cleared`) and the
   * subject line, never in a column. When it is set, `raised` is not
   * consulted: an event is not a transition, and its dedupe is the ledger read
   * in `dispatchToChannel`, not the raise path's refusal.
   */
  event?: DispatchEvent;
  /**
   * `F3.51` (ADR 0041 Amendment 5) — this is the alarm lifecycle sweep's
   * raise-retry phase re-offering an alarm's ORIGINAL raise, which did not
   * reach anybody. Set nowhere else.
   *
   * **It is not an event.** It does not reach `buildDedupeKey` and does not
   * change `subjectFor`, so the key and the subject stay byte-identical to the
   * original raise's — which is the whole mechanism, because the sweep decides
   * who is owed by reading rows under that ORIGINAL key. A `:retry` suffix or a
   * subject prefix would orphan every row it matched on (case E18 holds this).
   *
   * What it changes is one property: {@link offeredAgainWithoutAsking}.
   */
  reoffered?: true;
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    // E7.1c (ADR 0043 Amendment 5, decision 7, 0048): notification_deliveries.
    // organization_id is NOT NULL and every write here now stamps a real org —
    // the rule's for a dispatch, the channel's for a send test (refused
    // outright for a NULL-org channel, see sendTest). Both the ledger insert
    // and the rate-limit read still run on fleetDb, but for a different reason
    // than before 0048: this is a fire-and-forget path with no tenant
    // transaction to run under, so the org filter is the WHERE clause, not the
    // connection — see isOverHourlyLimit's own comment.
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly channels: ChannelsService,
    private readonly logTransport: LogTransport,
    private readonly emailTransport: EmailTransport,
    private readonly webhookTransport: WebhookTransport,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: NotificationsConfig,
  ) {}

  /**
   * Sends one alarm to every channel joined to its rule, and records a row for
   * every attempt — including every skip. That is the raise path's rule, and
   * every input that arrives HERE still obeys it: this entry point serves a
   * raise a rule evaluation just made, and nothing re-offers such a raise. The
   * three exceptions live in `dispatchToChannel` steps 0 and 2 (D3, H1, and
   * `F3.48` ruling Q1) and belong to a dispatch that will be offered again
   * without anyone asking — an escalation step, or `F3.51`'s re-offered raise.
   * Both reach the per-channel path through `dispatchToChannels`, never here.
   *
   * **A refusal is recorded once, not once per attempt** (`F3.46`). The first
   * `raised: false` dispatch writes the `skipped_deduped` row; every later one
   * under the same `(channel, organization, dedupe key)` finds that row and
   * answers from it without writing. Before this, re-evaluating an unchanged
   * plant added one row per open-alarm rule per joined channel on every press,
   * and nothing bounded it. The result the caller sees is identical either way
   * — what is bounded is the ledger, not the contract.
   *
   * Returns one `DeliveryResult` per channel, in channel-code order. A rule
   * with no channels returns an empty array and writes nothing: there is no
   * channel to attribute a row to (`notification_deliveries.channel_id` is NOT
   * NULL), and "this rule notifies nobody" is the state every rule is in the
   * moment migration 0038 runs.
   */
  async dispatch(input: DispatchInput): Promise<DispatchOutcome[]> {
    let channels: NotificationChannelRow[];
    try {
      channels = await this.channels.loadForRule(input.ruleId);
    } catch (err) {
      // Even the load is inside the guarantee: a database hiccup here must not
      // reject into a fire-and-forget caller.
      this.logger.warn(
        `notification channels could not be read for rule=${input.ruleCode}: ${reasonOf(err)}`,
      );
      return [];
    }
    return this.dispatchToChannels(channels, input);
  }

  /**
   * `F3.10` — sends one input to an explicit channel set (ADR 0057 decision
   * 9). The alarm lifecycle sweep's entry point: a step's channels come from
   * its profile, a cleared message's from `sentChannelIdsForAlarm`, and
   * neither is the rule's `rule_notifications` join that `dispatch` loads.
   *
   * Two refusals live here rather than in the per-channel path, because they
   * are about the input and the list, not about one channel (PR 1's security
   * review, 2026-09-06):
   *
   * - **An event with no alarm id is refused whole** (L2). Its key would be
   *   `<rule>:no-alarm:<severity>:<event>` — one key shared by every alarm the
   *   rule ever raises — so the first step sent for any of them would answer
   *   every later one from the ledger. One warn (rule code, event kind),
   *   nothing sent, nothing written, an empty result. Plan U7 never builds
   *   this input; the service refuses it because the sweep is not the only
   *   possible caller.
   * - **A channel in another organization is dropped** (M2). `setRuleChannels`
   *   refuses the pairing when a rule's join is written and the profile write
   *   path mirrors it (plan U8), but this is the caller-independent floor: a
   *   delivery is stamped with the rule's organization (`E7.1c`), and sending
   *   it through another tenant's channel would carry one tenant's alarm into
   *   another's inbox. A fleet-wide (`null`) channel passes. One warn per
   *   dropped channel — its code and the two organization ids, nothing else
   *   (§9.6) — and no result entry for it, so `results.length` still says how
   *   many channels were really tried.
   *
   * Returns one `DeliveryResult` per channel kept, **in the order given** —
   * the caller chose the order, and `loadEnabledChannelsByIds` already sorts
   * by code. Never rejects, for the reason the class header gives.
   *
   * **`F3.53` — `closedCeilings` is the sweep's memory of which ceilings have
   * already refused inside this tick** (ADR 0041 Amendment 7, ruling 2). It is
   * OPTIONAL, and a caller that passes none reads the ledger before every
   * dispatch exactly as it did before that unit.
   *
   * **No production caller passes one yet, and that is this tree's state rather
   * than the ruling's.** Nothing constructs a `ClosedCeilings` outside the specs
   * until the sweep does — the same gap `closed-ceilings.ts` records. Of the
   * **three** production callers, one is to pass it and two are not, and each
   * omission is a decision: `dispatchRememberingLostRows` is the one — the
   * single site shared by the raise-retry and escalation phases, where all of
   * the measured spin is; `notifyCleared` is not, because a cleared message has
   * no next tick to be postponed to and `closed-ceilings.ts`'s non-monotone edge
   * would cost the clear itself; and `dispatch()` is not, because it runs
   * concurrently with the sweep and outside it. **`sendTest` is not one of the
   * three at all** — it
   * calls `isOverHourlyLimit` directly and never enters this method, so it
   * cannot see a memo on any reading. Amendment 7 first counted four callers
   * and named `sendTest`; that was corrected in place in the ADR, and this
   * paragraph is written from the correction.
   */
  async dispatchToChannels(
    channels: readonly NotificationChannelRow[],
    input: DispatchInput,
    closedCeilings?: ClosedCeilings,
  ): Promise<DispatchOutcome[]> {
    if (input.event !== undefined && input.alarmId === null) {
      this.logger.warn(
        `event=${input.event.kind} refused for rule=${input.ruleCode}: no alarm id, so the dedupe key would be shared by every alarm of the rule`,
      );
      return [];
    }

    const kept = channels.filter((channel) => {
      if (channel.organizationId === null || channel.organizationId === input.organizationId) {
        return true;
      }
      this.logger.warn(
        `channel=${channel.code} dropped for rule=${input.ruleCode}: channel organization=${channel.organizationId} is not the rule's organization=${input.organizationId}`,
      );
      return false;
    });

    const dedupeKey = buildDedupeKey(input);
    const results: DispatchOutcome[] = [];
    for (const channel of kept) {
      const result = await this.dispatchToChannel(input, channel, dedupeKey, closedCeilings);
      results.push(result);
    }
    return results;
  }

  private async dispatchToChannel(
    input: DispatchInput,
    channel: NotificationChannelRow,
    dedupeKey: string,
    closedCeilings?: ClosedCeilings,
  ): Promise<DispatchOutcome> {
    // 0. `F3.10` — event idempotency (ADR 0057 decision 10), and it comes
    //    FIRST. An escalation step or a cleared message is sent once per
    //    (channel, organization, dedupe key), for the life of the ledger; a
    //    `sent` or `skipped_deduped` row answers the key, a `failed` one is
    //    retried until there are `MAX_EVENT_ATTEMPTS` of them (owner ruling
    //    Q9), a rate-limited one no longer answers it at all (`F3.48` ruling
    //    Q2 — ruling Q7 said it did, and step 2 below no longer writes one for
    //    a step), and an unconfigured one answers it only until the channel is
    //    reconfigured or the process restarts (`F3.50` ruling Q1, the
    //    `unconfiguredSince` watermark below). A blocked key is the record —
    //    nothing is written. `raised` is
    //    not consulted on this path: an event is not a transition, and had
    //    the raise-path refusal below run first it would have written a
    //    `skipped_deduped` row under the event's key and made the event
    //    unsendable forever.
    if (input.event !== undefined) {
      // `F3.50` ruling Q1 (ADR 0057 Amendment 3): the instant a
      // `skipped_unconfigured` row stops being an answer and becomes history.
      // The later of the two clocks that can have changed a channel's ability
      // to send — its own `updated_at` (a URL, recipients, the kind, a
      // re-saved secret) and the process boundary (`SMTP_HOST`,
      // `CREDENTIAL_ENCRYPTION_KEY`, which no row records).
      //
      // `F3.50` wrote this expression inline here and said a `watermarkFor()`
      // helper "would only invite a test that passes while this line is never
      // reached". There are two call sites now — this one and
      // `channelsOwedTheRaise`, which must date a `skipped_unconfigured` row
      // the same way or the raise retry and the event path would disagree about
      // when a refusal stops answering — and two call sites are what justifies
      // the helper. Both are driven: case 15 renders the parameters this read
      // binds, and `raise-retry.spec.ts` P8/P9/P14 drive the other.
      //
      // Outside the `try` below on purpose, and security review asked. The
      // "never rejects" invariant is about `dispatch()`, the fire-and-forget
      // raise path — which cannot reach this line at all, because it is inside
      // `input.event !== undefined`. Both callers that CAN reach it wrap their
      // dispatch in a `try` of their own (`notifyCleared`, and the escalation
      // phase's per-step catch from security review M1). Moving it inside the
      // ledger-read `try` would buy nothing and would report a `TypeError`
      // here as "delivery ledger read failed", which is a lie.
      const unconfiguredSince = unconfiguredWatermark(channel, PROCESS_STARTED_AT);
      let alreadyRecorded: boolean;
      try {
        alreadyRecorded = await eventDeliveryBlocked(
          this.fleetDb,
          channel.id,
          input.organizationId,
          dedupeKey,
          unconfiguredSince,
        );
      } catch (err) {
        // Plan D3, narrowed to the escalation kind by `F3.54` (ADR 0057
        // Amendment 4 ruling 1).
        //
        // For a STEP: no row and no send. Writing one would poison this key for
        // every later tick — the read above would then answer "already sent"
        // from a row that records nothing was sent — and sending would risk
        // the duplicate the read exists to prevent. The next tick retries.
        // This is the opposite of the raise path's fallback in step 1, on
        // purpose: there, the write is bounded and a duplicate row is the
        // cost; here, the write would be permanent and silence is the cost.
        //
        // For a CLEARED message: the row IS written, and it is ruling Q-A's
        // argument reaching the exit `F3.48` did not change. Every clause above
        // is about a key a later tick comes back to, and a clear has no later
        // tick — `notifyCleared` runs once from the clear phase and
        // `loadActiveAlarms` filters `cleared_at IS NULL`, so the alarm leaves
        // the sweep the moment it clears. Silence there buys no retry and costs
        // the only evidence the refusal happened.
        //
        // The row is only ATTEMPTED, and that is the honest claim: this branch
        // ran because the ledger read failed, and the insert below goes to the
        // same connection. `record()` reports its own failure and returns the
        // result either way, so this cannot reject.
        //
        // §9.6: codes and a reason, never the alarm text or a recipient.
        this.logger.warn(
          `delivery ledger read failed for channel=${channel.code} rule=${input.ruleCode}: ${reasonOf(err)}`,
        );
        const failedRead: DeliveryResult = {
          status: "failed",
          error: "delivery ledger read failed",
        };
        return offeredAgainWithoutAsking(input)
          ? notRecorded(channel, failedRead)
          : this.record(input, channel, dedupeKey, failedRead);
      }
      if (alreadyRecorded) {
        return notRecorded(channel, { status: "skipped_deduped", error: null });
      }

    } else if (!input.raised) {
      // 1. The transition dedupe. The skip is still RECORDED: "we chose not to
      //    send" and "nothing happened" must not look the same in the ledger
      //    (decision 4). `F3.46`: but only ONCE per (channel, organization,
      //    dedupe key) — read the ledger before writing, and let the row that
      //    is already there answer the second and every later press. Decision
      //    4 asks that the refusal be visible, not that it be re-stated; ADR
      //    0041 Amendment 1 ruling 1 left the growth of that restatement open,
      //    and this is where it is closed.
      const skip: DeliveryResult = { status: "skipped_deduped", error: null };
      let alreadyRecorded: boolean;
      try {
        alreadyRecorded = await hasRecordedSkip(
          this.fleetDb,
          channel.id,
          input.organizationId,
          dedupeKey,
        );
      } catch (err) {
        // An unreadable ledger falls back to today's write — bounded by today's
        // growth — never to a send, and never to silence. Skipping the write
        // instead would make "the ledger was unreadable" look exactly like "we
        // already recorded this", which is the silent-loss shape §4.6 names.
        this.logger.warn(
          `dedupe ledger read failed for channel=${channel.code} rule=${input.ruleCode}: ${reasonOf(err)}`,
        );
        alreadyRecorded = false;
      }
      return alreadyRecorded
        ? notRecorded(channel, skip)
        : this.record(input, channel, dedupeKey, skip);
    }

    // 2. The per-channel hourly ceiling.
    let overLimit: boolean;
    try {
      // `F3.52`: an event stops at the reserve, a raise keeps the whole
      // ceiling, and `budgetFor` is what tells them apart — never a literal
      // here (ADR 0041 Amendment 6 §1).
      const budget = budgetFor(input);
      const read = () => this.isOverHourlyLimit(channel.id, input.organizationId, budget);
      // `F3.53`: with a sweep's memo, a ceiling this tick has already found
      // CLOSED answers without a read; without one, nothing is remembered. The
      // ternary is explicit rather than an optional chain or a default instance
      // because "no memo, no memory" has to be visible here — a default would
      // cache across every caller. `closed-ceilings.ts` holds the reasons.
      overLimit =
        closedCeilings === undefined
          ? await read()
          : await closedCeilings.overLimit(channel.id, input.organizationId, budget, read);
    } catch (err) {
      // A ceiling that cannot be read is not a licence to send without one.
      this.logger.warn(`rate-limit check failed for channel=${channel.code}: ${reasonOf(err)}`);
      const failed: DeliveryResult = { status: "failed", error: "rate-limit check failed" };
      // Review H1, narrowed to the escalation kind by `F3.54` (ADR 0057
      // Amendment 4 ruling 1).
      //
      // On an ESCALATION step this row is NOT written, for step 0's reason. An
      // event's key is for the life of the ledger, and a `failed` row here
      // records a read that never reached the transport — it would spend one of
      // the key's `MAX_EVENT_ATTEMPTS` (Q9), and before Q9 it blocked the key
      // for ever. The next tick retries the step.
      //
      // A CLEARED message keeps its row, because there is no next tick to
      // conserve an attempt for and nothing to gain by staying silent — ruling
      // Q-A's argument, applied at the exit `F3.48` did not reach.
      //
      // An ORDINARY raise keeps its row too: that write is bounded by the
      // transition, and the next raise is a new alarm with a new key.
      //
      // A RE-OFFERED raise does not (`F3.51`, ADR 0041 Amendment 5). The
      // lifecycle sweep asks again on its next tick, so a `failed` row here
      // would spend one of the raise key's `MAX_EVENT_ATTEMPTS` on a read that
      // never reached the transport — case 10's reason, at the same exit, for a
      // dispatch that is not an event. The call below tells the two raises
      // apart by `reoffered`; it can no longer be read as "everything without
      // an event records".
      //
      // This test is now the SAME CALL as the ceiling's `retriable` twenty
      // lines below, and as step 0's. That was `F3.54`'s whole complaint: two
      // adjacent exits discriminating differently — one on the presence of an
      // event, one on its kind — with nothing in the code saying why.
      return offeredAgainWithoutAsking(input)
        ? notRecorded(channel, failed)
        : this.record(input, channel, dedupeKey, failed);
    }
    if (overLimit) {
      const limited: DeliveryResult = { status: "skipped_rate_limited", error: null };
      // `F3.48` ruling Q1 (ADR 0057 Amendment 2): on the ESCALATION path this
      // row is NOT written — the same treatment, and the same reason, as the
      // failed rate-limit read two lines above (H1). An event's key lasts the
      // life of the ledger, so a row here would spend it on a refusal the next
      // tick is meant to revisit: `isOverHourlyLimit` counts `sent` rows over a
      // trailing hour and lifts by itself, and `runEscalationPhase`
      // re-dispatches every due step every tick and ignores the results.
      // Writing nothing IS the retry — no caller knows about this.
      //
      // `escalation`, not every event (ruling Q-A): `notifyCleared` runs once,
      // from the clear phase, and `loadActiveAlarms` filters `cleared_at IS
      // NULL`, so a cleared message is never dispatched a second time. Dropping
      // its row would make the refusal invisible and buy no retry, so the clear
      // keeps the visible refusal ADR 0041 decision 4 asks for.
      //
      // An ORDINARY raise keeps its row too: a raise key is per transition and
      // the next raise is a new alarm with a new key, so the growth is bounded.
      //
      // A RE-OFFERED raise does not, and this exit is what `F3.51` exists for
      // (ADR 0041 Amendment 5). The sweep re-offers an undelivered raise every
      // 30 s, so three refusals here would spend the key inside 90 seconds
      // while `isOverHourlyLimit` counts `sent` rows over a trailing HOUR — the
      // retry would burn out before the ceiling could lift. That is the
      // premise `F3.48` measured and falsified, reproduced on the raise path,
      // and the fix is `F3.48`'s unchanged: write nothing, and the next tick
      // asks again.
      const retriable = offeredAgainWithoutAsking(input);
      return retriable
        ? notRecorded(channel, limited)
        : this.record(input, channel, dedupeKey, limited);
    }

    // 2b. `F3.52` — the step is too late to send (ADR 0041 Amendment 6 §2,
    //     owner ruling 9). Last of the pre-checks: after the ledger read, and
    //     after the ceiling.
    //
    //     **Being after the ceiling buys the REASON, not the message, and the
    //     comment here claimed otherwise until a correctness pass ran it.** It
    //     said a step refused by the budget could never then be abandoned for
    //     age it spent waiting. False: `stepIsTooLate` recomputes each tick
    //     from a fixed `raised_at` and an increasing `now`, so once stale a
    //     step stays stale — the moment the ceiling frees, control reaches this
    //     line and the step is abandoned anyway. The end state is the same in
    //     both orders. What differs is what an operator reads meanwhile:
    //     `skipped_rate_limited` is true and self-clearing while the channel is
    //     over budget, where `skipped_stale` would be terminal and premature.
    //     What actually reduces the loss is ruling 8's two-count ceiling above,
    //     which stops raises consuming the event budget at all. S7 and S9 gate
    //     this order; S5 gates the age deciding under a ceiling the step passes.
    //
    //     BEFORE the `alreadyRecorded` return is still wrong for its own
    //     reason: it would write a row for a step already sent, because the
    //     phase re-dispatches every due step every tick and the ledger read is
    //     what makes that idempotent (S6).
    //
    //     `input.event?.kind` re-narrows because the `if` block above has
    //     closed. That is ruling 1's structural gate all the same: `stale`
    //     lives only on the escalation variant, so a raise and a re-offered
    //     raise cannot carry it. A `skipped_stale` row under a RAISE key would
    //     block that raise for ever — `channelsOwedTheRaise` excludes only
    //     `skipped_rate_limited` and a stale `skipped_unconfigured`. Case S8, a
    //     pair on one fixture, is the gate; this paragraph is not.
    //
    //     The row IS written where the ceiling exception writes none: an
    //     abandonment is a decision, not a postponement — nothing lifts by
    //     itself, `eventDeliveryBlocked`'s "not `failed`" arm is MEANT to block
    //     the key for ever, and the row is the only evidence an operator gets.
    //     `offeredAgainWithoutAsking` answers a different question and is not
    //     consulted.
    if (input.event?.kind === "escalation" && input.event.stale === true) {
      return this.record(input, channel, dedupeKey, { status: "skipped_stale", error: null });
    }

    // 3. Send. A transport that rejects is a `failed` delivery, never a
    //    rejection out of `dispatch` (decision 1).
    const transport = this.transportFor(channel.kind);
    let result: DeliveryResult;
    try {
      result = await transport.send({
        subject: subjectFor(input),
        body: input.message,
        ruleId: input.ruleId,
        ruleCode: input.ruleCode,
        alarmId: input.alarmId,
        severity: input.severity,
        channel,
      });
    } catch (err) {
      result = { status: "failed", error: `transport threw: ${reasonOf(err)}` };
    }

    return this.record(input, channel, dedupeKey, result);
  }

  /**
   * Which transport serves a channel kind.
   *
   * `LogTransport` stands in for a kind with no configured transport — an
   * email channel with no `SMTP_HOST`, or a kind this build does not implement
   * (decision 5). It writes a line and reports `skipped_unconfigured`, so an
   * unconfigured deployment leaves a visible trail instead of silence.
   */
  private transportFor(kind: string): NotificationTransport {
    if (kind === "webhook") return this.webhookTransport;
    if (kind === "email") {
      return this.config.smtp === null ? this.logTransport : this.emailTransport;
    }
    return this.logTransport;
  }

  /**
   * `true` when this channel has already had `ratePerHour` **sent** deliveries
   * in the last hour, for THIS organization.
   *
   * Counts `sent` only, deliberately. Counting skips would let the ceiling fill
   * with its own refusals: one noisy hour would lock the channel out for the
   * next, and the rate limiter would be the thing keeping it locked.
   *
   * `E7.1c`: scoped by `organizationId` — this is the revisit the old comment
   * asked for by name ("once deliveries carry a real org, a cross-org count
   * would charge one tenant's sends against another's ceiling"). A channel
   * shared across tenants (a fleet-managed global, joined to rules in more than
   * one organization) now gets one ceiling **per tenant**, not one shared pool
   * a noisy tenant could exhaust for everyone else on the same channel.
   *
   * `fleetDb` stays load-bearing, but for a different reason than before: this
   * is a fire-and-forget read outside any tenant transaction (`dispatch` never
   * opens one, and `sendTest` runs off a request that has not either), so
   * there is no `withTenant` GUC to run it under — the `WHERE` clause is now
   * what does the org filtering, not the connection.
   *
   * **`F3.52`: one query, two limits** (ADR 0041 Amendment 6 §1, rulings 3 and
   * 8). A raise keeps the whole `ratePerHour`; an event or a manual test must
   * ALSO stay under `hourlyCeiling`'s reserved share, so the last slots of every
   * hour stay reachable by a raise alone. One round trip, no new column, no
   * schema change.
   *
   * **Two numbers, and each limit reads its own** (ruling 8, the security
   * review's finding). `allSent` is every `sent` row; `reservedSent` is the
   * subset {@link RESERVED_KEY_PATTERN} matches — the rows a dispatch that
   * CHARGED the reserved budget wrote. That constant's docblock holds the
   * invariant, why the pattern is structural, and the defect this replaced: one
   * unfiltered count compared against both limits let 48 sent RAISES refuse
   * every step, clear and test on the channel while raises sent on to 60.
   *
   * **The full arm is tested first and applies to BOTH budgets**, so the hourly
   * total is still `ratePerHour` and the two limits are not two pools. An event
   * is refused when either number is at its limit; a raise, only by the first.
   * `dispatch-budget.spec.ts` N4 is that claim, on a mixed count.
   */
  private async isOverHourlyLimit(
    channelId: string,
    organizationId: string,
    budget: CeilingBudget,
  ): Promise<boolean> {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const chargedTheReserve = or(
      isNull(notificationDeliveries.dedupeKey),
      like(notificationDeliveries.dedupeKey, RESERVED_KEY_PATTERN),
    );
    const rows = await this.fleetDb
      .select({
        allSent: sql<number>`count(*)::int`,
        reservedSent: sql<number>`count(*) FILTER (WHERE ${chargedTheReserve})::int`,
      })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.channelId, channelId),
          eq(notificationDeliveries.organizationId, organizationId),
          eq(notificationDeliveries.status, "sent"),
          gte(notificationDeliveries.attemptedAt, since),
        ),
      );
    if ((rows[0]?.allSent ?? 0) >= hourlyCeiling("full", this.config.ratePerHour)) return true;
    if (budget === "full") return false;
    return (rows[0]?.reservedSent ?? 0) >= hourlyCeiling("reserved", this.config.ratePerHour);
  }

  /**
   * `F3.10` — the cleared message's recipients (ADR 0057 decision 9, owner
   * ruling Q5): every channel that holds a `sent` row for this alarm in this
   * organization — the raise or any step — and nobody else. Distinct, in
   * first-seen order, de-duplicated here rather than in SQL.
   *
   * **No index serves `alarm_id` today** — this is the column's first reader,
   * and `notification_deliveries_channel_time_idx` leads on `channel_id`, so
   * the read is a scan of the organization's rows. PR 2's migration
   * `0066_alarm_lifecycle.sql` adds `notification_deliveries_alarm_idx ON
   * (alarm_id) WHERE alarm_id IS NOT NULL` beside plan Q3's probe (`0038`'s
   * rule: the reader adds the index), and the plan records it. `F3.51` is that
   * index's second reader and measured the plan: `raise-attempts.ts`, which
   * holds the RAISE key's read — outside this class, because the file is at
   * §4.5's cap and the read needs nothing from it but `fleetDb`.
   *
   * Same connection and the same reason as `isOverHourlyLimit`: a sweep read
   * with no tenant transaction, so the organization is the `WHERE`. Unlike
   * the two dispatch entry points this read is not fire-and-forget and does
   * reject on a failed read: the sweep loop warns and the next tick retries,
   * and a cleared message sent to "nobody" because the read failed would be
   * the silent-loss shape §4.6 names.
   */
  async sentChannelIdsForAlarm(alarmId: string, organizationId: string): Promise<string[]> {
    const rows = await this.fleetDb
      .select({ channelId: notificationDeliveries.channelId })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.alarmId, alarmId),
          eq(notificationDeliveries.organizationId, organizationId),
          eq(notificationDeliveries.status, "sent"),
        ),
      );
    return [...new Set(rows.map((row) => row.channelId))];
  }

  /**
   * Sends one message through a channel's real transport and records it like
   * any other attempt.
   *
   * This is the cheapest way to make U4's egress rules visible to whoever
   * configures a webhook: the refusal an operator would otherwise meet at 3am,
   * met at configuration time instead.
   *
   * Subject to the hourly ceiling — a test is a real send and must not be a way
   * around it — but **not** to the transition dedupe, which has no meaning
   * here: there is no alarm and nothing transitioned. Since `F3.52` it is
   * subject to the RESERVED ceiling rather than the whole one (ADR 0041
   * Amendment 6 §1, ruling 4): a manual test is not an alarm, so it must never
   * consume headroom held for a critical raise.
   *
   * `E7.1c` (Blocker 1's ruling): refuses a fleet-wide (`organizationId ===
   * null`) channel outright, before the rate-limit read and before the
   * transport is ever touched. `record()`'s insert is now `NOT NULL` on
   * `organizationId`, and its own `catch` only logs — so without this
   * explicit 400, pressing **Send Test** on a global channel would send the
   * real message and write **no** ledger row, the same silent-loss failure a
   * cached browser bundle produces: it looks like it worked.
   */
  async sendTest(channel: NotificationChannelRow): Promise<{
    status: DeliveryResult["status"];
    error: string | null;
  }> {
    if (channel.organizationId === null) {
      throw new BadRequestException(
        "A fleet-wide channel has no organization to attribute the delivery to; " +
          "create an org-scoped channel or wait for the E7.1d organization picker",
      );
    }
    // Narrowed once, right after the guard: every `record()` call below reads
    // this local rather than `channel.organizationId` again, so nothing here
    // can silently drift back to sending an un-attributable delivery if the
    // guard above is ever moved.
    const organizationId = channel.organizationId;

    let overLimit: boolean;
    try {
      // `F3.52` ruling 4: a manual test meets the REDUCED event limit, not the
      // full ceiling. A test is not an alarm, so it must never consume headroom
      // held for a critical raise.
      overLimit = await this.isOverHourlyLimit(channel.id, organizationId, "reserved");
    } catch (err) {
      this.logger.warn(`rate-limit check failed for channel=${channel.code}: ${reasonOf(err)}`);
      return sendTestResult(
        await this.record({ ruleId: null, alarmId: null, organizationId }, channel, null, {
          status: "failed",
          error: "rate-limit check failed",
        }),
      );
    }
    if (overLimit) {
      return sendTestResult(
        await this.record({ ruleId: null, alarmId: null, organizationId }, channel, null, {
          status: "skipped_rate_limited",
          error: null,
        }),
      );
    }

    const transport = this.transportFor(channel.kind);
    let result: DeliveryResult;
    try {
      result = await transport.send({
        subject: `TRINETRA test notification (${channel.code})`,
        body:
          "This is a test notification from TRINETRA. If you are reading it, this channel works.",
        ruleId: null,
        ruleCode: null,
        alarmId: null,
        severity: null,
        channel,
      });
    } catch (err) {
      result = { status: "failed", error: `transport threw: ${reasonOf(err)}` };
    }
    return sendTestResult(
      await this.record({ ruleId: null, alarmId: null, organizationId }, channel, null, result),
    );
  }

  /**
   * Writes the ledger row and returns the result unchanged — plus, since the
   * `F3.51` review, whether the row LANDED.
   *
   * **It still never throws and never fails the caller** (ADR 0041 decision
   * 1). What changed is only that the failure stops being invisible: the
   * `logger.error` below is for an operator, and `rowLost` is for the alarm
   * lifecycle sweep, whose TWO re-offering phases — the raise retry and the
   * escalation — would otherwise offer this dispatch again for ever. No row
   * means no `MAX_EVENT_ATTEMPTS` to count and no `sent` row for
   * `isOverHourlyLimit` to count either, so nothing in the ledger can stop
   * either of them; each keeps its own memory, under its own dedupe key.
   */
  private async record(
    input: { ruleId: string | null; alarmId: string | null; organizationId: string },
    channel: NotificationChannelRow,
    dedupeKey: string | null,
    result: DeliveryResult,
  ): Promise<DispatchOutcome> {
    try {
      await this.fleetDb.insert(notificationDeliveries).values({
        organizationId: input.organizationId,
        ruleId: input.ruleId,
        alarmId: input.alarmId,
        channelId: channel.id,
        status: result.status,
        dedupeKey,
        error: result.error === null ? null : storable(result.error),
      });
    } catch (err) {
      // The send may already have happened; losing the row is bad but failing
      // the caller is worse. Say so loudly and carry on.
      this.logger.error(
        `delivery row not written for channel=${channel.code} status=${result.status}: ${reasonOf(err)}`,
      );
      return { ...result, channelId: channel.id, rowLost: true };
    }
    return { ...result, channelId: channel.id, rowLost: false };
  }

}
