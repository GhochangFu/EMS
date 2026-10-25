import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { RuleListItem, RulePreviewResult } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import {
  createRuleDraft,
  fetchRuleBuilderCatalog,
  previewRuleDraft,
  type RuleDraftPayload,
  updateRuleDraft,
} from "../../api/rules";
import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import { apiErrorMessage } from "../../lib/api-error-message";
import { defaultCategoryCode } from "../../lib/vocabulary";
import { wizardBody } from "../../lib/wizard-steps";
import { AdminWizardFrame } from "../admin/admin-wizard-frame";
import { WizardShell } from "../wizard/wizard-shell";
import { ActionStepFields } from "./rule-action-step-fields";
import { ConditionStepFields } from "./rule-condition-step-fields";
import { RuleStepFields, type RuleValues, valuesFromRule } from "./rule-wizard-fields";

/**
 * `F4.278` (ADR 0099 decision 6, Amendment 8) — the Rule Engine's rule form on
 * the shared `WizardShell`: `rule.create` and `rule.update`, Rule → Condition →
 * Action → Review. It replaces the plain `rule-builder-panel.tsx`. The values
 * are the route's own body; Submit sends the plain request (no
 * `X-Copilot-Change`), and the route's validator still decides. "Preview latest
 * data" stays a page aid on the Condition step, calling `POST /rules/preview`
 * (an excluded route: it writes a `rule_preview` audit row). The `<WizardShell>`
 * lines write the literal `entry={wizardEntry("…")}` (the stepper gate's form).
 */

