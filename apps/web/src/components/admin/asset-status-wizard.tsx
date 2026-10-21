import type { AdminAssetDto } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import { WizardShell } from "../wizard/wizard-shell";
import { AdminWizardFrame } from "./admin-wizard-frame";

/** The catalog entry, or a build defect (the `calc-parameters-page.tsx` rule). */
function wizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F3.86: the catalog has no entry "${id}"`);
  return entry;
}

/** A bodyless wizard's values (deactivate, reactivate): it has no field to fill. */
const NO_VALUES: Record<string, unknown> = {};

/**
 * `F3.86` PR 3b (ADR 0099 decision 6, ruling Q9) — deactivate or reactivate
 * an asset: a Review-only wizard in place of the row's direct write. Submit
 * hands the write to the page, which closes it.
 */
export function AssetStatusWizard({
  target,
  onCancel,
  onSubmit,
}: {
  target: AdminAssetDto;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const context = { body: NO_VALUES, params: { id: target.id }, targetName: target.name, organizationName: "" };
  const shared = {
    values: NO_VALUES,
    onChange: () => undefined,
    renderStep: () => null,
    onSubmit: () => onSubmit(),
    onCancel,
    submitting: false,
  };
  if (target.active) {
    return (
      <AdminWizardFrame title={`Deactivate ${target.name}`}>
        <WizardShell
          key={`deactivate-${target.id}`}
          {...shared}
          entry={wizardEntry("asset.deactivate")}
          params={{ id: target.id }}
          summary={wizardEntry("asset.deactivate").summary(context)}
        />
      </AdminWizardFrame>
    );
  }
  return (
    <AdminWizardFrame title={`Reactivate ${target.name}`}>
      <WizardShell
        key={`reactivate-${target.id}`}
        {...shared}
        entry={wizardEntry("asset.reactivate")}
        params={{ id: target.id }}
        summary={wizardEntry("asset.reactivate").summary(context)}
      />
    </AdminWizardFrame>
  );
}
