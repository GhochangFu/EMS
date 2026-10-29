import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { AlarmSeverityDto, RuleBuilderCatalogAsset } from "@bms/shared";
import { RULE_BATCH_MAX_ROWS } from "@bms/shared/contracts";
import { RULE_LIVE_LINE } from "@bms/shared/copilot";

import { createRuleBatch, fetchRuleBuilderCatalog, type RuleDraftPayload } from "../../api/rules";
import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import { apiErrorMessage } from "../../lib/api-error-message";
import { AdminWizardFrame } from "../admin/admin-wizard-frame";
import { WizardShell } from "../wizard/wizard-shell";
import { wizardEntry } from "./rule-lifecycle-wizard";

/**
 * `F4.289` (ADR 0099 Amendment 9 E3; owner ruling P1, 2026-10-27) — the Rule
 * Engine's batch-create wizard: `rule.createBatch` on the shared `WizardShell`,
 * Rules → Review. The Rules step is a table form of up to 25 threshold rules,
 * one row each (name, asset, point, operator, threshold, severity). Submit sends
 * the plain `POST /rules/batch` (no `X-Copilot-Change`), which creates **and
 * publishes** every row in one transaction, all or none; the route's validator
 * still decides. The `<WizardShell>` line writes the literal
 * `entry={wizardEntry("rule.createBatch")}` (the stepper gate's form).
 *
 * Layout (AGENTS.md §5): the mockups draw no batch form. The frame and the
 * stepper are the existing rule wizards' (`AdminWizardFrame` + `WizardShell`, as
 * `RuleLifecycleWizard`); the rows are the `ESKOM_SMOC.html` Rule Engine page's
 * (`R.rl`, `#/rules`) rule list, as a table of inputs.
 */

/** One row of the table form: a threshold rule's own fields, the threshold as typed. */
type BatchRow = {
  name: string;
  assetId: string;
  pointKey: string;
  operator: string;
  threshold: string;
  severity: string;
};

const BLANK_ROW: BatchRow = { name: "", assetId: "", pointKey: "", operator: "gt", threshold: "", severity: "warning" };

const OPERATORS: readonly { value: string; label: string }[] = [
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "eq", label: "=" },
];

/**
 * The route's draft for one row. A blank threshold is `null` (the validator asks for it), never the
 * `0` an empty string coerces to; text that is not a number stays text, so the step names the row.
 */
export function draftOfRow(row: BatchRow): Record<string, unknown> {
  const threshold = row.threshold.trim();
  return {
    name: row.name,
    ruleType: "threshold",
    assetId: row.assetId === "" ? null : row.assetId,
    pointKey: row.pointKey === "" ? null : row.pointKey,
    operator: row.operator,
    thresholdValue: threshold === "" ? null : Number.isFinite(Number(threshold)) ? Number(threshold) : threshold,
    severity: row.severity === "" ? null : row.severity,
    condition: { window: "latest" },
    action: { type: "notify", target: "Operations" },
  };
}

/** A row from one route draft (a copilot fill of the Rules step); a field that is not text is left blank. */
function rowOfDraft(draft: unknown): BatchRow {
  const d = typeof draft === "object" && draft !== null ? (draft as Record<string, unknown>) : {};
  const text = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
  return {
    name: text(d.name),
    assetId: text(d.assetId),
    pointKey: text(d.pointKey),
    operator: text(d.operator, BLANK_ROW.operator),
    threshold: typeof d.thresholdValue === "number" ? String(d.thresholdValue) : text(d.thresholdValue),
    severity: text(d.severity, BLANK_ROW.severity),
  };
}

/** The table's column for a draft field the Zod path names; any other field keeps its name. */
const COLUMN_OF: Readonly<Record<string, string>> = {
  name: "name",
  assetId: "asset",
  pointKey: "point",
  operator: "operator",
  thresholdValue: "threshold",
  severity: "severity",
};

/**
 * A Next refusal in the table's terms: the step parses `rules`, so Zod names
 * `rules.<i>.<field>` from 0, while the `#` column and the route's own refusals
 * (`Row N: …`) count from 1. `rules.1.name: …` becomes `Row 2 name: …`; a
 * refusal that is not about one row is left as it is.
 */
export function rowProblem(problem: string): string {
  const match = /^rules\.(\d+)(?:\.([^:]+))?: ([\s\S]*)$/.exec(problem);
  if (match === null) return problem;
  const [, index, field, message] = match;
  const column = field === undefined ? "" : ` ${COLUMN_OF[field] ?? field}`;
  return `Row ${Number(index) + 1}${column}: ${message}`;
}

type RuleBatchWizardProps = {
  onCancel: () => void;
  onDone: () => Promise<void> | void;
};

