import type { EnergyView } from "@bms/shared";

import { formatKwhPerM2 } from "../../lib/energy-organization-views";
import { type EnergyChange, changeFor, levelLabel } from "../../lib/energy-view-filter";
import { costTileProps } from "../../lib/money";
import { pueTileProps } from "../../lib/pue-tile";
import { KpiTile, type KpiTileStatus } from "../kpi-tile";
import { formatPeakTime } from "./site-ranking-table";

/** The change hint, e.g. `+12.5 % vs previous`; `undefined` when compare is off. */
function changeHint(change: EnergyChange): string | undefined {
  switch (change.kind) {
    case "none":
      return undefined;
    case "no_previous":
      return "no data for the previous period";
    case "no_previous_value":
      return "no figure for the previous period";
    case "change":
      if (change.pct === null) {
        return "no % change — the previous figure is zero";
      }
      return `${change.pct >= 0 ? "+" : ""}${change.pct.toFixed(1)} % vs previous`;
  }
}

/** The hint parts that are present, joined with ` · `. */
function joinHint(...parts: (string | undefined)[]): string | undefined {
  const present = parts.filter((part): part is string => part !== undefined);
  return present.length === 0 ? undefined : present.join(" · ");
}

function wholeNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

type EnergyKpiTilesProps = {
  /** The read's status; the tiles show their own empty states on top of it. */
  status: KpiTileStatus;
  /** The `energy/view` answer, or `undefined` while `status` is not `ready`. */
  view: EnergyView | undefined;
  /**
   * `F4.304` (ADR 0108 Amendment 5 item 8) — the site page's seventh tile, kWh
   * per m²; absent on the Energy page. `hasReadableChildren` adds the hint that
   * the figure is the site's own assets', not the view's Total energy.
   */
  floorAreaTile?: { hasReadableChildren: boolean };
};

type TileState = { status: KpiTileStatus; value: string | null; unit?: string; hint?: string };

/**
 * The kWh per m² tile's state. The empty states run in a fixed order (plan C3):
 * no area first — even with no kW data, the fix is to set the area — then no kW
 * data in the period, then no kW data from the site's own assets. The figure is
 * the server's; the browser never divides.
 */
function floorAreaTileState(
  status: KpiTileStatus,
  v: EnergyView | undefined,
  hasReadableChildren: boolean,
): TileState {
  if (status !== "ready" || v === undefined) {
    return { status, value: null };
  }
  const current = v.current;
  if ((v.floorArea?.floorAreaM2 ?? null) === null) {
    return { status: "ready", value: "No area", hint: "Set the floor area in Admin → Locations" };
  }
  if (!current.hasData) {
    return { status: "empty", value: null, hint: "No kW data in this period" };
  }
  if (current.kwhPerM2 === null) {
    return { status: "empty", value: null, hint: "No kW data from this site's own assets" };
  }
  return {
    status: "ready",
    value: formatKwhPerM2(current.kwhPerM2),
    unit: "kWh/m²",
    hint: joinHint(
      hasReadableChildren ? "This site's own assets ÷ its floor area" : undefined,
      changeHint(changeFor(current, v.compare, "kwhPerM2")),
    ),
  };
}

/**
 * `F4.302` U3 (ADR 0108 Amendment 4 item 3) — the six Energy KPI tiles
 * (total, peak with its time, average PF, rollup, PUE, indicative cost) with
 * the change against the previous period in the hint slot, extracted from
 * `EnergyPage` so the site page reuses them. Order follows the
 * `ESKOM_SMOC.html` `#/energy` KPI row where it overlaps. `F4.304` adds a
 * seventh, kWh per m², on the site page only (`floorAreaTile`).
 */
export function EnergyKpiTiles({ status, view: v, floorAreaTile }: EnergyKpiTilesProps) {
  const current = v?.current;
  const compare = v?.compare ?? null;
  const noKw = current !== undefined && !current.hasData;
  const kwStatus: KpiTileStatus = noKw ? "empty" : status;

  const totalHint = current ? changeHint(changeFor(current, compare, "totalKwh")) : undefined;
  const peakHint =
    current && v
      ? joinHint(
          current.peakAt !== null ? `Peak at ${formatPeakTime(current.peakAt, v.timeZone)}` : undefined,
          changeHint(changeFor(current, compare, "peakKw")),
        )
      : undefined;
  const pfStatus: KpiTileStatus = current?.avgPf === null ? "empty" : status;
  const pfHint =
    current === undefined
      ? undefined
      : current.avgPf === null
        ? "No pf point in scope"
        : (changeHint(changeFor(current, compare, "avgPf")) ?? "Sample average of the pf points in scope");

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <KpiTile
        label="Total energy"
        status={kwStatus}
        value={current ? wholeNumber(current.totalKwh) : null}
        unit="kWh"
        hint={noKw ? "No kW data in this period" : totalHint}
      />
      <KpiTile
        label="Peak demand"
        status={kwStatus}
        value={current ? wholeNumber(current.peakKw) : null}
        unit="kW"
        hint={noKw ? "No kW data in this period" : peakHint}
      />
      <KpiTile
        label="Average PF"
        status={pfStatus}
        value={current?.avgPf != null ? current.avgPf.toFixed(2) : null}
        hint={pfHint}
      />
      {/* Decision 2.12 — the level read, the display bucket and the zone the buckets are in. */}
      <KpiTile
        label="Rollup"
        status={status}
        value={v ? v.level : null}
        hint={v ? levelLabel(v.level, v.bucket, v.timeZone) : undefined}
      />
      {/* `F2.8` — the windowed Σ site_kw / Σ it_kw, or a dash with a reason. */}
      <KpiTile label="PUE" {...pueTileProps(status, current?.pueEstimate)} />
      {/*
        `E4.1c` — the organization's currency carries the symbol, so the tile
        has no `unit`; a `null` cost (no tariff in scope, or two currencies) is
        the dash with the reason, never a 0.
      */}
      <KpiTile label="Indicative cost" {...costTileProps(status, current?.indicativeCost, current?.currency)} />
      {floorAreaTile !== undefined ? (
        <KpiTile label="kWh per m²" {...floorAreaTileState(status, v, floorAreaTile.hasReadableChildren)} />
      ) : null}
    </div>
  );
}
