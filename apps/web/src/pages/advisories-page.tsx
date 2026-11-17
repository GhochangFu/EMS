import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { ADVISORY_EMPTY_SENTENCE } from "@bms/shared/contracts";

import { fetchAdvisories } from "../api/advisories";
import { AdvisoryCard } from "../components/advisories/advisory-card";
import { retryUnlessForbidden } from "../components/asset-history/history-format";
import { PageHeader } from "../components/page-header";
import { ScopeFilterBar } from "../components/scope-filter-bar";
import { SectionCard } from "../components/section-card";
import { useScopeFilter } from "../hooks/use-scope-filter";
import { AppShell } from "../layouts/app-shell";
import { ADVISORIES_REFETCH_MS, shownOfSentence } from "../lib/advisories";
import { ML_PAGE_FILTER_KEYS, pickScope } from "../lib/ml-findings";
import type { AuthUser } from "../stores/auth-store";

export const ADVISORIES_SUBTITLE =
  "Advisory. What the last 7 complete days of your energy meters suggest, and what it may be worth.";

export const ADVISORIES_ERROR_SENTENCE = "Could not load the advisories.";

type AdvisoriesPageProps = {
  user: AuthUser;
};

/**
 * `E1.6b` / ADR 0137 (plan T2.3) — `/advisories`: the optimisation advisories of the energy meters
 * the caller can read (`GET /advisories`; the API filters by access, so the page has no gate beyond
 * sign-in). The Anomalies page's shape: the shared shell, `PageHeader`, the Organization and
 * Location pickers (`useScopeFilter`, URL state), then one card per advisory in the server's order.
 * The read sends only those two keys, waits for `scope.ready`, and is read again every 15 minutes.
 * A failed read is one fixed sentence (the `F4.204` rule).
 */
export function AdvisoriesPage({ user }: AdvisoriesPageProps) {
  const scope = useScopeFilter();
  const shown = useMemo(() => pickScope(scope.filter, ML_PAGE_FILTER_KEYS), [scope.filter]);
  const listQ = useQuery({
    queryKey: ["advisories", shown.organizationId ?? null, shown.locationId ?? null],
    // A thunk: React Query's context must never reach the filter.
    queryFn: () => fetchAdvisories(shown),
    refetchInterval: ADVISORIES_REFETCH_MS,
    retry: retryUnlessForbidden,
    enabled: scope.ready,
  });
  const data = listQ.data;
  const advisories = data?.advisories ?? [];
  const capped = data === undefined ? null : shownOfSentence(data.considered, data.candidates);

  return (
    <AppShell user={user} kpiRibbon={<span className="text-ink">Advisories · advisory</span>}>
      <div className="mx-auto max-w-[1200px] space-y-4 pb-8">
        <PageHeader eyebrow="Operations · Advisories" title="Advisories" subtitle={ADVISORIES_SUBTITLE} />

        <ScopeFilterBar
          filter={scope.filter}
          options={scope.options}
          unavailable={scope.unavailable}
          onChange={scope.setScope}
          pickers={ML_PAGE_FILTER_KEYS}
        />

        {listQ.isPending ? (
          // `isPending`, not `isLoading`: a paused or not-yet-enabled read must not read as empty.
          <p className="text-sm text-ink-muted">Loading advisories…</p>
        ) : listQ.isError && data === undefined ? (
          <p className="text-sm text-critical-ink" role="alert">
            {ADVISORIES_ERROR_SENTENCE}
          </p>
        ) : advisories.length === 0 ? (
          <SectionCard title="Advisories">
            <p className="text-sm text-ink-muted">{ADVISORY_EMPTY_SENTENCE}</p>
            {capped ? <p className="mt-2 text-xs text-ink-muted">{capped}</p> : null}
          </SectionCard>
        ) : (
          <div className="space-y-4">
            {capped ? <p className="text-xs text-ink-muted">{capped}</p> : null}
            {advisories.map((advisory) => (
              <AdvisoryCard key={advisory.id} advisory={advisory} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
