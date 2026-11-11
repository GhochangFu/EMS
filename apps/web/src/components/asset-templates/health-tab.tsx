/**
 * The Health tab (`F4.355`, ADR 0038 Amendment 7, ADR 0050 Amendment 4).
 *
 * Wiring only. The rules are `src/lib/template-health-form.ts`; the write goes
 * through `mergeTemplateContent`'s `health` arm, whose `null` is the one way
 * this screen deletes a section.
 *
 * ## What it edits
 *
 * A band table (code, label, minimum score in percent; add, remove, move) and a
 * weight per point (B2). The minimum score is typed in percent and stored in
 * `0..1`; the conversion is the lib's, at this edge only.
 *
 * ## Nothing is pre-filled (ADR 0050 Amendment 4)
 *
 * **Use the standard five bands** fills the table on a click and only then. An
 * empty draft renders an empty table; a mount effect that applied the preset
 * would invent bands for a template that has none, which is what Amendment 1
 * decision 3 forbids. `health-tab.spec.tsx` asserts the empty draft stays empty.
 *
 * ## Removing the block (B4)
 *
 * **Remove health bands** asks first, then marks the form for removal; Save sends
 * `health: null`. Emptying the band table is not a removal — the lib names it as
 * a problem instead — so a deletion is always something the author asked for.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { AdminAssetTemplateDto } from "@bms/shared";

import { updateAdminAssetTemplate } from "../../api/admin/asset-templates";
import { ConfirmDialog } from "../confirm-dialog";
import { apiErrorMessage } from "../../lib/api-error-message";
import { mergeTemplateContent, unwritableContentKeys } from "../../lib/template-content-merge";
import {
  MAX_HEALTH_BANDS,
  blankHealthBandRow,
  healthFormErrors,
  healthFormFrom,
  healthHasChanged,
  healthWriteFrom,
  moveHealthBand,
  standardHealthBandRows,
  storedHealth,
  type HealthBandRow,
  type HealthForm,
} from "../../lib/template-health-form";
import { useFollowStoredWhenClean } from "../../lib/use-follow-stored-when-clean";

type HealthTabProps = {
  template: AdminAssetTemplateDto;
  editable: boolean;
  onSaved: (next: AdminAssetTemplateDto) => void;
  /** Tells the page whether leaving this tab would discard an edit. */
  onDirtyChange: (dirty: boolean) => void;
};

