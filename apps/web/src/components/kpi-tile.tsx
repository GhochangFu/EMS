import type { ReactNode } from "react";

export type KpiTileStatus = "loading" | "error" | "empty" | "ready";

type KpiTileProps = {
  label: string;
  status: KpiTileStatus;
  value: string | null;
  unit?: string;
  hint?: string;
  /**
   * `E4.2` / ADR 0072 decision 2 — one more line under the value, and its own
   * slot rather than a second use of `hint`: `hint` already carries at most one
   * of the computed delta and the author note, and a data-completeness warning
   * must not displace either.
   */
  note?: string;
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
  note,
  stale,
  tone = "default",
  icon,
}: KpiTileProps) {
  const toneBorder =
    tone === "critical"
      ? "border-critical-line"
      : tone === "warning"
        ? "border-warning-line"
        : "border-line";
  const toneBar =
    tone === "critical"
      ? "after:bg-critical"
      : tone === "warning"
        ? "after:bg-warning"
        : "after:bg-accent";
  const staleRing = stale ? "ring-2 ring-warning/70 ring-offset-2" : "";

  return (
    <div
      className={`relative flex flex-col overflow-hidden rounded-lg border bg-surface p-4 shadow-sm after:absolute after:left-0 after:right-0 after:top-0 after:h-0.5 ${toneBorder} ${toneBar} ${staleRing}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
          {label}
        </span>
        {icon ? <span className="text-accent">{icon}</span> : null}
      </div>
      {status === "loading" ? (
        <div className="mt-3 h-9 w-24 animate-pulse rounded bg-well-deep" />
      ) : status === "error" ? (
        <p role="alert" className="mt-3 text-sm text-critical-ink-soft">
          Could not load
        </p>
      ) : status === "empty" ? (
        <p className="mt-3 font-condensed text-2xl font-bold text-ink-muted">—</p>
      ) : (
        <p className="mt-2 font-condensed text-2xl font-bold tabular-nums text-ink">
          {value}
          {unit ? (
            <span className="ml-1 text-sm font-normal text-ink-muted">{unit}</span>
          ) : null}
        </p>
      )}
      {hint ? (
        <p className="mt-1 text-[11px] text-ink-muted">{hint}</p>
      ) : null}
      {note ? (
        <p className="mt-1 text-[11px] font-medium text-warning-ink">{note}</p>
      ) : null}
      {stale ? (
        <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-warning-ink">
          Stale · no telemetry ~10s
        </p>
      ) : null}
    </div>
  );
}
