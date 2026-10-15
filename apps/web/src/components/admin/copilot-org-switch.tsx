import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { type CopilotAccessPutBody, fetchCopilotAccess, putCopilotAccess } from "../../api/admin/copilot-access";
import { apiErrorMessage } from "../../lib/api-error-message";
import { copilotAccessQueryKey } from "./copilot-access-card";

/** ADR 0099 Amendment 3 A7: what the attachment switch allows, said where it is set. */
const ATTACHMENTS_UNSCRUBBED = "A file attached to a turn goes to the organization's AI provider as it is, unscrubbed.";

type CopilotOrgSwitchProps = {
  orgId: string;
  orgName: string;
};

/**
 * The organization's administrator-copilot switch on the Organizations list
 * (`F3.85` PR 3, ADR 0099 decision 5). Rendered for the global admin only —
 * the server refuses the switch to anyone else. A new organization starts off.
 * A refused save puts the check back and says why, in the server's sentence.
 * `F3.87` (ADR 0099 Amendment 3 A7): a second switch sets the organization's
 * attachment switch; the global admin's write creates a missing row with the
 * copilot still off (ruling Q3).
 */
export function CopilotOrgSwitch({ orgId, orgName }: CopilotOrgSwitchProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const accessQ = useQuery({ queryKey: copilotAccessQueryKey(orgId), queryFn: () => fetchCopilotAccess(orgId) });
  const toggle = useMutation({
    mutationFn: (body: CopilotAccessPutBody) => putCopilotAccess(orgId, body),
    onSuccess: (dto) => {
      queryClient.setQueryData(copilotAccessQueryKey(orgId), dto);
      setError(null);
    },
    onError: (err: unknown) => setError(apiErrorMessage(err)),
  });
  const busy = !accessQ.data || toggle.isPending;
  return (
    <span className="flex flex-col">
      <label className="flex items-center gap-1 text-xs font-semibold text-ink-muted">
        <input
          type="checkbox"
          aria-label={`Copilot for ${orgName}`}
          checked={accessQ.data?.enabled ?? false}
          disabled={busy}
          onChange={(event) => toggle.mutate({ enabled: event.target.checked })}
        />
        Copilot
      </label>
      <label className="flex items-center gap-1 text-xs font-semibold text-ink-muted" title={ATTACHMENTS_UNSCRUBBED}>
        <input
          type="checkbox"
          aria-label={`Copilot attachments for ${orgName}`}
          checked={accessQ.data?.attachmentsEnabled ?? false}
          disabled={busy}
          onChange={(event) => toggle.mutate({ attachmentsEnabled: event.target.checked })}
        />
        Attachments
      </label>
      {error ? (
        <span role="alert" className="text-xs text-critical-ink">
          {error}
        </span>
      ) : null}
    </span>
  );
}
