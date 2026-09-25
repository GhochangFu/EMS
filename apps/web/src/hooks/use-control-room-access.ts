import { useQuery } from "@tanstack/react-query";

import { fetchAssets } from "../api/assets";
import { CR_TRACKED_ASSET_CODES } from "../components/live-svg/control-room-bindings";
import { hasAnyControlRoomAsset } from "../lib/control-room-access";

export type ControlRoomAccess = "pending" | "granted" | "denied";

/**
 * `F4.156` (OQ2) — the shell and the route guard observe `["assets"]` with a
 * five-minute stale time, so a sidebar render or a route change does not
 * refetch the list. Per observer: the schematic provider's own `["assets"]`
 * observer keeps the default `staleTime: 0`.
 */
export const CONTROL_ROOM_ACCESS_STALE_MS = 5 * 60_000;

/**
 * `F4.156` — may the caller see the Eskom Control Room 2D?
 *
 * Reads the same `["assets"]` query the schematic provider issues (the API's
 * already-filtered `GET /api/v1/assets` body) and grants when it holds at
 * least one `CR-*` code.
 *
 * Decides from `data`, never from `status`: TanStack v5 sets `status:
 * "error"` on a failed *background* refetch while keeping `data`, so a
 * granted caller stays granted. With no `data`, a pending read is `"pending"`
 * and anything else (a failed first read) is `"denied"` — fail closed.
 */
export function useControlRoomAccess(): ControlRoomAccess {
  const assets = useQuery({
    queryKey: ["assets"],
    queryFn: () => fetchAssets(),
    staleTime: CONTROL_ROOM_ACCESS_STALE_MS,
  });
  if (assets.data === undefined) {
    return assets.isPending ? "pending" : "denied";
  }
  return hasAnyControlRoomAsset(assets.data, CR_TRACKED_ASSET_CODES) ? "granted" : "denied";
}
