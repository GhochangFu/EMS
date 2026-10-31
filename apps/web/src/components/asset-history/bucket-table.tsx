import type { PointAggregateResponse } from "@bms/shared";

import { previousByBucket } from "../../lib/asset-history-range";
import { SectionCard } from "../section-card";
import { formatInZone } from "./history-format";

type BucketTableProps = {
  pointKey: string;
  unit: string | null;
  data: PointAggregateResponse;
  compare: boolean;
  /** The zone the bucket times are formatted in (the site zone). */
  zone: string;
};

function cell(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : String(Number(value.toFixed(3)));
}

/**
 * `F4.297` U5 — the bucket table for the first charted point: time, min, average, max and the
 * sample count per bucket (`bucketStats`), and the previous period's value when a compare is on.
 *
 * The previous value is matched by time, not by index (ADR 0108 decision 1.3 alignment): each
 * compare bucket moves forward by the span and snaps to the bucket grid (`previousByBucket`),
 * so a custom span that is not a whole number of buckets still lands on a current bucket.
 */
export function BucketTable({ pointKey, unit, data, compare, zone }: BucketTableProps) {
  const buckets = data.buckets ?? [];
  const spanMs = Date.parse(data.to) - Date.parse(data.from);
  const previous = previousByBucket(data.compare?.buckets ?? [], spanMs, data.bucketSeconds);
  const showCompare = compare && data.compare !== null;

  return (
    <SectionCard
      title={`Buckets · ${pointKey}${unit ? ` (${unit})` : ""}`}
      bodyClassName="surface-table max-h-80 overflow-auto p-0"
    >
      <table className="w-full text-left text-sm">
        <thead className="border-b border-well-deep bg-well text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          <tr>
            <th className="px-3 py-2">Time</th>
            <th className="px-3 py-2">Min</th>
            <th className="px-3 py-2">Average</th>
            <th className="px-3 py-2">Max</th>
            <th className="px-3 py-2">Samples</th>
            {showCompare ? <th className="px-3 py-2">Previous period</th> : null}
          </tr>
        </thead>
        <tbody>
          {buckets.length === 0 ? (
            <tr>
              <td colSpan={showCompare ? 6 : 5} className="px-3 py-4 text-xs text-ink-muted">
                No buckets in this window.
              </td>
            </tr>
          ) : null}
          {buckets.map((bucket) => (
            <tr key={bucket.t} className="border-b border-well-deep tabular-nums">
              <td className="px-3 py-1.5 text-xs">{formatInZone(bucket.t, zone)}</td>
              <td className="px-3 py-1.5">{cell(bucket.min)}</td>
              <td className="px-3 py-1.5">{cell(bucket.average)}</td>
              <td className="px-3 py-1.5">{cell(bucket.max)}</td>
              <td className="px-3 py-1.5">{bucket.sampleCount ?? "—"}</td>
              {showCompare ? <td className="px-3 py-1.5">{cell(previous.get(Date.parse(bucket.t)))}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </SectionCard>
  );
}
