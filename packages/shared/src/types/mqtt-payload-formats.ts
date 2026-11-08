/**
 * `F4.334` / ADR 0116 decision 5 — the payload format catalog's wire types,
 * each `z.infer`red from its schema in `../contracts/` (ADR 0030 decision 2);
 * re-exported by `index.ts`.
 */
import type { z } from "zod";

import type * as MPF from "../contracts/mqtt-payload-formats";

export type MqttPayloadFormatDto = z.infer<typeof MPF.mqttPayloadFormatDtoSchema>;
export type MqttPayloadFormatsListResponse = z.infer<typeof MPF.mqttPayloadFormatsListResponseSchema>;
export type CreateMqttPayloadFormatBody = z.infer<typeof MPF.createMqttPayloadFormatBodySchema>;
export type UpdateMqttPayloadFormatBody = z.infer<typeof MPF.updateMqttPayloadFormatBodySchema>;
export type TestMqttPayloadFormatBody = z.infer<typeof MPF.testMqttPayloadFormatBodySchema>;
export type TestMqttPayloadFormatResponse = z.infer<typeof MPF.testMqttPayloadFormatResponseSchema>;
export type DeleteMqttPayloadFormatConflict = z.infer<typeof MPF.deleteMqttPayloadFormatConflictSchema>;
export type SetRtuPayloadFormatBody = z.infer<typeof MPF.setRtuPayloadFormatBodySchema>;
