import { z } from "zod";

/**
 * `F3.8` request bodies (ADR 0041, ADR 0029 decision 1).
 *
 * These are the objects the handlers `.parse()`, and the same objects
 * `openapi-registry.ts` points at — one description of each payload, not two.
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
 */
const channelSecretSchema = z.string().min(8).max(512).nullable();

export const createNotificationChannelBodySchema = z
  .object({
    /**
     * `E7.1c` (ADR 0043 Amendment 5, Blocker 1 ruling). **Optional, on purpose:**
     * an `admin` who omits it still gets a fleet-managed global channel — exactly
     * today's behaviour — so the web UI needs no change and `E7.1d` (the admin UI
     * split) stays out of this slice. Supplied, or implied for an
     * `organization_admin` with exactly one direct grant, it creates an
     * org-scoped channel instead. `ChannelsService.create` resolves and gates it.
     */
    organizationId: z.string().uuid().optional(),
    code: z
      .string()
      .min(1)
      .max(64)
      // Stable identifier, so the same restriction the rest of the repo's codes
      // use: it appears in logs and in delivery rows, where a space or a slash
      // would be read as a delimiter.
      .regex(/^[a-z0-9][a-z0-9-]*$/, "code must be lowercase letters, digits and hyphens"),
    name: z.string().min(1).max(128),
    kind: channelKindSchema,
    config: channelConfigSchema.default({}),
    secret: channelSecretSchema.optional(),
    enabled: z.boolean().default(true),
  })
  .strict();

export const updateNotificationChannelBodySchema = z
  .object({
    name: z.string().min(1).max(128).optional(),
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

export const listDeliveriesQuerySchema = z.object({
  // The same bounded-list shape `listRuleExecutions` uses (ADR 0041 decision
  // 4): a limit, no cursor. The deliveries view is recent history, not an
  // infinite scroll.
  limit: z.coerce.number().int().min(1).max(500).default(100),
  channelId: z.string().uuid().optional(),
  ruleId: z.string().uuid().optional(),
});

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

export type CreateNotificationChannelBody = z.infer<
  typeof createNotificationChannelBodySchema
>;
export type UpdateNotificationChannelBody = z.infer<
  typeof updateNotificationChannelBodySchema
>;
export type ListDeliveriesQuery = z.infer<typeof listDeliveriesQuerySchema>;
export type SetRuleNotificationsBody = z.infer<typeof setRuleNotificationsBodySchema>;
