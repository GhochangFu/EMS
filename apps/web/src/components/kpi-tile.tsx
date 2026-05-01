import type { ReactNode } from "react";

export type KpiTileStatus = "loading" | "error" | "empty" | "ready";

type KpiTileProps = {
  label: string;
  status: KpiTileStatus;
  value: string | null;
  unit?: string;
  hint?: string;
  stale?: boolean;
  tone?: "default" | "warning" | "critical";
  icon?: ReactNode;
};

export function KpiTile({
  label,
  status,
  value,
  unit,
  hint,
  stale,
  tone = "default",
  icon,
}: KpiTileProps) {
  const toneBorder =
    tone === "critical"
      ? "border-red-200"
      : tone === "warning"
        ? "border-amber-200"
        : "border-gray-200";
  const toneBar =
    tone === "critical"
      ? "after:bg-red-600"
      : tone === "warning"
        ? "after:bg-amber-500"
        : "after:bg-bms-green";
  const staleRing = stale ? "ring-2 ring-amber-400/70 ring-offset-2" : "";

  return (
    <div
      className={`relative flex flex-col overflow-hidden rounded-lg border bg-white p-4 shadow-sm after:absolute after:left-0 after:right-0 after:top-0 after:h-0.5 ${toneBorder} ${toneBar} ${staleRing}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-bms-muted">
          {label}
        </span>
        {icon ? <span className="text-bms-green">{icon}</span> : null}
      </div>
      {status === "loading" ? (
        <div className="mt-3 h-9 w-24 animate-pulse rounded bg-gray-100" />
      ) : status === "error" ? (
        <p className="mt-3 text-sm text-red-600">Could not load</p>
      ) : status === "empty" ? (
        <p className="mt-3 font-condensed text-2xl font-bold text-bms-muted">—</p>
      ) : (
        <p className="mt-2 font-condensed text-2xl font-bold tabular-nums text-bms-ink">
          {value}
          {unit ? (
            <span className="ml-1 text-sm font-normal text-bms-muted">{unit}</span>
          ) : null}
        </p>
      )}
      {hint ? (
        <p className="mt-1 text-[11px] text-bms-muted">{hint}</p>
      ) : null}
      {stale && status === "ready" ? (
        <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-amber-700">
          Stale · no telemetry ~10s
        </p>
      ) : null}
    </div>
  );
}
