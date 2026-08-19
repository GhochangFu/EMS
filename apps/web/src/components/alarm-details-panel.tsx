import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";

import {
  fetchAlarmDetails,
  saveAlarmEnrichment,
  type AlarmEnrichmentUpsertBody,
} from "../api/alarms";
import { fetchVocabularies, vocabulariesQueryKey } from "../api/vocabularies";
import { alarmSkillLabel, formatThresholdPairing, toLocalDateTimeInputValue } from "../lib/alarm-details";
import { alarmSeverityTone } from "../lib/alarm-severity";
import { StatusPill } from "./status-pill";

type AlarmDetailsPanelProps = {
  alarmId: string;
  /** `true` for `viewer` — the write form is not shown, matching the
   * server-side `assertOperationsWriteRole` gate on the write endpoint. */
  readOnly: boolean;
  onClose: () => void;
};

type FormState = {
  rootCause: string;
  impact: string;
  correctiveActions: string;
  energyImpact: string;
  waterImpact: string;
  productionImpact: string;
  /** `<input type="datetime-local">`'s own unzoned local-time string
   * (`YYYY-MM-DDTHH:mm`), not the server's UTC ISO — converted only at
   * submit. Storing the ISO string here and slicing it for display was the
   * bug: the slice reads UTC digits as if they were local. */
  etrAt: string;
  skillCode: string;
};

const EMPTY_FORM: FormState = {
  rootCause: "",
  impact: "",
  correctiveActions: "",
  energyImpact: "",
  waterImpact: "",
  productionImpact: "",
  etrAt: "",
  skillCode: "",
};

/**
 * ADR 0034 — the Alarm Details panel. The read half (value-vs-threshold,
 * asset context) needs no write access; the enrichment form is hidden for a
 * `viewer`, matching the write endpoint's role gate.
 *
 * Affected assets (ADR 0034 decision 4) are shown read-only here — the API
 * and its scope guard are built and tested (`alarm-enrichment.service.ts`),
 * but an add/remove picker is not part of this slice.
 */
