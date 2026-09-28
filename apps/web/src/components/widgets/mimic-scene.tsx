import { useId, type ReactNode } from "react";

import type { MimicNodeDto } from "@bms/shared";

import type { SiteLiveReadings } from "../../hooks/use-site-live-readings";
import { formatPointValue } from "../../lib/generated-site-view";
import {
  MIMIC_ALARM_CLASSES,
  MIMIC_CALLOUT,
  MIMIC_FRAME_H,
  MIMIC_NODE_SIZE,
  MIMIC_PANEL_CLASSES,
  MIMIC_PIPE_Y,
  MIMIC_SINK_W,
  MIMIC_STATUS_LABEL,
  MIMIC_STATUS_STROKE,
  mimicAlarmTone,
  mimicAriaLabel,
  mimicBadge,
  mimicCalloutText,
  mimicLevelFraction,
  mimicLevelPoint,
  mimicNodeFlows,
  mimicNodePoints,
  mimicNodeStatus,
  type MimicNodeStatus,
} from "../../lib/mimic";
import { unitScale, type MimicGeometry, type MimicGeometryUnit } from "../../lib/mimic-geometry";
import { isStale } from "../../lib/schematic-telemetry";
import { FlowDash } from "./mimic-flow-dash";
import { MimicGlyph } from "./mimic-glyphs";

export type MimicSceneProps = {
  /** The widget's title — the first part of the drawing's accessible name. */
  title: string;
  geometry: MimicGeometry;
  /** The resolved nodes, by key. A roled unit with no entry here draws as "Not assigned". */
  nodes: readonly MimicNodeDto[];
  readings: SiteLiveReadings;
  /** Drawn inside the `<svg>`, after the drawing — the editor's hit rects and handles (U6). */
  children?: ReactNode;
};

/** Value rows, under the status frame, in unit-slot units. */
const ROW_Y = [152, 170, 188] as const;

/** The symbol's square inside the frame, centred on the pipe height. */
const GLYPH_SIZE = 60;

/** The callout's text column: right of the alert icon, clear of the slot's right edge. */
const CALLOUT_TEXT_X = 38;
const CALLOUT_TEXT_PAD_R = 6;

/**
 * `F3.32c` U4 (ADR 0081, plan D10) — the plant mimic's drawing, one renderer for a preset and a
 * stored layout. `F3.32b`'s `MimicWidget` body, lifted out and driven by a `MimicGeometry`.
 *
 * Draws the GEOMETRY, not the response: every unit in the geometry's order, each looked up by key
 * in `nodes`, so a roled unit the response lacks still draws — as "Not assigned". A passive unit
 * (`roleCode` `null`, plan D6) draws its frame, label and symbol with `data-status="passive"`: no
 * status text, no values, no callout, no flow.
 *
 * Each unit draws in its own 200 × 250 slot, scaled uniformly into its box and centred
 * (`unitScale`); a preset box is the slot itself, so the `F3.32b` drawing is unchanged. Order,
 * back to front: panel frames, labels, pipes (with the flow dash out of a unit with fresh data),
 * pumps, the sink, the units — grouped under their panel — and then `children`.
 *
 * **Accessibility.** The SVG is one `role="img"`; its `aria-label` names every unit whose callout
 * is drawn, with the severity label and the full message (`mimicAriaLabel`).
 *
 * **Colours are ADR 0078 role classes only** — no hex, no palette class, no named colour, no
 * `dark:` (`tests/f3.65-colour-roles-gate.test.ts`). Marker and clip ids come from `useId`, so
 * two mimics on one dashboard do not share one.
 */
