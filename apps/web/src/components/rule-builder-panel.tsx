import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  AutomationRuleCategory,
  AutomationRuleOperator,
  AutomationRuleType,
  RuleListItem,
  RulePreviewResult,
} from "@bms/shared";

import {
  createRuleDraft,
  fetchRuleBuilderCatalog,
  previewRuleDraft,
  publishRule,
  updateRuleDraft,
  type RuleDraftPayload,
} from "../api/rules";

type BuilderForm = {
  id?: string;
  code: string;
  name: string;
  description: string;
  category: AutomationRuleCategory;
  ruleType: AutomationRuleType;
  assetId: string;
  pointKey: string;
  operator: AutomationRuleOperator;
  thresholdValue: string;
  severity: "info" | "warning" | "critical";
  actionType: "notify" | "review" | "trace_only";
  actionTarget: string;
  days: string[];
  startTime: string;
  endTime: string;
};

const dayOptions = [
  ["mon", "Mon"],
  ["tue", "Tue"],
  ["wed", "Wed"],
  ["thu", "Thu"],
  ["fri", "Fri"],
  ["sat", "Sat"],
  ["sun", "Sun"],
] as const;

const emptyForm: BuilderForm = {
  code: "",
  name: "",
  description: "",
  category: "operations",
  ruleType: "threshold",
  assetId: "",
  pointKey: "",
  operator: "gt",
  thresholdValue: "",
  severity: "warning",
  actionType: "notify",
  actionTarget: "Operations",
  days: ["mon", "tue", "wed", "thu", "fri"],
  startTime: "08:00",
  endTime: "17:00",
};

const fieldClass =
  "w-full rounded border border-gray-300 bg-white px-2 py-2 text-sm text-bms-ink shadow-sm focus:border-bms-green focus:outline-none";