export function RuleBatchWizard({ onCancel, onDone }: RuleBatchWizardProps) {
  const catalogQ = useQuery({ queryKey: ["rules", "catalog"], queryFn: fetchRuleBuilderCatalog });
  const vocabQ = useQuery({ queryKey: vocabulariesQueryKey, queryFn: fetchVocabularies, staleTime: 5 * 60 * 1000 });
  const [rows, setRows] = useState<BatchRow[]>([{ ...BLANK_ROW }]);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => createRuleBatch(body as { rules: RuleDraftPayload[] }),
    onSuccess: async () => onDone(),
  });
  const assets = catalogQ.data?.assets ?? [];
  const severities = vocabQ.data?.alarmSeverities ?? [];
  const values = { rules: rows.map(draftOfRow) };
  const assetCount = new Set(rows.map((row) => row.assetId).filter((id) => id !== "")).size;
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  return (
    <AdminWizardFrame title="Create and publish alarm rules">
      <WizardShell
        entry={wizardEntry("rule.createBatch")}
        params={{}}
        values={values}
        // A copilot fill of the Rules step brings route drafts: the table takes the first 25 as rows.
        onChange={(next) => {
          if (Array.isArray(next.rules) && next.rules.length > 0) setRows(next.rules.slice(0, RULE_BATCH_MAX_ROWS).map(rowOfDraft));
        }}
        formatProblem={rowProblem}
        renderStep={() => <BatchRowsTable rows={rows} setRows={setRows} assets={assets} severities={severities} />}
        onSubmit={(body) => save.mutate(body)}
        onCancel={onCancel}
        submitting={save.isPending}
        submitError={save.error ? apiErrorMessage(save.error) : null}
        dirty={rows.some((row) => row.name !== "" || row.assetId !== "" || row.threshold !== "")}
        summary={`Create and publish ${count(rows.length, "alarm rule")} on ${count(assetCount, "asset")}. ${RULE_LIVE_LINE}`}
      />
    </AdminWizardFrame>
  );
}

function BatchRowsTable({
  rows,
  setRows,
  assets,
  severities,
}: {
  rows: BatchRow[];
  setRows: (rows: BatchRow[]) => void;
  assets: readonly RuleBuilderCatalogAsset[];
  severities: readonly AlarmSeverityDto[];
}) {
  const set = (index: number, patch: Partial<BatchRow>) =>
    setRows(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  const cell = "surface-field w-full px-1 py-1 text-xs";
  return (
    <>
      <p className="text-xs text-ink-muted">
        Up to {RULE_BATCH_MAX_ROWS} threshold rules. Every row is created and published at once.
      </p>
      <div className="overflow-x-auto">
        <table aria-label="Rules to create" className="w-full border-collapse text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-ink-muted">
              {["#", "Name", "Asset", "Point", "Operator", "Threshold", "Severity", ""].map((label, at) => (
                <th key={at} scope="col" className="py-0.5 pr-1 font-semibold">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const n = index + 1;
              const pointKeys = assets.find((asset) => asset.id === row.assetId)?.pointKeys ?? [];
              return (
                <tr key={index}>
                  <td className="py-0.5 pr-1">{n}</td>
                  <td className="py-0.5 pr-1">
                    <input aria-label={`Row ${n} name`} className={cell} value={row.name} onChange={(e) => set(index, { name: e.target.value })} />
                  </td>
                  <td className="py-0.5 pr-1">
                    <select
                      aria-label={`Row ${n} asset`}
                      className={cell}
                      value={row.assetId}
                      onChange={(e) => set(index, { assetId: e.target.value, pointKey: "" })}
                    >
                      <option value="">Asset</option>
                      {assets.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.code}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-0.5 pr-1">
                    <select aria-label={`Row ${n} point`} className={cell} value={row.pointKey} onChange={(e) => set(index, { pointKey: e.target.value })}>
                      <option value="">Point</option>
                      {pointKeys.map((key) => (
                        <option key={key} value={key}>
                          {key}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-0.5 pr-1">
                    <select aria-label={`Row ${n} operator`} className={cell} value={row.operator} onChange={(e) => set(index, { operator: e.target.value })}>
                      {OPERATORS.map((operator) => (
                        <option key={operator.value} value={operator.value}>
                          {operator.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-0.5 pr-1">
                    <input
                      aria-label={`Row ${n} threshold`}
                      inputMode="decimal"
                      className={cell}
                      value={row.threshold}
                      onChange={(e) => set(index, { threshold: e.target.value })}
                    />
                  </td>
                  <td className="py-0.5 pr-1">
                    <select aria-label={`Row ${n} severity`} className={cell} value={row.severity} onChange={(e) => set(index, { severity: e.target.value })}>
                      {severities.map((severity) => (
                        <option key={severity.code} value={severity.code}>
                          {severity.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-0.5">
                    <button
                      type="button"
                      aria-label={`Remove row ${n}`}
                      disabled={rows.length === 1}
                      onClick={() => setRows(rows.filter((_, at) => at !== index))}
                      className="surface-button px-2 py-1 text-xs disabled:opacity-50"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        disabled={rows.length >= RULE_BATCH_MAX_ROWS}
        onClick={() => setRows([...rows, { ...BLANK_ROW }])}
        className="surface-button self-start px-3 py-1 text-xs disabled:opacity-50"
      >
        Add row
      </button>
    </>
  );
}
