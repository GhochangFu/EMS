import { useEffect, useState } from "react";

import { ElectricalSldDiagram } from "../components/live-svg/electrical-sld";
import {
  SchematicTelemetryProvider,
  useSchematicAssetMeta,
  useSchematicTelemetry,
} from "../components/live-svg/schematic-telemetry-context";
import { SLD_TRACKED_ASSET_CODES } from "../components/live-svg/sld-bindings";
import { AppShell } from "../layouts/app-shell";
import type { AuthUser } from "../stores/auth-store";

type SldPageProps = {
  user: AuthUser;
};

function SldDetailDrawer({
  assetId,
  onClose,
}: {
  assetId: string | undefined;
  onClose: () => void;
}) {
  const meta = useSchematicAssetMeta(assetId);
  const { slice, status, stale } = useSchematicTelemetry(assetId);

  useEffect(() => {
    if (!assetId) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [assetId, onClose]);

  if (!assetId) {
    return null;
  }

  const statusLabel =
    status === "running" ? "Running" : status === "fault" ? "Fault" : "Offline";

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/20"
      role="presentation"
      onClick={onClose}
    >
      <aside
        className="h-full w-full max-w-md border-l border-gray-200 bg-white shadow-xl"
        role="dialog"
        aria-label="Equipment detail"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <h2 className="font-condensed text-lg font-bold text-bms-ink">
              {meta?.name ?? "Equipment"}
            </h2>
            <p className="font-mono text-xs text-bms-muted">{meta?.code ?? "—"}</p>
            <p className="mt-1 text-xs text-bms-muted">{meta?.siteName}</p>
          </div>
          <button
            type="button"
            className="rounded px-2 py-1 text-sm text-bms-muted hover:bg-gray-100"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="space-y-4 px-4 py-4 text-sm">
          <div>
            <span className="text-bms-muted">Status</span>
            <div className="mt-1 flex items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${
                  status === "running"
                    ? "bg-emerald-100 text-emerald-900"
                    : status === "fault"
                      ? "bg-red-100 text-red-900"
                      : "bg-gray-200 text-gray-700"
                }`}
              >
                {statusLabel}
              </span>
              {stale ? <span className="text-xs text-amber-700">Stale telemetry</span> : null}
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3 font-mono text-xs">
            <div>
              <dt className="text-bms-muted">kW</dt>
              <dd className="font-semibold text-bms-ink">
                {slice.kw != null ? slice.kw.toFixed(1) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-bms-muted">Voltage L1</dt>
              <dd className="font-semibold text-bms-ink">
                {slice.voltage != null ? `${slice.voltage.toFixed(1)} V` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-bms-muted">Current</dt>
              <dd className="font-semibold text-bms-ink">
                {slice.current != null ? `${slice.current.toFixed(0)} A` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-bms-muted">Power factor</dt>
              <dd className="font-semibold text-bms-ink">
                {slice.pf != null ? slice.pf.toFixed(3) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-bms-muted">Main breaker</dt>
              <dd className="font-semibold text-bms-ink">
                {slice.breaker === null
                  ? "—"
                  : slice.breaker === 1
                    ? "Closed"
                    : "Open"}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-bms-muted">
            Read-only prototype view. Commanding is out of scope until production Phase 4.
          </p>
        </div>
      </aside>
    </div>
  );
}

function SldContent({
  selectedId,
  onSelect,
}: {
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  return (
    <div className="relative mx-auto max-w-[1200px] pb-8">
      <header className="mb-4 flex flex-col gap-2 border-b border-gray-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-condensed text-xl font-bold text-bms-ink sm:text-2xl">
            Electrical Single-Line Diagram · DC1
          </h1>
          <p className="mt-1 text-sm text-bms-muted">
            11 kV grid · 2 × 2 MVA · UPS + DG backup · live (mockup{" "}
            <span className="font-mono text-xs">R.sld</span>)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-900">
            Live
          </span>
        </div>
      </header>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-[#F7F8FA] p-4">
        <ElectricalSldDiagram onSelectAsset={onSelect} />
      </div>
      <SldDetailDrawer assetId={selectedId} onClose={() => onSelect(undefined)} />
    </div>
  );
}

export function SldPage({ user }: SldPageProps) {
  const [selectedId, setSelectedId] = useState<string | undefined>();

  return (
    <AppShell
      user={user}
      kpiRibbon={
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-900">
            Live
          </span>
          <span className="text-bms-ink">Single-line diagram · telemetry-bound</span>
        </div>
      }
    >
      <SchematicTelemetryProvider assetCodes={SLD_TRACKED_ASSET_CODES}>
        <SldContent selectedId={selectedId} onSelect={setSelectedId} />
      </SchematicTelemetryProvider>
    </AppShell>
  );
}
