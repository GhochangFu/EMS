import { useId } from "react";

import { MIMIC_PRESETS, type MimicNodeDto, type MimicPreset } from "@bms/shared";

import type { SiteLiveReadings } from "../../hooks/use-site-live-readings";
import { formatPointValue } from "../../lib/generated-site-view";
import {
  MIMIC_LAYOUTS,
  MIMIC_NODE_SIZE,
  MIMIC_STATUS_LABEL,
  MIMIC_STATUS_STROKE,
  mimicBadge,
  mimicNodePoints,
  mimicNodeStatus,
  pipePath,
  sinkPath,
  type MimicPoint,
} from "../../lib/mimic";
import { isStale } from "../../lib/schematic-telemetry";
import type { WidgetStatus } from "../../lib/widget-catalog";
import { WidgetFrame } from "./widget-frame";

type MimicWidgetProps = {
  title: string;
  status: WidgetStatus;
  preset: MimicPreset;
  /** The resolved nodes, by key. A preset node with no entry here draws as "Not assigned". */
  nodes: readonly MimicNodeDto[];
  readings: SiteLiveReadings;
};

/** No resolved node — what `DashboardWidget` draws, having no node read of its own. */
export const NO_MIMIC_NODES: readonly MimicNodeDto[] = [];

/** No live overlay: every point reads the shared dash and every asset reads `none`. */
export const NO_LIVE_READINGS: SiteLiveReadings = {
  nowMs: 0,
  pointLatest: () => null,
  assetLastSeenMs: () => null,
};

const ROW_Y = [62, 82, 102] as const;

/**
 * `F3.32` U4 — the fixed plant mimic (ADR 0079 decisions 2–5, plan §3 U4).
 *
 * Draws the PRESET, not the response: every preset node in its declared order, each looked up
 * by key in `nodes`, so a node the response lacks still draws — as "Not assigned" — and the
 * train never loses a box. Pipes are the preset's; the sink is a drawn label (owner ruling 1).
 *
 * **Colours are ADR 0078 role classes only** — no hex, no palette class, no named colour, no
 * `dark:` (`tests/f3.65-colour-roles-gate.test.ts`). The status outline is
 * `MIMIC_STATUS_STROKE`; an unassigned node is dashed and dimmed.
 *
 * Marker ids come from `useId`, so two mimics on one dashboard do not share an arrowhead id.
 */
export function MimicWidget({ title, status, preset, nodes, readings }: MimicWidgetProps) {
  const markerId = `mimic-arrow-${useId().replace(/:/g, "")}`;
  const def = MIMIC_PRESETS[preset];
  const layout = MIMIC_LAYOUTS[preset];
  const at = layout.nodes as Readonly<Record<string, MimicPoint>>;
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const { w, h } = MIMIC_NODE_SIZE;
  const sinkFrom = at[def.sink.from];

  return (
    <WidgetFrame title={title} status={status}>
      <div className="min-h-0 flex-1">
        <svg
          viewBox={layout.viewBox}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`${title}: ${def.label}`}
          className="h-full w-full"
        >
          <defs>
            <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0 L10 5 L0 10 Z" className="fill-line-strong" />
            </marker>
          </defs>

          {def.pipes.map((pipe) => {
            const from = at[pipe.from];
            const to = at[pipe.to];
            return from === undefined || to === undefined ? null : (
              <path
                key={`${pipe.from}->${pipe.to}`}
                data-testid="mimic-pipe"
                d={pipePath(from, to)}
                fill="none"
                strokeWidth={3}
                markerEnd={`url(#${markerId})`}
                className="stroke-line-strong"
              />
            );
          })}

          {sinkFrom === undefined ? null : (
            <g data-testid="mimic-sink">
              <path
                d={sinkPath(sinkFrom, layout.sink)}
                fill="none"
                strokeWidth={3}
                markerEnd={`url(#${markerId})`}
                className="stroke-line-strong"
              />
              <text
                x={layout.sink.x - 8}
                y={layout.sink.y + 5}
                textAnchor="end"
                fontSize={15}
                className="fill-ink-muted"
              >
                {def.sink.label}
              </text>
            </g>
          )}

          {def.nodes.map((presetNode) => {
            const pos = at[presetNode.key];
            if (pos === undefined) {
              return null;
            }
            const node = byKey.get(presetNode.key);
            const asset = node?.asset ?? null;
            const nodeStatus = mimicNodeStatus(
              { asset, activeAlarms: node?.activeAlarms ?? 0 },
              asset === null ? null : readings.assetLastSeenMs(asset),
              readings.nowMs,
            );
            const badge = asset === null ? null : mimicBadge(node?.memberCount ?? 0);
            const statusLabel = MIMIC_STATUS_LABEL[nodeStatus];
            return (
              <g
                key={presetNode.key}
                data-testid="mimic-node"
                data-node-key={presetNode.key}
                data-status={nodeStatus}
                className={asset === null ? "opacity-50" : undefined}
              >
                <title>{`${presetNode.label}: ${statusLabel}`}</title>
                <rect
                  x={pos.x}
                  y={pos.y}
                  width={w}
                  height={h}
                  rx={8}
                  strokeWidth={nodeStatus === "alarm" ? 3 : 2}
                  strokeDasharray={asset === null ? "6 4" : undefined}
                  className={`fill-surface ${MIMIC_STATUS_STROKE[nodeStatus]}`}
                />
                <text x={pos.x + 12} y={pos.y + 22} fontSize={15} fontWeight={700} className="fill-ink">
                  {presetNode.label}
                </text>
                {badge === null ? null : (
                  <text
                    data-testid="mimic-badge"
                    x={pos.x + w - 12}
                    y={pos.y + 22}
                    textAnchor="end"
                    fontSize={12}
                    fontWeight={700}
                    className="fill-ink-muted"
                  >
                    {badge}
                  </text>
                )}
                <text x={pos.x + 12} y={pos.y + 40} fontSize={12} className="fill-ink-muted">
                  {asset === null ? statusLabel : asset.code}
                </text>
                {asset === null ? null : (
                  <text
                    data-testid="mimic-node-status"
                    x={pos.x + w - 12}
                    y={pos.y + 40}
                    textAnchor="end"
                    fontSize={11}
                    fontWeight={700}
                    className="fill-ink-muted"
                  >
                    {statusLabel}
                  </text>
                )}
                {asset === null
                  ? null
                  : mimicNodePoints(asset).map((point, i) => {
                      const latest = readings.pointLatest(asset.id, point);
                      const rowStale = latest !== null && isStale(latest.atMs, readings.nowMs);
                      const unit = latest === null ? "" : (point.unit ?? "");
                      const y = pos.y + (ROW_Y[i] ?? ROW_Y[ROW_Y.length - 1]);
                      return (
                        <g key={point.pointKey} data-testid="mimic-point" data-point-key={point.pointKey}>
                          <text x={pos.x + 12} y={y} fontSize={12} className="fill-ink-muted">
                            {point.name ?? point.pointKey}
                          </text>
                          <text
                            data-testid="mimic-point-value"
                            x={pos.x + w - 12}
                            y={y}
                            textAnchor="end"
                            fontSize={12}
                            fontWeight={700}
                            className={rowStale ? "fill-ink opacity-50" : "fill-ink"}
                          >
                            {`${formatPointValue(latest?.value ?? null)}${unit === "" ? "" : ` ${unit}`}`}
                          </text>
                        </g>
                      );
                    })}
              </g>
            );
          })}
        </svg>
      </div>
    </WidgetFrame>
  );
}