/** The catalog entry, or a build defect (the `calc-parameters-page.tsx` rule). */
function wizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F4.278: the catalog has no entry "${id}"`);
  return entry;
}

const NEW_DRAFT: RuleValues = {
  name: "",
  severity: "warning",
  ruleType: "threshold",
  assetId: "",
  pointKey: "",
  operator: "gt",
  clearHoldSeconds: null,
  condition: { window: "latest" },
  action: { type: "notify", target: "Operations" },
};

type RuleWizardProps = {
  /** The rule to edit; absent for a new draft. */
  rule?: RuleListItem | null;
  onCancel: () => void;
  onDone: () => Promise<void> | void;
};

export function RuleWizard({ rule, onCancel, onDone }: RuleWizardProps) {
  const catalogQ = useQuery({
    queryKey: ["rules", "catalog"],
    queryFn: fetchRuleBuilderCatalog,
  });
  const vocabQ = useQuery({
    queryKey: vocabulariesQueryKey,
    queryFn: fetchVocabularies,
    staleTime: 5 * 60 * 1000,
  });
  // The severity is read against the vocabulary, so an edit waits for it (the `F4.46` load-order rule).
  if (rule && !vocabQ.isSuccess) {
    return (
      <AdminWizardFrame title="Edit an alarm rule">
        <p className="text-xs text-ink-muted">Loading…</p>
      </AdminWizardFrame>
    );
  }
  return (
    <RuleWizardForm
      rule={rule ?? null}
      onCancel={onCancel}
      onDone={onDone}
      assets={catalogQ.data?.assets ?? []}
      categories={vocabQ.data?.ruleCategories ?? []}
      severities={vocabQ.data?.alarmSeverities ?? []}
    />
  );
}

function RuleWizardForm({
  rule,
  onCancel,
  onDone,
  assets,
  categories,
  severities,
}: {
  rule: RuleListItem | null;
  onCancel: () => void;
  onDone: () => Promise<void> | void;
  assets: NonNullable<Awaited<ReturnType<typeof fetchRuleBuilderCatalog>>["assets"]>;
  categories: NonNullable<Awaited<ReturnType<typeof fetchVocabularies>>["ruleCategories"]>;
  severities: NonNullable<Awaited<ReturnType<typeof fetchVocabularies>>["alarmSeverities"]>;
}) {
  const [values, setValues] = useState<RuleValues>(() =>
    rule ? valuesFromRule(rule, severities) : { ...NEW_DRAFT, category: defaultCategoryCode(categories) },
  );
  const [thresholdText, setThresholdText] = useState(rule?.thresholdValue == null ? "" : String(rule.thresholdValue));
  const [holdText, setHoldText] = useState(rule?.clearHoldSeconds == null ? "" : String(rule.clearHoldSeconds));
  const [preview, setPreview] = useState<RulePreviewResult | null>(null);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      rule
        ? updateRuleDraft({
            id: rule.id,
            payload: body as Partial<RuleDraftPayload> & { reason?: string },
          })
        : createRuleDraft(body as RuleDraftPayload),
    onSuccess: async () => onDone(),
  });
  const previewM = useMutation({
    mutationFn: () =>
      previewRuleDraft({
        ...(wizardBody(values) as RuleDraftPayload),
        id: rule?.id,
      }),
    onSuccess: (result) => setPreview(result),
  });
  const id = rule ? "rule.update" : "rule.create";
  // A copilot fill may set a number the typed text no longer shows; the input follows the value.
  const shownThreshold =
    typeof values.thresholdValue === "number" && String(values.thresholdValue) !== thresholdText.trim()
      ? String(values.thresholdValue)
      : thresholdText;
  const shownHold =
    typeof values.clearHoldSeconds === "number" &&
    Number.isFinite(values.clearHoldSeconds) &&
    String(values.clearHoldSeconds) !== holdText.trim()
      ? String(values.clearHoldSeconds)
      : holdText;
  const shared = {
    values,
    onChange: setValues,
    renderStep: (step: { id: string }) => {
      if (step.id === "rule") {
        return (
          <RuleStepFields
            values={values}
            setValues={setValues}
            ruleCategories={categories}
            alarmSeverities={severities}
          />
        );
      }
      if (step.id === "condition") {
        return (
          <>
            <ConditionStepFields
              values={values}
              setValues={setValues}
              assets={assets}
              thresholdText={shownThreshold}
              setThresholdText={setThresholdText}
              holdText={shownHold}
              setHoldText={setHoldText}
            />
            <button
              type="button"
              className="surface-button self-start px-3 py-1 text-xs disabled:opacity-50"
              disabled={previewM.isPending}
              aria-busy={previewM.isPending}
              onClick={() => previewM.mutate()}
            >
              {previewM.isPending ? "Previewing..." : "Preview latest data"}
            </button>
            {previewM.error ? <p className="text-xs text-critical-ink">{apiErrorMessage(previewM.error)}</p> : null}
            {preview ? (
              <p className="text-xs text-ink-muted">
                Preview: {preview.status.replace("_", " ")} · {preview.message}
              </p>
            ) : null}
          </>
        );
      }
      return <ActionStepFields values={values} setValues={setValues} withReason={rule !== null} />;
    },
    onSubmit: (body: Record<string, unknown>) => save.mutate(body),
    onCancel,
    submitting: save.isPending,
    submitError: save.error ? apiErrorMessage(save.error) : null,
  };
  const assetName = assets.find((asset) => asset.id === values.assetId)?.name ?? "";
  return rule ? (
    <AdminWizardFrame title="Edit an alarm rule">
      <WizardShell
        entry={wizardEntry("rule.update")}
        {...shared}
        params={{ id: rule.id }}
        current={valuesFromRule(rule, severities)}
        summary={wizardEntry(id).summary({
          body: wizardBody(values),
          params: { id: rule.id },
          targetName: rule.name,
          organizationName: "",
          lifecycle: rule.lifecycleStatus,
        })}
      />
    </AdminWizardFrame>
  ) : (
    <AdminWizardFrame title="Create an alarm rule">
      <WizardShell
        entry={wizardEntry("rule.create")}
        {...shared}
        params={{}}
        summary={`Create the rule "${typeof values.name === "string" ? values.name : ""}"${assetName ? ` on ${assetName}` : ""}.`}
      />
    </AdminWizardFrame>
  );
}
