import { z } from "zod";

import { mqttTopicHasWildcard } from "@bms/shared";

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
    ingestEnabled: z.boolean().optional(),
    meta: z.record(z.unknown()).optional(),
  })
  .strict();

export const updateRtuBodySchema = createRtuBodySchema.omit({ locationId: true }).partial();

export type CreateRtuBody = z.infer<typeof createRtuBodySchema>;
export type UpdateRtuBody = z.infer<typeof updateRtuBodySchema>;
