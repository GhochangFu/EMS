import { copilotAccessDtoSchema } from "@bms/shared/contracts";
import type { CopilotAccessDto, CopilotSwitchableRole } from "@bms/shared";

import { adminFetch } from "./client";

/**
 * One organization's administrator-copilot switches and exceptions (`F3.85`
 * PR 3, ADR 0099 decision 5). Every response is parsed with the shared
 * `.strict()` schema.
 */

/** `PUT` body: any subset. `override.allow: null` removes the exception. */
export type CopilotAccessPutBody = {
  enabled?: boolean;
  roles?: Partial<Record<CopilotSwitchableRole, boolean>>;
  override?: { userId: string; allow: boolean | null };
};

function path(orgId: string): string {
  return `/admin/organizations/${orgId}/copilot-access`;
}

export async function fetchCopilotAccess(orgId: string): Promise<CopilotAccessDto> {
  return adminFetch(path(orgId), copilotAccessDtoSchema);
}

export async function putCopilotAccess(orgId: string, body: CopilotAccessPutBody): Promise<CopilotAccessDto> {
  return adminFetch(path(orgId), copilotAccessDtoSchema, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
