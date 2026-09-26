import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchActiveAlarms, fetchAlarmSummary, type AlarmScope } from "../api/alarms";
import { useAlarmsSocket } from "./use-alarms-socket";

/** Prefixes, without the ids: one socket event refreshes every scope's entry. */
export const activeAlarmsQueryPrefix = ["alarms", "active"] as const;
export const alarmSummaryQueryPrefix = ["alarms", "summary"] as const;

/**
 * The two reads behind the `/cr-overview` alarms rail (`F3.28`, ADR 0074
 * decision 4): the newest active alarms and the active count per severity,
 * both narrowed to `scope`: a list of asset ids, or (`F3.66` step-5 fix)
 * one organization, which the API reads by `organizationId` so the request
 * does not grow with the organization's asset count.
 *
 * With no ids there is nothing to ask about — the page's telemetry context
 * has not resolved its codes yet, or the caller can read none of them — so
 * neither query runs. Sending no `assetIds` would instead mean *every readable
 * asset*, a wider read than the rail describes. The organization scope is
 * enabled by its id alone. Both scopes key under the same prefixes, so one
 * socket event refreshes either.
 */
export function useActiveAlarms(scope: AlarmScope) {
  const qc = useQueryClient();
  const enabled = "organizationId" in scope ? scope.organizationId.length > 0 : scope.length > 0;
  const active = useQuery({
    queryKey: [...activeAlarmsQueryPrefix, scope],
    queryFn: () => fetchActiveAlarms(scope),
    enabled,
  });
  const summary = useQuery({
    queryKey: [...alarmSummaryQueryPrefix, scope],
    queryFn: () => fetchAlarmSummary(scope),
    enabled,
  });
  useAlarmsSocket(() => {
    void qc.invalidateQueries({ queryKey: activeAlarmsQueryPrefix });
    void qc.invalidateQueries({ queryKey: alarmSummaryQueryPrefix });
  });
  return { active, summary };
}
