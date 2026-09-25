import { useSystemStatus } from "../hooks/use-system-status";
import {
  dataQualityBand,
  summaryLine,
  titleLine,
  type SystemQualityBand,
} from "../lib/system-status-bands";

/**
 * `F3.30` (ADR 0075 decision 5) — the footer's System Status and Data Quality
 * indicator: a dot, the verdict, then "Data quality 98.6 % Good". Polled by
 * `useSystemStatus` (TanStack Query, 30 s); no socket, no timer of its own.
 *
 * **The error branch is read before `data`.** A failed poll keeps the last
 * good `data` beside the error, and rendering it would show a stale
 * "operational" (decision 3) — so a failed request renders a red
 * "Status unavailable" and no percentage, whatever came before.
 *
 * Loading renders a grey dot and "Checking status…" (plan decision 4) —
 * neither "operational" nor "unavailable".
 */

const BAND_LABEL: Record<SystemQualityBand, string> = { good: "Good", fair: "Fair", poor: "Poor" };

const BAND_CLASS: Record<SystemQualityBand, string> = {
  good: "text-bms-green",
  fair: "text-amber-400",
  poor: "text-red-400",
};

function Dot({ className }: { className: string }) {
  return <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${className}`} />;
}

export function SystemStatusIndicator() {
  const { data, isError } = useSystemStatus();

  if (isError) {
    return (
      <span className="flex items-center gap-2">
        <Dot className="bg-red-500" />
        <span className="text-red-400">Status unavailable</span>
      </span>
    );
  }

  if (!data) {
    return (
      <span className="flex items-center gap-2">
        <Dot className="bg-white/40" />
        <span>Checking status…</span>
      </span>
    );
  }

  const { percent } = data.dataQuality;
  const band = dataQualityBand(percent);

  return (
    <span className="flex items-center gap-2" title={titleLine(data)}>
      <Dot className={data.status === "operational" ? "bg-bms-green" : "bg-amber-400"} />
      <span>{summaryLine(data)}</span>
      <span>
        {percent === null ? "Data quality —" : `Data quality ${percent.toFixed(1)} %`}
        {band ? (
          <>
            {" "}
            <span className={`font-semibold ${BAND_CLASS[band]}`}>{BAND_LABEL[band]}</span>
          </>
        ) : null}
      </span>
    </span>
  );
}