/** Guided IF/THEN builder for the existing simple automation rule model. */
export function RuleBuilderPanel({
  selectedRule,
  onClearSelected,
}: {
  selectedRule: RuleListItem | null;
  onClearSelected: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<BuilderForm>(emptyForm);
  const [preview, setPreview] = useState<RulePreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const catalogQ = useQuery({
    queryKey: ["rules", "catalog"],
    queryFn: fetchRuleBuilderCatalog,
  });

  useEffect(() => {
    if (!selectedRule) {
      return;
    }
    setForm(formFromRule(selectedRule));
    setPreview(null);
    setError(null);
  }, [selectedRule]);

  const assets = catalogQ.data?.assets ?? [];
  const selectedAsset = assets.find((asset) => asset.id === form.assetId);
  const pointKeys = selectedAsset?.pointKeys ?? [];

  const payload = useMemo(() => buildPayload(form), [form]);
  const invalidReason = validateForm(form);

  const createM = useMutation({
    mutationFn: createRuleDraft,
    onSuccess: (rule) => {
      setForm(formFromRule(rule));
      invalidateRules(qc);
      setError(null);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const updateM = useMutation({
    mutationFn: updateRuleDraft,
    onSuccess: (rule) => {
      setForm(formFromRule(rule));
      invalidateRules(qc);
      setError(null);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const previewM = useMutation({
    mutationFn: previewRuleDraft,
    onSuccess: (result) => {
      setPreview(result);
      invalidateRules(qc);
      setError(null);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const publishM = useMutation({
    mutationFn: publishRule,
    onSuccess: (rule) => {
      setForm(formFromRule(rule));
      invalidateRules(qc);
      setError(null);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const busy = createM.isPending || updateM.isPending || previewM.isPending || publishM.isPending;
  const canSubmit = !invalidReason && !busy;

  return (
    <section className="rounded border border-gray-200 bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-3">
        <div>
          <h2 className="font-condensed text-lg font-bold text-bms-ink">
            Guided IF/THEN Rule Builder
          </h2>
          <p className="text-xs text-bms-muted">
            Operator-created threshold and time-window rules only. No commands,
            breaker actions, schedulers, or real-source automation.
          </p>
        </div>
        <button
          className="rounded border border-gray-300 px-3 py-1.5 text-xs font-semibold text-bms-muted"
          onClick={() => {
            setForm(emptyForm);
            setPreview(null);
            setError(null);
            onClearSelected();
          }}
        >
          New draft
        </button>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Rule name">
            <input
              className={fieldClass}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="CR Q9 current warning"
            />
          </Field>
          <Field label="Rule code">
            <input
              className={fieldClass}
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              placeholder="Auto-generated if blank"
            />
          </Field>
          <Field label="Category">
            <select
              className={fieldClass}
              value={form.category}
              onChange={(e) =>
                setForm({ ...form, category: e.target.value as AutomationRuleCategory })
              }
            >
              <option value="operations">Operations</option>
              <option value="energy">Energy</option>
              <option value="comfort">Comfort</option>
              <option value="safety">Safety</option>
            </select>
          </Field>
          <Field label="Rule type">
            <select
              className={fieldClass}
              value={form.ruleType}
              onChange={(e) =>
                setForm({ ...form, ruleType: e.target.value as AutomationRuleType })
              }
            >
              <option value="threshold">Threshold</option>
              <option value="time_window">Time window</option>
            </select>
          </Field>
        </div>

        <Field label="Description">
          <textarea
            className={`${fieldClass} min-h-16`}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Explain what the operator should review when this rule matches."
          />
        </Field>

        {form.ruleType === "threshold" ? (
          <div className="rounded border border-gray-200 bg-gray-50 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-bms-muted">
              IF latest telemetry matches
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Asset">
                <select
                  className={fieldClass}
                  value={form.assetId}
                  onChange={(e) =>
                    setForm({ ...form, assetId: e.target.value, pointKey: "" })
                  }
                >
                  <option value="">Select asset</option>
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.code} · {asset.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Telemetry Point">
                <select
                  className={fieldClass}
                  value={form.pointKey}
                  onChange={(e) => setForm({ ...form, pointKey: e.target.value })}
                >
                  <option value="">Select point</option>
                  {pointKeys.map((pointKey) => (
                    <option key={pointKey} value={pointKey}>
                      {pointKey}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Operator">
                <select
                  className={fieldClass}
                  value={form.operator}
                  onChange={(e) =>
                    setForm({ ...form, operator: e.target.value as AutomationRuleOperator })
                  }
                >
                  <option value="gt">above</option>
                  <option value="gte">at least</option>
                  <option value="lt">below</option>
                  <option value="lte">at most</option>
                  <option value="eq">equals</option>
                </select>
              </Field>
              <Field label="Threshold">
                <input
                  className={fieldClass}
                  inputMode="decimal"
                  value={form.thresholdValue}
                  onChange={(e) => setForm({ ...form, thresholdValue: e.target.value })}
                  placeholder="3"
                />
              </Field>
            </div>
          </div>
        ) : (
          <div className="rounded border border-gray-200 bg-gray-50 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-bms-muted">
              IF current time is inside window
            </div>
            <div className="flex flex-wrap gap-2">
              {dayOptions.map(([value, label]) => (
                <label key={value} className="flex items-center gap-1 text-xs text-bms-muted">
                  <input
                    type="checkbox"
                    checked={form.days.includes(value)}
                    onChange={(e) => {
                      const days = e.target.checked
                        ? [...form.days, value]
                        : form.days.filter((day) => day !== value);
                      setForm({ ...form, days });
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Field label="Start time">
                <input
                  className={fieldClass}
                  type="time"
                  value={form.startTime}
                  onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                />
              </Field>
              <Field label="End time">
                <input
                  className={fieldClass}
                  type="time"
                  value={form.endTime}
                  onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                />
              </Field>
            </div>
          </div>
        )}

        <div className="rounded border border-gray-200 bg-gray-50 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-bms-muted">
            THEN create an operator trace
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Severity">
              <select
                className={fieldClass}
                value={form.severity}
                onChange={(e) =>
                  setForm({
                    ...form,
                    severity: e.target.value as "info" | "warning" | "critical",
                  })
                }
              >
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </Field>
            <Field label="Action">
              <select
                className={fieldClass}
                value={form.actionType}
                onChange={(e) =>
                  setForm({
                    ...form,
                    actionType: e.target.value as "notify" | "review" | "trace_only",
                  })
                }
              >
                <option value="notify">Notify</option>
                <option value="review">Review</option>
                <option value="trace_only">Trace only</option>
              </select>
            </Field>
            <Field label="Target">
              <input
                className={fieldClass}
                value={form.actionTarget}
                onChange={(e) => setForm({ ...form, actionTarget: e.target.value })}
                placeholder="Operations"
              />
            </Field>
          </div>
        </div>

        {invalidReason ? (
          <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {invalidReason}
          </p>
        ) : null}
        {error ? (
          <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        ) : null}
        {preview ? <PreviewResult result={preview} /> : null}

        <div className="flex flex-wrap gap-2">
          <button
            className="rounded border border-gray-300 px-3 py-2 text-xs font-semibold text-bms-muted disabled:opacity-50"
            disabled={!canSubmit}
            onClick={() => previewM.mutate({ ...payload, id: form.id })}
          >
            {previewM.isPending ? "Previewing..." : "Preview latest data"}
          </button>
          <button
            className="rounded bg-gray-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            disabled={!canSubmit}
            onClick={() =>
              form.id
                ? updateM.mutate({
                    id: form.id,
                    payload: { ...payload, reason: "Operator saved rule draft" },
                  })
                : createM.mutate(payload)
            }
          >
            {form.id ? "Save changes" : "Save draft"}
          </button>
          <button
            className="rounded bg-bms-green px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            disabled={!form.id || !canSubmit}
            onClick={() => form.id && publishM.mutate({ id: form.id })}
          >
            {publishM.isPending ? "Publishing..." : "Publish and enable"}
          </button>
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-xs font-semibold text-bms-muted">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function PreviewResult({ result }: { result: RulePreviewResult }) {
  return (
    <div className="rounded border border-bms-green/20 bg-bms-green/5 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-bms-muted">
        Preview Result
      </div>
      <p className="mt-1 text-sm font-semibold text-bms-ink">
        {result.status.replace("_", " ")} · {result.message}
      </p>
      <pre className="mt-2 max-h-28 overflow-auto rounded bg-gray-950 p-2 text-[11px] text-gray-100">
        {JSON.stringify(result.trace, null, 2)}
      </pre>
    </div>
  );
}

function buildPayload(form: BuilderForm): RuleDraftPayload {
  if (form.ruleType === "time_window") {
    return {
      code: form.code || undefined,
      name: form.name,
      description: form.description || null,
      category: form.category,
      ruleType: form.ruleType,
      severity: form.severity,
      condition: {
        days: form.days,
        startTime: form.startTime,
        endTime: form.endTime,
      },
      action: { type: form.actionType, target: form.actionTarget },
    };
  }

  return {
    code: form.code || undefined,
    name: form.name,
    description: form.description || null,
    category: form.category,
    ruleType: form.ruleType,
    assetId: form.assetId,
    pointKey: form.pointKey,
    operator: form.operator,
    thresholdValue: Number(form.thresholdValue),
    severity: form.severity,
    condition: { window: "latest" },
    action: { type: form.actionType, target: form.actionTarget },
  };
}

function formFromRule(rule: RuleListItem): BuilderForm {
  const timeCondition = "days" in rule.condition ? rule.condition : null;
  return {
    id: rule.id,
    code: rule.code.toUpperCase(),
    name: rule.name,
    description: rule.description ?? "",
    category: rule.category,
    ruleType: rule.ruleType,
    assetId: rule.assetId ?? "",
    pointKey: rule.pointKey ?? "",
    operator: rule.operator ?? "gt",
    thresholdValue: rule.thresholdValue === null ? "" : String(rule.thresholdValue),
    severity: normalizeSeverity(rule.severity),
    actionType: rule.action.type,
    actionTarget: rule.action.target,
    days: timeCondition?.days ?? emptyForm.days,
    startTime: timeCondition?.startTime ?? emptyForm.startTime,
    endTime: timeCondition?.endTime ?? emptyForm.endTime,
  };
}

function normalizeSeverity(value: string | null): "info" | "warning" | "critical" {
  if (value === "info" || value === "critical") {
    return value;
  }
  return "warning";
}

function validateForm(form: BuilderForm): string | null {
  if (form.name.trim().length < 3) {
    return "Add a rule name with at least 3 characters.";
  }
  if (form.actionTarget.trim().length < 2) {
    return "Add an action target so operators know who owns the trace.";
  }
  if (form.ruleType === "threshold") {
    if (!form.assetId || !form.pointKey) {
      return "Select an asset and compatible telemetry point.";
    }
    if (form.thresholdValue.trim() === "" || Number.isNaN(Number(form.thresholdValue))) {
      return "Enter a numeric threshold value.";
    }
  }
  if (form.ruleType === "time_window" && form.days.length === 0) {
    return "Select at least one day for the time-window rule.";
  }
  return null;
}

function invalidateRules(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["rules", "list"] });
  void qc.invalidateQueries({ queryKey: ["rules", "executions"] });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Rule operation failed.";
}
