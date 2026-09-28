import { useId } from "react";

import { MIMIC_PRESETS, type MimicNodeDto, type MimicPreset } from "@bms/shared";

import type { SiteLiveReadings } from "../../hooks/use-site-live-readings";
import { formatPointValue } from "../../lib/generated-site-view";
import {
  MIMIC_ALARM_CLASSES,
  MIMIC_CALLOUT,
  MIMIC_FRAME_H,
  MIMIC_LAYOUTS,
  MIMIC_NODE_GLYPHS,
  MIMIC_NODE_SIZE,
  MIMIC_PANEL_CLASSES,
  MIMIC_PANELS,
  MIMIC_PIPE_Y,
  MIMIC_SINK_W,
  MIMIC_STATUS_LABEL,
  MIMIC_STATUS_STROKE,
  mimicAlarmSeverityLabel,
  mimicAlarmTone,
  mimicBadge,
  mimicCalloutText,
  mimicLevelFraction,
  mimicLevelPoint,
  mimicNodePoints,
  mimicNodeStatus,
  mimicPanelBox,
  pipeMidpoint,
  pipePath,
  sinkPath,
  type MimicGlyphKind,
  type MimicNodeStatus,
  type MimicPanelTone,
  type MimicPoint,
} from "../../lib/mimic";
import { isStale } from "../../lib/schematic-telemetry";
import type { WidgetStatus } from "../../lib/widget-catalog";
import { MimicGlyph } from "./mimic-glyphs";
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

/** Value rows, under the status frame. */
const ROW_Y = [152, 170, 188] as const;

/** The symbol's square inside the frame, centred on the pipe height. */
const GLYPH_SIZE = 60;

/** One flow dash period, in viewBox units: the animated offset runs over exactly one. */
const FLOW_DASH = "6 10";
const FLOW_PERIOD = 16;

/**
 * `F3.32` U4, redrawn by `F3.32b` (ADR 0079 Amendment 2) — the fixed plant mimic.
 *
 * Draws the PRESET, not the response: every preset node in its declared order, each looked up
 * by key in `nodes`, so a node the response lacks still draws — as "Not assigned" — and the
 * train never loses a box. The nodes sit in tinted panels (`MIMIC_PANELS`: water treatment,
 * utilities, wastewater); a node no panel names still draws, after the panels.
 *
 * Each unit is a status frame round its label and illustrated symbol (`MIMIC_NODE_GLYPHS`), up
 * to three value rows under it, and — when the node carries `topAlarm` — an alarm callout under
 * those, in the severity's role colour. A pipe whose upstream node is `live` carries a moving
 * dash, hidden under `prefers-reduced-motion` by Tailwind's `motion-reduce:` variant (no
 * `matchMedia`, which the colour gate forbids).
 *
 * **Colours are ADR 0078 role classes only** — no hex, no palette class, no named colour, no
 * `dark:` (`tests/f3.65-colour-roles-gate.test.ts`).
 *
 * Marker ids come from `useId`, so two mimics on one dashboard do not share an arrowhead id.
 */
