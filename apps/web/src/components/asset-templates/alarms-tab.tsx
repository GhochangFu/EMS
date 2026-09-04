/**
 * The Alarms tab (`F2.5`, ADR 0038 Unit 9e).
 *
 * Wiring only. The rules are `src/lib/template-alarm-form.ts`; the write goes
 * through Unit 6's `mergeTemplateContent`.
 *
 * ## This is class-level authoring, not a rule builder
 *
 * Nothing here creates a `bms.automation_rules` row, and the page must not read
 * as though it might — a rule needs `ruleType`, `condition` and `action`, which
 * a template does not carry. What an author writes here is the threshold and
 * the knowledge about it, stored on the template and copied nowhere by this
 * feature.
 *
 * `rule-builder-panel.tsx` was read for the **form idiom** this repository
 * uses, and its five operator wordings are reused so one comparison does not
 * get two names in one product. Nothing is imported from it and nothing here
 * extends it.
 *
 * ## Three vocabularies, none of them hardcoded
 *
 * `severity` (ADR 0032), `category` (ADR 0031 Amendment 1) and
 * `philosophy.skill` (ADR 0034) are rows, not enums —
 * `templateAlarmSchema` checks shape only and
 * `assertTemplateAlarmVocabularies` closes each set server-side. All three come
 * from `GET /api/v1/vocabularies` through the shared query key.
 *
 * The **operator** is different and is deliberately a literal list: it is a
 * closed union in the contract, and `ALARM_OPERATORS` reads it from there.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { AdminAssetTemplateDto, TemplateAlarm } from "@bms/shared";

import { updateAdminAssetTemplate } from "../../api/admin/asset-templates";
import { apiErrorMessage } from "../../lib/api-error-message";
import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import {
  ALARM_OPERATORS,
  MAX_ALARM_ENTRIES,
  OPERATOR_LABELS,
  alarmFormErrors,
  alarmRowsFrom,
  alarmsHaveChanged,
  blankAlarmRow,
  buildAlarmPayload,
  type TemplateAlarmRow,
} from "../../lib/template-alarm-form";
import { mergeTemplateContent, unwritableContentKeys } from "../../lib/template-content-merge";
import { Field } from "./field";

type AlarmsTabProps = {
  template: AdminAssetTemplateDto;
  editable: boolean;
  onSaved: (next: AdminAssetTemplateDto) => void;
  /** Tells the page whether leaving this tab would discard an edit. */
  onDirtyChange: (dirty: boolean) => void;
};

/**
 * The fields inside the collapsible philosophy block.
 *
 * Named here rather than checked inline so the `<details open>` condition and
 * the summary badge cannot drift apart, and so a fifth philosophy field added
 * to `alarmPhilosophySchema` is one edit rather than two.
 */
const PHILOSOPHY_FIELDS = ["cause", "impact", "action", "skill"];

/** The stored section, read from the loose `content` record. */
function storedAlarms(template: AdminAssetTemplateDto): TemplateAlarm[] | undefined {
  const section = template.content.alarms;
  return Array.isArray(section) ? (section as TemplateAlarm[]) : undefined;
}

