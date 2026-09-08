import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, gt, gte, ne, or, sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import { notificationDeliveries } from "@bms/db";

import { FLEET_DRIZZLE } from "../database/database.tokens";
import { ChannelsService } from "./channels.service";
import { buildDedupeKey, type DispatchEvent } from "./dedupe-key";
import { EmailTransport } from "./email.transport";
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
 * Every failure becomes a `failed` result — recorded as a row, except the two
 * event-path reads that D3 and H1 keep out of the ledger — and the promise
 * resolves. `F3.48` adds a third exception, and it is a decision rather than a
 * read: the hourly ceiling writes no row when it refuses an escalation step,
 * because that key must survive to be retried (ruling Q1).
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
};

/** How much of a transport's failure text is stored. */
const MAX_ERROR_LENGTH = 1_000;

/**
 * `F3.10` (owner ruling Q9, 2026-09-06): how many `failed` rows an event's key
 * may hold on one channel before the event stops being retried.
 *
 * A transport failure is not a decision. A webhook that timed out at 03:00
 * should be tried again on the next tick, where a deduped step should not —
 * but an unbounded retry would let one dead endpoint grow the ledger by a row
 * per tick for the life of the alarm. Three rows per key per channel is the
 * growth bound; `eventDeliveryBlocked` reads at most this many and blocks the
 * key once it finds them.
 *
 * A step the hourly ceiling refused is retried too, since `F3.48`, and it
 * never spends an attempt: ruling Q1 writes no row for it, so there is nothing
 * for this bound to count. **Nothing else bounds it either.** The ceiling's
 * trailing hour decides when a slot frees, not how long the retry runs, so a
 * channel held permanently over a misconfigured ceiling retries for the life of
 * the alarm — writing nothing, sending nothing. ADR 0057 Amendment 2 §2 accepts
 * that; it is not an oversight in this constant.
 *
 * A step an unconfigured channel refused is retried too, since `F3.50`, and it
 * IS bounded — by the second arm rather than by this one. Ruling Q1 keeps
 * writing the row (an operator must see a configuration fault), and releases
 * the key only once the row predates the channel's `updated_at` or the process
 * start. A retry that reaches a write then writes ONE fresh row, which is newer
 * than that watermark, so `eventDeliveryBlocked`'s `status !== "failed"` arm
 * blocks the key at the very next tick. **One row per key per WATERMARK MOVE**
 * — a process start or any channel PATCH, ruling Q2 — not per restart; this
 * count is never reached on that path.
 *
 * One carve-out, and it is where the two retries meet: if the hourly ceiling
 * refuses the released step, `F3.48` ruling Q1 writes no row at all, so the key
 * is NOT blocked again and the step is re-offered every tick until the ceiling
 * lifts. Nothing is written and nothing is sent, so the ledger does not grow —
 * the cost is two reads per tick per such key, which `F3.53` owns.
 */
