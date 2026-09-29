import { HVAC_POINT_KEYS } from "@bms/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { fetchAssets } from "../api/assets";
import { CracSchematic } from "../components/live-svg/crac-schematic";
import { CRAC_TRACKED_CODES } from "../components/live-svg/crac-bindings";
import {
  SchematicTelemetryProvider,
  useSchematicAssetMeta,
  useSchematicTelemetry,
} from "../components/live-svg/schematic-telemetry-context";
import { PageHeader } from "../components/page-header";
import { SectionCard } from "../components/section-card";
import { StatusPill } from "../components/status-pill";
import { AppShell } from "../layouts/app-shell";
import { hasCompleteSchematicAssets } from "../lib/schematic-access";
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
      className="fixed inset-0 z-40 flex justify-end bg-scrim/20"
      role="presentation"
      onClick={onClose}
    >
      <aside
        className="surface-dialog h-full w-full max-w-md"
        role="dialog"
        aria-label="CRAC detail"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-line px-4 py-3">
          <div>
            <h2 className="font-condensed text-lg font-bold text-ink">
              {meta?.name ?? "Equipment"}
            </h2>
            <p className="font-mono text-xs text-ink-muted">{meta?.code ?? "—"}</p>
            <p className="mt-1 text-xs text-ink-muted">{meta?.siteName}</p>
          </div>
          <button
            type="button"
            className="surface-button px-2 py-1 text-sm"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="space-y-4 px-4 py-4 text-sm">
          <div>
            <span className="text-ink-muted">Status</span>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${
                  status === "running"
                    ? "bg-ok-wash text-ok-ink"
                    : status === "fault"
                      ? "bg-critical-wash-strong text-critical-ink-strong"
                      : "bg-well-deep text-neutral-ink"
                }`}
              >
                {statusLabel}
              </span>
              {stale ? <span className="text-xs text-warning-ink">Stale telemetry</span> : null}
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3 font-mono text-xs">
            <div>
              <dt className="text-ink-muted">Supply air</dt>
              <dd className="font-semibold text-ink">
                {fmtC(slice.supplyAirTempC, "°C")}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Return air</dt>
              <dd className="font-semibold text-ink">
                {fmtC(slice.returnAirTempC, "°C")}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Fan</dt>
              <dd className="font-semibold text-ink">
                {slice.fanRpm != null ? `${Math.round(slice.fanRpm)} rpm` : "—"} ·{" "}
                {slice.fanSpeedPct != null ? `${slice.fanSpeedPct.toFixed(0)}%` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">CHW flow</dt>
              <dd className="font-semibold text-ink">
                {fmtC(slice.chwFlowLps, "L/s")}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">CHW supply</dt>
              <dd className="font-semibold text-ink">
                {fmtC(slice.chwSupplyTempC, "°C")}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">CHW return</dt>
              <dd className="font-semibold text-ink">
                {fmtC(slice.chwReturnTempC, "°C")}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Cooling load</dt>
              <dd className="font-semibold text-ink">
                {fmtC(slice.coolingKw, "kW")}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Compressor</dt>
              <dd className="font-semibold text-ink">
                {slice.compressorOk === null
                  ? "—"
                  : slice.compressorOk === 1
                    ? "OK"
                    : "Trip"}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-ink-muted">
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
    <div className="relative mx-auto max-w-[1200px] space-y-4 pb-8">
      <PageHeader
        eyebrow="R.crac"
        title="CRAC · Precision cooling schematic"
        subtitle="DH101 hall · four CRAC units · chilled-water loop"
        actions={<StatusPill label="Live" />}
      />
      <SectionCard bodyClassName="surface-pressed overflow-x-auto p-4">
        <CracSchematic onSelectAsset={onSelect} />
      </SectionCard>
      <CracDetailDrawer assetId={selectedId} onClose={() => onSelect(undefined)} />
    </div>
  );
}

function CracUnavailable({ loading }: { loading: boolean }) {
  return (
    <div className="relative mx-auto max-w-[1200px] space-y-4 pb-8">
      <PageHeader
        eyebrow="R.crac"
        title="CRAC · Precision cooling schematic"
        subtitle="DH101 hall · four CRAC units · chilled-water loop"
        actions={<StatusPill label={loading ? "Checking" : "Unavailable"} tone="offline" />}
      />
      <SectionCard bodyClassName="p-4">
        <div className="rounded border border-warning-line bg-warning-wash p-4 text-sm text-warning-ink">
          {loading
            ? "Checking schematic access for your assigned assets..."
            : "This HVAC/CRAC schematic is not configured for your assigned location or asset group."}
        </div>
      </SectionCard>
    </div>
  );
}

export function CracPage({ user }: CracPageProps) {
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const assetsQuery = useQuery({
    queryKey: ["assets"],
    queryFn: () => fetchAssets(),
  });
  const canViewCrac =
    assetsQuery.isSuccess &&
    hasCompleteSchematicAssets(assetsQuery.data, CRAC_TRACKED_CODES);

  return (
    <AppShell
      user={user}
      kpiRibbon={
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-ok-wash px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ok-ink">
            Live
          </span>
          <span className="text-ink">HVAC schematic · CRAC telemetry</span>
        </div>
      }
    >
      {canViewCrac ? (
        <SchematicTelemetryProvider
          assetCodes={CRAC_TRACKED_CODES}
          pointKeys={[...HVAC_POINT_KEYS]}
        >
          <CracContent selectedId={selectedId} onSelect={setSelectedId} />
        </SchematicTelemetryProvider>
      ) : (
        <CracUnavailable loading={assetsQuery.isLoading} />
      )}
    </AppShell>
  );
}
