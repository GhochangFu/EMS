import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { RuleListItem } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import { archiveRule, duplicateRule, publishRule } from "../../api/rules";
import { apiErrorMessage } from "../../lib/api-error-message";
import { AdminWizardFrame, fieldClass, labelClass } from "../admin/admin-wizard-frame";
import { WizardShell } from "../wizard/wizard-shell";

/**
 * `F4.278` (ADR 0099 decision 6, Amendment 8 D3) — the Rule Engine card's
 * lifecycle actions on the shared `WizardShell`, replacing the card's direct
 * calls. Publish, duplicate and archive take the optional reason (Reason →
 * Review); enable and disable are one entry per direction, each the Review step
 * alone with the entry's `fixedBody` (`{ enabled: true }` / `{ enabled: false }`)
 * as the whole PATCH body — the `AssetRoleToggleWizard` pattern. Submit sends the
 * plain request (no `X-Copilot-Change`). The toggle is `rule-toggle-wizard.tsx`
 * (one exported component per file, AGENTS.md §4.2).
 */

/** The catalog entry, or a build defect (the `calc-parameters-page.tsx` rule). */
export function wizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F4.278: the catalog has no entry "${id}"`);
  return entry;
}

export type RuleLifecycleAction = "publish" | "duplicate" | "archive";

export type RuleWizardProps = {
  rule: RuleListItem;
  onCancel: () => void;
  onDone: () => Promise<void> | void;
};

const SEND: Record<RuleLifecycleAction, (input: { id: string; reason?: string }) => Promise<RuleListItem>> = {
  publish: publishRule,
  duplicate: duplicateRule,
  archive: archiveRule,
};

/** `rule.publish`, `rule.duplicate` or `rule.archive`: Reason → Review. */
export function RuleLifecycleWizard({
  rule,
  action,
  onCancel,
  onDone,
}: RuleWizardProps & { action: RuleLifecycleAction }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      SEND[action]({
        id: rule.id,
        ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
      }),
    onSuccess: async () => onDone(),
  });
  const reason = typeof values.reason === "string" ? values.reason : "";
  const shared = {
    values,
    onChange: setValues,
    renderStep: () => (
      <label className={labelClass}>
        Reason (optional)
        <input
          aria-label="Reason"
          className={fieldClass}
          value={reason}
          onChange={(e) =>
            setValues({
              ...values,
              reason: e.target.value === "" ? undefined : e.target.value,
            })
          }
        />
      </label>
    ),
    onSubmit: (body: Record<string, unknown>) => save.mutate(body),
    onCancel,
    submitting: save.isPending,
    submitError: save.error ? apiErrorMessage(save.error) : null,
  };
  const summaryOf = (id: string) =>
    wizardEntry(id).summary({
      body: values,
      params: { id: rule.id },
      targetName: rule.name,
      organizationName: "",
    });
  if (action === "publish") {
    return (
      <AdminWizardFrame title="Publish an alarm rule">
        <WizardShell
          entry={wizardEntry("rule.publish")}
          {...shared}
          params={{ id: rule.id }}
          summary={summaryOf("rule.publish")}
        />
      </AdminWizardFrame>
    );
  }
  if (action === "duplicate") {
    return (
      <AdminWizardFrame title="Duplicate an alarm rule">
        <WizardShell
          entry={wizardEntry("rule.duplicate")}
          {...shared}
          params={{ id: rule.id }}
          summary={summaryOf("rule.duplicate")}
        />
      </AdminWizardFrame>
    );
  }
  return (
    <AdminWizardFrame title="Archive an alarm rule">
      <WizardShell
        entry={wizardEntry("rule.archive")}
        {...shared}
        params={{ id: rule.id }}
        summary={summaryOf("rule.archive")}
      />
    </AdminWizardFrame>
  );
}
