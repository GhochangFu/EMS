import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchCopilotAccess, putCopilotAccess } from "../../api/admin/copilot-access";
import { copilotAccessQueryKey } from "./copilot-access-card";

type CopilotOrgSwitchProps = {
  orgId: string;
  orgName: string;
};

/**
 * The organization's administrator-copilot switch on the Organizations list
 * (`F3.85` PR 3, ADR 0099 decision 5). Rendered for the global admin only —
 * the server refuses the switch to anyone else. A new organization starts off.
 */
export function CopilotOrgSwitch({ orgId, orgName }: CopilotOrgSwitchProps) {
  const queryClient = useQueryClient();
  const accessQ = useQuery({ queryKey: copilotAccessQueryKey(orgId), queryFn: () => fetchCopilotAccess(orgId) });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => putCopilotAccess(orgId, { enabled }),
    onSuccess: (dto) => queryClient.setQueryData(copilotAccessQueryKey(orgId), dto),
  });
  return (
    <label className="flex items-center gap-1 text-xs font-semibold text-ink-muted">
      <input
        type="checkbox"
        aria-label={`Copilot for ${orgName}`}
        checked={accessQ.data?.enabled ?? false}
        disabled={!accessQ.data || toggle.isPending}
        onChange={(event) => toggle.mutate(event.target.checked)}
      />
      Copilot
    </label>
  );
}
