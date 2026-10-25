import { z } from "zod";

/**
 * `F4.279` (ADR 0099 Amendment 8, ADR 0030) — the request bodies of the
 * notification-channel write routes (`apps/api/src/notifications/notifications.controller.ts`
 * and `PUT /rules/:id/notifications` in `rules.controller.ts`), moved here from
 * `apps/api/src/notifications/notifications.schema.ts` so the copilot catalog
 * entries carry the route's own body by identity. `notifications.schema.ts`
 * keeps the deliveries query.
 *
 * `F3.8` (ADR 0041, ADR 0029 decision 1): these are the objects the handlers
 * `.parse()`, and the same objects `openapi-registry.ts` points at — one
 * description of each payload, not two.
 *
 * Plain `z.object`s from shared `shape` constants (the `rule-writes.ts`
 * pattern): no `.merge()`, no `.omit().extend()` — `tests/adr-0030-contract-derivation.test.ts`
 * scans for both — and no `.readonly()`, since nothing here is all-readonly.
 */

/**
 * The channel kind is validated as a non-empty string, **not** an enum.
 *
 * `bms.notification_channel_kinds` is the authority and it is open by design
 * (ADR 0041 decision 3): `F3.9` adds `sms` as a row. The foreign key refuses an
 * undeclared kind at write time with a clear database error, so an enum here
 * would only add a second list to keep in step — and it would reject the new
 * kind before the row that declares it ever mattered.
 */
const channelKindSchema = z.string().min(1).max(64);

/**
 * The webhook URL is a string here, and that is deliberate rather than lax.
 *
 * The real check is `assertWebhookTargetAllowed` at send time (decision 6),
 * because DNS can change between the write and the send: a hostname that
 * resolves publicly today can resolve into the Compose network tomorrow, and a
 * write-time verdict would be stale the moment it was stored. Validating the
 * shape twice would imply the write-time answer is binding. It is not.
 */
const channelConfigSchema = z.record(z.unknown());

/**
 * The secret, when present, is the webhook HMAC key.
 *
 * `null` clears the stored one; omitting the field on a PATCH keeps it. Those
 * are three different intentions and the schema keeps them distinct — a single
 * optional string would make "clear it" unexpressible.
 *
 * Exported for the copilot's Confirm card (`F4.279` Q11), which types the secret
 * with the route's own rule.
 */
export const channelSecretSchema = z.string().min(8).max(512).nullable();

/** Stable identifier, so the same restriction the rest of the repo's codes use. */
const channelCodeSchema = z
  .string()
  .min(1)
  .max(64)
  // It appears in logs and in delivery rows, where a space or a slash would be
  // read as a delimiter.
  .regex(/^[a-z0-9][a-z0-9-]*$/, "code must be lowercase letters, digits and hyphens");

const channelNameSchema = z.string().min(1).max(128);

export const createNotificationChannelBodySchema = z
  .object({
    /**
     * `E7.1c` (ADR 0043 Amendment 5, Blocker 1 ruling). **Optional, on purpose:**
     * an `admin` who omits it still gets a fleet-managed global channel — exactly
     * today's behaviour — so the web UI needs no change and `E7.1d` (the admin UI
     * split) stays out of this slice. Supplied, or implied for an
     * `organization_admin` with exactly one direct grant, it creates an
     * org-scoped channel instead. `ChannelWritesService.create` resolves and gates it.
     */
    organizationId: z.string().uuid().optional(),
    code: channelCodeSchema,
    name: channelNameSchema,
    kind: channelKindSchema,
    config: channelConfigSchema.default({}),
    secret: channelSecretSchema.optional(),
    enabled: z.boolean().default(true),
  })
  .strict();

export const updateNotificationChannelBodySchema = z
  .object({
    name: channelNameSchema.optional(),
    kind: channelKindSchema.optional(),
    config: channelConfigSchema.optional(),
    secret: channelSecretSchema.optional(),
    enabled: z.boolean().optional(),
  })
  // `.strict()` must precede `.refine` — a `ZodEffects` has no `.strict()`.
  // Nothing may separate `.refine(...)` from its `.describe(...)` below.
  .strict()
  // An empty PATCH is a mistake, not a no-op: it reads as "I changed
  // something" and changes nothing, which is the shape of a lost edit.
  .refine((body) => Object.keys(body).length > 0, {
    message: "a PATCH must change at least one field",
  })
  // AFTER the refinement, deliberately: zod-to-json-schema emits nothing for a
  // refine, so without this the document would describe an empty body as valid
  // while the API answers 400 (ADR 0029 Amendment 1). Placed before the refine,
  // the description lands on the inner object and is discarded.
  .describe(
    "Partial update of a notification channel. At least one field must be present; " +
      "an empty body is rejected. Omitting `secret` keeps the stored one, `null` clears it.",
  );

