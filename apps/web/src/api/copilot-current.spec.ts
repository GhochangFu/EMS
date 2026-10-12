import { expect, vi } from "vitest";
import type { CopilotPendingChangeDto } from "@bms/shared";

import * as locationsApi from "./admin/locations";
import { fetchCopilotCurrent } from "./copilot-current";

/**
 * `F3.86` PR 3d (plan §5.5) — the Now values of a Control Room view card are
 * the site's stored setting, read through the locations page's own route.
 * Vitest entry point: the sibling `.test.ts`.
 */

const SITE = "11111111-1111-4111-8111-111111111111";
const DASHBOARD = "22222222-2222-4222-8222-222222222222";

function viewChange(path = `/api/v1/admin/locations/${SITE}/control-room-view`): CopilotPendingChangeDto {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    catalogId: "location.controlRoomView.set",
    method: "PUT",
    path,
    body: { kind: "generated" },
    summary: 'Set the Control Room view of "Lotapata" in PHE to the generated view.',
    risk: "edit",
    proposedAt: "2026-10-12T10:00:00.000Z",
    expiresAt: "2026-10-12T10:15:00.000Z",
  };
}

/** The stored setting of the site the change's path names, as the body's three fields. */
export async function theViewCardReadsTheStoredSetting(): Promise<void> {
  const read = vi.spyOn(locationsApi, "fetchSiteControlRoomView").mockResolvedValue({
    locationId: SITE,
    organizationId: "33333333-3333-4333-8333-333333333333",
    kind: "dashboard",
    dashboardId: DASHBOARD,
    builtinKey: null,
    updatedAt: null,
    updatedBy: null,
  });

  expect(await fetchCopilotCurrent(viewChange())).toEqual({ kind: "dashboard", dashboardId: DASHBOARD, builtinKey: null });
  expect(read).toHaveBeenCalledWith(SITE);
}
