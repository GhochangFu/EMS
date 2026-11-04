/**
 * `F4.311` PR 6a (ADR 0109 decision 5) — `calcPoint.delete`, Review alone.
 * Submit hands the `DELETE` to the page; a refusal (`409`: the point is on a
 * dashboard widget) is `error`, the server's sentence.
 */
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import { WizardShell } from "../wizard/wizard-shell";

/** The catalog entry a wizard submits, or a build defect (the `asset-points-page.tsx` rule). */
function wizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F4.311: the catalog has no entry "${id}"`);
  return entry;
}

/** A Review-only wizard has no field to fill. */
const NO_VALUES: Record<string, unknown> = {};

export function CalcPointDeleteWizard({
  assetId,
  pointKey,
  assetLabel,
  deleting,
  error,
  onSubmit,
  onCancel,
}: {
  assetId: string;
  pointKey: string;
  assetLabel: string;
  deleting: boolean;
  error: string | null;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const entry = wizardEntry("calcPoint.delete");
  const params = { assetId, pointKey };
  return (
    <div className="surface-raised-sm flex flex-col gap-3 p-3">
      <h3 className="text-sm font-semibold">Delete {pointKey}</h3>
      <WizardShell
        // Looked up again, not `entry={entry}`: F3.85's stepper-coverage gate
        // reads a literal `entry={wizardEntry("<id>")}` to know this id is wired.
        entry={wizardEntry("calcPoint.delete")}
        params={params}
        values={NO_VALUES}
        onChange={() => undefined}
        renderStep={() => null}
        onSubmit={() => {
          if (!deleting) onSubmit();
        }}
        onCancel={() => {
          if (!deleting) onCancel();
        }}
        submitting={deleting}
        submitError={error}
        summary={entry.summary({ body: NO_VALUES, params, targetName: assetLabel, organizationName: "" })}
      />
    </div>
  );
}