/**
 * `PUT /rules/:id/notifications` — plan D1.
 *
 * The whole set, not a delta. A join is a set, and "these are the channels"
 * survives a lost request in a way "add this one" does not.
 */
export const setRuleNotificationsBodySchema = z
  .object({
    channelIds: z.array(z.string().uuid()).max(50),
  })
  .strict();

/**
 * `F4.279` Q12 — the rule the Confirm card checks a typed webhook URL with.
 * The model never proposes a URL; the binding check stays the send-time
 * `assertWebhookTargetAllowed` (see `channelConfigSchema` above).
 */
export const copilotWebhookUrlSchema = z.string().url().max(2048);

/**
 * `F4.279` Q6, Q12 — the channel `config` the copilot proposes: an email
 * recipient list and nothing else. A webhook URL is a nested `clientOnly`
 * path (`config.url`), typed on the card.
 */
export const copilotNotificationChannelConfigSchema = z
  .object({
    to: z.array(z.string().email()).min(1).max(50).optional(),
  })
  .strict();

/** The two kinds the copilot proposes (Q6). */
const copilotChannelKindSchema = z.enum(["email", "webhook"]);

/**
 * `F4.279` Q11–Q13 — the copilot's model body for `notificationChannel.create`:
 * `organizationId` required (fleet-wide channels stay on the page), the kind
 * narrowed to email or webhook, and no `secret` (typed on the card).
 */
export const copilotCreateNotificationChannelModelBodySchema = z
  .object({
    organizationId: z.string().uuid(),
    code: channelCodeSchema,
    name: channelNameSchema,
    kind: copilotChannelKindSchema,
    config: copilotNotificationChannelConfigSchema.default({}),
    enabled: z.boolean().default(true),
  })
  .strict();

/**
 * `F4.279` — the copilot's model body for `notificationChannel.update`. No
 * `secret` (Q11) and no `enabled`: the deactivate and reactivate entries own
 * the direction (Q5, the `assetRole.update` rule). A `kind` comes with its
 * `config`: the PATCH keeps a stored `config` it is not sent, so a kind change
 * alone would leave an email list on a webhook, and the card would show no URL box.
 */
export const copilotUpdateNotificationChannelModelBodySchema = z
  .object({
    name: channelNameSchema.optional(),
    kind: copilotChannelKindSchema.optional(),
    config: copilotNotificationChannelConfigSchema.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "a PATCH must change at least one field",
  })
  .describe("At least one field must be present.")
  .refine((body) => body.kind === undefined || body.config !== undefined, {
    message: "a kind change must send its config ({} for a webhook)",
    path: ["config"],
  })
  .describe(
    "Partial update of a notification channel. At least one field must be present; a `kind` must come with its `config`.",
  );

export type CreateNotificationChannelBody = z.infer<typeof createNotificationChannelBodySchema>;
export type UpdateNotificationChannelBody = z.infer<typeof updateNotificationChannelBodySchema>;
export type SetRuleNotificationsBody = z.infer<typeof setRuleNotificationsBodySchema>;

/**
 * `F4.279` (ADR 0099 Amendment 8 D5) — the card-only `recipients` a notification
 * proposal stores: each channel the change reaches, with every email address or
 * webhook URL in full. The Confirm card shows it; the model never sees it (the
 * model-facing summary carries names and counts only), the hash leaves it out
 * and the browser strips it before it sends the write. `channelId` is `null`
 * for a channel the change creates.
 */
export const notificationRecipientSchema = z
  .object({
    channelId: z.string().nullable(),
    name: z.string(),
    kind: z.string(),
    targets: z.array(z.string()),
    /**
     * A current join `setRuleChannels` keeps because it is outside the
     * caller's manage scope (`F3.7`): the change leaves it, and it still
     * receives the rule's alarms.
     */
    kept: z.literal(true).optional(),
  })
  .strict();

export const notificationRecipientsSchema = z.array(notificationRecipientSchema);

export type NotificationRecipient = z.infer<typeof notificationRecipientSchema>;

/** The text a webhook URL shows on the card before the user types it (Q12). */
export const WEBHOOK_URL_TYPED_ON_CONFIRM = "(typed on Confirm)";
