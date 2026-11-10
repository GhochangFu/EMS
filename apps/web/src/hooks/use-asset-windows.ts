import { useQuery } from "@tanstack/react-query";

import { fetchAssetWindows } from "../api/telemetry";
import { freshWindowMs } from "../lib/schematic-telemetry";

/** The API's per-call cap on asset ids (`MAX_LATEST_ASSET_IDS`). */
const WINDOWS_PER_CALL = 50;

/** A window changes only when an admin sets an interval or the learned median moves. */
const WINDOWS_STALE_MS = 5 * 60_000;

/** Splits `ids` into calls of at most {@link WINDOWS_PER_CALL}. */
export function chunkIds(ids: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += WINDOWS_PER_CALL) {
    chunks.push(ids.slice(i, i + WINDOWS_PER_CALL));
  }
  return chunks;
}

/**
 * `F4.350` (ADR 0075 Amendment 3) — each asset's freshness window in **milliseconds**, for the
 * views that hold only point references (dashboard widgets, the wall bar) and so cannot read
 * `freshnessWindowSeconds` off an asset row. An asset the read has not answered (still loading,
 * failed, or gone) is absent from the map, and the caller then falls back to the 25 s floor —
 * never a wider window than the API judged, so a failed read can only make a widget read
 * stale sooner, not later.
 */
export function useAssetWindows(assetIds: readonly string[]): ReadonlyMap<string, number> {
  const ids = [...new Set(assetIds)].sort();
  const query = useQuery({
    queryKey: ["asset-windows", ids.join(",")],
    enabled: ids.length > 0,
    staleTime: WINDOWS_STALE_MS,
    queryFn: async () => {
      const answers = await Promise.all(chunkIds(ids).map((chunk) => fetchAssetWindows(chunk)));
      return new Map(
        answers.flatMap((answer) =>
          answer.items.map((item): [string, number] => [item.assetId, freshWindowMs(item.freshnessWindowSeconds)]),
        ),
      );
    },
  });
  return query.data ?? EMPTY_WINDOWS;
}

const EMPTY_WINDOWS: ReadonlyMap<string, number> = new Map();
