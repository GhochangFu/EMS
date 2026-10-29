import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ReportFileFormat } from "@bms/shared";
import { REPORT_FILE_FORMATS } from "@bms/shared/contracts";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import { fetchAdminOrganizations } from "../api/admin/organizations";
import { type EnergyReportInput, saveEnergyReportFile } from "../api/reports";
import { apiErrorMessage } from "../lib/api-error-message";
import { formatLabel, saveBlockedReason } from "../lib/report-files-view";
import type { AuthUser } from "../stores/auth-store";
import { fieldClass, labelClass } from "./admin/admin-wizard-frame";
import { REPORT_FILES_QUERY_KEY } from "./report-history";
import { WizardShell } from "./wizard/wizard-shell";

/** The catalog entry, or a build defect (the `rule-wizard.tsx` rule). */
function saveEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F4.280: the catalog has no entry "${id}"`);
  return entry;
}

/**
 * `F4.290` (ADR 0099 Amendment 9 E4) — the site filter a copilot fill may set
 * on the step (the panel has no site picker). The Review card names it ("scoped
 * to N locations"), so it is posted too; anything but a string list is dropped.
 */
function locationIdsOf(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") && value.length > 0 ? value : undefined;
}

export type ReportFileSaveWizardProps = {
  /** The panel's range: the body's `startDate` and `endDate`. */
  input: EnergyReportInput;
  user: AuthUser;
  hasPreview: boolean;
  previewError: boolean;
};

/**
 * `F4.280` (ADR 0099 decision 6, Amendment 8, Q8, Q14) — the Save-to-history
 * block (ADR 0071 decisions 4 and 11; Amendment 1 item 1) as a one-step
 * `WizardShell` on `reportFile.save`: Report → Review. Rendered only for a
 * master-data admin — the caller holds the gate. The range is the panel's own;
 * the file renders inside the Submit request.
 *
 * The organization select exists only for the global `admin`, who must name
 * one; every other role sends no `organizationId`. Every refusal is one of
 * `saveBlockedReason`'s sentences, shown on the Review card, so nothing is
 * refused without saying why.
 */
export function ReportFileSaveWizard({ input, user, hasPreview, previewError }: ReportFileSaveWizardProps) {
  const queryClient = useQueryClient();
  const needsOrganization = user.role === "admin";
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...input, format: "pdf", organizationId: undefined }));
  const [outcome, setOutcome] = useState<{ tone: "saved" | "refused"; text: string } | null>(null);
  // A saved report starts the wizard again from its first step.
  const [round, setRound] = useState(0);

  // The range is the panel's: the wizard follows it.
  useEffect(() => {
    setValues((current) =>
      current.startDate === input.startDate && current.endDate === input.endDate ? current : { ...current, ...input },
    );
  }, [input.startDate, input.endDate]);

  const organizationsQ = useQuery({
    queryKey: ["admin", "organizations", "true"],
    queryFn: () => fetchAdminOrganizations("true"),
    enabled: needsOrganization,
  });

  const organizationId = typeof values.organizationId === "string" ? values.organizationId : undefined;
  const format = (typeof values.format === "string" ? values.format : "pdf") as ReportFileFormat;

  const saveM = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      saveEnergyReportFile(
        { startDate: String(body.startDate), endDate: String(body.endDate) },
        body.format as ReportFileFormat,
        typeof body.organizationId === "string" ? body.organizationId : undefined,
        locationIdsOf(body.locationIds),
      ),
    onSuccess: async (file) => {
      setOutcome({ tone: "saved", text: `Saved ${file.filename} to history.` });
      setRound((current) => current + 1);
      await queryClient.invalidateQueries({ queryKey: REPORT_FILES_QUERY_KEY });
    },
    onError: (cause: Error) => setOutcome({ tone: "refused", text: apiErrorMessage(cause) }),
  });

  const blockedReason = saveBlockedReason({ hasPreview, previewError, needsOrganization, organizationId, pending: false });
  const organizationName =
    organizationsQ.data?.items.find((organization) => organization.id === organizationId)?.name ?? "your organization";

  return (
    <div className="mt-4 border-t border-line pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Save to history</h3>
      <WizardShell
        key={round}
        entry={saveEntry("reportFile.save")}
        params={{}}
        fixedFields={["startDate", "endDate"]}
        values={values}
        onChange={setValues}
        renderStep={() => (
          <>
            <p className="text-xs text-ink-muted">{`${input.startDate} to ${input.endDate}`}</p>
            <label className={labelClass}>
              Format
              <select className={fieldClass} value={format} onChange={(event) => setValues({ ...values, format: event.target.value })}>
                {REPORT_FILE_FORMATS.map((option) => (
                  <option key={option} value={option}>
                    {formatLabel(option)}
                  </option>
                ))}
              </select>
            </label>
            {needsOrganization ? (
              <label className={labelClass}>
                Organization
                <select
                  className={fieldClass}
                  value={organizationId ?? ""}
                  onChange={(event) => setValues({ ...values, organizationId: event.target.value === "" ? undefined : event.target.value })}
                >
                  <option value="">Choose an organization</option>
                  {(organizationsQ.data?.items ?? []).map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {organization.code} · {organization.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {blockedReason !== null ? <p className="text-xs text-ink-muted">{blockedReason}</p> : null}
          </>
        )}
        onSubmit={(body) => {
          if (blockedReason === null) saveM.mutate(body);
        }}
        onCancel={() => setRound((current) => current + 1)}
        submitting={saveM.isPending}
        submitError={blockedReason}
        summary={saveEntry("reportFile.save").summary({ body: values, params: {}, targetName: organizationName, organizationName })}
      />
      {outcome !== null ? (
        <p className={`mt-2 text-xs ${outcome.tone === "saved" ? "text-accent-strong" : "text-critical-ink"}`}>{outcome.text}</p>
      ) : null}
    </div>
  );
}
