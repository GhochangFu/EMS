import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import { encodePointRef } from "@bms/shared";
import type { PointAggregateResponse } from "@bms/shared";

import { fetchPointAggregate } from "../api/telemetry";
import { retryUnlessForbidden } from "../components/asset-history/history-format";
import { rangeToQuery, rangeToSearch, type HistoryRange } from "../lib/asset-history-range";

export interface AssetHistorySeries {
  readonly pointKey: string;
  readonly data: PointAggregateResponse | undefined;
  readonly isLoading: boolean;
  readonly error: unknown;
}

/**
 * `F4.297` U5 (ADR 0108 decision 1.8) — one `aggregate` read per charted point, in parallel:
 * at most `MAX_HISTORY_POINTS` calls, each one statement and one `canReadAsset` on the server.
 * No batch route.
 *
 * Every read asks for `bucketStats` (the bucket table) and names the page's function, so the
 * server returns the plotted buckets. `now` is read once per range change, not per render: the
 * query keys stay stable while the range is unchanged.
 */
export function useAssetHistory(
  assetId: string,
  pointKeys: readonly string[],
  range: HistoryRange,
): AssetHistorySeries[] {
  // The range without its point list: adding a point must not move `now` for the others.
  const rangeKey = rangeToSearch({ ...range, points: [] }).toString();
  const query = useMemo(
    () => rangeToQuery(range, Date.now()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the range's URL form
    [rangeKey],
  );

  const results = useQueries({
    queries: pointKeys.map((pointKey) => {
      const ref = encodePointRef(assetId, pointKey);
      return {
        queryKey: ["asset-history-aggregate", ref, query, range.compare, range.fn],
        queryFn: () =>
          fetchPointAggregate(ref, {
            ...query,
            compare: range.compare,
            bucketFunction: range.fn,
            bucketStats: true,
          }),
        retry: retryUnlessForbidden,
      };
    }),
  });

  return results.map((result, index) => ({
    pointKey: pointKeys[index],
    data: result.data,
    isLoading: result.isLoading,
    error: result.error,
  }));
}
