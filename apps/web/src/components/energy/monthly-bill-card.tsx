import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { EnergyBill, EnergyBillReason } from "@bms/shared";

import { fetchEnergyBill } from "../../api/energy-bill";
import { formatMoney } from "../../lib/money";
import { SectionCard } from "../section-card";
import { StatusPill } from "../status-pill";
import { TariffVerifyBadge } from "./tariff-verify-badge";

/** How far back the month selector reaches (the API refuses anything older). */
export const BILL_MONTHS_BACK = 24;

export const BILL_FOOTNOTE =
  "Excludes electricity duty, FPPAS/FAC and subsidies. Also not included: time-of-day rates, power-factor and load-factor rebates, minimum charges and telescopic demand.";

/** One fixed sentence per reason the API gives for not billing; `no_mapping` is shown only for a past month. */
export const BILL_REASON_TEXT: Record<EnergyBillReason, string> = {
  no_mapping: "No tariff was mapped to this site for this month.",
  no_version_in_force: "No tariff was in force for this month.",
  meter_no_reading: "The billing meter has no readings for this month.",
  meter_decreasing: "The billing meter's reading went down during this month, so the units cannot be billed.",
  kvah_unavailable: "This tariff bills in kVAh, but the billing meter does not report kVAh.",
  load_unit_mismatch: "The sanctioned load unit does not match what this tariff charges its fixed amount on.",
  version_invalid: "The tariff in force for this month is incomplete (for example, it has no slabs), so it cannot be priced.",
};

export const BILL_ERROR_TEXT = "Could not load the monthly bill.";

export type MonthOption = { value: string; label: string };

function labelOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 1)).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The selector's months, counted back from `current` ("YYYY-MM"): the current month first (value
 * `""`, so the API picks it in the location's own zone), then the previous
 * {@link BILL_MONTHS_BACK}. The card passes the month the server answered for its default read —
 * the current month in the LOCATION's zone — so near a month boundary the list never offers a
 * month the API calls future (400) or repeats one.
 */
