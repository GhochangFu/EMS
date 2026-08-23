import type { NotificationDeliveryStatus } from "@bms/shared";

/**
 * `F3.8` — what every transport implements, and the shapes it works on
 * (ADR 0041 decision 2).
 *
 * One interface, three implementations chosen by configuration: `LogTransport`
 * stands in when nothing is configured, `EmailTransport` sends SMTP,
 * `WebhookTransport` POSTs. Keeping the seam here is what makes decision 1's
 * "no queue yet" reversible: when `F4.24` lands, moving dispatch onto BullMQ
 * changes the caller, not any of these.
 */

/**
 * The five outcomes, taken from the response contract rather than restated.
 *
 * `packages/shared/src/contracts/notifications.ts` owns the list and
 * `notification_deliveries_status_check` enforces it in Postgres. A local
 * union here would be a third description of the same set — the exact drift
 * ADR 0030 exists to prevent — and it would compile happily while disagreeing
 * with the column.
 */
export type DeliveryStatus = NotificationDeliveryStatus;

export type DeliveryResult = { status: DeliveryStatus; error: string | null };

/**
 * A channel as the transports see it.
 *
 * **The secret is already decrypted here.** `ChannelsService.load()` (U7) is
 * the only place `CredentialCryptoService` is touched, so no transport handles
 * ciphertext, and no transport can throw because a key is missing. That
 * matters more than it looks: dispatch is fire-and-forget from the raise path
 * (decision 1), so a throw inside a transport would land in an unhandled
 * rejection rather than in front of an operator.
 */
export type NotificationChannelRow = {
  id: string;
  code: string;
  name: string;
  kind: string;
  config: Record<string, unknown>;
  secret: string | null;
  /**
   * `none` — no secret stored for this channel.
   * `ready` — stored and decrypted.
   * `unreadable` — stored, but `CREDENTIAL_ENCRYPTION_KEY` is unset or the
   *   wrong length, so `CredentialCryptoService` could not read it. The
   *   transport returns `skipped_unconfigured` for this state and never
   *   throws, which is the same treatment decision 5 gives an unset
   *   `SMTP_HOST`: a visible skip row and a readiness banner, not silence.
   */
  secretState: "none" | "ready" | "unreadable";
  enabled: boolean;
};

/**
 * One notification, already rendered.
 *
 * `body` and `subject` are operator-facing text about an alarm. They must
 * never be logged (§9.6) — a transport logs the channel code and the rule, not
 * what was said or who it was said to.
 */
export type NotificationMessage = {
  subject: string;
  body: string;
  ruleId: string | null;
  ruleCode: string | null;
  alarmId: string | null;
  severity: string | null;
  channel: NotificationChannelRow;
};

export interface NotificationTransport {
  /**
   * The channel kind this transport serves — a code from
   * `bms.notification_channel_kinds`, or `"log"` for the stand-in, which is
   * deliberately not in that vocabulary because no operator ever configures it.
   */
  readonly kind: string;
  /**
   * Never rejects. Every failure is a `DeliveryResult` with
   * `status: "failed"` and an `error` string, because the caller records the
   * result rather than handling an exception.
   */
  send(message: NotificationMessage): Promise<DeliveryResult>;
}
