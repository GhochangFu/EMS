import { useId, type ReactNode } from "react";

import { worstDownstreamSwitch, type MimicNodeDto, type PointKeyStateMapDto } from "@bms/shared";

import type { SiteLiveReadings } from "../../hooks/use-site-live-readings";
import {
  BREAKER_LOOK_CLASSES,
  BREAKER_PILL,
  breakerLook,
  breakerRow,
  fanOutRows,
  graphOf,
  membersOf,
  statusRow,
  switchStatesOf,
  toSwitchState,
  type BreakerLook,
  type MimicBreakerMember,
} from "../../lib/mimic-breaker";
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
import { BreakerSwitch, FanOutMembers } from "./mimic-breaker-switch";
import { FlowDash } from "./mimic-flow-dash";
import { MimicGlyph } from "./mimic-glyphs";

/** No state map: every switching member reads `unknown` (or `offline` when stale). */
export const NO_STATE_MAPS: readonly PointKeyStateMapDto[] = [];

export type MimicSceneProps = {
  /** The widget's title — the first part of the drawing's accessible name. */
  title: string;
  geometry: MimicGeometry;
  /** The resolved nodes, by key. A roled unit with no entry here draws as "Not assigned". */
  nodes: readonly MimicNodeDto[];
  readings: SiteLiveReadings;
  /**
   * `F3.74` plan D4/D12 — the response's `stateMaps`: which value of a state point means which
   * switch state. The editor and the preset preview have no read and pass none.
   */
  stateMaps?: readonly PointKeyStateMapDto[];
  /** `F3.74` OQ9 — draw labels, switches and pills only: no value rows and no callouts. */
  compact?: boolean;
  /** Drawn inside the `<svg>`, after the drawing — the editor's hit rects and handles (U6). */
  children?: ReactNode;
};

/**
 * The label of a roled unit the response lists with `asset: null` — resolved, no member carrying
 * its role (F3.73 critique: "Not assigned" read like a fault). "Not assigned" stays for a unit the
 * response does not list at all: the editor's drawing (`nodes={[]}`) and a widget missing from
 * the read.
 */
