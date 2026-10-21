/**
 * `F4.254` PR 3 / ADR 0099 decision 6 — Instantiate is the
 * `assetTemplate.instantiate` stepper on the shared `WizardShell`: Target,
 * Assets, then Review. It replaces the detail page's `InstantiateDialog` and
 * keeps what it did:
 *
 * - **The target** is a location **or** an RTU, never both. The
 *   `HierarchyFilterBar` supplies both pickers, seeded with the template's own
 *   organization so the cascade cannot offer a target from another one (the
 *   server refuses it: a template may not cross an organization boundary).
 *   Picking an RTU sets its location too, and **the RTU wins** (`targetOf`,
 *   `lib/template-instantiate-form.ts`).
 * - **The rows** (code, name, one input per `templateVariables(template)`)
 *   become the body's `assets` through `namedRows` — blank rows dropped, the
 *   name falling back to the code.
 *
 * **One rule source.** The wizard's `values` are derived on every change from
 * the picker's selection and the rows, through the same `targetOf` and
 * `namedRows` that `buildInstantiatePayload` calls, so the Review card shows
 * exactly the body Submit sends (Submit sends `buildInstantiatePayload`'s typed body). A copilot `fill_step` arrives as values, and
 * is mapped back into the selection and the rows (`rowsOfAssets`).
 *
 * Review's problems come from the body's own refinement ("Supply exactly one
 * of rtuId…"): the body is one refined object, not a union. A named row that
 * lacks a required variable is refused on Submit with the row and the name
 * (`missingVariablesMessage`), before the wire.
 *
 * **The answer** (ADR 0067 Q5): on success the stepper is replaced by
 * `instantiationSummary(result)` and Close only. The batch has been built, so
 * a Submit left beside the result would offer a second batch of assets.
 *
 * Instantiation is all-or-nothing. It sends no `X-Copilot-Change` header: a
 * wizard used alone is not a copilot change (`F3.85` plan §10.5).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import type { AdminAssetTemplateDto } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import { type InstantiateAssetsInput, instantiateFromAdminAssetTemplate } from "../../api/admin/asset-templates";
import type { RtusListResponse } from "../../api/admin/rtus";
import { apiErrorMessage } from "../../lib/api-error-message";
import { instantiationSummary } from "../../lib/default-dashboards-report";
import {
  buildInstantiatePayload,
  type InstantiateRow,
  missingVariables,
  missingVariablesMessage,
  namedRows,
  patternsCarryingVariables,
  rowsOfAssets,
  targetOf,
  templateVariables,
} from "../../lib/template-instantiate-form";
import type { WizardStep } from "../../lib/wizard-steps";
import type { AuthUser } from "../../stores/auth-store";
import { HierarchyFilterBar, type HierarchySelection } from "../admin/hierarchy-filter-bar";
import { WizardShell } from "../wizard/wizard-shell";

/** The catalog entry a wizard submits, by its literal id (the stepper coverage gate reads the id). */
function wizardEntry(id: string): CatalogEntry {
  const found = catalogEntry(id);
  if (found === undefined) throw new Error(`No copilot catalog entry "${id}".`);
  return found;
}

const BLANK_ROW: InstantiateRow = { code: "", name: "", vars: {} };

/** The wizard's values: the body the picker selection and the rows make. */
function valuesOf(selection: HierarchySelection, rows: readonly InstantiateRow[]): Record<string, unknown> {
  return { ...(targetOf(selection) ?? {}), assets: namedRows(rows) };
}

