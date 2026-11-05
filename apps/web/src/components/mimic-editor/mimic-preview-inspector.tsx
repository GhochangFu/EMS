import type { GeneratedSitePointDto, MimicNodeDto, PointKeyStateMapDto } from "@bms/shared";

import type { SiteLiveReadings } from "../../hooks/use-site-live-readings";
import { formatPointValue } from "../../lib/generated-site-view";
import { mimicBadge, mimicNodePoints } from "../../lib/mimic";

export type MimicPreviewInspectorProps = {
  /**
   * The selected roled unit: its label and its resolved node (`undefined` when the answer does
   * not list it). `null` when nothing is selected.
   */
  selection: { readonly label: string; readonly node: MimicNodeDto | undefined } | null;
  readings: SiteLiveReadings;
  stateMaps: readonly PointKeyStateMapDto[];
};

const HEADING = "mb-1 text-xs font-semibold uppercase text-ink-muted";
const ROW = "flex items-center gap-2 text-xs text-ink";

/** The label a state point's live value reads: its state map's row, else the formatted value. */
function stateLabel(value: number | null, pointKey: string, stateMaps: readonly PointKeyStateMapDto[]): string {
  if (value === null) {
    return formatPointValue(null);
  }
  const row = stateMaps.find((map) => map.pointKey === pointKey)?.states.find((state) => state.value === value);
  return row?.label ?? formatPointValue(value);
}

function valueText(value: number | null, unit: string | null): string {
  return value === null || unit === null ? formatPointValue(value) : `${formatPointValue(value)} ${unit}`;
}

function PointRows({ label, rows }: { label: string; rows: readonly { key: string; name: string; value: string }[] }) {
  return (
    <section>
      <h4 className={HEADING}>{label}</h4>
      <ul aria-label={label} className="space-y-1">
        {rows.map((row) => (
          <li key={row.key} className={ROW}>
            <span className="min-w-0 flex-1 truncate">{row.name}</span>
            <span>{row.value}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * `F4.308` (ADR 0081 Amendment 2 decision 6, plan C13) — what "Preview with site" shows of the
 * selected unit: the bound asset (`code — name`), its shown points (`mimicNodePoints`, the
 * server's order, values from the live overlay), its state points with their `stateMaps` label,
 * and its open-alarm count; or "No asset at this site". A fan-out unit shows its first asset and
 * the `+N` badge (owner ruling Q3 (a)). Read-only: nothing here edits the layout.
 */
export function MimicPreviewInspector({ selection, readings, stateMaps }: MimicPreviewInspectorProps) {
  if (selection === null) {
    return <p className="text-xs text-ink-muted">Select a unit to see its asset at this site.</p>;
  }
  const node = selection.node;
  const asset = node?.asset ?? null;
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase text-ink-muted">{selection.label}</h3>
      {node === undefined || asset === null ? (
        <p className="text-xs text-ink-muted">No asset at this site</p>
      ) : (
        <>
          <p className={ROW}>
            <span className="min-w-0 flex-1">{`${asset.code} — ${asset.name}`}</span>
            {mimicBadge(node.memberCount) !== null ? <span className="text-ink-muted">{mimicBadge(node.memberCount)}</span> : null}
          </p>
          <PointRows
            label="Points"
            rows={mimicNodePoints(asset).map((point: GeneratedSitePointDto) => ({
              key: point.pointKey,
              name: point.name ?? point.pointKey,
              value: valueText(readings.pointLatest(asset.id, point)?.value ?? null, point.unit),
            }))}
          />
          {node.statePoints.length > 0 ? (
            <PointRows
              label="State points"
              rows={node.statePoints.map((point) => ({
                key: point.pointKey,
                name: point.name ?? point.pointKey,
                value: stateLabel(readings.pointLatest(asset.id, point)?.value ?? null, point.pointKey, stateMaps),
              }))}
            />
          ) : null}
          <p className={ROW}>{`Open alarms: ${node.activeAlarms}`}</p>
        </>
      )}
    </div>
  );
}
