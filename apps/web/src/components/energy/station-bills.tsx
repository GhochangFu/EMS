import type { LocationKpiSummary } from "@bms/shared";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { formatMoney } from "../../lib/money";
import { stationBillTotal, type StationBillRead, type StationBillTotal } from "../../lib/station-view";
import { StatusPill } from "../status-pill";
import { billQueryOptions, MonthlyBillCard, monthOptions } from "./monthly-bill-card";

/** The total's line when no site has a mapping for a past month the reader chose. */
const NO_MAPPING_SENTENCE = "No station total: no site has a tariff mapped for this month.";

/**
 * `F4.240` part b (ADR 0140 decision 3f, plan D10, D11) — the station's monthly bills: one
 * `MonthlyBillCard` per site, titled by the site and reading that site's own mapping, under one
 * month selector, with a **Station total** line that adds the site totals (`stationBillTotal`,
 * never re-priced).
 *
 * The total observes the cards' own reads (`billQueryOptions`: the same key and options), so it
 * adds no request; no read here names the station, so the station's own tariff row is never read.
 * A placeholder answer from the previous month counts as pending, so the total never adds months.
 * When every site answers `no_mapping` for the current month the block renders nothing. The
 * selector's months count back from the current month of the first site whose default read
 * answered, as the card's own selector does. A site whose read failed, even after an earlier
 * answer, stops the total.
 */
export function StationBills({ sites }: { sites: readonly LocationKpiSummary[] }) {
  const [month, setMonth] = useState("");
  const [currentMonth, setCurrentMonth] = useState<string | null>(null);
  const queries = useQueries({ queries: sites.map((site) => billQueryOptions(site.id, month)) });

  const reads: StationBillRead[] = sites.map((site, index) => {
    const query = queries[index];
    // A failed background refetch keeps TanStack's old `data` and sets `isError`; the card then
    // shows its error, so the total treats that site as failed, never as its old amount.
    const own = query === undefined || query.isError || query.isPlaceholderData ? undefined : query.data;
    return { siteName: site.name, bill: own, failed: query?.isError === true };
  });
  const firstMonth = month === "" ? reads.find((read) => read.bill !== undefined)?.bill?.month : undefined;
  useEffect(() => {
    if (firstMonth !== undefined) setCurrentMonth(firstMonth);
  }, [firstMonth]);

  const total = stationBillTotal(reads);
  if (month === "" && total.kind === "nothing") {
    return null;
  }

  return (
    <section aria-label="Monthly bills" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TotalLine total={total} />
        {currentMonth !== null ? (
          <label className="text-2xs text-ink-muted">
            <span className="sr-only">Billing month</span>
            <select
              aria-label="Billing month"
              className="surface-field px-2 py-1.5 text-sm"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            >
              {monthOptions(currentMonth).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {sites.map((site) => (
          <MonthlyBillCard key={site.id} locationId={site.id} title={site.name} month={month} />
        ))}
      </div>
    </section>
  );
}

function TotalLine({ total }: { total: StationBillTotal }) {
  return (
    <p data-testid="station-bill-total" className="flex flex-wrap items-center gap-2 text-sm text-ink">
      <span className="font-semibold">Station total</span>
      {total.kind === "total" ? (
        <>
          <span data-testid="station-bill-total-amount" className="text-lg font-semibold">
            {formatMoney(total.total, total.currency, 2) ?? total.total.toLocaleString()}
          </span>
          <span className="text-ink-muted">sum of the site bills</span>
          {total.complete ? null : <StatusPill label="Month to date" tone="info" />}
          {total.estimated ? <StatusPill label="Estimated" tone="warning" /> : null}
        </>
      ) : total.kind === "pending" ? (
        <span className="text-ink-muted">Loading…</span>
      ) : (
        <>
          <span>—</span>
          <span className="text-ink-muted">{total.kind === "none" ? total.sentence : NO_MAPPING_SENTENCE}</span>
        </>
      )}
    </p>
  );
}
