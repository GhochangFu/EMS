import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { setEscalationDefaults } from "../../api/escalation";
import { apiErrorMessage } from "../../lib/api-error-message";
import { AdminWizardFrame } from "../admin/admin-wizard-frame";
import { WizardShell } from "../wizard/wizard-shell";
import { channelWizardEntry } from "./channel-wizard";

type DefaultItem = { severity: string; profileId: string };

export type EscalationDefaultsWizardProps = {
  organizationId: string;
  organizationName: string;
  /** The map the page's selects hold now. */
  items: readonly DefaultItem[];
  /** How the Severity map step names a severity and a profile. */
  severityLabel: (code: string) => string;
  profileLabel: (id: string) => string;
  onCancel: () => void;
  onDone: () => Promise<void> | void;
};

/**
 * `F4.279` (ADR 0099 decision 6, Amendment 8 D3; owner ruling Q2) — the
 * severity map's save on the shared `WizardShell`: `escalationDefaults.set`,
 * or `escalationDefaults.clear` (red) when the map is empty, because an empty
 * map silences every severity. The entry flips on the items, the
 * `RuleToggleWizard` pattern. The page's selects choose the map; the Severity
 * map step shows it, and Review sends it.
 */
export function EscalationDefaultsWizard(props: EscalationDefaultsWizardProps) {
  const { organizationId, organizationName, severityLabel, profileLabel, onCancel, onDone } = props;
  const [values, setValues] = useState<Record<string, unknown>>({ organizationId, items: [...props.items] });
  const items = Array.isArray(values.items) ? (values.items as DefaultItem[]) : [];
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      setEscalationDefaults({ organizationId, items: Array.isArray(body.items) ? (body.items as DefaultItem[]) : [] }),
    onSuccess: async () => onDone(),
  });
  const shared = {
    values,
    onChange: setValues,
    renderStep: () =>
      items.length === 0 ? (
        <p className="text-xs text-ink-muted">No severity is mapped: no alarm escalates.</p>
      ) : (
        <ul className="list-disc pl-4 text-xs text-ink">
          {items.map((item) => (
            <li key={item.severity}>
              {severityLabel(item.severity)} → {profileLabel(item.profileId)}
            </li>
          ))}
        </ul>
      ),
    onSubmit: (body: Record<string, unknown>) => save.mutate(body),
    onCancel,
    submitting: save.isPending,
    submitError: save.error ? apiErrorMessage(save.error) : null,
  };
  const summaryOf = (id: string) =>
    channelWizardEntry(id).summary({ body: values, params: {}, targetName: organizationName, organizationName });
  return items.length === 0 ? (
    <AdminWizardFrame title="Clear the severity map">
      <WizardShell
        entry={channelWizardEntry("escalationDefaults.clear")}
        {...shared}
        params={{}}
        fixedFields={["organizationId"]}
        summary={summaryOf("escalationDefaults.clear")}
      />
    </AdminWizardFrame>
  ) : (
    <AdminWizardFrame title="Set the severity map">
      <WizardShell
        entry={channelWizardEntry("escalationDefaults.set")}
        {...shared}
        params={{}}
        fixedFields={["organizationId"]}
        summary={summaryOf("escalationDefaults.set")}
      />
    </AdminWizardFrame>
  );
}
