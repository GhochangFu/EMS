import { useInfiniteQuery } from "@tanstack/react-query";

import { fetchPointRawRecords } from "../../api/telemetry";
import { apiErrorMessage } from "../../lib/api-error-message";
import { SectionCard } from "../section-card";
import { ACCESS_SENTENCE, formatInZone, isForbidden, retryUnlessForbidden } from "./history-format";

type RawRecordsTableProps = {
  pointRef: string;
  pointKey: string;
  /** The zone the times are formatted in (the site zone). */
  zone: string;
};

/**
 * `F4.297` U5 — the latest stored samples of one point, newest first, from
 * `GET /telemetry/points/:pointRef/raw` (ADR 0108 decision 1.6). "Load older" pages with the
 * server's `nextBefore` cursor; the last page has none and the button goes. A sample with no
 * device time shows "—".
 */
export function RawRecordsTable({ pointRef, pointKey, zone }: RawRecordsTableProps) {
  const rawQ = useInfiniteQuery({
    queryKey: ["asset-history-raw", pointRef],
    queryFn: ({ pageParam }) => fetchPointRawRecords(pointRef, pageParam === undefined ? {} : { before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    retry: retryUnlessForbidden,
  });
  const items = rawQ.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <SectionCard title={`Latest records · ${pointKey}`} bodyClassName="surface-table overflow-x-auto p-0">
      {rawQ.isError ? (
        <p className="px-3 py-3 text-xs text-critical-ink-strong">
          {isForbidden(rawQ.error) ? ACCESS_SENTENCE : apiErrorMessage(rawQ.error)}
        </p>
      ) : null}
      <table className="w-full text-left text-sm">
        <thead className="border-b border-well-deep bg-well text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          <tr>
            <th className="px-3 py-2">Time</th>
            <th className="px-3 py-2">Device time</th>
            <th className="px-3 py-2">Value</th>
            <th className="px-3 py-2">Unit</th>
          </tr>
        </thead>
        <tbody>
          {rawQ.isSuccess && items.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-3 py-4 text-xs text-ink-muted">
                No stored samples for this point.
              </td>
            </tr>
          ) : null}
          {items.map((item) => (
            <tr key={item.time} className="border-b border-well-deep tabular-nums" data-testid="raw-record">
              <td className="px-3 py-1.5 text-xs">{formatInZone(item.time, zone)}</td>
              <td className="px-3 py-1.5 text-xs">{item.deviceTime === null ? "—" : formatInZone(item.deviceTime, zone)}</td>
              <td className="px-3 py-1.5">{item.value}</td>
              <td className="px-3 py-1.5">{item.unit ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rawQ.hasNextPage ? (
        <div className="px-3 py-2">
          <button
            type="button"
            className="rounded border border-line-strong px-2 py-1 text-xs"
            disabled={rawQ.isFetchingNextPage}
            aria-busy={rawQ.isFetchingNextPage}
            onClick={() => void rawQ.fetchNextPage()}
          >
            {rawQ.isFetchingNextPage ? "Loading…" : "Load older"}
          </button>
        </div>
      ) : null}
    </SectionCard>
  );
}
