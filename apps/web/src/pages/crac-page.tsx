import { HVAC_POINT_KEYS } from "@bms/shared";
import { useEffect, useState } from "react";

import { CracSchematic } from "../components/live-svg/crac-schematic";
import { CRAC_TRACKED_CODES } from "../components/live-svg/crac-bindings";
import {
  SchematicTelemetryProvider,
  useSchematicAssetMeta,
  useSchematicTelemetry,
} from "../components/live-svg/schematic-telemetry-context";
import { AppShell } from "../layouts/app-shell";
import type { AuthUser } from "../stores/auth-store";

type CracPageProps = {
  user: AuthUser;
};

function CracDetailDrawer({
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

  const fmtC = (v: number | null, unit: string) =>
    v != null && !Number.isNaN(v) ? `${v.toFixed(1)} ${unit}` : "—";

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/20"
      role="presentation"
      onClick={onClose}
    >
      <aside
        className="h-full w-full max-w-md border-l border-gray-200 bg-white shadow-xl"
        role="dialog"
        aria-label="CRAC detail"
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
            <div className="mt-1 flex flex-wrap items-center gap-2">
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
              <dt className="text-bms-muted">Supply air</dt>
              <dd className="font-semibold text-bms-ink">
                {fmtC(slice.supplyAirTempC, "°C")}
              </dd>
            </div>
            <div>
              <dt className="text-bms-muted">Return air</dt>
              <dd className="font-semibold text-bms-ink">
                {fmtC(slice.returnAirTempC, "°C")}
              </dd>
            </div>
            <div>
              <dt className="text-bms-muted">Fan</dt>
              <dd className="font-semibold text-bms-ink">
                {slice.fanRpm != null ? `${Math.round(slice.fanRpm)} rpm` : "—"} ·{" "}
                {slice.fanSpeedPct != null ? `${slice.fanSpeedPct.toFixed(0)}%` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-bms-muted">CHW flow</dt>
              <dd className="font-semibold text-bms-ink">
                {fmtC(slice.chwFlowLps, "L/s")}
              </dd>
            </div>
            <div>
              <dt className="text-bms-muted">CHW supply</dt>
              <dd className="font-semibold text-bms-ink">
                {fmtC(slice.chwSupplyTempC, "°C")}
              </dd>
            </div>
            <div>
              <dt className="text-bms-muted">CHW return</dt>
              <dd className="font-semibold text-bms-ink">
                {fmtC(slice.chwReturnTempC, "°C")}
              </dd>
            </div>
            <div>
              <dt className="text-bms-muted">Cooling load</dt>
              <dd className="font-semibold text-bms-ink">
                {fmtC(slice.coolingKw, "kW")}
              </dd>
            </div>
            <div>
              <dt className="text-bms-muted">Compressor</dt>
              <dd className="font-semibold text-bms-ink">
                {slice.compressorOk === null
                  ? "—"
                  : slice.compressorOk === 1
                    ? "OK"
                    : "Trip"}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-bms-muted">
            Read-only prototype. Commanding ships in production Phase 4.
          </p>
        </div>
      </aside>
    </div>
  );
}

function CracContent({
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
            CRAC · Precision cooling schematic
          </h1>
          <p className="mt-1 text-sm text-bms-muted">
            DH101 hall · four CRAC units · chilled loop (mockup{" "}
            <span className="font-mono text-xs">R.crac</span>)
          </p>
        </div>
        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-900">
          Live
        </span>
      </header>
      <div className="overflow-x-auto rounded-lg border border-gray-200 p-4">
        <CracSchematic onSelectAsset={onSelect} />
      </div>
      <CracDetailDrawer assetId={selectedId} onClose={() => onSelect(undefined)} />
    </div>
  );
}

export function CracPage({ user }: CracPageProps) {
  const [selectedId, setSelectedId] = useState<string | undefined>();

  return (
    <AppShell
      user={user}
      kpiRibbon={
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-900">
            Live
          </span>
          <span className="text-bms-ink">HVAC schematic · CRAC telemetry</span>
        </div>
      }
    >
      <SchematicTelemetryProvider
        assetCodes={CRAC_TRACKED_CODES}
        pointKeys={[...HVAC_POINT_KEYS]}
      >
        <CracContent selectedId={selectedId} onSelect={setSelectedId} />
      </SchematicTelemetryProvider>
    </AppShell>
  );
}
