import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { TelemetryEntryRow, TelemetryWriteResponse } from "@bms/shared";
import { catalogEntry } from "@bms/shared/copilot";

import { submitManualReadings } from "../../api/admin/manual-readings";
import { fetchAdminPointKeys } from "../../api/admin/point-keys";
import {
  HierarchyFilterBar,
  type HierarchySelection,
} from "../../components/admin/hierarchy-filter-bar";
import { MasterDataLayout } from "../../components/admin/master-data-layout";
import { PageHeader } from "../../components/page-header";
import { SectionCard } from "../../components/section-card";
import { WizardShell } from "../../components/wizard/wizard-shell";
import { apiErrorMessage } from "../../lib/api-error-message";
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

/** An ISO instant as this browser's `datetime-local` value (seconds kept when set), or `null`. */
function isoToLocalDateTime(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const seconds = at.getSeconds();
  return seconds === 0 ? defaultLocalDateTime(at) : `${defaultLocalDateTime(at)}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Admin screen for entering one telemetry reading by hand (backlog `F1.8`).
 *
 * `F4.283` (ADR 0099 Amendment 8): the form is the `telemetryReading.create` wizard — one Readings
 * step (the reading's fields and the conflict policy), then Review. The rows the step holds are the
 * one row the fields build, once they validate; the page keeps the overwrite choice, which the
 * copilot never proposes (Q21).
 */
export function ManualReadingsPage({ user }: ManualReadingsPageProps) {
  const [selection, setSelection] = useState<HierarchySelection>({});
  const [pointKey, setPointKey] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [time, setTime] = useState(() => defaultLocalDateTime(new Date()));
  const [overwrite, setOverwrite] = useState(false);
  const [result, setResult] = useState<TelemetryWriteResponse | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Was scoped to the selected asset's own organization (fact 8/9). `F3.39`
  // merged bms.point_keys fleet-wide, so there is one catalog and no scope.
  const catalogQ = useQuery({
    queryKey: ["admin", "point-keys", "true"],
    queryFn: () => fetchAdminPointKeys("true"),
  });

  const catalogUnit = catalogQ.data?.items.find((item) => item.code === pointKey)?.unit ?? null;

  const form: ManualReadingFormValues = { assetId: selection.assetId ?? "", pointKey, value, unit, time };
  // `F4.283` review: the field errors are the live ones. The wizard's Next stays disabled while the
  // fields build no row, so each field says what it needs beside it.
  const formErrors = validateManualReadingForm(form);
  // The wizard's value: the one row the fields build, once they validate (else none, which the step refuses).
  const rows: TelemetryEntryRow[] =
    Object.keys(formErrors).length === 0 ? [buildManualReadingRow(form, catalogUnit, offsetForLocalDateTime(form.time))] : [];
  const wizardValues: Record<string, unknown> = { rows, conflictPolicy: overwrite ? "overwrite" : "reject" };

  const submitMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      if (Object.keys(validateManualReadingForm(form)).length > 0) {
        throw new Error("Fix the highlighted fields before submitting.");
      }
      return submitManualReadings(body.rows as TelemetryEntryRow[], body.conflictPolicy === "overwrite" ? "overwrite" : "reject");
    },
    onSuccess: (response) => {
      setResult(response);
      setSubmitError(null);
    },
    onError: (err: unknown) => {
      setResult(null);
      setSubmitError(apiErrorMessage(err));
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
        <div className="grid max-w-xl gap-3">
          <WizardShell
            entry={catalogEntry("telemetryReading.create")!}
            params={{}}
            values={wizardValues}
            onChange={(next) => {
              // A copilot fill: the conflict policy and the first row's fields.
              if (next.conflictPolicy === "overwrite" || next.conflictPolicy === "reject") setOverwrite(next.conflictPolicy === "overwrite");
              const first = Array.isArray(next.rows) ? (next.rows[0] as Partial<TelemetryEntryRow> | undefined) : undefined;
              // `F4.283` review: every field a fill carries lands, the asset and the time included.
              if (typeof first?.assetId === "string" && first.assetId !== selection.assetId) setSelection({ assetId: first.assetId });
              if (first?.pointKey !== undefined) setPointKey(first.pointKey);
              if (typeof first?.value === "number") setValue(String(first.value));
              if (first?.unit !== undefined) setUnit(first.unit);
              if (typeof first?.time === "string") {
                const local = isoToLocalDateTime(first.time);
                if (local !== null) setTime(local);
              }
            }}
            renderStep={() => (
              <>
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
            }}
            syncRoutes={false}
          />

          <label className="block text-xs font-semibold text-ink-muted">
            Point key
            <select
              className="mt-1 w-full surface-field px-3 py-2 text-sm"
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
          </label>
          {formErrors.pointKey ? <span className="-mt-2 block text-xs text-critical-ink">{formErrors.pointKey}</span> : null}

          <label className="block text-xs font-semibold text-ink-muted">
            Value
            <input
              className="mt-1 w-full surface-field px-3 py-2 text-sm"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          {formErrors.value ? <span className="-mt-2 block text-xs text-critical-ink">{formErrors.value}</span> : null}

          <label className="block text-xs font-semibold text-ink-muted">
            Unit
            <input
              className="mt-1 w-full surface-field px-3 py-2 text-sm"
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
            />
          </label>

          <label className="block text-xs font-semibold text-ink-muted">
            Timestamp
            <input
              type="datetime-local"
              className="mt-1 w-full surface-field px-3 py-2 text-sm"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </label>
          {formErrors.time ? <span className="-mt-2 block text-xs text-critical-ink">{formErrors.time}</span> : null}

          <label className="flex items-center gap-2 text-xs font-semibold text-ink-muted">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(event) => setOverwrite(event.target.checked)}
            />
            Overwrite an existing reading at this exact timestamp
          </label>

          {formErrors.assetId ? <div className="text-xs text-critical-ink">{formErrors.assetId}</div> : null}
              </>
            )}
            nextDisabled={rows.length === 0}
            onSubmit={(body) => submitMutation.mutate(body)}
            onCancel={() => {
              setPointKey("");
              setValue("");
              setUnit("");
              setOverwrite(false);
              setResult(null);
              setSubmitError(null);
            }}
            submitting={submitMutation.isPending}
            submitError={submitError}
          />
          {result ? (
            <div className="text-xs text-ink">
              {describeWriteOutcome(result)}
              {result.rejected.length > 0 ? (
                <ul className="mt-1 list-disc pl-4 text-critical-ink">
                  {result.rejected.map((row, i) => (
                    <li key={i}>{row.reason}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </SectionCard>
    </MasterDataLayout>
  );
}
