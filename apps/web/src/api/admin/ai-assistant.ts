import {
  aiAssistantSettingsDtoSchema,
  aiAssistantTestResultDtoSchema,
} from "@bms/shared/contracts";
import type {
  AiAssistantProviderChoice,
  AiAssistantSettingsDto,
  AiAssistantTestResultDto,
} from "@bms/shared";

import { adminFetch } from "./client";

/**
 * One organization's onboarding-agent setting (`F3.21`, ADR 0090 Amendment 1
 * A5). Every response is parsed with the shared `.strict()` schema (owner
 * ruling 12), so a key field that leaks into a response fails here rather than
 * reaching the page.
 */

/** `PUT` body. `apiKey` omitted keeps the stored key for the same provider. */
export type AiAssistantPutBody = {
  provider: AiAssistantProviderChoice;
  model?: string;
  apiKey?: string;
};

/** `POST …/test` body. `apiKey` omitted uses the stored key, else the platform default. */
export type AiAssistantTestBody = {
  provider: Exclude<AiAssistantProviderChoice, "off">;
  model: string;
  apiKey?: string;
};

function path(orgId: string): string {
  return `/admin/organizations/${orgId}/ai-assistant`;
}

/** Reads the organization's setting, or the platform default when it has none. */
export async function fetchAiAssistantSettings(orgId: string): Promise<AiAssistantSettingsDto> {
  return adminFetch(path(orgId), aiAssistantSettingsDtoSchema);
}

/** Writes the organization's setting. */
export async function putAiAssistantSettings(
  orgId: string,
  body: AiAssistantPutBody,
): Promise<AiAssistantSettingsDto> {
  return adminFetch(path(orgId), aiAssistantSettingsDtoSchema, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Removes the organization's setting; it returns to the platform default. */
export async function deleteAiAssistantSettings(orgId: string): Promise<AiAssistantSettingsDto> {
  return adminFetch(path(orgId), aiAssistantSettingsDtoSchema, { method: "DELETE" });
}

/** One minimal billed call to the provider; the answer is a status, never the key. */
export async function testAiAssistant(
  orgId: string,
  body: AiAssistantTestBody,
): Promise<AiAssistantTestResultDto> {
  return adminFetch(`${path(orgId)}/test`, aiAssistantTestResultDtoSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
