import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchAlarmDetails } from "../api/alarms";
import { fetchAssets } from "../api/assets";
import { fetchVocabularies, vocabulariesQueryKey } from "../api/vocabularies";
import { apiErrorMessage } from "../lib/api-error-message";
import { alarmSkillLabel, formatThresholdPairing } from "../lib/alarm-details";
import { alarmSeverityTone } from "../lib/alarm-severity";
import { alarmLifecycleState, alarmStateLabel } from "../lib/alarm-state";
import { AlarmEnrichmentWizard } from "./alarm-enrichment-wizard";
import { StatusPill } from "./status-pill";

type AlarmDetailsPanelProps = {
  alarmId: string;
  /** `true` for `viewer` — the write form is not shown, matching the
   * server-side `assertOperationsWriteRole` gate on the write endpoint. */
  readOnly: boolean;
  onClose: () => void;
};

/**
 * ADR 0034 — the Alarm Details panel. The read half (value-vs-threshold,
 * asset context) needs no write access; the enrichment form is hidden for a
 * `viewer`, matching the write endpoint's role gate.
 *
 * Affected assets (ADR 0034 decision 4) are a search-and-toggle picker over
 * `GET /api/v1/assets` — already scoped server-side to the caller's readable
 * assets, the same set `PUT .../enrichment` independently checks
 * `affectedAssetIds` against. The picker is a full-set editor: every save
 * sends the current `affectedAssetIds`, including `[]`, since the form is
 * always hydrated from the server's current set first.
 *
 * `F4.284` (ADR 0099 decision 6; owner ruling Q9): the write half is the
 * `AlarmEnrichmentWizard` (Analysis → Impacts → Details → Review on the shared
 * `WizardShell`), which holds its own state from the moment it mounts.
 */
