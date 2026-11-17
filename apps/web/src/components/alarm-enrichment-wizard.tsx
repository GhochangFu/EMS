import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { AlarmDetailsResponse, AlarmSkillDto } from "@bms/shared";

import { saveAlarmEnrichment } from "../api/alarms";
import type { AssetRow } from "../api/assets";
import { alarmSkillLabel, toLocalDateTimeInputValue } from "../lib/alarm-details";
import { alarmSubjectName } from "../lib/alarm-source";
import { apiErrorMessage } from "../lib/api-error-message";
import { filterAssetsByQuery, toggleAssetSelection } from "../lib/asset-picker";
import { holdsText } from "../lib/root-cause-suggestions";
import { operationsWizardEntry } from "./alarm-ack-wizard";
import { WizardShell } from "./wizard/wizard-shell";

export type AlarmEnrichmentWizardProps = {
  details: AlarmDetailsResponse;
  skills: readonly AlarmSkillDto[];
  /** The alarm organization's assets the caller may read (the picker's list). */
  assets: readonly AssetRow[];
  assetsLoading: boolean;
  onCancel: () => void;
  onSaved: (updated: AlarmDetailsResponse) => void;
  /**
   * `E2.3` (ADR 0136 decision 6): a suggestion's text for `rootCause`, from the panel's "Use as
   * root cause". Each click is a new `seq`. It fills `rootCause` only and sends nothing.
   */
  rootCauseFill?: { readonly text: string; readonly seq: number } | null;
};

/** The replace question and the status line (plan §7 T2.4, §17 Q5: the words say Submit). */
export const ROOT_CAUSE_REPLACE_QUESTION = "The root cause field already has text. Replace it with this suggestion?";
export const ROOT_CAUSE_FILLED_STATUS =
  "Root cause filled from a suggestion (step 1, Analysis). Nothing is saved until you press Submit.";

const fieldClass = "mt-1 surface-field w-full px-3 py-2 text-sm";
const labelClass = "text-xs font-medium text-ink-muted";

type Body = Record<string, unknown>;

/**
 * The body as it is stored now. Every field is sent (decision 6's full-set editor): an empty
 * text is `null`, and `affectedAssetIds` always goes, `[]` included, because the wizard opens
 * on the server's current set — a complete replacement, never a partial edit.
 */
function bodyOf(details: AlarmDetailsResponse): Body {
  const enrichment = details.enrichment;
  return {
    rootCause: enrichment?.rootCause ?? null,
    impact: enrichment?.impact ?? null,
    correctiveActions: enrichment?.correctiveActions ?? null,
    energyImpact: enrichment?.energyImpact ?? null,
    waterImpact: enrichment?.waterImpact ?? null,
    productionImpact: enrichment?.productionImpact ?? null,
    etrAt: enrichment?.etrAt ?? null,
    skillCode: enrichment?.skillCode ?? null,
    affectedAssetIds: enrichment?.affectedAssets.map((asset) => asset.assetId) ?? [],
  };
}

const TEXT_FIELDS: Readonly<Record<string, readonly (readonly [string, string, string])[]>> = {
  analysis: [
    ["rootCause", "root-cause", "Root cause"],
    ["impact", "impact", "Impact"],
    ["correctiveActions", "corrective-actions", "Corrective actions"],
  ],
  impacts: [
    ["energyImpact", "energy-impact", "Energy impact"],
    ["waterImpact", "water-impact", "Water impact"],
    ["productionImpact", "production-impact", "Production impact"],
  ],
};

/**
 * `F4.284` (ADR 0099 decision 6; owner ruling Q9) — the alarm's analysis (ADR 0034
 * decision 6) on the shared `WizardShell`, replacing the details panel's one-page
 * form: Analysis → Impacts → Details → Review. Used by operators too; Submit sends
 * the plain `PUT` (no `X-Copilot-Change`).
 *
 * The values are the body itself: the ETR is stored as the server's ISO instant and
 * shown in the `datetime-local` box in local time, converted on each change (the
 * `toLocalDateTimeInputValue` rule). The state is the wizard's own, set once when it
 * mounts, so a background refetch never overwrites what the user is typing.
 */