export const MAX_EVENT_ATTEMPTS = 3;

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
   * every attempt — including every skip. That is the raise path's rule and it
   * is unchanged; the event path has three exceptions, and `dispatchToChannel`
   * steps 0 and 2 carry them (D3, H1, and `F3.48` ruling Q1).
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
  async dispatch(input: DispatchInput): Promise<DeliveryResult[]> {
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
   */
  async dispatchToChannels(
    channels: readonly NotificationChannelRow[],
    input: DispatchInput,
  ): Promise<DeliveryResult[]> {
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
    const results: DeliveryResult[] = [];
    for (const channel of kept) {
      const result = await this.dispatchToChannel(input, channel, dedupeKey);
      results.push(result);
    }
    return results;
  }

  private async dispatchToChannel(
    input: DispatchInput,
    channel: NotificationChannelRow,
    dedupeKey: string,
  ): Promise<DeliveryResult> {
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
      // `CREDENTIAL_ENCRYPTION_KEY`, which no row records). One expression at
      // its one call site: a `watermarkFor()` helper would only invite a test
      // that passes while this line is never reached.
      //
      // Outside the `try` below on purpose, and security review asked. The
      // "never rejects" invariant is about `dispatch()`, the fire-and-forget
      // raise path — which cannot reach this line at all, because it is inside
      // `input.event !== undefined`. Both callers that CAN reach it wrap their
      // dispatch in a `try` of their own (`notifyCleared`, and the escalation
      // phase's per-step catch from security review M1). Moving it inside the
      // ledger-read `try` would buy nothing and would report a `TypeError`
      // here as "delivery ledger read failed", which is a lie.
      const unconfiguredSince = new Date(
        Math.max(channel.updatedAt.getTime(), PROCESS_STARTED_AT.getTime()),
      );
      let alreadyRecorded: boolean;
      try {
        alreadyRecorded = await this.eventDeliveryBlocked(
          channel.id,
          input.organizationId,
          dedupeKey,
          unconfiguredSince,
        );
      } catch (err) {
        // Plan D3: no row and no send. Writing a row would poison this key for
        // every later tick — the read above would then answer "already sent"
        // from a row that records nothing was sent — and sending would risk
        // the duplicate the read exists to prevent. The next tick retries.
        // This is the opposite of the raise path's fallback in step 1, on
        // purpose: there, the write is bounded and a duplicate row is the
        // cost; here, the write would be permanent and silence is the cost.
        // §9.6: codes and a reason, never the alarm text or a recipient.
        this.logger.warn(
          `delivery ledger read failed for channel=${channel.code} rule=${input.ruleCode}: ${reasonOf(err)}`,
        );
        return { status: "failed", error: "delivery ledger read failed" };
      }
      if (alreadyRecorded) {
        return { status: "skipped_deduped", error: null };
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
        alreadyRecorded = await this.hasRecordedSkip(channel.id, input.organizationId, dedupeKey);
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
      return alreadyRecorded ? skip : this.record(input, channel, dedupeKey, skip);
    }

    // 2. The per-channel hourly ceiling.
    let overLimit: boolean;
    try {
      overLimit = await this.isOverHourlyLimit(channel.id, input.organizationId);
    } catch (err) {
      // A ceiling that cannot be read is not a licence to send without one.
      this.logger.warn(`rate-limit check failed for channel=${channel.code}: ${reasonOf(err)}`);
      const failed: DeliveryResult = { status: "failed", error: "rate-limit check failed" };
      // Review H1: on the event path this row is NOT written, for step 0's
      // reason. An event's key is for the life of the ledger, and a `failed`
      // row here records a read that never reached the transport — it would
      // spend one of the key's `MAX_EVENT_ATTEMPTS` (Q9), and before Q9 it
      // blocked the key for ever. The raise path keeps its row: that write is
      // bounded by the transition, and the next raise is a new alarm with a
      // new key. The next tick retries the event.
      return input.event !== undefined ? failed : this.record(input, channel, dedupeKey, failed);
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
      // The raise path keeps its row too: a raise key is per transition and the
      // next raise is a new alarm with a new key, so the growth is bounded.
      const retriable = input.event?.kind === "escalation";
      return retriable ? limited : this.record(input, channel, dedupeKey, limited);
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
   */
  private async isOverHourlyLimit(channelId: string, organizationId: string): Promise<boolean> {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const rows = await this.fleetDb
      .select({ count: sql<number>`count(*)::int` })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.channelId, channelId),
          eq(notificationDeliveries.organizationId, organizationId),
          eq(notificationDeliveries.status, "sent"),
          gte(notificationDeliveries.attemptedAt, since),
        ),
      );
    return (rows[0]?.count ?? 0) >= this.config.ratePerHour;
  }

  /**
   * `F3.46`: `true` when this channel, for THIS organization, already holds a
   * `skipped_deduped` row under this key — the refusal has been answered once
   * and is not recorded again.
   *
   * Same connection and the same reason as `isOverHourlyLimit`: a
   * fire-and-forget read with no tenant transaction to run under, so the
   * organization filter is the `WHERE` clause, not the connection.
   *
   * The `channel_id` equality is served today by the leading column of
   * `notification_deliveries_channel_time_idx`, and the other three predicates
   * filter that channel's own rows. After this change a channel's ledger holds
   * at most one skip row per `(organization, rule, severity)` plus one row per
   * real transition, so the read stays cheap; the partial index on
   * `(channel_id, dedupe_key)` turns it into a single probe once a channel's
   * history reaches the tens of thousands.
   *
   * Concurrency is a growth bound, not an invariant: two sweeps in flight can
   * both read "no row" and both write, which costs one extra row per key per
   * overlapping sweep. There is deliberately no unique index — the ledger is
   * history and stays append-only.
   *
   * The partial index — `0065`'s `WHERE status = 'skipped_deduped'`, replaced
   * by `0066`'s wider `(channel_id, dedupe_key) WHERE dedupe_key IS NOT NULL`
   * — is usable only while the filters reach the planner as folded constants:
   * an unnamed statement, as drizzle sends today. A `.prepare()` here can
   * switch Postgres to a generic plan, the `$n` stays a parameter, the
   * predicate no longer proves the index's `WHERE`, and the read silently
   * falls back to walking the channel's ledger. Keep it unprepared.
   */
  private async hasRecordedSkip(
    channelId: string,
    organizationId: string,
    dedupeKey: string,
  ): Promise<boolean> {
    const rows = await this.fleetDb
      .select({ id: notificationDeliveries.id })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.channelId, channelId),
          eq(notificationDeliveries.organizationId, organizationId),
          eq(notificationDeliveries.dedupeKey, dedupeKey),
          eq(notificationDeliveries.status, "skipped_deduped"),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * `F3.10`: `true` when this channel, for THIS organization, has already
   * answered this event's key — the event (an escalation step, a cleared
   * message) is not sent again (ADR 0057 decision 10; owner rulings Q7, Q9).
   *
   * **Which rows consume the key.** A `sent` or `skipped_deduped` row consumes
   * it for the life of the ledger: the event was delivered, or a decision was
   * taken not to deliver it, and a decision is not retried. A `failed` row is a
   * transport that threw or refused, which is not a decision, so the event is
   * retried on the next tick — up to `MAX_EVENT_ATTEMPTS` such rows, after
   * which the key is blocked as if it had been answered (Q9). Two statuses sit
   * between those, each excluded in the `WHERE` below and each for its own
   * reason: `skipped_rate_limited` never blocks (`F3.48` ruling Q2), and
   * `skipped_unconfigured` blocks only while it is newer than the
   * configuration that produced it (`F3.50` ruling Q1).
   *
   * **`skipped_rate_limited` is excluded in the `WHERE`, not here** (`F3.48`
   * ruling Q2, ADR 0057 Amendment 2). It was a blocking status under ruling Q7
   * and is not one now: the ceiling is a rolling hour that lifts by itself, so
   * refusing a step is a postponement rather than a decision. Ruling Q1 stops
   * new such rows being written on the escalation path; excluding the status
   * here releases the ones written before `F3.48` landed.
   *
   * **`skipped_unconfigured` is excluded conditionally** (`F3.50` ruling Q1,
   * ADR 0057 Amendment 3), and the difference from `skipped_rate_limited` is
   * the whole of that row. A ceiling refusal is a self-clearing postponement,
   * so `F3.48` could stop writing it. An unconfigured channel is a
   * **configuration fault an operator must see and fix**, so the row keeps
   * being written and the ledger keeps saying so — it simply stops ANSWERING
   * once it predates `unconfiguredSince`, the later of the channel's
   * `updated_at` and `PROCESS_STARTED_AT`. The `caller` computes that; this
   * read only applies it.
   *
   * **The growth that leaves is one row per key per watermark move** — a
   * process start or any channel PATCH (ruling Q2), not one per restart. A
   * released key is re-offered on the next tick; if the channel is still
   * unconfigured, that tick writes ONE fresh row — which is newer than the
   * watermark, so the second arm below (`status !== "failed"`) blocks the key
   * immediately. The count arm is never reached on this path, and three
   * *fresh* unconfigured rows under one key is not a reachable state.
   *
   * **Unless the hourly ceiling refuses the retry**, in which case `F3.48`
   * ruling Q1 writes nothing and the key stays released, re-offered every tick
   * until the ceiling lifts. That costs two reads a tick and grows the ledger
   * not at all.
   *
   * The exclusion has to be in the SQL for the next paragraph to stay true.
   * The read asks for at most `MAX_EVENT_ATTEMPTS` rows' `status`: fewer than
   * that and every blocking-eligible row under the key was seen, so "any
   * non-`failed`" is exact; that many and the key is blocked whatever they
   * hold, so no order is needed. Filtering the sampled rows in TypeScript
   * instead would break exactly that — an unordered sample of
   * `MAX_EVENT_ATTEMPTS` rows could come back all rate-limited and leave both
   * arms false for a key Q9 blocks.
   *
   * `F3.50` makes that argument load-bearing rather than precautionary.
   * Amendment 2 §3 had to concede its mixed state was unreachable in
   * production; this one is reachable, because one stale unconfigured row
   * accumulates per restart. A key can legitimately hold one `sent` row and
   * three stale `skipped_unconfigured` ones, and a TypeScript filter over an
   * unordered sample of three could then return the three unconfigured rows,
   * empty itself, leave both arms false — and **send an event that was already
   * sent**.
   *
   * Same connection and the same reason as `isOverHourlyLimit`: a read with no
   * tenant transaction to run under — the sweep spans every tenant with no
   * JWT — so the organization filter is the `WHERE` clause, not the
   * connection. Projection `{ status }`, on purpose distinct from
   * `hasRecordedSkip`'s `{ id }`: the unit spec's fake tells the two reads
   * apart by nothing else.
   *
   * Served today by the leading column of
   * `notification_deliveries_channel_time_idx`; migration `0066` adds the
   * `(channel_id, dedupe_key) WHERE dedupe_key IS NOT NULL` probe (plan Q3).
   * No unique index: one loop, sweep-then-sleep, so two ticks never overlap.
   */
  private async eventDeliveryBlocked(
    channelId: string,
    organizationId: string,
    dedupeKey: string,
    unconfiguredSince: Date,
  ): Promise<boolean> {
    const rows = await this.fleetDb
      .select({ status: notificationDeliveries.status })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.channelId, channelId),
          eq(notificationDeliveries.organizationId, organizationId),
          eq(notificationDeliveries.dedupeKey, dedupeKey),
          // `F3.48` ruling Q2: a `skipped_rate_limited` row no longer blocks —
          // Q1 stops new ones being written, and this releases the ones already
          // there, including every key blocked before `F3.48` landed.
          //
          // Excluded HERE and not from `rows` below, and that is load-bearing:
          // the read takes `MAX_EVENT_ATTEMPTS` rows with no `ORDER BY`, and
          // the comment above gives order-independence as the reason that is
          // sound. Drawing the sample from the blocking-eligible rows only
          // keeps both arms exact; a filter over an unordered sample would not.
          // `status` is NOT NULL, so `<>` drops nothing else, and
          // `notification_deliveries_channel_key_idx` still serves the read
          // with the status as a residual filter — no DDL. That plan was
          // measured, not assumed; ADR 0057 Amendment 2 §3 records it.
          ne(notificationDeliveries.status, "skipped_rate_limited"),
          // `F3.50` ruling Q1: a `skipped_unconfigured` row answers this key
          // only while it is NEWER than the configuration that produced it.
          // Beside the exclusion above rather than folded into it, because the
          // two statuses leave for different reasons and on different terms: a
          // rate-limited row never blocks again, an unconfigured one blocks
          // until the operator moves the watermark past it.
          //
          // `or(ne, gt)` and not the literal `not(and(eq, lte))`. They are the
          // same predicate — `status` and `attempted_at` are both `NOT NULL` —
          // but the literal form renders `"status" = $n`, and
          // `notifications.events.spec.ts` case 14 asserts that no equality on
          // `status` appears here, because one would block every key that is
          // not the named status. The twin costs nothing and leaves that
          // assertion standing as a free gate on this clause too.
          //
          // **Scoped to this one status, never hoisted into the `and` above.**
          // A watermark over the whole read would drop a `failed` row older
          // than it out of the sample, and ruling Q9's three-attempt cap would
          // silently reset on every channel edit.
          or(
            ne(notificationDeliveries.status, "skipped_unconfigured"),
            gt(notificationDeliveries.attemptedAt, unconfiguredSince),
          ),
        ),
      )
      .limit(MAX_EVENT_ATTEMPTS);
    return rows.length >= MAX_EVENT_ATTEMPTS || rows.some((row) => row.status !== "failed");
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
   * rule: the reader adds the index), and the plan records it.
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
   * here: there is no alarm and nothing transitioned.
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
      overLimit = await this.isOverHourlyLimit(channel.id, organizationId);
    } catch (err) {
      this.logger.warn(`rate-limit check failed for channel=${channel.code}: ${reasonOf(err)}`);
      return this.record({ ruleId: null, alarmId: null, organizationId }, channel, null, {
        status: "failed",
        error: "rate-limit check failed",
      });
    }
    if (overLimit) {
      return this.record({ ruleId: null, alarmId: null, organizationId }, channel, null, {
        status: "skipped_rate_limited",
        error: null,
      });
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
    return this.record({ ruleId: null, alarmId: null, organizationId }, channel, null, result);
  }

  /** Writes the ledger row and returns the result unchanged. */
  private async record(
    input: { ruleId: string | null; alarmId: string | null; organizationId: string },
    channel: NotificationChannelRow,
    dedupeKey: string | null,
    result: DeliveryResult,
  ): Promise<DeliveryResult> {
    try {
      await this.fleetDb.insert(notificationDeliveries).values({
        organizationId: input.organizationId,
        ruleId: input.ruleId,
        alarmId: input.alarmId,
        channelId: channel.id,
        status: result.status,
        dedupeKey,
        error: result.error === null ? null : truncate(result.error),
      });
    } catch (err) {
      // The send may already have happened; losing the row is bad but failing
      // the caller is worse. Say so loudly and carry on.
      this.logger.error(
        `delivery row not written for channel=${channel.code} status=${result.status}: ${reasonOf(err)}`,
      );
    }
    return result;
  }

}

/**
 * The subject line, by event (plan D14): a raise is `severity: RULE`, a step
 * is `escalation n · severity: RULE`, a clear is `cleared · severity: RULE`.
 * String composition, no template — the body stays the caller's message.
 */
function subjectFor(input: DispatchInput): string {
  const base = `${input.severity ?? "alarm"}: ${input.ruleCode}`;
  if (input.event === undefined) return base;
  return input.event.kind === "escalation"
    ? `escalation ${input.event.step} · ${base}`
    : `cleared · ${base}`;
}

function reasonOf(err: unknown): string {
  return truncate(err instanceof Error ? err.message : String(err));
}

function truncate(text: string): string {
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH)}…` : text;
}