export function AlarmsTab({ template, editable, onSaved, onDirtyChange }: AlarmsTabProps) {
  const [rows, setRows] = useState<TemplateAlarmRow[]>(() => alarmRowsFrom(storedAlarms(template)));
  const [error, setError] = useState<string | null>(null);

  // Keyed on the row id and the lifecycle status — see `details-tab.tsx`.
  useEffect(() => {
    setRows(alarmRowsFrom(storedAlarms(template)));
    setError(null);
  }, [template.id, template.status]);

  const vocabQ = useQuery({ queryKey: vocabulariesQueryKey, queryFn: fetchVocabularies });
  const vocabularies = {
    severities: (vocabQ.data?.alarmSeverities ?? []).map((entry) => entry.code),
    categories: (vocabQ.data?.ruleCategories ?? []).map((entry) => entry.code),
    skills: (vocabQ.data?.alarmSkills ?? []).map((entry) => entry.code),
  };

  const declaredPointKeys = template.points.map((point) => point.pointKey);
  const blockedKeys = unwritableContentKeys(template.content);
  const changed = alarmsHaveChanged(rows, storedAlarms(template));

  // The same comparison Save already uses, reported up so the page can guard a
  // tab switch. The cleanup reports clean on unmount, so switching away cannot
  // leave the page holding this tab's `true`.
  useEffect(() => {
    onDirtyChange(changed);
    return () => onDirtyChange(false);
  }, [changed, onDirtyChange]);

  // While the vocabularies are still loading every code looks retired, which
  // would paint a valid form red. The membership checks are meaningful only
  // once the lists have arrived.
  const problems = vocabQ.isSuccess ? alarmFormErrors(rows, declaredPointKeys, vocabularies) : [];
  const blocked = !vocabQ.isSuccess || problems.length > 0 || blockedKeys.length > 0;

  const saveM = useMutation({
    mutationFn: () =>
      updateAdminAssetTemplate(template.id, {
        content: mergeTemplateContent(template.content, {
          section: "alarms",
          value: buildAlarmPayload(rows),
        }),
      }),
    onSuccess: (next) => {
      setError(null);
      onSaved(next);
    },
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });

  function update(index: number, patch: Partial<TemplateAlarmRow>) {
    setRows((current) =>
      current.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)),
    );
  }

  const sectionProblems = problems.filter((problem) => problem.row === null);

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>
      ) : null}

      {blockedKeys.length > 0 ? (
        <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Saving alarms is blocked: this template holds content that cannot be written back. The
          banner above lists the keys.
        </p>
      ) : null}

      {/* An instruction, not a disclaimer. This used to end "Nothing here
          creates or edits a live automation rule" — true, and it still let a
          reader who had just read it expect that saving here armed something.
          A negative gives an author nothing to act on. Naming the next step
          does, and an alarm screen that looks like it protects an asset class
          while nothing watches is the one misreading here that has a
          consequence. */}
      <p className="rounded border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
        These are the thresholds this asset class ships with, and the knowledge behind each one.
        They are stored on the template as a standard — <strong>nothing here watches a live asset
        yet</strong>. To act on one of these, create the matching rule in the Rule Engine for each
        asset. Saving this tab does not create, change or remove any automation rule.
      </p>

      {sectionProblems.map((problem) => (
        <p
          key={problem.message}
          className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800"
        >
          {problem.message}
        </p>
      ))}

      {rows.length === 0 ? (
        <p className="rounded border border-dashed border-gray-300 p-4 text-xs text-bms-muted">
          This template declares no alarms yet.
        </p>
      ) : null}

      {rows.map((alarm, index) => {
        const rowProblems = problems.filter((problem) => problem.row === index);
        const problemFor = (field: string) =>
          rowProblems.find((problem) => problem.field === field)?.message;

        return (
          <section key={index} className="rounded border border-gray-200 p-3">
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Code" error={problemFor("code")}>
                <input
                  type="text"
                  value={alarm.code}
                  disabled={!editable}
                  onChange={(event) => update(index, { code: event.target.value })}
                  className={fieldClass(!editable, problemFor("code"))}
                />
              </Field>
              <Field label="Point" error={problemFor("pointKey")}>
                <select
                  value={alarm.pointKey}
                  disabled={!editable}
                  onChange={(event) => update(index, { pointKey: event.target.value })}
                  className={fieldClass(!editable, problemFor("pointKey"))}
                >
                  <option value="">Choose a point…</option>
                  {/* A point removed on the Points tab. Kept selectable so the
                      row shows what it holds and the problem names it, rather
                      than snapping to another point's threshold. */}
                  {alarm.pointKey !== "" && !declaredPointKeys.includes(alarm.pointKey) ? (
                    <option value={alarm.pointKey}>{alarm.pointKey} (not declared)</option>
                  ) : null}
                  {declaredPointKeys.map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Severity" error={problemFor("severity")}>
                <select
                  value={alarm.severity}
                  disabled={!editable || !vocabQ.isSuccess}
                  onChange={(event) => update(index, { severity: event.target.value })}
                  className={fieldClass(!editable, problemFor("severity"))}
                >
                  <option value="">Choose…</option>
                  {alarm.severity !== "" && !vocabularies.severities.includes(alarm.severity) ? (
                    <option value={alarm.severity}>{alarm.severity} (retired)</option>
                  ) : null}
                  {(vocabQ.data?.alarmSeverities ?? []).map((entry) => (
                    <option key={entry.code} value={entry.code}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <Field label="Fires when the value is">
                {/* ADR 0019 Amendment 2: `operator` and `thresholdValue` are a
                    paired optional group, so this select needs an explicit
                    empty option — "not set" is a legitimate authored state
                    (an alarm philosophy row), not an omission to guess past. */}
                <select
                  value={alarm.operator}
                  disabled={!editable}
                  onChange={(event) => update(index, { operator: event.target.value })}
                  className={fieldClass(!editable, undefined)}
                >
                  <option value="">Not set — philosophy only</option>
                  {ALARM_OPERATORS.map((operator) => (
                    <option key={operator} value={operator}>
                      {OPERATOR_LABELS[operator]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Threshold" error={problemFor("thresholdValue")}>
                {/* Pair-absent (both empty): no input at all — a threshold
                    means nothing without a comparator, so the row explains
                    itself instead of showing an editable empty box. Choosing
                    an operator above is what makes this input reappear. */}
                {alarm.operator === "" && alarm.thresholdValue === "" ? (
                  <p className="w-full rounded border border-dashed border-gray-200 px-2 py-1.5 text-xs text-bms-muted">
                    value set per site at commissioning
                  </p>
                ) : (
                  // `inputMode="decimal"` on a text input, as the rule builder
                  // does: a `type="number"` box reports an empty string for
                  // several kinds of invalid input, which would make a typo
                  // indistinguishable from a cleared field.
                  <input
                    type="text"
                    inputMode="decimal"
                    value={alarm.thresholdValue}
                    disabled={!editable}
                    placeholder="12"
                    onChange={(event) => update(index, { thresholdValue: event.target.value })}
                    className={fieldClass(!editable, problemFor("thresholdValue"))}
                  />
                )}
              </Field>
              <Field label="Category" error={problemFor("category")}>
                <select
                  value={alarm.category}
                  disabled={!editable || !vocabQ.isSuccess}
                  onChange={(event) => update(index, { category: event.target.value })}
                  className={fieldClass(!editable, problemFor("category"))}
                >
                  <option value="">not set</option>
                  {alarm.category !== "" && !vocabularies.categories.includes(alarm.category) ? (
                    <option value={alarm.category}>{alarm.category} (retired)</option>
                  ) : null}
                  {(vocabQ.data?.ruleCategories ?? []).map((entry) => (
                    <option key={entry.code} value={entry.code}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="mt-3">
              <Field label="Message" error={problemFor("message")}>
                <input
                  type="text"
                  value={alarm.message}
                  disabled={!editable}
                  placeholder="What an operator sees when this fires."
                  onChange={(event) => update(index, { message: event.target.value })}
                  className={fieldClass(!editable, problemFor("message"))}
                />
              </Field>
            </div>

            {/* Open by default on a **read-only** template (`F2.20`). There is
                no Save to protect on a version that can never accept a write,
                and reading is the other job this tab has: closed `<details>`
                content is absent from `innerText` altogether, which is how
                `E5.3`'s first browser pass reported a `philosophy.skill` that
                was present in the data as missing from the page.

                On an **editable** template the collapse stays, and is forced
                open only when a philosophy field is failing. A collapsed block
                hiding the only failing field leaves the author with a disabled
                Save, a "fix the problems above" message, and nothing visible to
                fix — which reads as the form being broken. */}
            <details
              className="mt-3"
              open={
                !editable ||
                rowProblems.some((problem) => PHILOSOPHY_FIELDS.includes(problem.field))
              }
            >
              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-bms-muted">
                Alarm philosophy
                {rowProblems.some((problem) => PHILOSOPHY_FIELDS.includes(problem.field)) ? (
                  <span className="ml-2 font-normal text-red-700">needs attention</span>
                ) : null}
              </summary>
              <div className="mt-2 grid gap-3 md:grid-cols-2">
                <Field label="Likely cause" error={problemFor("cause")}>
                  <textarea
                    rows={2}
                    value={alarm.cause}
                    disabled={!editable}
                    onChange={(event) => update(index, { cause: event.target.value })}
                    className={fieldClass(!editable, problemFor("cause"))}
                  />
                </Field>
                <Field label="Impact" error={problemFor("impact")}>
                  <textarea
                    rows={2}
                    value={alarm.impact}
                    disabled={!editable}
                    onChange={(event) => update(index, { impact: event.target.value })}
                    className={fieldClass(!editable, problemFor("impact"))}
                  />
                </Field>
                <Field label="Action" error={problemFor("action")}>
                  <textarea
                    rows={2}
                    value={alarm.action}
                    disabled={!editable}
                    onChange={(event) => update(index, { action: event.target.value })}
                    className={fieldClass(!editable, problemFor("action"))}
                  />
                </Field>
                <Field label="Skill needed" error={problemFor("skill")}>
                  <select
                    value={alarm.skill}
                    disabled={!editable || !vocabQ.isSuccess}
                    onChange={(event) => update(index, { skill: event.target.value })}
                    className={fieldClass(!editable, problemFor("skill"))}
                  >
                    <option value="">not set</option>
                    {alarm.skill !== "" && !vocabularies.skills.includes(alarm.skill) ? (
                      <option value={alarm.skill}>{alarm.skill} (retired)</option>
                    ) : null}
                    {(vocabQ.data?.alarmSkills ?? []).map((entry) => (
                      <option key={entry.code} value={entry.code}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </details>

            {editable ? (
              <button
                type="button"
                onClick={() =>
                  setRows((current) => current.filter((_, position) => position !== index))
                }
                className="mt-3 rounded border border-red-200 px-3 py-1 text-[11px] font-semibold text-red-700"
              >
                Remove
              </button>
            ) : null}
          </section>
        );
      })}

      {editable ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={rows.length >= MAX_ALARM_ENTRIES}
            onClick={() => setRows((current) => [...current, blankAlarmRow()])}
            className="rounded border border-gray-200 px-3 py-1.5 text-xs font-semibold text-bms-ink disabled:opacity-60"
          >
            Add an alarm
          </button>
          <button
            type="button"
            disabled={blocked || !changed || saveM.isPending}
            onClick={() => saveM.mutate()}
            className="rounded bg-bms-green px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
          >
            {saveM.isPending ? "Saving…" : "Save alarms"}
          </button>
          <span className="text-[11px] text-bms-muted">
            {!vocabQ.isSuccess
              ? "Loading the severity, category and skill vocabularies…"
              : blockedKeys.length > 0
                ? "Blocked by unwritable content."
                : problems.length > 0
                  ? "Fix the problems above to save."
                  : changed
                    ? "Sends this section; every other section is carried unchanged."
                    : "No changes yet."}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function fieldClass(disabled: boolean, problem: string | undefined): string {
  const tone = problem ? "border-red-300 bg-red-50" : "border-gray-200";
  return `w-full rounded border px-2 py-1.5 text-xs ${tone} ${
    disabled ? "bg-gray-50 text-bms-muted" : ""
  }`;
}