export function AlarmEnrichmentWizard({ details, skills, assets, assetsLoading, onCancel, onSaved, rootCauseFill }: AlarmEnrichmentWizardProps) {
  const [values, setValues] = useState<Body>(() => bodyOf(details));
  const [assetQuery, setAssetQuery] = useState("");
  // E2.3: a suggestion waiting on the replace question, and whether one was filled (R-l: `dirty`).
  const [pendingFill, setPendingFill] = useState<string | null>(null);
  const [filled, setFilled] = useState(false);

  function fillRootCause(fill: string): void {
    // `rootCause` only, and the whole text: never appended to what was there.
    setValues((prev) => ({ ...prev, rootCause: fill }));
    setPendingFill(null);
    setFilled(true);
  }

  // Each click is read once, when it arrives (`seq`), against the field as it stands now — on
  // whichever step the wizard is (§17 Q5: no jump). Empty: fill. The same text: nothing. Other
  // text: ask first (R-k), inline rather than `window.confirm`.
  useEffect(() => {
    if (!rootCauseFill) return;
    const now = values.rootCause;
    if (!holdsText(now)) fillRootCause(rootCauseFill.text);
    else if ((now as string).trim() === rootCauseFill.text.trim()) setPendingFill(null);
    else setPendingFill(rootCauseFill.text);
  }, [rootCauseFill?.seq]);

  const save = useMutation({
    mutationFn: (body: Body) => saveAlarmEnrichment(details.id, body),
    onSuccess: (updated) => onSaved(updated),
  });
  const set = (key: string, value: unknown) => setValues({ ...values, [key]: value });
  const text = (key: string): string => (typeof values[key] === "string" ? (values[key] as string) : "");
  const skillCode = text("skillCode");
  // The current skill as an option even if the vocabulary retired it (the `F4.44` trap).
  const skillOptions =
    skillCode && !skills.some((skill) => skill.code === skillCode)
      ? [...skills, { code: skillCode, label: alarmSkillLabel(skillCode, skills) ?? skillCode, sortOrder: -1, active: false }]
      : skills;
  const affected = Array.isArray(values.affectedAssetIds) ? (values.affectedAssetIds as string[]) : [];
  const etrAt = text("etrAt");
  const entry = operationsWizardEntry("alarm.enrichment.set");

  return (
    <div className="flex flex-col gap-3">
      {pendingFill !== null ? (
        <div role="alertdialog" aria-label="Replace the root cause" className="surface-raised-sm flex flex-col gap-2 px-3 py-2 text-xs">
          <p>{ROOT_CAUSE_REPLACE_QUESTION}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setPendingFill(null)} className="surface-button px-3 py-1 text-xs">
              Keep current text
            </button>
            <button type="button" onClick={() => fillRootCause(pendingFill)} className="surface-button-primary px-3 py-1 text-xs">
              Replace
            </button>
          </div>
        </div>
      ) : null}
      {filled ? (
        <p role="status" className="text-xs text-ink-muted">
          {ROOT_CAUSE_FILLED_STATUS}
        </p>
      ) : null}
      <WizardShell
        entry={operationsWizardEntry("alarm.enrichment.set")}
        params={{ id: details.id }}
        values={values}
        onChange={setValues}
        current={bodyOf(details)}
        renderStep={(step) =>
          step.id === "details" ? (
            <>
              <div>
                <label className={labelClass} htmlFor="skill-code">
                  Skill / trade
                </label>
                <select id="skill-code" className={fieldClass} value={skillCode} onChange={(e) => set("skillCode", e.target.value || null)}>
                  <option value="">Unassigned</option>
                  {skillOptions.map((skill) => (
                    <option key={skill.code} value={skill.code}>
                      {skill.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="etr">
                  ETR
                </label>
                <input
                  id="etr"
                  type="datetime-local"
                  className={fieldClass}
                  value={etrAt ? toLocalDateTimeInputValue(etrAt) : ""}
                  onChange={(e) => set("etrAt", e.target.value ? new Date(e.target.value).toISOString() : null)}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="affected-assets-search">
                  Affected assets
                </label>
                {affected.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {affected.map((id) => {
                      const asset = assets.find((a) => a.id === id);
                      return (
                        <span key={id} className="inline-flex items-center gap-1 surface-pressed-sm rounded-full px-2 py-0.5 text-xs">
                          {asset?.code ?? id}
                          <button
                            type="button"
                            className="text-ink-muted hover:text-critical-ink"
                            aria-label={`Remove ${asset?.code ?? id}`}
                            onClick={() => set("affectedAssetIds", toggleAssetSelection(affected, id))}
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-ink-muted">None selected.</p>
                )}
                <input
                  id="affected-assets-search"
                  type="text"
                  className="mt-2 surface-field w-full px-3 py-2 text-sm"
                  placeholder="Search assets by code, name or site…"
                  value={assetQuery}
                  onChange={(e) => setAssetQuery(e.target.value)}
                />
                <div className="mt-1 max-h-32 overflow-y-auto surface-pressed">
                  {assetsLoading ? (
                    <p className="px-2 py-1 text-xs text-ink-muted">Loading assets…</p>
                  ) : (
                    filterAssetsByQuery(assets, assetQuery)
                      .slice(0, 50)
                      .map((asset) => (
                        <label key={asset.id} className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-well">
                          <input
                            type="checkbox"
                            checked={affected.includes(asset.id)}
                            onChange={() => set("affectedAssetIds", toggleAssetSelection(affected, asset.id))}
                          />
                          <span className="font-medium">{asset.code}</span>
                          <span className="text-ink-muted">{asset.name}</span>
                        </label>
                      ))
                  )}
                </div>
              </div>
            </>
          ) : (
            (TEXT_FIELDS[step.id] ?? []).map(([key, id, label]) => (
              <div key={key}>
                <label className={labelClass} htmlFor={id}>
                  {label}
                </label>
                <textarea id={id} className={fieldClass} rows={2} value={text(key)} maxLength={2000} onChange={(e) => set(key, e.target.value || null)} />
              </div>
            ))
          )
        }
        onSubmit={(body) => save.mutate(body)}
        onCancel={onCancel}
        dirty={filled}
        submitting={save.isPending}
        submitError={save.error ? apiErrorMessage(save.error) : null}
        summary={entry.summary({
          body: values,
          params: { id: details.id },
          // F3.16: the panel offers a device alarm no enrichment; named as the ack wizard names it.
          targetName: alarmSubjectName(details),
          organizationName: "",
          alarm: { message: details.message, severity: details.severity, assetName: alarmSubjectName(details), raisedAt: details.raisedAt },
        })}
      />
    </div>
  );
}