export function AlarmDetailsPanel({ alarmId, readOnly, onClose }: AlarmDetailsPanelProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saveError, setSaveError] = useState<string | null>(null);

  const detailsQ = useQuery({
    queryKey: ["alarms", "details", alarmId],
    queryFn: () => fetchAlarmDetails(alarmId),
  });

  // Same shared key the alarms page and rule builder already use — one fetch,
  // one cache entry, no chance of a stale skill list next to a fresh one.
  const vocabQ = useQuery({
    queryKey: vocabulariesQueryKey,
    queryFn: fetchVocabularies,
    staleTime: 5 * 60 * 1000,
  });
  const skills = vocabQ.data?.alarmSkills ?? [];
  const severities = vocabQ.data?.alarmSeverities ?? [];

  /**
   * Hydrate the form once per `alarmId`, not on every `detailsQ.data`
   * change. `QueryClient` here has no `staleTime` set on this query and the
   * default client refetches on window focus, so without this guard a
   * background refetch while the operator is mid-edit would silently
   * overwrite their unsaved text with whatever is stored (found in review).
   */
  const hydratedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!detailsQ.data || hydratedForRef.current === alarmId) {
      return;
    }
    hydratedForRef.current = alarmId;
    const enrichment = detailsQ.data.enrichment;
    setForm({
      rootCause: enrichment?.rootCause ?? "",
      impact: enrichment?.impact ?? "",
      correctiveActions: enrichment?.correctiveActions ?? "",
      energyImpact: enrichment?.energyImpact ?? "",
      waterImpact: enrichment?.waterImpact ?? "",
      productionImpact: enrichment?.productionImpact ?? "",
      etrAt: enrichment?.etrAt ? toLocalDateTimeInputValue(enrichment.etrAt) : "",
      skillCode: enrichment?.skillCode ?? "",
    });
  }, [detailsQ.data, alarmId]);

  const saveM = useMutation({
    mutationFn: (body: AlarmEnrichmentUpsertBody) => saveAlarmEnrichment(alarmId, body),
    onSuccess: (updated) => {
      setSaveError(null);
      qc.setQueryData(["alarms", "details", alarmId], updated);
      void qc.invalidateQueries({ queryKey: ["alarms", "list"] });
    },
    onError: (e: Error) => {
      setSaveError(e.message);
    },
  });

  function submit(e: FormEvent): void {
    e.preventDefault();
    setSaveError(null);
    saveM.mutate({
      rootCause: form.rootCause || null,
      impact: form.impact || null,
      correctiveActions: form.correctiveActions || null,
      energyImpact: form.energyImpact || null,
      waterImpact: form.waterImpact || null,
      productionImpact: form.productionImpact || null,
      etrAt: form.etrAt ? new Date(form.etrAt).toISOString() : null,
      // A `<select>` whose value matches no `<option>` renders its first
      // option, which is the `F4.44` trap — the current value is always kept
      // as an option even if the vocabulary has since retired it (below).
      skillCode: form.skillCode || null,
      // affectedAssetIds intentionally omitted — this panel has no editor
      // for it yet, and omitting the key (vs. sending `[]`) leaves the
      // stored set untouched rather than clearing it.
    });
  }

  const details = detailsQ.data;
  const pairing = details
    ? formatThresholdPairing({
        currentValue: details.currentValue,
        currentValueUnit: details.currentValueUnit,
        thresholdOperator: details.thresholdOperator,
        thresholdValue: details.thresholdValue,
      })
    : null;

  // The current skillCode as an option even if it is not (or no longer) in
  // the live vocabulary — otherwise the select silently renders its first
  // option and a save would rewrite the stored value out from under it.
  const skillOptions =
    form.skillCode && !skills.some((s) => s.code === form.skillCode)
      ? [...skills, { code: form.skillCode, label: alarmSkillLabel(form.skillCode, skills) ?? form.skillCode, sortOrder: -1, active: false }]
      : skills;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="alarm-details-title"
    >
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <h2 id="alarm-details-title" className="font-condensed text-lg font-bold">
            Alarm details
          </h2>
          <button
            type="button"
            className="text-sm text-bms-muted hover:text-bms-ink"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {detailsQ.isLoading ? <p className="mt-4 text-sm text-bms-muted">Loading…</p> : null}
        {detailsQ.isError ? (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {(detailsQ.error as Error).message}
          </p>
        ) : null}

        {details ? (
          <div className="mt-4 space-y-4 text-sm">
            <div className="flex items-center gap-2">
              <StatusPill label={details.severity} tone={alarmSeverityTone(details.severity, severities)} />
              <span className="font-medium">{details.assetCode}</span>
              <span className="text-bms-muted">{details.assetName}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-bms-muted">
              <div>
                <span className="font-semibold text-bms-ink">Type</span> {details.assetDomain}
              </div>
              <div>
                <span className="font-semibold text-bms-ink">Location</span> {details.locationName}
              </div>
              <div>
                <span className="font-semibold text-bms-ink">Triggered</span>{" "}
                {new Date(details.raisedAt).toLocaleString()}
              </div>
              <div>
                <span className="font-semibold text-bms-ink">State</span>{" "}
                {details.acknowledgedAt ? "Acknowledged" : "Open"}
              </div>
            </div>

            {pairing ? (
              <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs">
                <span className="font-semibold text-bms-ink">Current value</span>{" "}
                <span className="font-mono">{pairing.current}</span>
                <span className="mx-2 text-bms-muted">vs threshold</span>
                <span className="font-mono">{pairing.threshold}</span>
              </div>
            ) : (
              <p className="text-xs text-bms-muted">No linked rule — no threshold to compare against.</p>
            )}

            <p className="text-sm">{details.message}</p>

            {readOnly ? (
              details.enrichment ? (
                <dl className="space-y-2 text-xs">
                  <div>
                    <dt className="font-semibold text-bms-ink">Root cause</dt>
                    <dd className="text-bms-muted">{details.enrichment.rootCause ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-bms-ink">Impact</dt>
                    <dd className="text-bms-muted">{details.enrichment.impact ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-bms-ink">Corrective actions</dt>
                    <dd className="text-bms-muted">{details.enrichment.correctiveActions ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-bms-ink">Energy impact</dt>
                    <dd className="text-bms-muted">{details.enrichment.energyImpact ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-bms-ink">Water impact</dt>
                    <dd className="text-bms-muted">{details.enrichment.waterImpact ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-bms-ink">Production impact</dt>
                    <dd className="text-bms-muted">{details.enrichment.productionImpact ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-bms-ink">ETR</dt>
                    <dd className="text-bms-muted">
                      {details.enrichment.etrAt ? new Date(details.enrichment.etrAt).toLocaleString() : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-bms-ink">Skill</dt>
                    <dd className="text-bms-muted">
                      {alarmSkillLabel(details.enrichment.skillCode, skills) ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-bms-ink">Affected assets</dt>
                    <dd className="text-bms-muted">
                      {details.enrichment.affectedAssets.length > 0
                        ? details.enrichment.affectedAssets.map((a) => a.assetCode).join(", ")
                        : "—"}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-xs text-bms-muted">No enrichment recorded yet.</p>
              )
            ) : (
              <form className="space-y-3 border-t border-gray-100 pt-3" onSubmit={submit}>
                <div>
                  <label className="text-xs font-medium text-bms-muted" htmlFor="root-cause">
                    Root cause
                  </label>
                  <textarea
                    id="root-cause"
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                    rows={2}
                    value={form.rootCause}
                    onChange={(ev) => setForm((f) => ({ ...f, rootCause: ev.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-bms-muted" htmlFor="impact">
                    Impact
                  </label>
                  <textarea
                    id="impact"
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                    rows={2}
                    value={form.impact}
                    onChange={(ev) => setForm((f) => ({ ...f, impact: ev.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-bms-muted" htmlFor="corrective-actions">
                    Corrective actions
                  </label>
                  <textarea
                    id="corrective-actions"
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                    rows={2}
                    value={form.correctiveActions}
                    onChange={(ev) => setForm((f) => ({ ...f, correctiveActions: ev.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs font-medium text-bms-muted" htmlFor="energy-impact">
                      Energy impact
                    </label>
                    <textarea
                      id="energy-impact"
                      className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                      rows={2}
                      value={form.energyImpact}
                      onChange={(ev) => setForm((f) => ({ ...f, energyImpact: ev.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-bms-muted" htmlFor="water-impact">
                      Water impact
                    </label>
                    <textarea
                      id="water-impact"
                      className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                      rows={2}
                      value={form.waterImpact}
                      onChange={(ev) => setForm((f) => ({ ...f, waterImpact: ev.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-bms-muted" htmlFor="production-impact">
                      Production impact
                    </label>
                    <textarea
                      id="production-impact"
                      className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                      rows={2}
                      value={form.productionImpact}
                      onChange={(ev) => setForm((f) => ({ ...f, productionImpact: ev.target.value }))}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-bms-muted" htmlFor="skill-code">
                    Skill / trade
                  </label>
                  <select
                    id="skill-code"
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                    value={form.skillCode}
                    onChange={(ev) => setForm((f) => ({ ...f, skillCode: ev.target.value }))}
                  >
                    <option value="">Unassigned</option>
                    {skillOptions.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-bms-muted" htmlFor="etr">
                    ETR
                  </label>
                  <input
                    id="etr"
                    type="datetime-local"
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                    value={form.etrAt}
                    onChange={(ev) => setForm((f) => ({ ...f, etrAt: ev.target.value }))}
                  />
                </div>
                {details.enrichment && details.enrichment.affectedAssets.length > 0 ? (
                  <p className="text-xs text-bms-muted">
                    Affected assets: {details.enrichment.affectedAssets.map((a) => a.assetCode).join(", ")}{" "}
                    (editing this list is not available here yet)
                  </p>
                ) : null}
                {saveError ? (
                  <p className="text-xs text-red-600" role="alert">
                    {saveError}
                  </p>
                ) : null}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded px-3 py-2 text-sm text-bms-muted hover:bg-gray-100"
                    onClick={onClose}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saveM.isPending}
                    className="rounded bg-bms-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {saveM.isPending ? "Saving…" : "Save"}
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