/** The instantiate wizard and its answer, in the page's dialog frame. */
export function InstantiateWizard({
  user,
  template,
  onClose,
}: {
  user: AuthUser;
  template: AdminAssetTemplateDto;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [selection, setSelection] = useState<HierarchySelection>({ organizationId: template.organizationId });
  const [rows, setRows] = useState<InstantiateRow[]>([BLANK_ROW]);
  const [error, setError] = useState<string | null>(null);
  // `F4.56` (ADR 0056 decision 10) — the distinct `{token}`s this template's measured points ask
  // for, minus the reserved `asset_code`; a pinned version's points cannot change while it is open.
  const variables = templateVariables(template);
  const patternsWithVariables = patternsCarryingVariables(template);
  const values = valuesOf(selection, rows);

  const instantiateM = useMutation({
    mutationFn: (body: InstantiateAssetsInput) => instantiateFromAdminAssetTemplate(template.id, body),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "assets"] });
    },
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
  });

  /**
   * A copilot fill: its target ids go to the picker, its assets to the rows.
   *
   * The fill arrives as the wizard's whole values (the shell merges the step
   * into them), and those values hold the derived target — `targetOf` drops the
   * location once an RTU is chosen. So the selection is not rebuilt from the
   * values: the fill is compared with the current target, key by key. A new
   * `rtuId` keeps the picker's location (or takes the RTU's own, when a cached
   * RTU list knows it); a new `locationId` with the RTU unchanged moves to that
   * location and clears the RTU; neither changed keeps the selection as it is.
   */
  function fromValues(next: Record<string, unknown>): void {
    setError(null);
    const id = (key: string): string | undefined => {
      const value = next[key];
      return typeof value === "string" && value !== "" ? value : undefined;
    };
    const current = targetOf(selection);
    const currentRtuId = current !== null && "rtuId" in current ? current.rtuId : undefined;
    const currentLocationId = current !== null && "locationId" in current ? current.locationId : undefined;
    const nextRtuId = id("rtuId");
    const nextLocationId = id("locationId");
    if (nextRtuId !== undefined && nextRtuId !== currentRtuId) {
      setSelection({
        organizationId: template.organizationId,
        locationId: rtuLocationId(nextRtuId) ?? selection.locationId,
        rtuId: nextRtuId,
      });
    } else if (nextLocationId !== undefined && nextLocationId !== currentLocationId) {
      setSelection({ organizationId: template.organizationId, locationId: nextLocationId });
    }
    setRows(rowsOfAssets(next.assets));
  }

  /** The location of an RTU any cached `["admin", "rtus", …]` list holds, if one does. */
  function rtuLocationId(rtuId: string): string | undefined {
    for (const [, data] of queryClient.getQueriesData<RtusListResponse>({ queryKey: ["admin", "rtus"] })) {
      const found = data?.items.find((rtu) => rtu.id === rtuId);
      if (found !== undefined) return found.locationId;
    }
    return undefined;
  }

  function editRow(index: number, change: (row: InstantiateRow) => InstantiateRow): void {
    setError(null);
    setRows((current) => current.map((item, position) => (position === index ? change(item) : item)));
  }

  function renderStep(step: WizardStep): ReactNode {
    if (step.id === "target") {
      return (
        <HierarchyFilterBar
          user={user}
          levels={["location", "rtu"]}
          selection={selection}
          onNavigate={(next) => {
            setError(null);
            setSelection({ ...next, organizationId: template.organizationId });
          }}
          syncRoutes={false}
        />
      );
    }
    if (step.id !== "assets") return null;
    return (
      <>
        {patternsWithVariables.length > 0 ? (
          <p className="text-[11px] text-ink-muted">
            Pattern{patternsWithVariables.length > 1 ? "s" : ""} {patternsWithVariables.join(", ")} carry a variable —
            fill one value per asset below.
          </p>
        ) : null}
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={index} className="flex flex-wrap gap-2">
              <input
                value={row.code}
                onChange={(event) => editRow(index, (item) => ({ ...item, code: event.target.value }))}
                placeholder="Asset code"
                aria-label={`Asset ${index + 1} code`}
                className="w-1/3 surface-field px-2 py-1 text-xs"
              />
              <input
                value={row.name}
                onChange={(event) => editRow(index, (item) => ({ ...item, name: event.target.value }))}
                placeholder="Asset name (defaults to the code)"
                aria-label={`Asset ${index + 1} name`}
                className="flex-1 surface-field px-2 py-1 text-xs"
              />
              {variables.map((variable) => (
                <input
                  key={variable}
                  value={row.vars[variable] ?? ""}
                  onChange={(event) =>
                    editRow(index, (item) => ({ ...item, vars: { ...item.vars, [variable]: event.target.value } }))
                  }
                  placeholder={variable}
                  aria-label={`Asset ${index + 1} ${variable}`}
                  className="w-24 surface-field px-2 py-1 text-xs"
                />
              ))}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setRows((current) => [...current, BLANK_ROW])}
            className="text-xs font-semibold text-accent-strong hover:underline"
          >
            Add another asset
          </button>
        </div>
      </>
    );
  }

  const entry = wizardEntry("assetTemplate.instantiate");
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-scrim/30 p-4">
      <div className="w-full max-w-2xl space-y-3 surface-dialog p-4">
        <h2 className="font-condensed text-base font-bold text-ink">
          Instantiate {template.code} v{template.version}
        </h2>
        {instantiateM.data ? (
          <>
            <p className="rounded border border-accent/20 bg-ok-wash p-3 text-sm text-ok-ink">
              {instantiationSummary(instantiateM.data)}
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="surface-button-primary bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent"
              >
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-[11px] text-ink-muted">
              Each asset is built with all {template.points.length} of this template&apos;s points. The whole batch
              succeeds or none of it does.
            </p>
            <WizardShell
              entry={wizardEntry("assetTemplate.instantiate")}
              params={{ id: template.id }}
              values={values}
              onChange={fromValues}
              renderStep={renderStep}
              onSubmit={() => {
                // A second Submit clears the last refusal first.
                setError(null);
                const refused = missingVariablesMessage(missingVariables(rows, variables));
                if (refused !== null) {
                  setError(refused);
                  return;
                }
                // The typed body from the same two rules the values came from, not the shell's
                // untyped values: the Review has already refused a body with no target.
                const payload = buildInstantiatePayload(selection, rows);
                if (!payload.ok) {
                  setError(payload.message);
                  return;
                }
                instantiateM.mutate(payload.input);
              }}
              onCancel={onClose}
              submitting={instantiateM.isPending}
              submitError={error}
              summary={entry.summary({
                body: values,
                params: { id: template.id },
                targetName: template.name,
                organizationName: template.organizationName,
              })}
            />
          </>
        )}
      </div>
    </div>
  );
}
