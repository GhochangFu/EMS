import { copilotStatusDtoSchema } from "@bms/shared/contracts";
import type { CopilotStatusDto } from "@bms/shared";

import { adminFetch } from "./admin/client";

/**
 * `GET /api/v1/copilot/status` (`F3.85`, ADR 0099 decision 5) — whether the
 * administrator copilot is available to the signed-in user here. An operator
 * or a viewer gets a 403, which `adminFetch` raises as an `ApiError`. The dock
 * (a later PR) reads it on mount; omit `organizationId` for the user's own
 * organization, or none for the global admin.
 */
export async function fetchCopilotStatus(organizationId?: string): Promise<CopilotStatusDto> {
  const query = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : "";
  return adminFetch(`/copilot/status${query}`, copilotStatusDtoSchema);
}
