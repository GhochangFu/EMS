import { ABNORMAL_LIST_MAX, type EnergyAbnormalEntry, type EnergyOrganizationViews } from "@bms/shared";

import { abnormalGroups, baselineSentence } from "../../lib/energy-organization-views";
import type { EnergySectionStatus } from "./energy-stack-chart";

type Props = {
  abnormal: EnergyOrganizationViews["abnormal"] | undefined;
  status: EnergySectionStatus;
};

function kwh(value: number | null): string {
  return value === null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function Row({ entry }: { entry: EnergyAbnormalEntry }) {
  return (
    <tr data-testid="abnormal-row" className="border-b border-well-deep">
      <td className="px-3 py-1.5 text-xs">{entry.kind === "site" ? "Site" : "Asset"}</td>
      <td className="px-3 py-1.5 text-xs">
        {entry.name}
        {entry.code !== null ? <span className="ml-1 text-ink-muted">{entry.code}</span> : null}
      </td>
      <td className="px-3 py-1.5 text-xs">{entry.kind === "asset" ? (entry.siteName ?? "—") : "—"}</td>
      <td className="px-3 py-1.5 text-right text-xs tabular-nums">{kwh(entry.currentKwh)}</td>
      <td className="px-3 py-1.5 text-right text-xs tabular-nums">{kwh(entry.baselineKwh)}</td>
      <td className="px-3 py-1.5 text-xs">
        {entry.verdict === "above" && entry.ratio !== null ? `${entry.ratio.toFixed(2)}×` : "not enough history"}
      </td>
    </tr>
  );
}

/**
 * `F4.299` U6 (ADR 0108 Amendment 1, 7.7) — the sites and assets whose kWh is
 * far above their own baseline, then those with not enough history. Advisory
 * only (ruling 4.7): no button, no link, no alarm — a list to read. `normal`
 * entities are a count in the footer, never rows.
 */
export function AbnormalList({ abnormal, status }: Props) {
  if (status === "loading") {
    return <p className="px-1 py-4 text-sm text-ink-muted">Loading the abnormal list…</p>;
  }
  if (status === "error") {
    return <p className="px-1 py-4 text-sm text-critical-ink">Could not load the abnormal list.</p>;
  }
  if (status === "empty" || abnormal === undefined) {
    return <p className="px-1 py-4 text-sm text-ink-muted">No kW data in this period.</p>;
  }

  const groups = abnormalGroups(abnormal);
  const rows = [...groups.above, ...groups.notEnoughHistory];

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted">
        {`Abnormal: ${baselineSentence(abnormal.baseline)}. Advisory only — no alarm is raised.`}
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">No site or asset is above its normal.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-well-deep bg-well text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-2">Kind</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Site</th>
              <th className="px-3 py-2 text-right">kWh</th>
              <th className="px-3 py-2 text-right">Baseline kWh</th>
              <th className="px-3 py-2">Ratio</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => (
              <Row key={`${entry.kind}:${entry.id}`} entry={entry} />
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-ink-muted">
        {`${groups.normalCount.sites} sites and ${groups.normalCount.assets} assets within their normal range`}
      </p>
      {groups.truncated ? <p className="text-xs text-warning-ink">{`list truncated to ${ABNORMAL_LIST_MAX}`}</p> : null}
    </div>
  );
}
