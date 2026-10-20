import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import { importAdminStockAssetTemplate } from "../../api/admin/asset-templates";
import { fetchAdminOrganizations } from "../../api/admin/organizations";
import { apiErrorMessage } from "../../lib/api-error-message";
import { WizardShell } from "../wizard/wizard-shell";

/** The catalog entry a wizard submits, by its literal id (the stepper coverage gate reads the id). */
function wizardEntry(id: string): CatalogEntry {
  const found = catalogEntry(id);
  if (found === undefined) throw new Error(`No copilot catalog entry "${id}".`);
  return found;
}

function textOf(values: Record<string, unknown>, field: string): string {
  const value = values[field];
  return typeof value === "string" ? value : "";
}

/**
 * `F4.254` PR 2 (ADR 0099 decision 6) — Import a stock entry on the shared
 * `WizardShell` for `assetTemplate.importStock`: the Organization step holds
 * the picker the page header used to carry, then Review, and only Review's
 * Submit sends. One component, two doors: the list page's stock card and the
 * read-only viewer (`asset-template-stock-view-page.tsx`).
 *
 * The request names `entry.code` — the resolved catalog entry's code, never a
 * URL parameter. On success it lands on the new draft (ADR 0052 decision 10):
 * the author's next action is there. Used alone it sends the plain request,
 * never `X-Copilot-Change`.
 */
export function ImportStockWizard({
  entry,
  onClose,
  onClosedError,
}: {
  entry: { code: string; name: string };
  onClose: () => void;
  /** Called with a refusal that arrives after the dialog closed, which nothing else would show. */
  onClosedError?: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The pages' own key, so this is a cache hit where they fetched it.
  const orgsQ = useQuery({
    queryKey: ["admin", "organizations", "true"],
    queryFn: () => fetchAdminOrganizations("true"),
  });

  const importM = useMutation({
    mutationFn: (organizationId: string) => importAdminStockAssetTemplate(entry.code, organizationId),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "asset-templates"] });
      onClose();
      navigate(`/admin/asset-templates/${created.id}`);
    },
    onError: (cause: Error) => {
      // Cancelled before the answer: the card is gone, so the page shows it.
      if (mounted.current) setError(apiErrorMessage(cause));
      else onClosedError?.(apiErrorMessage(cause));
    },
  });

  const orgs = orgsQ.data?.items ?? [];
  const orgName = (id: unknown): string =>
    orgs.find((org) => org.id === id)?.name ?? (typeof id === "string" && id !== "" ? id : "the organization");

  function update(next: Record<string, unknown>): void {
    setError(null);
    setValues(next);
  }

  function pick(event: { currentTarget: HTMLSelectElement }): void {
    const next = { ...values };
    if (event.currentTarget.value === "") delete next.organizationId;
    else next.organizationId = event.currentTarget.value;
    update(next);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-scrim/30 p-4">
      <div className="w-full max-w-lg space-y-3 surface-dialog p-4">
        <h2 className="font-condensed text-base font-bold text-ink">Import {entry.name}</h2>
        <WizardShell
          entry={wizardEntry("assetTemplate.importStock")}
          params={{ code: entry.code }}
          // `F4.245` (critique C2): the organization is the page's; a fill never sets it.
          fixedFields={["organizationId"]}
          values={values}
          onChange={update}
          renderStep={(step) =>
            step.id === "organization" ? (
              <label className="block text-xs font-semibold text-ink">
                Organization
                <select
                  value={textOf(values, "organizationId")}
                  onChange={pick}
                  className="mt-1 w-full surface-field px-2 py-1 text-xs font-normal"
                >
                  <option value="">Select an organization…</option>
                  {orgs.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.code} — {org.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null
          }
          onSubmit={(body) => {
            setError(null);
            importM.mutate(textOf(body, "organizationId"));
          }}
          onCancel={onClose}
          submitting={importM.isPending}
          submitError={error}
          summary={wizardEntry("assetTemplate.importStock").summary({
            body: values,
            params: { code: entry.code },
            targetName: orgName(values.organizationId),
            organizationName: orgName(values.organizationId),
          })}
        />
      </div>
    </div>
  );
}
