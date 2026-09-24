import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchActiveAlarms, fetchAlarmSummary } from "../api/alarms";
import { useAlarmsSocket } from "./use-alarms-socket";

/** Prefixes, without the ids: one socket event refreshes every scope's entry. */
export const activeAlarmsQueryPrefix = ["alarms", "active"] as const;
export const alarmSummaryQueryPrefix = ["alarms", "summary"] as const;

/**
 * The two reads behind the `/cr-overview` alarms rail (`F3.28`, ADR 0074
 * decision 4): the newest active alarms and the active count per severity,
 * both narrowed to `assetIds`.
 *
 * With no ids there is nothing to ask about — the page's telemetry context
 * has not resolved its codes yet, or the caller can read none of them — so
 * neither query runs. Sending no `assetIds` would instead mean *every readable
 * asset*, a wider read than the rail describes.
 */
export function useActiveAlarms(assetIds: readonly string[]) {
  const qc = useQueryClient();
  const enabled = assetIds.length > 0;
  const active = useQuery({
    queryKey: [...activeAlarmsQueryPrefix, assetIds],
    queryFn: () => fetchActiveAlarms(assetIds),
    enabled,
  });
  const summary = useQuery({
    queryKey: [...alarmSummaryQueryPrefix, assetIds],
    queryFn: () => fetchAlarmSummary(assetIds),
    enabled,
  });
  useAlarmsSocket(() => {
    void qc.invalidateQueries({ queryKey: activeAlarmsQueryPrefix });
    void qc.invalidateQueries({ queryKey: alarmSummaryQueryPrefix });
  });
  return { active, summary };
}
