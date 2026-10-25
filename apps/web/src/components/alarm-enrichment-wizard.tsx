import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { AlarmDetailsResponse, AlarmSkillDto } from "@bms/shared";

import { saveAlarmEnrichment } from "../api/alarms";
import type { AssetRow } from "../api/assets";
import { alarmSkillLabel, toLocalDateTimeInputValue } from "../lib/alarm-details";
import { apiErrorMessage } from "../lib/api-error-message";
import { filterAssetsByQuery, toggleAssetSelection } from "../lib/asset-picker";
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
};

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
export function AlarmEnrichmentWizard({ details, skills, assets, assetsLoading, onCancel, onSaved }: AlarmEnrichmentWizardProps) {
  const [values, setValues] = useState<Body>(() => bodyOf(details));
  const [assetQuery, setAssetQuery] = useState("");
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
      submitting={save.isPending}
      submitError={save.error ? apiErrorMessage(save.error) : null}
      summary={entry.summary({
        body: values,
        params: { id: details.id },
        targetName: details.assetName,
        organizationName: "",
        alarm: { message: details.message, severity: details.severity, assetName: details.assetName, raisedAt: details.raisedAt },
      })}
    />
  );
}