export function AlarmDetailsPanel({ alarmId, readOnly, onClose }: AlarmDetailsPanelProps) {
  const qc = useQueryClient();

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

  // ADR 0034 decision 4. `fetchAssets` is already scoped server-side to the
  // caller's readable assets — the same set `PUT .../enrichment` checks
  // affectedAssetIds against — so nothing here re-derives scope.
  // Narrowed to the alarm's own organization (found missing in review — an
  // unscoped list mixed assets from every organization the caller could
  // see). Gated on `detailsQ.data` so it never fires with an undefined
  // `organizationId`, which would silently fetch the unscoped list.
  const organizationId = detailsQ.data?.organizationId;
  const assetsQ = useQuery({
    queryKey: ["assets", "picker", organizationId],
    queryFn: () => fetchAssets(organizationId),
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });
  const assets = assetsQ.data ?? [];

  const details = detailsQ.data;
  const pairing = details
    ? formatThresholdPairing({
        currentValue: details.currentValue,
        currentValueUnit: details.currentValueUnit,
        thresholdOperator: details.thresholdOperator,
        thresholdValue: details.thresholdValue,
      })
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="alarm-details-title"
    >
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto surface-dialog p-6">
        <div className="flex items-start justify-between">
          <h2 id="alarm-details-title" className="font-condensed text-lg font-bold">
            Alarm details
          </h2>
          <button
            type="button"
            className="text-sm text-ink-muted hover:text-ink"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {detailsQ.isLoading ? <p className="mt-4 text-sm text-ink-muted">Loading…</p> : null}
        {detailsQ.isError ? (
          <p className="mt-4 text-sm text-critical-ink" role="alert">
            {apiErrorMessage(detailsQ.error)}
          </p>
        ) : null}

        {details ? (
          <div className="mt-4 space-y-4 text-sm">
            <div className="flex items-center gap-2">
              <StatusPill label={details.severity} tone={alarmSeverityTone(details.severity, severities)} />
              <span className="font-medium">{details.assetCode}</span>
              <span className="text-ink-muted">{details.assetName}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink-muted">
              <div>
                <span className="font-semibold text-ink">Type</span> {details.assetDomain}
              </div>
              <div>
                <span className="font-semibold text-ink">Location</span> {details.locationName}
              </div>
              <div>
                <span className="font-semibold text-ink">Triggered</span>{" "}
                {new Date(details.raisedAt).toLocaleString()}
              </div>
              {/*
                One helper with the grid, so this panel and the alarm grid
                cannot disagree about what an alarm's state is. The old
                expression here printed `Open` for anything unacknowledged,
                which under ADR 0057 decision 1 is wrong for a cleared alarm —
                the condition has returned to normal and only the
                acknowledgement is outstanding.
              */}
              <div>
                <span className="font-semibold text-ink">State</span>{" "}
                {alarmStateLabel(alarmLifecycleState(details))}
              </div>
              {details.clearedAt ? (
                <div>
                  <span className="font-semibold text-ink">Cleared</span>{" "}
                  {new Date(details.clearedAt).toLocaleString()}
                </div>
              ) : null}
            </div>

            {pairing ? (
              <div className="surface-pressed px-3 py-2 text-xs">
                <span className="font-semibold text-ink">Current value</span>{" "}
                <span className="font-mono">{pairing.current}</span>
                <span className="mx-2 text-ink-muted">vs threshold</span>
                <span className="font-mono">{pairing.threshold}</span>
              </div>
            ) : (
              <p className="text-xs text-ink-muted">No linked rule — no threshold to compare against.</p>
            )}

            <p className="text-sm">{details.message}</p>

            {/*
              E2.2 / ADR 0059. Above the enrichment, and visibly a different
              kind of thing: this is what engineering decided about the asset
              **class**, the block below is what an operator recorded about
              **this** alarm (ADR 0034 §Context). The labels are deliberately
              not the enrichment's — "Likely cause" beside "Root cause",
              "Typical impact" beside "Impact" — because two identical headings
              carrying different text is how that distinction stops being
              visible, and decision 5 asks for the labelling explicitly.

              Absent, not empty, when there is no provenance: that is nearly
              every alarm today (0 of 290 rules carry it), and a permanent row
              of dashes would be dead space on the densest panel in the app.
            */}
            {details.classPhilosophy ? (
              <section
                aria-label="Class philosophy"
                className="rounded border border-info-line bg-info-wash/60 px-3 py-2"
              >
                <h3 className="text-xs font-semibold text-ink">Class philosophy</h3>
                <p className="mt-0.5 text-[11px] text-ink-muted">
                  Authored on {details.classPhilosophy.templateName} v
                  {details.classPhilosophy.templateVersion} — it describes this asset class,
                  not this alarm.
                </p>
                <dl className="mt-2 space-y-1.5 text-xs">
                  {(
                    [
                      ["Likely cause", details.classPhilosophy.cause],
                      ["Typical impact", details.classPhilosophy.impact],
                      ["Recommended action", details.classPhilosophy.action],
                      // The resolved label, never the raw code — and it is
                      // present even for a retired skill, because the API
                      // resolves it without an `active` filter.
                      ["Skill required", details.classPhilosophy.skillLabel],
                    ] as const
                  )
                    .filter(([, value]) => value !== null)
                    .map(([label, value]) => (
                      <div key={label}>
                        <dt className="font-semibold text-ink">{label}</dt>
                        <dd className="text-ink-muted">{value}</dd>
                      </div>
                    ))}
                </dl>
              </section>
            ) : null}

            {readOnly ? (
              details.enrichment ? (
                <dl className="space-y-2 text-xs">
                  <div>
                    <dt className="font-semibold text-ink">Root cause</dt>
                    <dd className="text-ink-muted">{details.enrichment.rootCause ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-ink">Impact</dt>
                    <dd className="text-ink-muted">{details.enrichment.impact ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-ink">Corrective actions</dt>
                    <dd className="text-ink-muted">{details.enrichment.correctiveActions ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-ink">Energy impact</dt>
                    <dd className="text-ink-muted">{details.enrichment.energyImpact ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-ink">Water impact</dt>
                    <dd className="text-ink-muted">{details.enrichment.waterImpact ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-ink">Production impact</dt>
                    <dd className="text-ink-muted">{details.enrichment.productionImpact ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-ink">ETR</dt>
                    <dd className="text-ink-muted">
                      {details.enrichment.etrAt ? new Date(details.enrichment.etrAt).toLocaleString() : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-ink">Skill</dt>
                    <dd className="text-ink-muted">
                      {alarmSkillLabel(details.enrichment.skillCode, skills) ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-ink">Affected assets</dt>
                    <dd className="text-ink-muted">
                      {details.enrichment.affectedAssets.length > 0
                        ? details.enrichment.affectedAssets.map((a) => a.assetCode).join(", ")
                        : "—"}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-xs text-ink-muted">No enrichment recorded yet.</p>
              )
            ) : (
              <div className="border-t border-well-deep pt-3">
                <AlarmEnrichmentWizard
                  details={details}
                  skills={skills}
                  assets={assets}
                  assetsLoading={assetsQ.isLoading}
                  onCancel={onClose}
                  onSaved={(updated) => {
                    qc.setQueryData(["alarms", "details", alarmId], updated);
                    void qc.invalidateQueries({ queryKey: ["alarms", "list"] });
                  }}
                />
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