export function MimicScene({ title, geometry, nodes, readings, children }: MimicSceneProps) {
  const uid = useId().replace(/:/g, "");
  const markerId = `mimic-arrow-${uid}`;
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const roled = geometry.units.filter((u) => u.roleCode !== null);

  const lastSeenOf = new Map<string, number | null>(
    roled.map((unit) => {
      const asset = byKey.get(unit.key)?.asset ?? null;
      return [unit.key, asset === null ? null : readings.assetLastSeenMs(asset)];
    }),
  );
  const statusOf = new Map<string, MimicNodeStatus>(
    roled.map((unit) => {
      const node = byKey.get(unit.key);
      return [
        unit.key,
        mimicNodeStatus(
          { asset: node?.asset ?? null, activeAlarms: node?.activeAlarms ?? 0 },
          lastSeenOf.get(unit.key) ?? null,
          readings.nowMs,
        ),
      ];
    }),
  );
  const flows = (key: string): boolean =>
    statusOf.has(key) &&
    mimicNodeFlows(statusOf.get(key) ?? "unassigned", lastSeenOf.get(key) ?? null, readings.nowMs);
  /** A unit's drawn callout alarm: only an assigned, roled unit draws one. */
  const calloutOf = (key: string) => {
    const node = statusOf.has(key) ? byKey.get(key) : undefined;
    return node === undefined || node.asset === null ? null : node.topAlarm;
  };
  const ariaLabel = mimicAriaLabel(
    title,
    geometry.label,
    geometry.units.flatMap((unit) => {
      const alarm = calloutOf(unit.key);
      return alarm === null ? [] : [{ unit: unit.label, severity: alarm.label, message: alarm.message }];
    }),
  );

  const renderPassive = (unit: MimicGeometryUnit, transform: string) => {
    const { w } = MIMIC_NODE_SIZE;
    return (
      <g
        key={unit.key}
        data-testid="mimic-node"
        data-node-key={unit.key}
        data-status="passive"
        transform={transform}
      >
        <title>{unit.label}</title>
        <rect x={0} y={0} width={w} height={MIMIC_FRAME_H} rx={10} strokeWidth={2} className="fill-surface stroke-line" />
        <text x={12} y={22} fontSize={15} fontWeight={700} className="fill-ink">
          {unit.label}
        </text>
        <MimicGlyph
          kind={unit.symbol}
          x={(w - GLYPH_SIZE) / 2}
          y={MIMIC_PIPE_Y - GLYPH_SIZE / 2}
          size={GLYPH_SIZE}
          className={MIMIC_PANEL_CLASSES[unit.tone].glyph}
        />
      </g>
    );
  };

  const renderUnit = (unit: MimicGeometryUnit) => {
    const { s, ox, oy } = unitScale(unit.box);
    const transform = `translate(${ox} ${oy}) scale(${s})`;
    if (unit.roleCode === null) {
      return renderPassive(unit, transform);
    }
    const { w } = MIMIC_NODE_SIZE;
    const node = byKey.get(unit.key);
    const asset = node?.asset ?? null;
    const nodeStatus = statusOf.get(unit.key) ?? "unassigned";
    const badge = asset === null ? null : mimicBadge(node?.memberCount ?? 0);
    const statusLabel = MIMIC_STATUS_LABEL[nodeStatus];
    const levelPoint = asset === null || unit.symbol !== "tank" ? null : mimicLevelPoint(asset);
    const level =
      asset === null || levelPoint === null
        ? null
        : mimicLevelFraction(readings.pointLatest(asset.id, levelPoint)?.value ?? null);
    const glyphClass = asset === null ? "stroke-ink-faint" : MIMIC_PANEL_CLASSES[unit.tone].glyph;
    const topAlarm = calloutOf(unit.key);
    const alarmTone = topAlarm === null ? null : mimicAlarmTone(topAlarm.tone);
    const clipId = `mimic-callout-${uid}-${unit.key}`;
    return (
      <g
        key={unit.key}
        data-testid="mimic-node"
        data-node-key={unit.key}
        data-status={nodeStatus}
        transform={transform}
        className={asset === null ? "opacity-50" : undefined}
      >
        <title>{`${unit.label}: ${statusLabel}`}</title>
        <rect
          x={0}
          y={0}
          width={w}
          height={MIMIC_FRAME_H}
          rx={10}
          strokeWidth={nodeStatus === "alarm" ? 3 : 2}
          strokeDasharray={asset === null ? "6 4" : undefined}
          className={`fill-surface ${MIMIC_STATUS_STROKE[nodeStatus]}`}
        />
        <text x={12} y={22} fontSize={15} fontWeight={700} className="fill-ink">
          {unit.label}
        </text>
        {badge === null ? null : (
          <text
            data-testid="mimic-badge"
            x={w - 12}
            y={22}
            textAnchor="end"
            fontSize={12}
            fontWeight={700}
            className="fill-ink-muted"
          >
            {badge}
          </text>
        )}
        <text x={12} y={40} fontSize={12} className="fill-ink-muted">
          {asset === null ? statusLabel : asset.code}
        </text>
        {asset === null ? null : (
          <text
            data-testid="mimic-node-status"
            x={w - 12}
            y={40}
            textAnchor="end"
            fontSize={11}
            fontWeight={700}
            className="fill-ink-muted"
          >
            {statusLabel}
          </text>
        )}
        <MimicGlyph
          kind={unit.symbol}
          x={(w - GLYPH_SIZE) / 2}
          y={MIMIC_PIPE_Y - GLYPH_SIZE / 2}
          size={GLYPH_SIZE}
          className={glyphClass}
          level={level}
        />
        {asset === null
          ? null
          : mimicNodePoints(asset).map((point, i) => {
              const latest = readings.pointLatest(asset.id, point);
              const rowStale = latest !== null && isStale(latest.atMs, readings.nowMs);
              const pointUnit = latest === null ? "" : (point.unit ?? "");
              const y = ROW_Y[i] ?? ROW_Y[ROW_Y.length - 1];
              return (
                <g key={point.pointKey} data-testid="mimic-point" data-point-key={point.pointKey}>
                  <text x={4} y={y} fontSize={12} className="fill-ink-muted">
                    {point.name ?? point.pointKey}
                  </text>
                  <text
                    data-testid="mimic-point-value"
                    x={w - 4}
                    y={y}
                    textAnchor="end"
                    fontSize={12}
                    fontWeight={700}
                    className={rowStale ? "fill-ink opacity-50" : "fill-ink"}
                  >
                    {`${formatPointValue(latest?.value ?? null)}${pointUnit === "" ? "" : ` ${pointUnit}`}`}
                  </text>
                </g>
              );
            })}
        {topAlarm === null || alarmTone === null ? null : (
          <g data-testid="mimic-alarm-callout" data-severity={topAlarm.severity} data-tone={alarmTone}>
            <title>{topAlarm.message}</title>
            <rect
              x={0}
              y={MIMIC_CALLOUT.y}
              width={w}
              height={MIMIC_CALLOUT.h}
              rx={8}
              strokeWidth={1.5}
              className={MIMIC_ALARM_CLASSES[alarmTone].box}
            />
            <clipPath id={clipId}>
              <rect
                x={CALLOUT_TEXT_X}
                y={MIMIC_CALLOUT.y}
                width={w - CALLOUT_TEXT_X - CALLOUT_TEXT_PAD_R}
                height={MIMIC_CALLOUT.h}
              />
            </clipPath>
            <MimicGlyph
              kind="alert"
              x={9}
              y={MIMIC_CALLOUT.y + 12}
              size={24}
              className={MIMIC_ALARM_CLASSES[alarmTone].icon}
            />
            <g data-testid="mimic-alarm-text" clipPath={`url(#${clipId})`}>
              <text
                data-testid="mimic-alarm-message"
                x={42}
                y={MIMIC_CALLOUT.y + 20}
                fontSize={12}
                fontWeight={700}
                className={MIMIC_ALARM_CLASSES[alarmTone].ink}
              >
                {mimicCalloutText(topAlarm.message)}
              </text>
              <text
                data-testid="mimic-alarm-severity"
                x={42}
                y={MIMIC_CALLOUT.y + 37}
                fontSize={11}
                className={MIMIC_ALARM_CLASSES[alarmTone].ink}
              >
                {mimicCalloutText(topAlarm.label)}
              </text>
            </g>
          </g>
        )}
      </g>
    );
  };

  const panelKeys = new Set(geometry.panels.map((p) => p.key));
  const sink = geometry.sink;

  return (
    <svg
      viewBox={geometry.viewBox}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={ariaLabel}
      className="h-full w-full"
    >
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L10 5 L0 10 Z" className="fill-line-strong" />
        </marker>
      </defs>

      {geometry.panels.map((panel) => {
        const cls = MIMIC_PANEL_CLASSES[panel.tone];
        const { box } = panel;
        return (
          <g key={panel.key} data-testid="mimic-panel-frame" data-panel-key={panel.key}>
            <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={14} strokeWidth={1.5} className={cls.frame} />
            <text x={box.x + 16} y={box.y + 22} fontSize={13} fontWeight={700} letterSpacing={1} className={cls.title}>
              {panel.label.toUpperCase()}
            </text>
          </g>
        );
      })}

      {geometry.labels.map((label) => (
        <text
          key={label.key}
          data-testid="mimic-label"
          data-label-key={label.key}
          x={label.box.x + 4}
          y={label.box.y + label.box.h / 2}
          dominantBaseline="middle"
          fontSize={14}
          fontWeight={700}
          className="fill-ink-muted"
        >
          {label.text}
        </text>
      ))}

      {geometry.pipes.map((pipe) => (
        <g key={`${pipe.from}->${pipe.to}`}>
          <path
            data-testid="mimic-pipe"
            data-pipe-from={pipe.from}
            data-pipe-to={pipe.to}
            d={pipe.d}
            fill="none"
            strokeWidth={3}
            markerEnd={`url(#${markerId})`}
            className="stroke-line-strong"
          />
          {flows(pipe.from) ? <FlowDash d={pipe.d} from={pipe.from} /> : null}
        </g>
      ))}

      {geometry.pumps.map((pump) => (
        <g key={`pump:${pump.from}->${pump.to}`} data-testid="mimic-pump">
          <circle cx={pump.at.x} cy={pump.at.y} r={17} strokeWidth={1.5} className="fill-surface stroke-line-strong" />
          <MimicGlyph kind="pump" x={pump.at.x - 12} y={pump.at.y - 12} size={24} className="stroke-info" />
        </g>
      ))}

      {sink === null ? null : (
        <g data-testid="mimic-sink">
          <path d={sink.d} fill="none" strokeWidth={3} markerEnd={`url(#${markerId})`} className="stroke-line-strong" />
          {flows(sink.from) ? <FlowDash d={sink.d} from={sink.from} /> : null}
          <MimicGlyph
            kind="discharge"
            x={sink.at.x - MIMIC_SINK_W + 8}
            y={sink.at.y - 28}
            size={48}
            className="stroke-ink-muted"
          />
          <text
            x={sink.at.x - MIMIC_SINK_W / 2 + 2}
            y={sink.at.y + 40}
            textAnchor="middle"
            fontSize={13}
            fontWeight={700}
            className="fill-ink-muted"
          >
            {sink.label}
          </text>
        </g>
      )}

      {geometry.panels.map((panel) => (
        <g key={panel.key} data-testid="mimic-panel" data-panel-key={panel.key}>
          {geometry.units.filter((u) => u.panelKey === panel.key).map(renderUnit)}
        </g>
      ))}
      {geometry.units.filter((u) => u.panelKey === null || !panelKeys.has(u.panelKey)).map(renderUnit)}

      {children}
    </svg>
  );
}