const MIMIC_NO_ASSET_LABEL = "No asset at this site";

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
 * **Breakers (`F3.74`, ADR 0088 decisions 4–5, plan D6).** A unit whose symbol switches derives
 * each member's state with `deriveBreakerState` over the socket overlay and `stateMaps`
 * (`switchStatesOf`). Not fanning out, it draws a `BreakerSwitch` in place of its symbol and a
 * state pill, and frames by the precedence offline → tripped → open → alarm tone → closed; its
 * alarm status and callout stay. A fan-out unit stacks its members (code · switch · pill, or the
 * member's status for a unit that does not switch) in the value rows' and callout's slot, so it
 * draws neither; the drawing's accessible name still carries its alarm. A passive unit with a
 * switching unit directly downstream frames as their worst member (`worstDownstreamSwitch`).
 * `compact` hides every value row and callout and keeps the labels, switches and pills.
 *
 * **Accessibility.** The SVG is one `role="img"`; its `aria-label` names every unit whose callout
 * is drawn, with the severity label and the full message (`mimicAriaLabel`).
 *
 * **Colours are ADR 0078 role classes only** — no hex, no palette class, no named colour, no
 * `dark:` (`tests/f3.65-colour-roles-gate.test.ts`). Marker and clip ids come from `useId`, so
 * two mimics on one dashboard do not share one.
 */
export function MimicScene({
  title,
  geometry,
  nodes,
  readings,
  stateMaps = NO_STATE_MAPS,
  compact = false,
  children,
}: MimicSceneProps) {
  const uid = useId().replace(/:/g, "");
  const markerId = `mimic-arrow-${uid}`;
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  // `F3.32f` slice 3 (plan D8): the embedded organization symbols by key, once per drawing.
  const orgSymbolOf = new Map(geometry.orgSymbols.map((symbol) => [symbol.key as string, symbol]));
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

  // `F3.74` plan D6 — every switching unit's members with their derived state (socket overlay,
  // staleness first), and the same as the walk's switch states for the passive-bus frame.
  const breakersOf = new Map<string, readonly MimicBreakerMember[]>(
    geometry.units
      .filter((u) => u.switching)
      .map((u) => [u.key, switchStatesOf(byKey.get(u.key), readings, stateMaps, readings.nowMs)]),
  );
  const graph = graphOf(geometry);
  const switchStates = new Map(
    [...breakersOf].map(([key, members]) => [key, members.map((m) => toSwitchState(m.state))] as const),
  );

  const renderPassive = (unit: MimicGeometryUnit, transform: string) => {
    const { w } = MIMIC_NODE_SIZE;
    // The passive-bus rule (D6, both arms): a role-less unit with a switching unit directly
    // downstream frames as the worst of those units' members; with none it stays plain passive.
    const worst = worstDownstreamSwitch(graph, unit.key, switchStates);
    const look: BreakerLook | null = worst === null ? null : breakerLook(worst, null);
    const frameClass = look === null ? "stroke-line" : BREAKER_LOOK_CLASSES[look].frame;
    return (
      <g
        key={unit.key}
        data-testid="mimic-node"
        data-node-key={unit.key}
        data-status="passive"
        data-frame={look ?? undefined}
        transform={transform}
      >
        <title>{unit.label}</title>
        <rect x={0} y={0} width={w} height={MIMIC_FRAME_H} rx={10} strokeWidth={2} className={`fill-surface ${frameClass}`} />
        <text x={12} y={22} fontSize={15} fontWeight={700} className="fill-ink">
          {unit.label}
        </text>
        <MimicGlyph
          kind={unit.symbol}
          x={(w - GLYPH_SIZE) / 2}
          y={MIMIC_PIPE_Y - GLYPH_SIZE / 2}
          size={GLYPH_SIZE}
          className={MIMIC_PANEL_CLASSES[unit.tone].glyph}
          orgSymbol={orgSymbolOf.get(unit.symbol) ?? null}
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
    // The server resolved the node and found no member for its role: a plain fact about the site,
    // not a fault — drawn muted and solid, never dashed, never "Not assigned".
    const noAsset = node !== undefined && asset === null;
    const badge = asset === null ? null : mimicBadge(node?.memberCount ?? 0);
    const statusLabel = noAsset ? MIMIC_NO_ASSET_LABEL : MIMIC_STATUS_LABEL[nodeStatus];
    const levelPoint = asset === null || unit.symbol !== "tank" ? null : mimicLevelPoint(asset);
    const level =
      asset === null || levelPoint === null
        ? null
        : mimicLevelFraction(readings.pointLatest(asset.id, levelPoint)?.value ?? null);
    const glyphClass = asset === null ? "stroke-ink-faint" : MIMIC_PANEL_CLASSES[unit.tone].glyph;
    const topAlarm = calloutOf(unit.key);
    const alarmTone = topAlarm === null ? null : mimicAlarmTone(topAlarm.tone);
    const clipId = `mimic-callout-${uid}-${unit.key}`;
    // `F3.74` plan D6 — a fan-out unit stacks its members in place of the value rows and the
    // callout's slot; a switching unit that does not fan out carries its one member's switch.
    const fanOut = unit.fanOut && asset !== null;
    const breakers = breakersOf.get(unit.key);
    // Only a node that carries state points takes a state (D6): an `electrical_distribution`
    // `ht_panel` draws the `breaker` glyph and reports no state-mapped key, so it draws as before.
    const hasState = (node?.statePoints.length ?? 0) > 0;
    const single = !fanOut && hasState && breakers?.length === 1 ? (breakers[0] ?? null) : null;
    const singleLook = single === null ? null : breakerLook(single.state, alarmTone);
    const frameClass = singleLook === null ? MIMIC_STATUS_STROKE[nodeStatus] : BREAKER_LOOK_CLASSES[singleLook].frame;
    const dashed = (asset === null && !noAsset) || (singleLook !== null && BREAKER_LOOK_CLASSES[singleLook].dashed);
    const memberRows = !fanOut
      ? []
      : breakers !== undefined
        ? breakers.map(breakerRow)
        : membersOf(node).map((m) => statusRow(m, readings, readings.nowMs));
    const fanOutPlaces = fanOutRows(memberRows.length, node?.memberCount ?? 0, w);
    const drawValues = !compact && !fanOut;
    const glyphX = (w - GLYPH_SIZE) / 2;
    const glyphY = MIMIC_PIPE_Y - GLYPH_SIZE / 2;
    return (
      <g
        key={unit.key}
        data-testid="mimic-node"
        data-node-key={unit.key}
        data-status={noAsset ? "no-asset" : nodeStatus}
        data-breaker-state={single?.state}
        data-frame={singleLook ?? undefined}
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
          strokeDasharray={dashed ? "6 4" : undefined}
          className={`fill-surface ${frameClass}`}
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
        {single === null || singleLook === null ? (
          <MimicGlyph
            kind={unit.symbol}
            x={glyphX}
            y={glyphY}
            size={GLYPH_SIZE}
            className={glyphClass}
            level={level}
            orgSymbol={orgSymbolOf.get(unit.symbol) ?? null}
          />
        ) : (
          <>
            <BreakerSwitch
              state={single.state}
              look={singleLook}
              symbol={unit.symbol}
              x={glyphX}
              y={glyphY}
              size={GLYPH_SIZE}
              plainClass={glyphClass}
              orgSymbol={orgSymbolOf.get(unit.symbol) ?? null}
            />
            <text
              data-testid="mimic-breaker-pill"
              x={w / 2}
              y={MIMIC_FRAME_H - 5}
              textAnchor="middle"
              fontSize={11}
              fontWeight={700}
              className={BREAKER_LOOK_CLASSES[singleLook].pill}
            >
              {BREAKER_PILL[single.state]}
            </text>
          </>
        )}
        {fanOut ? (
          <FanOutMembers
            members={memberRows}
            places={fanOutPlaces.rows}
            more={fanOutPlaces.more}
            symbol={unit.symbol}
            plainClass={glyphClass}
          />
        ) : null}
        {asset === null || !drawValues
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
        {topAlarm === null || alarmTone === null || !drawValues ? null : (
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
