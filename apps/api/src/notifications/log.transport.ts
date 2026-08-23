import { Injectable, Logger } from "@nestjs/common";

import type {
  DeliveryResult,
  NotificationMessage,
  NotificationTransport,
} from "./notification-transport";

/**
 * The stand-in transport (ADR 0041 decisions 2 and 5).
 *
 * Used when the transport a channel's kind needs is not configured — no
 * `SMTP_HOST` for an email channel, or a webhook secret that
 * `CREDENTIAL_ENCRYPTION_KEY` cannot read. It writes one structured line and
 * returns `skipped_unconfigured`, so the delivery ledger records that the
 * notification did not go out and the readiness route can explain why.
 *
 * **It reports a skip, not a send, and that is the point.** Returning `sent`
 * for a log line would make the deliveries view claim somebody was told when
 * nobody was — which is precisely the question ADR 0041 decision 4 built the
 * ledger to answer.
 *
 * **What it logs.** The channel code, the rule, the alarm and the severity —
 * enough to find the event. Never `channel.config`, never `channel.secret`,
 * never a recipient address, never `subject` or `body` (§9.6). `config` holds
 * the recipient list for an email channel and the URL for a webhook, so
 * passing it to a logger would put operator addresses and endpoints in the log
 * by default. The rule this module follows is simpler than redaction: nothing
 * from `config` reaches a logger at all.
 */
@Injectable()
export class LogTransport implements NotificationTransport {
  /**
   * Deliberately not a code in `bms.notification_channel_kinds`. No operator
   * configures a "log channel" — this stands in for a kind that cannot send,
   * so a row in that vocabulary would offer it as a destination.
   */
  readonly kind = "log";

  private readonly logger = new Logger(LogTransport.name);

  send(message: NotificationMessage): Promise<DeliveryResult> {
    // One line, string-formatted, like every other logger call in `apps/api`.
    // Each field is named so the line is greppable, and every field here is
    // an identifier — a code, a uuid, a severity — never content.
    this.logger.warn(
      `notification not sent: no transport configured for kind=${message.channel.kind} ` +
        `channel=${message.channel.code} rule=${message.ruleCode ?? "-"} ` +
        `alarm=${message.alarmId ?? "-"} severity=${message.severity ?? "-"}`,
    );
    return Promise.resolve({ status: "skipped_unconfigured", error: null });
  }
}
