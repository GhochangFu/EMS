import type { DashboardDto, EnergyBill } from "@bms/shared";

import { SITE_ASSETS_TAB, SITE_TRENDS_TAB } from "./smoc-pages";

/** One entry of the station's tab chooser: a dashboard tab key and the label first seen for it. */
export type StationTab = { readonly key: string; readonly label: string };

/** The segments the site page owns itself; a dashboard tab with one of these keys is not offered. */
const PAGE_SEGMENTS: ReadonlySet<string> = new Set([SITE_ASSETS_TAB, SITE_TRENDS_TAB]);

/**
 * `F4.240` part b (ADR 0140 decision 3e, plan D8) — the station's tab chooser: the union of the
 * sites' dashboard tab keys, first seen wins. Sites come in the KPI list's order, and within a
 * site the tabs by `sortOrder`, so the first site's tabs lead and a key only a later site holds
 * comes after them, with the label of the first dashboard that holds it.
 *
 * `undefined` stands for a site with no dashboard to offer (its read is pending, failed, or its
 * view is not a `dashboard`) and adds nothing. The page's own segments (`assets`, `trends`) are
 * dropped, so the chooser never hides them. The bare station path selects the first entry.
 *
 * Tabs are matched by key only; no code names a key, a level or an organization (ADR 0098
 * decision 7). The cached DTOs are never reordered (the tabs are sorted as a copy).
 */
export function stationTabs(dashboards: readonly (Pick<DashboardDto, "tabs"> | undefined)[]): StationTab[] {
  const out: StationTab[] = [];
  const seen = new Set<string>();
  for (const dashboard of dashboards) {
    if (dashboard === undefined) {
      continue;
    }
    for (const entry of [...dashboard.tabs].sort((a, b) => a.sortOrder - b.sortOrder)) {
      if (seen.has(entry.key) || PAGE_SEGMENTS.has(entry.key)) {
        continue;
      }
      seen.add(entry.key);
      out.push({ key: entry.key, label: entry.label });
    }
  }
  return out;
}

/** One site's bill read, as the station's bills block holds it: the answer, or a failed read. */
export type StationBillRead = {
  readonly siteName: string;
  /** The read's own answer; `undefined` while pending (a placeholder from another month counts as pending). */
  readonly bill: EnergyBill | undefined;
  /** The read rejected with no answer of its own. */
  readonly failed: boolean;
};

/** The station total: pending, nothing to show, "—" with one sentence, or the sum. */
export type StationBillTotal =
  | { readonly kind: "pending" }
  | { readonly kind: "nothing" }
  | { readonly kind: "none"; readonly sentence: string }
  | {
      readonly kind: "total";
      readonly total: number;
      readonly currency: string;
      readonly month: string;
      readonly complete: boolean;
      readonly estimated: boolean;
    };

/** The fixed sentence for each reason the station has no total, naming the site (plan D11). */
export const STATION_TOTAL_SENTENCE = {
  failed: (site: string): string => `No station total: the bill for ${site} could not be read.`,
  unpriced: (site: string): string => `No station total: ${site} has no priced bill for this month.`,
  noCurrency: (site: string): string => `No station total: the bill for ${site} names no currency.`,
  month: (site: string): string => `No station total: the bill for ${site} is for a different month.`,
  currency: (site: string): string => `No station total: the bill for ${site} is in a different currency.`,
} as const;

/**
 * `F4.240` part b (ADR 0140 decision 3f, plan D11) — the station's bill total: the site bills'
 * `bill.total` added, never re-priced (no unit is multiplied by a rate here). It shows only when
 * every site's bill is priced (no `reason`, a `bill`) for the same month in the same, named
 * currency; it is month to date when any site's month is, and estimated when any bill is.
 * Otherwise it is "—" with one fixed sentence naming the first site, in list order, that stops it
 * ({@link STATION_TOTAL_SENTENCE}). Any pending read makes the total pending; every site
 * answering `no_mapping` (or no site at all) is "nothing", which the bills block draws as nothing
 * for the current month.
 */
export function stationBillTotal(reads: readonly StationBillRead[]): StationBillTotal {
  if (reads.some((read) => read.bill === undefined && !read.failed)) {
    return { kind: "pending" };
  }
  if (reads.every((read) => read.bill?.reason === "no_mapping")) {
    return { kind: "nothing" };
  }
  let total = 0;
  let first: EnergyBill | undefined;
  for (const read of reads) {
    const answer = read.bill;
    if (answer === undefined) {
      return { kind: "none", sentence: STATION_TOTAL_SENTENCE.failed(read.siteName) };
    }
    if (answer.reason !== null || answer.bill === null) {
      return { kind: "none", sentence: STATION_TOTAL_SENTENCE.unpriced(read.siteName) };
    }
    if (answer.currency === null) {
      return { kind: "none", sentence: STATION_TOTAL_SENTENCE.noCurrency(read.siteName) };
    }
    first ??= answer;
    if (answer.month !== first.month) {
      return { kind: "none", sentence: STATION_TOTAL_SENTENCE.month(read.siteName) };
    }
    if (answer.currency !== first.currency) {
      return { kind: "none", sentence: STATION_TOTAL_SENTENCE.currency(read.siteName) };
    }
    total += answer.bill.total;
  }
  // `first` is set: `reads` is not empty (an empty list is "nothing" above) and every read passed.
  const head = first as EnergyBill;
  return {
    kind: "total",
    total,
    currency: head.currency as string,
    month: head.month,
    complete: reads.every((read) => read.bill?.complete === true),
    estimated: reads.some((read) => read.bill?.bill?.estimated === true),
  };
}