export function monthOptions(current: string): MonthOption[] {
  const options: MonthOption[] = [{ value: "", label: `${labelOf(current)} (current)` }];
  for (let back = 1; back <= BILL_MONTHS_BACK; back += 1) {
    const key = shiftMonth(current, -back);
    options.push({ value: key, label: labelOf(key) });
  }
  return options;
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const unitLabel = (type: "kwh" | "kvah"): string => (type === "kwh" ? "kWh" : "kVAh");
const number = (n: number): string => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

function TariffLine({ tariff }: { tariff: NonNullable<EnergyBill["tariff"]> }) {
  const link = /^https?:\/\//i.test(tariff.sourceUrl ?? "") ? tariff.sourceUrl : null;
  return (
    <p className="text-2xs text-ink-muted">
      {tariff.name} · {tariff.state} · effective {tariff.effectiveFrom}
      {link !== null ? (
        <>
          {" · "}
          <a href={link} target="_blank" rel="noopener noreferrer" className="underline">
            Source
          </a>
        </>
      ) : null}
    </p>
  );
}

function BillBody({ bill, data }: { bill: NonNullable<EnergyBill["bill"]>; data: EnergyBill }) {
  const money = (n: number, digits = 2): string => formatMoney(n, data.currency, digits) ?? number(n);
  const unit = unitLabel(bill.unitType);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold text-ink">{money(bill.total)}</span>
        <span className="text-sm text-ink-muted">
          {number(bill.units)} {unit}
        </span>
        {data.complete ? null : <StatusPill label="Month to date" tone="info" />}
        {bill.estimated ? <StatusPill label="Estimated" tone="warning" /> : null}
        {data.dataStatus !== null && data.dataStatus !== "official" ? <TariffVerifyBadge /> : null}
      </div>

      {bill.overflowUnits > 0 ? (
        <p role="note" className="text-sm font-medium text-warning-ink">
          {number(bill.overflowUnits)} units above the tariff&apos;s last slab are charged at its last slab&apos;s rate
        </p>
      ) : null}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-2xs text-ink-muted">
            <th className="py-1 font-medium">Slab</th>
            <th className="py-1 font-medium">Units × rate</th>
            <th className="py-1 text-right font-medium">Charge</th>
          </tr>
        </thead>
        <tbody>
          {bill.slabLines.map((line) => (
            <tr key={line.slabNo} className="border-t border-well-deep">
              <td className="py-1">
                {number(line.fromUnits)}–{line.toUnits === null ? "above" : number(line.toUnits)}
              </td>
              <td className="py-1">
                {number(line.units)} × {money(line.energyRate, 4)}
              </td>
              <td className="py-1 text-right">{money(line.energyCharge)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-well-deep">
            <td className="py-1" colSpan={2}>
              Energy charge
            </td>
            <td className="py-1 text-right">{money(bill.energyCharge)}</td>
          </tr>
          <tr>
            <td className="py-1" colSpan={2}>
              Fixed / demand charge
            </td>
            <td className="py-1 text-right">{money(bill.fixedCharge)}</td>
          </tr>
          <tr>
            <td className="py-1" colSpan={2}>
              Wheeling charge
            </td>
            <td className="py-1 text-right">{money(bill.wheelingCharge)}</td>
          </tr>
          <tr className="border-t border-well-deep font-semibold">
            <td className="py-1" colSpan={2}>
              Total
            </td>
            <td className="py-1 text-right">{money(bill.total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * `F4.365` U10 (ADR 0134 decisions 6, 7, 9 and Amendment 1) — the site's monthly bill: one
 * month's units priced through the location's mapped slab tariff. Renders nothing while loading
 * and when the location has no mapping (`no_mapping`), so a site without a tariff is unchanged.
 */
export function MonthlyBillCard({ locationId }: { locationId: string }) {
  const [month, setMonth] = useState("");
  // The location-zone current month, learned from the default read (see `monthOptions`).
  const [currentMonth, setCurrentMonth] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["energy", "bill", locationId, month],
    queryFn: () => fetchEnergyBill(locationId, month === "" ? undefined : month),
    refetchInterval: 5 * 60_000,
    // The previous month's bill stays on screen while the next loads, so the selector the reader
    // just used does not vanish under them.
    placeholderData: keepPreviousData,
  });

  const data = q.data;
  const fresh = data !== undefined && !q.isPlaceholderData;
  useEffect(() => {
    // Only the default read's own answer names the current month — never a placeholder from a past one.
    if (month === "" && fresh) setCurrentMonth(data.month);
  }, [month, data, fresh]);

  const selector = (current: string) => (
    <label className="text-2xs text-ink-muted">
      <span className="sr-only">Billing month</span>
      <select
        aria-label="Billing month"
        className="surface-field px-2 py-1.5 text-sm"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
      >
        {monthOptions(current).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  if (q.isError) {
    // The selector stays once the current month is known, so a month that failed is not a dead end.
    return (
      <SectionCard title="Monthly bill" actions={currentMonth !== null ? selector(currentMonth) : undefined}>
        <p className="text-sm text-ink-muted">{BILL_ERROR_TEXT}</p>
      </SectionCard>
    );
  }
  // Nothing for a site with no mapping now; but a past month with none keeps the selector, so
  // the reader is not stranded on a month before the mapping began.
  if (data === undefined || (data.reason === "no_mapping" && month === "")) {
    return null;
  }

  return (
    <SectionCard
      title="Monthly bill"
      subtitle={data.tariff ? <TariffLine tariff={data.tariff} /> : undefined}
      actions={selector(currentMonth ?? data.month)}
    >
      {data.bill !== null && data.reason === null ? (
        <BillBody bill={data.bill} data={data} />
      ) : (
        <p className="text-sm text-ink-muted">{data.reason === null ? BILL_ERROR_TEXT : BILL_REASON_TEXT[data.reason]}</p>
      )}
      <p className="mt-3 text-2xs text-ink-muted">{BILL_FOOTNOTE}</p>
    </SectionCard>
  );
}
