import { z } from "zod";

import { mqttTopicHasWildcard } from "../mqtt-topic";

/**
 * `F4.221` — the sentence a `#` or `+` in `mqttTopic` answers with. Ingest refuses
 * such a topic and skips the RTU, so the admin routes refuse it for every RTU,
 * with the predicate ingest and onboarding share.
 */
export const RTU_WILDCARD_TOPIC_MESSAGE = "MQTT topic must name one device; # and + are wildcards";

export const rtuSourceTypeSchema = z.enum(["mqtt", "simulator", "catalog"]);

export const createRtuBodySchema = z
  .object({
    locationId: z.string().uuid(),
    code: z.string().min(2).max(64),
    displayName: z.string().min(2).max(255),
    sourceType: rtuSourceTypeSchema.default("catalog"),
    domain: z.string().max(64).optional(),
    externalRtuId: z.number().int().optional(),
    rtuCode: z.string().max(64).optional(),
    // F4.221: field-level refine, `.describe()` right after it, `.optional()` last.
    // tests/adr-0029-openapi-contract.test.ts (ADR 0029 decision 10) needs the
    // `.describe()` directly after the `.refine()`.
    mqttTopic: z
      .string()
      .max(255)
      .refine((topic) => !mqttTopicHasWildcard(topic), { message: RTU_WILDCARD_TOPIC_MESSAGE })
      .describe("One device's topic; # and + are refused (F4.221)")
      .optional(),
    stationCode: z.string().max(64).optional(),
    stationName: z.string().max(255).optional(),
    // F4.350 (ADR 0075 Amendment 3): seconds between the device's reports; the freshness window is
    // 2.5 x this, clamped to 25-900 s. `null` clears it (the window then follows the learned
    // interval); 86,400 (a day) is a sanity bound, the window's own cap being 900 s.
    expectedIntervalSeconds: z.number().int().min(1).max(86_400).nullable().optional(),
    ingestEnabled: z.boolean().optional(),
    meta: z.record(z.unknown()).optional(),
  })
  .strict();

export const updateRtuBodySchema = createRtuBodySchema.omit({ locationId: true }).partial();

export type CreateRtuBody = z.infer<typeof createRtuBodySchema>;
export type UpdateRtuBody = z.infer<typeof updateRtuBodySchema>;

/**
 * `F4.333` (ADR 0129 decision 2) — the longest credential value, in characters.
 * Declared once: the API's onboarding `MAX_RTU_CREDENTIAL_CHARS` is this
 * constant, so the draft write and the RTU route give one answer.
 */
export const RTU_CREDENTIAL_MAX_CHARS = 4096;

/** `F4.333` (ADR 0129 decision 2, Q3): the most sibling RTUs one replace may cover. */
export const RTU_CREDENTIAL_SIBLINGS_MAX = 100;

/**
 * `PUT /admin/rtus/:id/credentials` (ADR 0129 decision 2). Write-only: the
 * values are encrypted at the current key version and never echoed, logged or
 * audited. A full replacement — both fields, never a merge (ADR 0012 decision 4
 * forbids decrypting the old blob in the API). `alsoApplyTo` (Q3) names other
 * RTUs of the same organization on the same broker that get the same new blob.
 */
export const replaceRtuCredentialsBodySchema = z
  .object({
    username: z.string().min(1).max(RTU_CREDENTIAL_MAX_CHARS),
    password: z.string().min(1).max(RTU_CREDENTIAL_MAX_CHARS),
    alsoApplyTo: z.array(z.string().uuid()).max(RTU_CREDENTIAL_SIBLINGS_MAX).optional(),
  })
  .strict();

export type ReplaceRtuCredentialsBody = z.infer<typeof replaceRtuCredentialsBodySchema>;
