import type { QueryClient } from "@tanstack/react-query";
import {
  adminRtuDtoSchema,
  deleteMqttPayloadFormatConflictSchema,
  mqttPayloadFormatDtoSchema,
  mqttPayloadFormatsListResponseSchema,
  testMqttPayloadFormatResponseSchema,
} from "@bms/shared/contracts";
import type {
  AdminRtuDto,
  CreateMqttPayloadFormatBody,
  DeleteMqttPayloadFormatConflict,
  MqttPayloadFormatDto,
  MqttPayloadFormatsListResponse,
  SetRtuPayloadFormatBody,
  TestMqttPayloadFormatBody,
  TestMqttPayloadFormatResponse,
  UpdateMqttPayloadFormatBody,
} from "@bms/shared";

import { ApiError } from "../../lib/api-error";
import { clearSessionOnAuthFailure, withAuth } from "../http";
import { adminFetch } from "./client";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `F4.334` / ADR 0116 decision 5 (plan T5.1) — the MQTT payload format catalog at
 * `/admin/mqtt-payload-formats`. Reads are any master-data user's (the onboarding
 * drawer's select); writes and the test route are the global admin's.
 */
export const mqttPayloadFormatsQueryKey = ["admin", "mqtt-payload-formats"] as const;

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function fetchMqttPayloadFormats(): Promise<MqttPayloadFormatsListResponse> {
  return adminFetch("/admin/mqtt-payload-formats", mqttPayloadFormatsListResponseSchema);
}

export async function createMqttPayloadFormat(input: CreateMqttPayloadFormatBody): Promise<MqttPayloadFormatDto> {
  return adminFetch("/admin/mqtt-payload-formats", mqttPayloadFormatDtoSchema, json("POST", input));
}

export async function updateMqttPayloadFormat(
  code: string,
  input: UpdateMqttPayloadFormatBody,
): Promise<MqttPayloadFormatDto> {
  return adminFetch(`/admin/mqtt-payload-formats/${encodeURIComponent(code)}`, mqttPayloadFormatDtoSchema, json("PUT", input));
}

/** Decodes a pasted sample against a definition; stores nothing. */
export async function testMqttPayloadFormat(input: TestMqttPayloadFormatBody): Promise<TestMqttPayloadFormatResponse> {
  return adminFetch("/admin/mqtt-payload-formats/test", testMqttPayloadFormatResponseSchema, json("POST", input));
}

/** `null` returns the RTU to the built-in envelope (plan R9). */
export async function setRtuPayloadFormat(rtuId: string, input: SetRtuPayloadFormatBody): Promise<AdminRtuDto> {
  return adminFetch(`/admin/rtus/${encodeURIComponent(rtuId)}/payload-format`, adminRtuDtoSchema, json("PUT", input));
}

/** A 409 from `DELETE` (ruling Q5): the RTUs and drafts that still name the format. */
export class MqttPayloadFormatInUseError extends Error {
  constructor(readonly conflict: DeleteMqttPayloadFormatConflict) {
    super(conflict.message);
    this.name = "MqttPayloadFormatInUseError";
  }
}

/**
 * Removes a format. The route answers 204 with no body, so this makes the request
 * itself with `adminFetch`'s refusal handling; a 409 whose body is the in-use list
 * becomes a {@link MqttPayloadFormatInUseError}.
 */
export async function deleteMqttPayloadFormat(code: string): Promise<void> {
  const path = `/admin/mqtt-payload-formats/${encodeURIComponent(code)}`;
  const sent = withAuth({ method: "DELETE" });
  const res = await fetch(`${base}/api/v1${path}`, sent);
  if (res.ok) {
    return;
  }
  clearSessionOnAuthFailure(res, sent);
  const text = await res.text();
  if (res.status === 409) {
    const conflict = deleteMqttPayloadFormatConflictSchema.safeParse(parseOrNull(text));
    if (conflict.success) {
      throw new MqttPayloadFormatInUseError(conflict.data);
    }
  }
  throw new ApiError(text || `admin ${path} ${res.status}`, res.status);
}

function parseOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function invalidateMqttPayloadFormatReads(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: mqttPayloadFormatsQueryKey });
}