export function MimicWidget({ title, status, preset, nodes, readings }: MimicWidgetProps) {
  const markerId = `mimic-arrow-${useId().replace(/:/g, "")}`;
  const def = MIMIC_PRESETS[preset];
  const layout = MIMIC_LAYOUTS[preset];
  const at = layout.nodes as Readonly<Record<string, MimicPoint>>;
  const glyphs = MIMIC_NODE_GLYPHS[preset] as Readonly<Record<string, MimicGlyphKind>>;
  const panels = MIMIC_PANELS[preset];
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const sinkFrom = at[def.sink.from];

  const statusOf = new Map<string, MimicNodeStatus>(
    def.nodes.map((presetNode) => {
      const node = byKey.get(presetNode.key);
      const asset = node?.asset ?? null;
      return [
        presetNode.key,
        mimicNodeStatus(
          { asset, activeAlarms: node?.activeAlarms ?? 0 },
          asset === null ? null : readings.assetLastSeenMs(asset),
          readings.nowMs,
        ),
      ];
    }),
  );
  const toneOf = new Map<string, MimicPanelTone>(panels.flatMap((p) => p.nodes.map((k) => [k, p.tone] as const)));
  const inPanel = new Set<string>(panels.flatMap((p) => [...p.nodes]));

  const renderNode = (presetNode: (typeof def.nodes)[number]) => {
    const pos = at[presetNode.key];
    if (pos === undefined) {
      return null;
    }
    const { w } = MIMIC_NODE_SIZE;
    const node = byKey.get(presetNode.key);
    const asset = node?.asset ?? null;
    const nodeStatus = statusOf.get(presetNode.key) ?? "unassigned";
    const badge = asset === null ? null : mimicBadge(node?.memberCount ?? 0);
    const statusLabel = MIMIC_STATUS_LABEL[nodeStatus];
    const glyph = glyphs[presetNode.key] ?? "vessel";
    const levelPoint = asset === null || glyph !== "tank" ? null : mimicLevelPoint(asset);
    const level =
      asset === null || levelPoint === null
        ? null
        : mimicLevelFraction(readings.pointLatest(asset.id, levelPoint)?.value ?? null);
    const glyphClass =
      asset === null ? "stroke-ink-faint" : MIMIC_PANEL_CLASSES[toneOf.get(presetNode.key) ?? "neutral"].glyph;
    const topAlarm = asset === null ? null : (node?.topAlarm ?? null);
    const alarmTone = topAlarm === null ? null : mimicAlarmTone(topAlarm.severity);
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
          height={MIMIC_FRAME_H}
          rx={10}
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
        <MimicGlyph
          kind={glyph}
          x={pos.x + (w - GLYPH_SIZE) / 2}
          y={pos.y + MIMIC_PIPE_Y - GLYPH_SIZE / 2}
          size={GLYPH_SIZE}
          className={glyphClass}
          level={level}
        />
        {asset === null
          ? null
          : mimicNodePoints(asset).map((point, i) => {
              const latest = readings.pointLatest(asset.id, point);
              const rowStale = latest !== null && isStale(latest.atMs, readings.nowMs);
              const unit = latest === null ? "" : (point.unit ?? "");
              const y = pos.y + (ROW_Y[i] ?? ROW_Y[ROW_Y.length - 1]);
              return (
                <g key={point.pointKey} data-testid="mimic-point" data-point-key={point.pointKey}>
                  <text x={pos.x + 4} y={y} fontSize={12} className="fill-ink-muted">
                    {point.name ?? point.pointKey}
                  </text>
                  <text
                    data-testid="mimic-point-value"
                    x={pos.x + w - 4}
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
        {topAlarm === null || alarmTone === null ? null : (
          <g data-testid="mimic-alarm-callout" data-severity={topAlarm.severity} data-tone={alarmTone}>
            <title>{topAlarm.message}</title>
            <rect
              x={pos.x}
              y={pos.y + MIMIC_CALLOUT.y}
              width={w}
              height={MIMIC_CALLOUT.h}
              rx={8}
              strokeWidth={1.5}
              className={MIMIC_ALARM_CLASSES[alarmTone].box}
            />
            <MimicGlyph
              kind="alert"
              x={pos.x + 9}
              y={pos.y + MIMIC_CALLOUT.y + 12}
              size={24}
              className={MIMIC_ALARM_CLASSES[alarmTone].icon}
            />
            <text
              data-testid="mimic-alarm-message"
              x={pos.x + 42}
              y={pos.y + MIMIC_CALLOUT.y + 20}
              fontSize={12}
              fontWeight={700}
              className={MIMIC_ALARM_CLASSES[alarmTone].ink}
            >
              {mimicCalloutText(topAlarm.message)}
            </text>
            <text
              data-testid="mimic-alarm-severity"
              x={pos.x + 42}
              y={pos.y + MIMIC_CALLOUT.y + 37}
              fontSize={11}
              className={MIMIC_ALARM_CLASSES[alarmTone].ink}
            >
              {mimicAlarmSeverityLabel(topAlarm.severity)}
            </text>
          </g>
        )}
      </g>
    );
  };

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

          {panels.map((panel) => {
            const box = mimicPanelBox(
              panel.nodes.flatMap((k) => (at[k] === undefined ? [] : [at[k] as MimicPoint])),
              (panel.nodes as readonly string[]).includes(def.sink.from) ? layout.sink : null,
            );
            const cls = MIMIC_PANEL_CLASSES[panel.tone];
            return box === null ? null : (
              <g key={panel.key} data-testid="mimic-panel-frame" data-panel-key={panel.key}>
                <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={14} strokeWidth={1.5} className={cls.frame} />
                <text
                  x={box.x + 16}
                  y={box.y + 22}
                  fontSize={13}
                  fontWeight={700}
                  letterSpacing={1}
                  className={cls.title}
                >
                  {panel.label.toUpperCase()}
                </text>
              </g>
            );
          })}

          {def.pipes.map((pipe) => {
            const from = at[pipe.from];
            const to = at[pipe.to];
            if (from === undefined || to === undefined) {
              return null;
            }
            const d = pipePath(from, to);
            return (
              <g key={`${pipe.from}->${pipe.to}`}>
                <path
                  data-testid="mimic-pipe"
                  d={d}
                  fill="none"
                  strokeWidth={3}
                  markerEnd={`url(#${markerId})`}
                  className="stroke-line-strong"
                />
                {statusOf.get(pipe.from) === "live" ? <FlowDash d={d} from={pipe.from} /> : null}
              </g>
            );
          })}

          {layout.pumps.map((pump) => {
            const from = at[pump.from];
            const to = at[pump.to];
            const mid = from === undefined || to === undefined ? null : pipeMidpoint(from, to);
            return mid === null ? null : (
              <g key={`pump:${pump.from}->${pump.to}`} data-testid="mimic-pump">
                <circle cx={mid.x} cy={mid.y} r={17} strokeWidth={1.5} className="fill-surface stroke-line-strong" />
                <MimicGlyph kind="pump" x={mid.x - 12} y={mid.y - 12} size={24} className="stroke-info" />
              </g>
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
              {statusOf.get(def.sink.from) === "live" ? (
                <FlowDash d={sinkPath(sinkFrom, layout.sink)} from={def.sink.from} />
              ) : null}
              <MimicGlyph
                kind="discharge"
                x={layout.sink.x - MIMIC_SINK_W + 8}
                y={layout.sink.y - 28}
                size={48}
                className="stroke-ink-muted"
              />
              <text
                x={layout.sink.x - MIMIC_SINK_W / 2 + 2}
                y={layout.sink.y + 40}
                textAnchor="middle"
                fontSize={13}
                fontWeight={700}
                className="fill-ink-muted"
              >
                {def.sink.label}
              </text>
            </g>
          )}

          {panels.map((panel) => (
            <g key={panel.key} data-testid="mimic-panel" data-panel-key={panel.key}>
              {def.nodes.filter((n) => (panel.nodes as readonly string[]).includes(n.key)).map(renderNode)}
            </g>
          ))}
          {def.nodes.filter((n) => !inPanel.has(n.key)).map(renderNode)}
        </svg>
      </div>
    </WidgetFrame>
  );
}

/**
 * The moving dash over a pipe whose upstream node is live. SMIL, not a CSS keyframe, so no
 * stylesheet or Tailwind config changes; `motion-reduce:hidden` removes it for a person who asked
 * for reduced motion, leaving the plain pipe.
 */
function FlowDash({ d, from }: { d: string; from: string }) {
  return (
    <path
      data-testid="mimic-flow"
      data-flow-from={from}
      d={d}
      fill="none"
      strokeWidth={3}
      strokeDasharray={FLOW_DASH}
      className="stroke-accent motion-reduce:hidden"
    >
      <animate attributeName="stroke-dashoffset" from={FLOW_PERIOD} to={0} dur="1s" repeatCount="indefinite" />
    </path>
  );
}
