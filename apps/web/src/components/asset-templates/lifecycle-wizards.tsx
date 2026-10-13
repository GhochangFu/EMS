import type { AdminAssetTemplateDto } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import { WizardShell } from "../wizard/wizard-shell";

/** The catalog entry a wizard submits, by its literal id (the stepper coverage gate reads the id). */
function wizardEntry(id: string): CatalogEntry {
  const found = catalogEntry(id);
  if (found === undefined) throw new Error(`No copilot catalog entry "${id}".`);
  return found;
}

/** The lifecycle action whose Review-only wizard is open on the detail page. */
export type AssetTemplateLifecycleWizardAction = "publish" | "archive" | "createDraft";

/** A bodyless wizard's values: it has no field to fill. */
const NO_VALUES: Record<string, unknown> = {};

/**
 * The dialog's name. `createDraft` is one route with two meanings (the page's
 * `actionLabel`): on an archived version it revives the model, on a published
 * one it opens the next draft.
 */
export function lifecycleWizardLabel(action: AssetTemplateLifecycleWizardAction, status: string): string {
  if (action === "publish") return "Publish this version";
  if (action === "archive") return "Archive this version";
  return status === "archived" ? "Revive as a new draft" : "Edit this version";
}

/**
 * `F4.254` PR 2 (ADR 0099 decision 6) — the asset-template detail page's three
 * Review-only lifecycle wizards: publish (moved here from the page, `F3.85`
 * PR 11a), archive and the new draft. Each is a bodyless catalog entry, so the
 * shell is Review alone and only its Submit sends; archive's Review is red
 * (`deactivate`). The page owns the mutations — its lifecycle buttons keep
 * their own pending names while a Submit pends — and closes the dialog on
 * success. A wizard used alone sends the plain request, never
 * `X-Copilot-Change` (the dashboard-template precedent, `F3.85` PR 10b).
 */
export function AssetTemplateLifecycleWizard({
  action,
  template,
  submitting,
  submitError,
  onSubmit,
  onCancel,
}: {
  action: AssetTemplateLifecycleWizardAction;
  template: AdminAssetTemplateDto;
  submitting: boolean;
  submitError: string | null;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const label = lifecycleWizardLabel(action, template.status);
  const shared = {
    values: NO_VALUES,
    onChange: () => undefined,
    renderStep: () => null,
    onSubmit: () => onSubmit(),
    onCancel,
    submitting,
    submitError,
  };
  const context = { body: NO_VALUES, params: { id: template.id }, targetName: template.name, organizationName: "" };
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-scrim/30 p-4">
      <div role="dialog" aria-modal="true" aria-label={label} className="w-full max-w-md space-y-3 surface-dialog p-4">
        <h2 className="font-condensed text-base font-bold text-ink">
          {label} · {template.code} v{template.version}
        </h2>
        {action === "publish" ? (
          <WizardShell
            key="publish"
            entry={wizardEntry("assetTemplate.publish")}
            {...shared}
            current={null}
            summary={`Publish ${template.name} v${template.version}. A published version is frozen; editing it again makes a new draft.`}
          />
        ) : null}
        {action === "archive" ? (
          <>
            <p className="max-w-prose text-xs text-ink-muted">
              An archived version can no longer be instantiated. Assets built from it keep working.
              You can revive it later as a new draft.
            </p>
            <WizardShell
              key="archive"
              entry={wizardEntry("assetTemplate.archive")}
              {...shared}
              summary={wizardEntry("assetTemplate.archive").summary(context)}
            />
          </>
        ) : null}
        {action === "createDraft" ? (
          <WizardShell
            key="createDraft"
            entry={wizardEntry("assetTemplate.draft")}
            {...shared}
            summary={wizardEntry("assetTemplate.draft").summary(context)}
          />
        ) : null}
      </div>
    </div>
  );
}
