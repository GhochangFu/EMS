import { useMutation } from "@tanstack/react-query";

import { setRuleEnabled } from "../../api/rules";
import { apiErrorMessage } from "../../lib/api-error-message";
import { AdminWizardFrame } from "../admin/admin-wizard-frame";
import { WizardShell } from "../wizard/wizard-shell";
import { type RuleWizardProps, wizardEntry } from "./rule-lifecycle-wizard";

/** `rule.enable` / `rule.disable`, each the Review step alone: the direction is the rule's opposite. */
export function RuleToggleWizard({ rule, onCancel, onDone }: RuleWizardProps) {
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => setRuleEnabled({ id: rule.id, enabled: body.enabled === true }),
    onSuccess: async () => onDone(),
  });
  const shared = {
    onChange: () => undefined,
    renderStep: () => null,
    onSubmit: (body: Record<string, unknown>) => save.mutate(body),
    onCancel,
    submitting: save.isPending,
    submitError: save.error ? apiErrorMessage(save.error) : null,
  };
  const summaryOf = (id: string) =>
    wizardEntry(id).summary({
      body: {},
      params: { id: rule.id },
      targetName: rule.name,
      organizationName: "",
    });
  return rule.enabled ? (
    <AdminWizardFrame title="Disable an alarm rule">
      <WizardShell
        entry={wizardEntry("rule.disable")}
        {...shared}
        params={{ id: rule.id }}
        values={{ enabled: false }}
        summary={summaryOf("rule.disable")}
      />
    </AdminWizardFrame>
  ) : (
    <AdminWizardFrame title="Enable an alarm rule">
      <WizardShell
        entry={wizardEntry("rule.enable")}
        {...shared}
        params={{ id: rule.id }}
        values={{ enabled: true }}
        summary={summaryOf("rule.enable")}
      />
    </AdminWizardFrame>
  );
}