/** The Health tab: health bands and point weights for one template version. */
export function HealthTab({ template, editable, onSaved, onDirtyChange }: HealthTabProps) {
  const stored = storedHealth(template.content);
  const [form, setForm] = useState<HealthForm>(() => healthFormFrom(stored, template.points));
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  // Keyed on the row id and the lifecycle status — see `details-tab.tsx`.
  useEffect(() => {
    setForm(healthFormFrom(storedHealth(template.content), template.points));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reseed on identity and status only.
  }, [template.id, template.status]);

  // A refetch under the same id and status is followed only while the tab is clean.
  const reseedFrom = useFollowStoredWhenClean(
    template.id,
    stored,
    (previous) => !healthHasChanged(form, previous, template.points),
    (next) => setForm(healthFormFrom(next, template.points)),
  );

  // The form a save was sent from, and the form now. The save's answer reseeds
  // only a form nobody touched while it was pending — the `kpis-tab.tsx`
  // pattern. Without it a saved removal left the old bands on screen under a
  // "will be removed" banner, because a form armed for removal never counts as
  // clean against the block it removes (code review, F4.355 PR 3).
  const sentForm = useRef<HealthForm | null>(null);
  const currentForm = useRef(form);
  currentForm.current = form;

  const blockedKeys = unwritableContentKeys(template.content);
  const changed = healthHasChanged(form, stored, template.points);

  // Reported up so the page can guard a tab switch; clean on unmount.
  useEffect(() => {
    onDirtyChange(changed);
    return () => onDirtyChange(false);
  }, [changed, onDirtyChange]);

  const problems = healthFormErrors(form, stored);
  const write = healthWriteFrom(form);
  const blocked = problems.length > 0 || blockedKeys.length > 0 || write.kind === "none";

  const saveM = useMutation({
    mutationFn: () => {
      sentForm.current = form;
      // `null` deletes the block, so it is sent only for an explicit, confirmed
      // removal; `none` never reaches here (Save is disabled for it).
      const value = write.kind === "remove" ? null : write.kind === "set" ? write.value : undefined;
      if (value === undefined) {
        throw new Error("Nothing to save.");
      }
      return updateAdminAssetTemplate(template.id, {
        content: mergeTemplateContent(template.content, { section: "health", value }),
      });
    },
    onSuccess: (next) => {
      setError(null);
      if (currentForm.current === sentForm.current) reseedFrom(storedHealth(next.content));
      onSaved(next);
    },
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });

  /** Every edit is a change of mind about removing the block. */
  const edit = useCallback((change: (current: HealthForm) => HealthForm) => {
    setForm((current) => ({ ...change(current), removeBlock: false }));
  }, []);

  function updateBand(index: number, patch: Partial<HealthBandRow>) {
    edit((current) => ({
      ...current,
      bands: current.bands.map((band, position) => (position === index ? { ...band, ...patch } : band)),
    }));
  }

  const problemFor = (section: "bands" | "weights", row: number, field: string) =>
    problems.find(
      (problem) => problem.section === section && problem.row === row && problem.field === field,
    )?.message;
  const sectionProblems = problems.filter((problem) => problem.row === null);

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded border border-critical-line bg-critical-wash p-3 text-sm text-critical-ink-strong">{error}</p>
      ) : null}

      {blockedKeys.length > 0 ? (
        <p className="rounded border border-warning-line bg-warning-wash p-3 text-xs text-warning-ink">
          Saving health is blocked: this template holds content that cannot be written back. The
          banner above lists the keys.
        </p>
      ) : null}

      <p className="rounded border border-line p-3 text-2xs text-ink-muted">
        An asset&apos;s health score falls into the first band whose minimum it reaches, from the top.
        Bands are listed highest first and the last one must start at 0%. A point weighs 1 unless you
        change it; a heavier point counts for more of the score.
      </p>

      {form.removeBlock ? (
        <div className="flex flex-wrap items-center gap-3 rounded border border-warning-line bg-warning-wash p-3 text-xs text-warning-ink">
          <span>
            The health bands and weights will be removed when you save. Assets on this version will
            show no band once it is published and they are on it.
          </span>
          <button
            type="button"
            onClick={() => setForm((current) => ({ ...current, removeBlock: false }))}
            className="surface-button px-3 py-1"
          >
            Keep health bands
          </button>
        </div>
      ) : null}

      {sectionProblems.map((problem) => (
        <p
          key={problem.message}
          className="rounded border border-critical-line bg-critical-wash p-3 text-xs text-critical-ink-strong"
        >
          {problem.message}
        </p>
      ))}

      <section className="surface-raised-sm p-3">
        <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-ink-muted">Bands</h3>
        {form.bands.length === 0 ? (
          <p className="rounded border border-dashed border-line-strong p-4 text-xs text-ink-muted">
            This template has no health bands. Its assets are scored, but show no band.
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                <th className="py-1 pr-2 font-semibold">Code</th>
                <th className="py-1 pr-2 font-semibold">Label</th>
                <th className="py-1 pr-2 font-semibold">Minimum score (%)</th>
                {editable ? <th className="py-1 font-semibold">Order</th> : null}
              </tr>
            </thead>
            <tbody>
              {form.bands.map((band, index) => {
                const n = index + 1;
                return (
                  <tr key={index} className="align-top">
                    <td className="py-1 pr-2">
                      <CellInput
                        label={`Band ${n} code`}
                        value={band.code}
                        editable={editable}
                        problem={problemFor("bands", index, "code")}
                        onChange={(value) => updateBand(index, { code: value })}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <CellInput
                        label={`Band ${n} label`}
                        value={band.label}
                        editable={editable}
                        problem={problemFor("bands", index, "label")}
                        onChange={(value) => updateBand(index, { label: value })}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <CellInput
                        label={`Band ${n} minimum score (%)`}
                        value={band.minPercent}
                        editable={editable}
                        numeric
                        problem={problemFor("bands", index, "minPercent")}
                        onChange={(value) => updateBand(index, { minPercent: value })}
                      />
                    </td>
                    {editable ? (
                      <td className="flex gap-1 py-1">
                        <button
                          type="button"
                          aria-label={`Move band ${n} up`}
                          disabled={index === 0}
                          onClick={() => edit((current) => ({ ...current, bands: moveHealthBand(current.bands, index, -1) }))}
                          className="surface-button px-2 py-1 disabled:opacity-60"
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          aria-label={`Move band ${n} down`}
                          disabled={index === form.bands.length - 1}
                          onClick={() => edit((current) => ({ ...current, bands: moveHealthBand(current.bands, index, 1) }))}
                          className="surface-button px-2 py-1 disabled:opacity-60"
                        >
                          Down
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove band ${n}`}
                          onClick={() =>
                            edit((current) => ({
                              ...current,
                              bands: current.bands.filter((_, position) => position !== index),
                            }))
                          }
                          className="surface-button border border-critical-line px-2 py-1 text-critical-ink"
                        >
                          Remove
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {editable ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={form.bands.length >= MAX_HEALTH_BANDS}
              onClick={() => edit((current) => ({ ...current, bands: [...current.bands, blankHealthBandRow()] }))}
              className="surface-button px-3 py-1.5 disabled:opacity-60"
            >
              Add a band
            </button>
            <button
              type="button"
              onClick={() => edit((current) => ({ ...current, bands: standardHealthBandRows() }))}
              className="surface-button px-3 py-1.5"
            >
              Use the standard five bands
            </button>
          </div>
        ) : null}
      </section>

      <section className="surface-raised-sm p-3">
        <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-ink-muted">Point weights</h3>
        {form.weights.length === 0 ? (
          <p className="text-xs text-ink-muted">This template declares no points to weigh.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                <th className="py-1 pr-2 font-semibold">Point</th>
                <th className="py-1 pr-2 font-semibold">Kind</th>
                <th className="py-1 pr-2 font-semibold">Weight</th>
              </tr>
            </thead>
            <tbody>
              {form.weights.map((row, index) => (
                <tr key={row.pointKey} className="align-top">
                  <td className="py-1 pr-2">
                    <span className="text-ink">{row.label}</span>
                    {row.label !== row.pointKey ? (
                      <span className="ml-1 font-mono text-2xs text-ink-muted">{row.pointKey}</span>
                    ) : null}
                    {!row.declared ? (
                      <span className="mt-1 block text-2xs text-warning-ink">
                        Not a point on this version. Saving will be refused until it is removed.
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1 pr-2 text-ink-muted">{row.kind ?? "—"}</td>
                  <td className="py-1 pr-2">
                    <div className="flex gap-2">
                      <CellInput
                        label={`Weight of ${row.pointKey}`}
                        value={row.weight}
                        editable={editable}
                        numeric
                        problem={problemFor("weights", index, "weight")}
                        onChange={(value) =>
                          edit((current) => ({
                            ...current,
                            weights: current.weights.map((entry, position) =>
                              position === index ? { ...entry, weight: value } : entry,
                            ),
                          }))
                        }
                      />
                      {editable && !row.declared ? (
                        <button
                          type="button"
                          aria-label={`Remove the weight of ${row.pointKey}`}
                          onClick={() =>
                            edit((current) => ({
                              ...current,
                              weights: current.weights.filter((_, position) => position !== index),
                            }))
                          }
                          className="surface-button border border-critical-line px-2 py-1 text-critical-ink"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {editable ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={blocked || !changed || saveM.isPending}
            aria-busy={saveM.isPending}
            onClick={() => saveM.mutate()}
            className="surface-button-primary bg-accent px-4 py-1.5 text-xs font-semibold text-on-accent disabled:opacity-60"
          >
            {saveM.isPending ? "Saving…" : "Save health"}
          </button>
          {stored !== undefined && !form.removeBlock ? (
            <button
              type="button"
              onClick={() => setConfirmingRemove(true)}
              className="surface-button border border-critical-line px-3 py-1.5 text-critical-ink"
            >
              Remove health bands
            </button>
          ) : null}
          <span className="text-2xs text-ink-muted">
            {blockedKeys.length > 0
              ? "Blocked by unwritable content."
              : problems.length > 0
                ? "Fix the problems above to save."
                : changed
                  ? "Sends this section; every other section is carried unchanged."
                  : "No changes yet."}
          </span>
        </div>
      ) : null}

      {confirmingRemove ? (
        <ConfirmDialog
          title="Remove health bands"
          body="This clears the bands and weights from this draft when you save. Once it is published and assets are on it, they show no health band."
          confirmLabel="Remove health bands"
          onConfirm={() => {
            setConfirmingRemove(false);
            setForm((current) => ({ ...current, removeBlock: true }));
          }}
          onClose={() => setConfirmingRemove(false)}
        />
      ) : null}
    </div>
  );
}

function CellInput({
  label,
  value,
  editable,
  numeric = false,
  problem,
  onChange,
}: {
  label: string;
  value: string;
  editable: boolean;
  numeric?: boolean;
  problem: string | undefined;
  onChange: (value: string) => void;
}) {
  const tone = problem ? "border-critical-line-strong bg-critical-wash" : "";
  return (
    <span className="block space-y-1">
      <input
        type="text"
        inputMode={numeric ? "decimal" : undefined}
        aria-label={label}
        aria-invalid={problem ? true : undefined}
        value={value}
        disabled={!editable}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full surface-field px-2 py-1.5 text-xs ${tone} ${editable ? "" : "text-ink-muted opacity-70"}`}
      />
      {problem ? <span className="block text-2xs text-critical-ink">{problem}</span> : null}
    </span>
  );
}
