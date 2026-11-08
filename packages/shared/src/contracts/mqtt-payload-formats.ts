import { z } from "zod";

import {
  MQTT_PAYLOAD_FORMAT_ARRAY_CAP,
  mqttDeclarativePayloadFormatSchema,
  mqttPayloadFormatCodeSchema,
  mqttPayloadFormatDefinitionSchema,
} from "../ingest-adapters/mqtt-payload-format";

/**
 * `F4.334` / ADR 0116 decision 5 — the MQTT payload format catalog's wire
 * contracts (`/api/v1/admin/mqtt-payload-formats`) and the RTU format route
 * (`PUT /api/v1/admin/rtus/:id/payload-format`, plan R9).
 *
 * Flat `.strict()` objects (ADR 0030 Amendment 1): no intersection, no merge.
 * The definition schema itself lives in `ingest-adapters/` because the ingest
 * host and the worker parse with it too.
 */

/** One catalog row. */
export const mqttPayloadFormatDtoSchema = z
  .object({
    id: z.string().uuid(),
    code: z.string(),
    name: z.string(),
    description: z.string(),
    definition: mqttPayloadFormatDefinitionSchema,
    builtin: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    updatedBy: z.string().nullable(),
  })
  .strict();

export const mqttPayloadFormatsListResponseSchema = z.array(mqttPayloadFormatDtoSchema);

const nameSchema = z.string().trim().min(1).max(128);
const descriptionSchema = z.string().trim().max(1000);

/** `POST` — a new format is always declarative; the built-in kind is never written (ruling 16). */
export const createMqttPayloadFormatBodySchema = z
  .object({
    code: mqttPayloadFormatCodeSchema,
    name: nameSchema,
    description: descriptionSchema.optional(),
    definition: mqttDeclarativePayloadFormatSchema,
  })
  .strict();

/** `PUT /:code` — the code never changes; an empty body is the service's 400. */
export const updateMqttPayloadFormatBodySchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
    definition: mqttDeclarativePayloadFormatSchema.optional(),
  })
  .strict();

/** The largest sample message the test route takes (64 KiB). */
export const MQTT_PAYLOAD_FORMAT_TEST_SAMPLE_MAX = 65_536;

/** `POST /test` — decode a pasted sample against a definition; nothing is stored. */
export const testMqttPayloadFormatBodySchema = z
  .object({
    definition: mqttPayloadFormatDefinitionSchema,
    topic: z.string().max(255),
    sample: z.string().max(MQTT_PAYLOAD_FORMAT_TEST_SAMPLE_MAX),
  })
  .strict();

export const testMqttPayloadFormatResponseSchema = z
  .object({
    ok: z.boolean(),
    /** One of `MQTT_DECODE_FAILURES` when `ok` is false. */
    reason: z.string().optional(),
    records: z
      .array(
        z
          .object({
            deviceKey: z.string(),
            at: z.string().nullable(),
            values: z.record(z.number().nullable()),
          })
          .strict(),
      )
      .max(MQTT_PAYLOAD_FORMAT_ARRAY_CAP),
  })
  .strict();

/**
 * `DELETE /:code` 409 (ruling Q5): the RTUs and open drafts that name the
 * format. The caller is always a global admin, who can already read every
 * organization.
 */
export const deleteMqttPayloadFormatConflictSchema = z
  .object({
    message: z.string(),
    rtus: z.array(z.object({ rtuCode: z.string(), organizationCode: z.string() }).strict()),
    drafts: z.array(z.object({ sessionId: z.string(), organizationCode: z.string() }).strict()),
  })
  .strict();

/** `PUT /admin/rtus/:id/payload-format` (plan R9): `null` returns the RTU to the built-in. */
export const setRtuPayloadFormatBodySchema = z
  .object({ payloadFormat: mqttPayloadFormatCodeSchema.nullable() })
  .strict();
