import { z } from "zod";

/**
 * `F3.8` notification contracts (ADR 0041) — channels, deliveries, readiness,
 * and the result of a send test.
 *
 * **`kind` is `z.string()` and `status` is a `z.enum`.** That asymmetry is the
 * same one migration `0038_notification_channels.sql` argues in SQL, carried
 * into the contract on purpose. The kind vocabulary is a table
 * (`bms.notification_channel_kinds`) because it is open — `F3.9` adds `sms` as
 * a row, with no migration and no redeploy — and a `z.enum` here would reject
 * the new kind at the API boundary the moment somebody inserts it, which is
 * F4.43 again. The delivery status set is closed and owned by
 * `NotificationService`: it is enforced by a CHECK in the database and by this
 * enum at the edge, and a status outside it is a bug rather than an extension.
 *
 * **A channel response carries `hasSecret`, never the secret.** Not the
 * plaintext, not the ciphertext, not the key version. AGENTS.md §9.6 and ADR
 * 0041 decision 8: the UI needs to render "secret set" or "no secret set", and
 * a boolean answers that completely. Anything more is a credential on a path
 * that is logged.
 */

/**
 * The six outcomes of one dispatch attempt.
 *
 * Four of them are skips, and they are separate values rather than one
 * `skipped` because they answer different operator questions: nothing is
 * configured, the same transition already notified, the channel is over its
 * hourly ceiling, or the step was abandoned as too late to send (ADR 0041
 * decisions 4 and 7, and Amendment 6 ruling 5). Collapsing them would make the
 * deliveries view say "skipped" and leave the operator to guess why.
 *
 * **What `skipped_stale` answers that no other value can.** The step was due,
 * nobody was told, and the reason is *age* — the step is further past its due
 * instant than the step-lateness budget Amendment 6 ruling 6 sets
 * (`STEP_MAX_LATENESS` there, 60 minutes by default) — rather than
 * configuration (`skipped_unconfigured`), an
 * earlier notification of the same transition (`skipped_deduped`) or the hourly
 * ceiling (`skipped_rate_limited`). Those three all describe a step that may yet
 * be sent; this one is the record that it never will be. `failed` would say the
 * transport was tried and refused, which is not what happened.
 *
 * Keep this list identical to `notification_deliveries_status_check` as the
 * NEWEST migration to declare it leaves it — migration `0038` created it with
 * five values and `0068` widened it to these six; `0038` is frozen, so it is no
 * longer the list to read. The database refuses a seventh value; this refuses it
 * one layer earlier, with a message a client can read.
 * `tests/adr-0041-notification-invariants.test.ts` compares the two.
 */
export const notificationDeliveryStatusSchema = z.enum([
  "sent",
  "failed",
  "skipped_unconfigured",
  "skipped_deduped",
  "skipped_rate_limited",
  "skipped_stale",
]);

/** One configured destination. */
export const notificationChannelDtoSchema = z.object({
  id: z.string(),
  /**
   * `E7.1c` (ADR 0043 Amendment 5, decision 7). `null` names a fleet-managed
   * global channel — a legitimate, ongoing state, not a pre-migration
   * artifact: an `admin` who omits `organizationId` on create still gets one.
   * Non-null on an org-scoped channel, since migration `0048`.
   */
  organizationId: z.string().nullable(),
  code: z.string(),
  name: z.string(),
  // A code from `bms.notification_channel_kinds`, not a union — see the file
  // comment. The set of kinds the API can actually dispatch is a separate
  // question, answered by the readiness route rather than by this type.
  kind: z.string(),
  config: z.record(z.unknown()),
  enabled: z.boolean(),
  /** Whether a secret is stored. Never the secret itself, in any form. */
  hasSecret: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * One row of the delivery ledger.
 *
 * `ruleId`, `ruleCode` and `alarmId` are all nullable: a send test has no rule
 * and no alarm, and a `skipped_unconfigured` row can predate any alarm.
 * `channelCode` is joined in because the deliveries view lists attempts across
 * channels and a uuid names nothing to a reader.
 */
export const notificationDeliveryDtoSchema = z.object({
  id: z.string(),
  /**
   * Non-null. `bms.notification_deliveries.organization_id` gained
   * `SET NOT NULL` in migration `0048` (ADR 0043 Amendment 5, item C): a
   * dispatch stamps its rule's org, a send test stamps its channel's org (and
   * refuses outright on a `NULL`-org channel — Blocker 1's ruling) — there is
   * no delivery row left that carries no organization.
   */
  organizationId: z.string(),
  ruleId: z.string().nullable(),
  ruleCode: z.string().nullable(),
  alarmId: z.string().nullable(),
  channelId: z.string(),
  channelCode: z.string(),
  status: notificationDeliveryStatusSchema,
  attemptedAt: z.string(),
  error: z.string().nullable(),
});

/**
 * Whether a transport can send at all, per kind.
 *
 * This exists because "no email arrived" has two causes that look identical
 * from the outside: nothing matched, or `SMTP_HOST` was never set. ADR 0041
 * decision 11 gives Mailpit its own compose profile and deliberately no
 * `SMTP_HOST` default, so an unconfigured deployment is the normal state and
 * must announce itself rather than fail silently.
 *
 * `detail` is operator-facing prose — "SMTP_HOST is not set" — and must never
 * carry a credential or a full connection string (§9.6).
 */
export const notificationReadinessDtoSchema = z.object({
  kind: z.string(),
  configured: z.boolean(),
  detail: z.string(),
});

/**
 * What `POST /notifications/channels/:id/test` answers.
 *
 * A test is a real dispatch through the real transport, so it returns a real
 * delivery outcome — including a skip. `deliveryId` is nullable because a
 * refusal raised before the ledger write has no row to point at.
 */
export const notificationTestResultSchema = z.object({
  channelId: z.string(),
  channelCode: z.string(),
  status: notificationDeliveryStatusSchema,
  deliveryId: z.string().nullable(),
  error: z.string().nullable(),
});
