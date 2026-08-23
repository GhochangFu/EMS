import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, gte, sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";
import { notificationDeliveries } from "@bms/db";

import { DRIZZLE } from "../database/database.tokens";
import { ChannelsService } from "./channels.service";
import { buildDedupeKey } from "./dedupe-key";
import { EmailTransport } from "./email.transport";
import { LogTransport } from "./log.transport";
import type {
  DeliveryResult,
  NotificationChannelRow,
  NotificationTransport,
} from "./notification-transport";
import { NOTIFICATIONS_CONFIG, type NotificationsConfig } from "./notifications.config";
import { WebhookTransport } from "./webhook.transport";

/**
 * `F3.8` — the one entry point that turns a raised alarm into deliveries
 * (ADR 0041).
 *
 * **There is exactly one public method.** The caller loop — over the rules a
 * sweep evaluated — belongs to `F3.7`, not here. A second entry point taking a
 * list would be a second place for the dedupe to be forgotten, and the dedupe
 * is the whole storm control.
 *
 * **`dispatch` never rejects** (decision 1). It is called fire-and-forget from
 * the alarm raise path, so a rejection would surface as an unhandled promise
 * rather than in front of anyone. Every failure becomes a `failed` delivery row
 * with a bounded `error`, and the promise resolves.
 */

/** What a caller knows at the moment a rule raised (or did not raise) an alarm. */
export type DispatchInput = {
  ruleId: string;
  ruleCode: string;
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
};

/** How much of a transport's failure text is stored. */
const MAX_ERROR_LENGTH = 1_000;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: BmsDb,
    private readonly channels: ChannelsService,
    private readonly logTransport: LogTransport,
    private readonly emailTransport: EmailTransport,
    private readonly webhookTransport: WebhookTransport,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: NotificationsConfig,
  ) {}

  /**
   * Sends one alarm to every channel joined to its rule, and records a row for
   * every attempt — including every skip.
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

    const dedupeKey = buildDedupeKey(input);
    const results: DeliveryResult[] = [];

    for (const channel of channels) {
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
    // 1. The transition dedupe. The skip is still RECORDED: "we chose not to
    //    send" and "nothing happened" must not look the same in the ledger
    //    (decision 4).
    if (!input.raised) {
      return this.record(input, channel, dedupeKey, {
        status: "skipped_deduped",
        error: null,
      });
    }

    // 2. The per-channel hourly ceiling.
    let overLimit: boolean;
    try {
      overLimit = await this.isOverHourlyLimit(channel.id);
    } catch (err) {
      // A ceiling that cannot be read is not a licence to send without one.
      this.logger.warn(`rate-limit check failed for channel=${channel.code}: ${reasonOf(err)}`);
      return this.record(input, channel, dedupeKey, {
        status: "failed",
        error: "rate-limit check failed",
      });
    }
    if (overLimit) {
      return this.record(input, channel, dedupeKey, {
        status: "skipped_rate_limited",
        error: null,
      });
    }

    // 3. Send. A transport that rejects is a `failed` delivery, never a
    //    rejection out of `dispatch` (decision 1).
    const transport = this.transportFor(channel.kind);
    let result: DeliveryResult;
    try {
      result = await transport.send({
        subject: `${input.severity ?? "alarm"}: ${input.ruleCode}`,
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
   * in the last hour.
   *
   * Counts `sent` only, deliberately. Counting skips would let the ceiling fill
   * with its own refusals: one noisy hour would lock the channel out for the
   * next, and the rate limiter would be the thing keeping it locked.
   */
  private async isOverHourlyLimit(channelId: string): Promise<boolean> {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const rows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.channelId, channelId),
          eq(notificationDeliveries.status, "sent"),
          gte(notificationDeliveries.attemptedAt, since),
        ),
      );
    return (rows[0]?.count ?? 0) >= this.config.ratePerHour;
  }

  /** Writes the ledger row and returns the result unchanged. */
  private async record(
    input: DispatchInput,
    channel: NotificationChannelRow,
    dedupeKey: string,
    result: DeliveryResult,
  ): Promise<DeliveryResult> {
    try {
      await this.db.insert(notificationDeliveries).values({
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

function reasonOf(err: unknown): string {
  return truncate(err instanceof Error ? err.message : String(err));
}

function truncate(text: string): string {
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH)}…` : text;
}
