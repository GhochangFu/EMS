import { useMutation, useQuery } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useState } from "react";
import type { TelemetryWriteResponse } from "@bms/shared";

import { submitManualReadings } from "../../api/admin/manual-readings";
import { fetchAdminPointKeys } from "../../api/admin/point-keys";
import {
  HierarchyFilterBar,
  type HierarchySelection,
} from "../../components/admin/hierarchy-filter-bar";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import {
  buildManualReadingRow,
  defaultLocalDateTime,
  describeWriteOutcome,
  offsetForLocalDateTime,
  validateManualReadingForm,
  type ManualReadingFormValues,
} from "../../lib/manual-reading-form";
import type { AuthUser } from "../../stores/auth-store";

type ManualReadingsPageProps = { user: AuthUser };

/** Admin screen for entering one telemetry reading by hand (backlog `F1.8`). */
export function ManualReadingsPage({ user }: ManualReadingsPageProps) {
  const [selection, setSelection] = useState<HierarchySelection>({});
  const [pointKey, setPointKey] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [time, setTime] = useState(() => defaultLocalDateTime(new Date()));
  const [overwrite, setOverwrite] = useState(false);
  const [formErrors, setFormErrors] = useState<ReturnType<typeof validateManualReadingForm>>({});
  const [result, setResult] = useState<TelemetryWriteResponse | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Scoped to the selected asset's own organization (fact 8/9).
  const catalogQ = useQuery({
    queryKey: ["admin", "point-keys", "true", selection.organizationId],
    queryFn: () => fetchAdminPointKeys("true", selection.organizationId),
    enabled: Boolean(selection.organizationId),
  });

  const catalogUnit = catalogQ.data?.items.find((item) => item.code === pointKey)?.unit ?? null;

  const submitMutation = useMutation({
    mutationFn: async () => {
      const form: ManualReadingFormValues = {
        assetId: selection.assetId ?? "",
        pointKey,
        value,
        unit,
        time,
      };
      const errors = validateManualReadingForm(form);
      setFormErrors(errors);
      if (Object.keys(errors).length > 0) {
        throw new Error("Fix the highlighted fields before submitting.");
      }
      const row = buildManualReadingRow(form, catalogUnit, offsetForLocalDateTime(form.time));
      return submitManualReadings([row], overwrite ? "overwrite" : "reject");
    },
    onSuccess: (response) => {
      setResult(response);
      setSubmitError(null);
    },
    onError: (err: Error) => {
      setResult(null);
      setSubmitError(err.message);
    },
  });

  return (
    <MasterDataLayout user={user}>
      <PageHeader
        eyebrow="Administration"
        title="Manual Entry"
        subtitle="Enter one telemetry reading by hand for an asset with no live gateway"
      />
      <SectionCard title="Reading" bodyClassName="p-4">
        <form
          className="grid max-w-xl gap-3"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            submitMutation.mutate();
          }}
        >
          <HierarchyFilterBar
            user={user}
            levels={["organization", "location", "asset"]}
            selection={selection}
            onNavigate={(next) => {
              setSelection(next);
              setPointKey("");
              setUnit("");
              setResult(null);
              setSubmitError(null);
              setFormErrors({});
            }}
            syncRoutes={false}
          />

          <label className="block text-xs font-semibold text-bms-muted">
            Point key
            <select
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              value={pointKey}
              disabled={!selection.assetId}
              onChange={(event) => {
                const selected = catalogQ.data?.items.find((item) => item.code === event.target.value);
                setPointKey(event.target.value);
                setUnit(selected?.unit ?? "");
              }}
            >
              <option value="">Select point key</option>
              {(catalogQ.data?.items ?? []).map((item) => (
                <option key={item.id} value={item.code}>
                  {item.code} · {item.name}
                </option>
              ))}
            </select>
            {formErrors.pointKey ? <span className="mt-1 block text-red-700">{formErrors.pointKey}</span> : null}
          </label>

          <label className="block text-xs font-semibold text-bms-muted">
            Value
            <input
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            {formErrors.value ? <span className="mt-1 block text-red-700">{formErrors.value}</span> : null}
          </label>

          <label className="block text-xs font-semibold text-bms-muted">
            Unit
            <input
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
            />
          </label>

          <label className="block text-xs font-semibold text-bms-muted">
            Timestamp
            <input
              type="datetime-local"
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
            {formErrors.time ? <span className="mt-1 block text-red-700">{formErrors.time}</span> : null}
          </label>

          <label className="flex items-center gap-2 text-xs font-semibold text-bms-muted">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(event) => setOverwrite(event.target.checked)}
            />
            Overwrite an existing reading at this exact timestamp
          </label>

          {formErrors.assetId ? <div className="text-xs text-red-700">{formErrors.assetId}</div> : null}
          {submitError ? <div className="text-xs text-red-700">{submitError}</div> : null}
          {result ? (
            <div className="text-xs text-bms-ink">
              {describeWriteOutcome(result)}
              {result.rejected.length > 0 ? (
                <ul className="mt-1 list-disc pl-4 text-red-700">
                  {result.rejected.map((row, i) => (
                    <li key={i}>{row.reason}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div>
            <button
              type="submit"
              className="rounded bg-bms-green px-3 py-2 text-xs font-semibold text-white"
              disabled={submitMutation.isPending}
            >
              Submit reading
            </button>
          </div>
        </form>
      </SectionCard>
    </MasterDataLayout>
  );
}
