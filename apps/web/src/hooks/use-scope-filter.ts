import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import type { FilterOptionsResponse } from "@bms/shared/contracts";

import { fetchFilterOptions, filterOptionsQueryKey } from "../api/filter-options";
import {
  applyScopeChange,
  hasScope,
  readScopeFilter,
  reconcileScopeFilter,
  writeScopeFilter,
  type ScopeFilter,
  type ScopeFilterKey,
} from "../lib/scope-filter";

export type ScopeFilterState = {
  /** What the list request carries: the URL's ids, cleaned against the options once they arrive. */
  readonly filter: ScopeFilter;
  readonly options: FilterOptionsResponse | undefined;
  /** Whether the list may run (D13): always without a scope in the URL, otherwise once the options settle. */
  readonly ready: boolean;
  /** The options read failed with no options held: the pickers are disabled and the list runs on the URL as it stands. */
  readonly unavailable: boolean;
  /** A user's choice on one picker; `""` is "All". Pushes a history entry (D12). */
  readonly setScope: (key: ScopeFilterKey, value: string) => void;
};

/**
 * `F4.361` (ADR 0132 decisions 6 and 8; plan D10–D13) — the Organization, Location, Asset group
 * and Asset filter of `/alarms` and `/rules`, kept in the URL so a reload or a shared link keeps it
 * and Back undoes a change. An id the options do not list is dropped by a replace, so Back does
 * not return to it. Parameters other than the four are left as they are.
 */
export function useScopeFilter(): ScopeFilterState {
  const [params, setParams] = useSearchParams();
  const optionsQ = useQuery({
    queryKey: filterOptionsQueryKey,
    queryFn: fetchFilterOptions,
    staleTime: 5 * 60 * 1000,
  });
  const options = optionsQ.data;
  const raw = useMemo(() => readScopeFilter(params), [params]);
  const filter = useMemo(() => (options ? reconcileScopeFilter(raw, options) : raw), [raw, options]);

  useEffect(() => {
    if (!options) {
      return;
    }
    const next = writeScopeFilter(params, filter);
    if (next.toString() !== params.toString()) {
      setParams(next, { replace: true });
    }
  }, [options, params, filter, setParams]);

  const setScope = useCallback(
    (key: ScopeFilterKey, value: string) => {
      if (!options) {
        return;
      }
      setParams(writeScopeFilter(params, applyScopeChange(filter, key, value, options)));
    },
    [options, params, filter, setParams],
  );

  return {
    filter,
    options,
    ready: !hasScope(raw) || optionsQ.isSuccess || optionsQ.isError,
    // Only a read with no data: after a failed background refetch the old options still drive the pickers.
    unavailable: optionsQ.isError && options === undefined,
    setScope,
  };
}
