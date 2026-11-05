import { Link } from "react-router-dom";

import { ABNORMAL_LIST_MAX, assetLabelOf, type SegmentAbnormalDto } from "@bms/shared";

import { historyHrefFor, segmentBaselineSentence, segmentVerdictSentence } from "../../lib/site-trends";

type Props = {
  abnormal: SegmentAbnormalDto;
  pointCode: string;
  period: { readonly from: string; readonly to: string };
  compare: boolean;
};

function figure(value: number | null, unit: string | null): string {
  if (value === null) {
    return "—";
  }
  const text = value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return unit === null ? text : `${text} ${unit}`;
}

/**
 * `F4.302` U4 (ADR 0108 Amendment 4 item 5) — the segment's assets whose mean of one point is
 * outside their own baseline on either side, then those that cannot be compared, then those with
 * not enough history, in the server's order. Advisory only (ruling 4.7): no button and no alarm
 * link — the one link per row opens the asset's history. `normal` assets are a count, never rows.
 */
export function SegmentAbnormalList({ abnormal, pointCode, period, compare }: Props) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted">
        {`Abnormal: ${segmentBaselineSentence(abnormal.baseline)}. Advisory only — no alarm is raised.`}
      </p>
      {abnormal.entries.length === 0 ? (
        <p className="text-sm text-ink-muted">No asset is outside its normal for this point.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-well-deep bg-well text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-2">Asset</th>
              <th className="px-3 py-2 text-right">Mean</th>
              <th className="px-3 py-2 text-right">Baseline</th>
              <th className="px-3 py-2">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {abnormal.entries.map((entry) => (
              <tr key={entry.assetId + entry.verdict} className="border-b border-well-deep">
                <td className="px-3 py-1.5 text-xs">
                  <Link
                    to={historyHrefFor(entry.assetId, period, pointCode, compare)}
                    className="font-semibold text-accent-strong hover:underline"
                  >
                    {entry.assetName}
                  </Link>
                  <span className="ml-1 text-ink-muted">{assetLabelOf(entry)}</span>
                </td>
                <td className="px-3 py-1.5 text-right text-xs tabular-nums">{figure(entry.currentMean, entry.unit)}</td>
                <td className="px-3 py-1.5 text-right text-xs tabular-nums">{figure(entry.baselineMean, entry.unit)}</td>
                <td data-testid="segment-verdict" className="px-3 py-1.5 text-xs">
                  {segmentVerdictSentence(entry)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-ink-muted">{`${abnormal.normalCount} assets within their normal range`}</p>
      {abnormal.truncated ? <p className="text-xs text-warning-ink">{`list truncated to ${ABNORMAL_LIST_MAX}`}</p> : null}
    </div>
  );
}
