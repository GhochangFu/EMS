import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { encodePointRef } from "@bms/shared";
import type { AssetPointPickerRow, PointValuesAtInstantItem } from "@bms/shared";

import { fetchPointValuesAt } from "../../api/telemetry";
import { axisForUnit, MAX_HISTORY_POINTS } from "../../lib/asset-history-range";
import { SectionCard } from "../section-card";
import { ageOf, formatInZone, retryUnlessForbidden } from "./history-format";

/** The api's `MAX_AT_INSTANT_REFS`: one `at-instant` call reads at most this many refs. */
const AT_INSTANT_CHUNK = 50;
const LATEST_REFRESH_MS = 30_000;

export const POINT_CAP_SENTENCE = `At most ${MAX_HISTORY_POINTS} points can be charted at once.`;

/** The inline sentence for a point whose unit would need a third axis. */
export function thirdAxisSentence(unit: string | null): string {
  return `The chart has two axes, one unit each — ${unit ?? "a point with no unit"} would need a third.`;
}

async function latestValues(refs: readonly string[], atIso: string): Promise<Map<string, PointValuesAtInstantItem>> {
  const chunks: string[][] = [];
  for (let i = 0; i < refs.length; i += AT_INSTANT_CHUNK) {
    chunks.push(refs.slice(i, i + AT_INSTANT_CHUNK));
  }
  const answers = await Promise.all(chunks.map((chunk) => fetchPointValuesAt(chunk, atIso)));
  // Zipped by position: the server answers one item per requested ref, in request order.
  return new Map(
    answers.flatMap((answer, c) => answer.items.map((item, i) => [chunks[c][i], item] as const)),
  );
}

type PointListProps = {
  assetId: string;
  points: readonly AssetPointPickerRow[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
  /** The zone the poll times are formatted in (the site zone). */
  zone: string;
};

/**
 * `F4.297` U5 — the asset's points with the latest value and its poll time, and a checkbox per
 * point that puts it on the chart.
 *
 * The latest value comes from `at-instant` (ADR 0108 decision 1.7), not `latest`: a point that
 * stopped three days ago still shows its value and "3 d ago". The cap ({@link MAX_HISTORY_POINTS})
 * and the two-axis rule (`axisForUnit`) are refused here with an inline sentence, before the
 * selection reaches the URL.
 */
export function PointList({ assetId, points, selected, onChange, zone }: PointListProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const refs = points.map((point) => encodePointRef(assetId, point.pointKey));

  const latestQ = useQuery({
    queryKey: ["asset-history-latest", assetId, refs],
    queryFn: () => latestValues(refs, new Date().toISOString()),
    enabled: refs.length > 0,
    refetchInterval: LATEST_REFRESH_MS,
    retry: retryUnlessForbidden,
  });
  const nowMs = latestQ.dataUpdatedAt || Date.now();

  function toggle(point: AssetPointPickerRow): void {
    if (selected.includes(point.pointKey)) {
      setNotice(null);
      onChange(selected.filter((key) => key !== point.pointKey));
      return;
    }
    if (selected.length >= MAX_HISTORY_POINTS) {
      setNotice(POINT_CAP_SENTENCE);
      return;
    }
    const units = points.filter((p) => selected.includes(p.pointKey)).map((p) => p.unit);
    if (axisForUnit(units, point.unit) === "refused") {
      setNotice(thirdAxisSentence(point.unit));
      return;
    }
    setNotice(null);
    onChange([...selected, point.pointKey]);
  }

  return (
    <SectionCard title="Points" bodyClassName="surface-table overflow-x-auto p-0">
      {notice ? (
        <p role="status" className="border-b border-warning-line bg-warning-wash px-3 py-2 text-xs text-ink">
          {notice}
        </p>
      ) : null}
      {points.length === 0 ? (
        <p className="px-3 py-4 text-xs text-ink-muted">This asset has no active points.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-well-deep bg-well text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-2">Chart</th>
              <th className="px-3 py-2">Point</th>
              <th className="px-3 py-2">Latest</th>
              <th className="px-3 py-2">Polled</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => {
              const latest = latestQ.data?.get(encodePointRef(assetId, point.pointKey));
              const unit = latest?.unit ?? point.unit;
              return (
                <tr key={point.id} className="border-b border-well-deep" data-point-key={point.pointKey}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Chart ${point.pointKey}`}
                      checked={selected.includes(point.pointKey)}
                      onChange={() => toggle(point)}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{point.pointKey}</td>
                  <td className="px-3 py-2 tabular-nums" data-testid="latest-value">
                    {latest?.value === null || latest?.value === undefined
                      ? "—"
                      : `${latest.value}${unit ? ` ${unit}` : ""}`}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-muted" data-testid="poll-time">
                    {latest?.time ? (
                      <>
                        {ageOf(latest.time, nowMs)} · {formatInZone(latest.time, zone)}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}
