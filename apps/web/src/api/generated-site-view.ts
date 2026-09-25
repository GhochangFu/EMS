import { generatedSiteViewDtoSchema } from "@bms/shared/contracts";
import type { GeneratedSiteViewDto } from "@bms/shared";

import { withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * GET /api/v1/control-room/sites/:locationId/generated — `F3.68` (ADR 0076
 * decision 7). Not in `api/control-room.ts`, which is `F3.66`'s.
 */
export async function fetchGeneratedSiteView(locationId: string): Promise<GeneratedSiteViewDto> {
  const res = await fetch(
    `${base}/api/v1/control-room/sites/${encodeURIComponent(locationId)}/generated`,
    withAuth(),
  );
  if (!res.ok) {
    throw new Error(`control-room/sites/:locationId/generated ${res.status}`);
  }
  return checkResponse(
    generatedSiteViewDtoSchema,
    await res.json(),
    "control-room/sites/:locationId/generated",
  );
}
