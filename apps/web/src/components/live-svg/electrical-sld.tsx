import "./sld-styles.css";

import type { CSSProperties } from "react";

import type { LiveSvgStatus } from "./types";
import {
  SLD_FEEDERS,
  SLD_TX_LEFT_CODE,
  SLD_TX_RIGHT_CODE,
  SLD_UPS_ASSET_CODE,
} from "./sld-bindings";
import {
  useSchematicTelemetryByCode,
  useSchematicTelemetryContext,
} from "./schematic-telemetry-context";

export type ElectricalSldDiagramProps = {
  onSelectAsset: (assetId: string | undefined) => void;
};

/**
 * `F3.65c` — role classes, not hex (ADR 0078 decision 5, plan D4/OQ2/OQ5/D7). `FLOW`/`FLOW_BUS`
 * (the animated dashes and blink dots) read `accent-strong` per OQ5 — the line's own colour and
 * the blink dot carry the status, so the dash on top is deliberately not the same role, and its
 * contrast against `accent` is not a declared pair (§2.5).
 */
const STROKE_ACCENT = "stroke-accent";
const STROKE_FAULT = "stroke-critical";
const STROKE_MUTED = "stroke-ink-hint";
const STROKE_FLOW = "stroke-accent-strong";
const FILL_FLOW = "fill-accent-strong";
const FILL_LABEL_MUTED = "fill-ink-muted";
const FILL_PANEL = "fill-ok-wash";

function strokeFor(status: LiveSvgStatus): string {
  if (status === "fault") {
    return STROKE_FAULT;
  }
  if (status === "offline") {
    return STROKE_MUTED;
  }
  return STROKE_ACCENT;
}

function flowStrokeFor(status: LiveSvgStatus): string {
  return status === "running" ? STROKE_FLOW : STROKE_MUTED;
}

function fillFor(status: LiveSvgStatus): string {
  if (status === "fault") {
    return "fill-critical";
  }
  if (status === "offline") {
    return "fill-ink-hint";
  }
  return "fill-accent";
}

function flowDurationSec(kw: number | null): string {
  if (kw == null || kw <= 0) {
    return "1.4s";
  }
  const t = Math.min(2.2, Math.max(0.35, 1.9 - kw / 420));
  return `${t.toFixed(2)}s`;
}

function fmtKw(kw: number | null): string {
  if (kw == null || Number.isNaN(kw)) {
    return "— kW";
  }
  return `${kw.toFixed(0)} kW`;
}

function txLoadPct(kw: number | null): number {
  if (kw == null || kw <= 0) {
    return 0;
  }
  return Math.min(99, Math.round((kw / 2000) * 100));
}

function upsLoadPct(kw: number | null): number {
  if (kw == null || kw <= 0) {
    return 0;
  }
  return Math.min(99, Math.round((kw / 2100) * 100));
}

function TxPole({
  cx,
  labelX,
  labelLine1,
  assetCode,
  onSelectAsset,
}: {
  cx: number;
  labelX: number;
  labelLine1: string;
  assetCode: string;
  onSelectAsset: (id: string | undefined) => void;
}) {
  const { assetId, slice, status } = useSchematicTelemetryByCode(assetCode);
  const loadPct = txLoadPct(slice.kw);
  const stroke = strokeFor(status);
  const flow = flowStrokeFor(status);
  const dur = flowDurationSec(slice.kw);
  const showFlow = status === "running";

  return (
    <g
      role="button"
      tabIndex={0}
      className="cursor-pointer outline-none"
      onClick={() => onSelectAsset(assetId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          onSelectAsset(assetId);
        }
      }}
    >
      <text
        x={labelX}
        y={30}
        textAnchor="middle"
        className="fill-ink font-condensed text-[13px] font-bold"
      >
        UTILITY 11kV
      </text>
      <line x1={cx} y1={40} x2={cx} y2={80} className={stroke} strokeWidth={4} />
      {showFlow ? (
        <line
          x1={cx}
          y1={40}
          x2={cx}
          y2={78}
          className={`${flow} sld-flow`}
          strokeWidth={2.5}
          strokeLinecap="round"
          style={
            {
              "--sld-flow-duration": dur,
            } as CSSProperties
          }
        />
      ) : null}
      <circle cx={cx - 10} cy={100} r={14} className={`fill-surface ${stroke}`} strokeWidth={2} />
      <circle cx={cx + 10} cy={100} r={14} className={`fill-surface ${stroke}`} strokeWidth={2} />
      <g transform={`translate(${cx} 100)`} className={status === "running" ? "sld-spin" : ""}>
        <line x1={-9} y1={0} x2={9} y2={0} className={stroke} strokeWidth={1.2} />
      </g>
      <text
        x={labelX}
        y={138}
        textAnchor="middle"
        className="font-mono text-[10px] fill-ink"
      >
        {labelLine1}
      </text>
      <text
        x={labelX}
        y={150}
        textAnchor="middle"
        className={`font-mono text-[9px] ${FILL_LABEL_MUTED}`}
      >
        11kV/415V · {loadPct}% load
      </text>
      <line x1={cx} y1={155} x2={cx} y2={200} className={stroke} strokeWidth={4} />
      {showFlow ? (
        <line
          x1={cx}
          y1={155}
          x2={cx}
          y2={198}
          className={`${flow} sld-flow`}
          strokeWidth={2.5}
          strokeLinecap="round"
          style={
            {
              "--sld-flow-duration": dur,
            } as CSSProperties
          }
        />
      ) : null}
    </g>
  );
}

function FeederBranch({
  x,
  feederCode,
  loadLabel,
  assetCode,
  animDelayTop,
  animDelayBot,
  onSelectAsset,
}: {
  x: number;
  feederCode: string;
  loadLabel: string;
  assetCode: string;
  animDelayTop: string;
  animDelayBot: string;
  onSelectAsset: (id: string | undefined) => void;
}) {
  const { assetId, slice, status } = useSchematicTelemetryByCode(assetCode);
  const stroke = strokeFor(status);
  const fillClass = fillFor(status);
  const flow = flowStrokeFor(status);
  const dur = flowDurationSec(slice.kw);
  const showFlow = status === "running";
  const panelFillClass = status === "offline" ? "fill-well-deep" : FILL_PANEL;

  return (
    <g
      role="button"
      tabIndex={0}
      className="cursor-pointer outline-none"
      onClick={() => onSelectAsset(assetId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          onSelectAsset(assetId);
        }
      }}
    >
      <line x1={x} y1={200} x2={x} y2={280} className={stroke} strokeWidth={3} />
      {showFlow ? (
        <line
          x1={x}
          y1={200}
          x2={x}
          y2={278}
          className={`${flow} sld-flow`}
          strokeWidth={2}
          strokeLinecap="round"
          style={
            {
              "--sld-flow-duration": dur,
              animationDelay: animDelayTop,
            } as CSSProperties
          }
        />
      ) : null}
      <rect
        x={x - 14}
        y={280}
        width={28}
        height={20}
        className={`fill-surface ${stroke}`}
        strokeWidth={2}
      />
      <line
        x1={x - 10}
        y1={290}
        x2={x + 8}
        y2={283}
        className={stroke}
        strokeWidth={2}
      />
      {status === "running" ? (
        <circle cx={x} cy={290} r={3} className={`${FILL_FLOW} sld-blink`} />
      ) : null}
      <line x1={x} y1={300} x2={x} y2={350} className={stroke} strokeWidth={3} />
      {showFlow ? (
        <line
          x1={x}
          y1={300}
          x2={x}
          y2={348}
          className={`${flow} sld-flow`}
          strokeWidth={2}
          strokeLinecap="round"
          style={
            {
              "--sld-flow-duration": dur,
              animationDelay: animDelayBot,
            } as CSSProperties
          }
        />
      ) : null}
      <rect
        x={x - 42}
        y={350}
        width={84}
        height={55}
        rx={4}
        className={`${panelFillClass} ${stroke}`}
        strokeWidth={1.5}
      />
      <text
        x={x}
        y={368}
        textAnchor="middle"
        className={`font-mono text-[10px] font-bold ${fillClass}`}
      >
        {feederCode}
      </text>
      <text
        x={x}
        y={382}
        textAnchor="middle"
        className={`font-mono text-[9px] ${fillClass}`}
      >
        {loadLabel}
      </text>
      <text
        x={x}
        y={397}
        textAnchor="middle"
        className={`font-condensed text-[11px] font-bold ${fillClass}`}
      >
        {fmtKw(slice.kw)}
      </text>
    </g>
  );
}

/**
 * Full single-line diagram for DC1 (mockup `R.sld`), bound to seeded assets.
 */
export function ElectricalSldDiagram({ onSelectAsset }: ElectricalSldDiagramProps) {
  const ctx = useSchematicTelemetryContext();
  const totalKw = ctx?.totalKw ?? null;
  const busMw = totalKw != null ? (totalKw / 1000).toFixed(2) : "—";
  // ADR 0027 decision 4: the total now excludes assets that have stopped
  // reporting, so it must say how many it left out. A headline megawatt figure
  // that quietly shrank when a feed died is the failure F4.38 exists to close.
  const staleAssets = ctx?.staleAssets ?? 0;
  const staleNote =
    staleAssets > 0
      ? ` · ${staleAssets} asset${staleAssets === 1 ? "" : "s"} stale`
      : "";

  const ups = useSchematicTelemetryByCode(SLD_UPS_ASSET_CODE);
  const upsStroke = strokeFor(ups.status);
  const upsFlow = flowStrokeFor(ups.status);
  const upsDur = flowDurationSec(ups.slice.kw);
  const upsShowFlow = ups.status === "running";
  const upsPanelFillClass = ups.status === "offline" ? "fill-well-deep" : FILL_PANEL;

  return (
    <svg
      viewBox="0 0 900 480"
      className="h-auto min-w-[900px] w-full bg-surface"
      aria-label="Electrical single-line diagram DC1"
    >
      <TxPole
        cx={100}
        labelX={100}
        labelLine1="TX-1 · 2 MVA"
        assetCode={SLD_TX_LEFT_CODE}
        onSelectAsset={onSelectAsset}
      />
      <TxPole
        cx={800}
        labelX={800}
        labelLine1="TX-2 · 2 MVA"
        assetCode={SLD_TX_RIGHT_CODE}
        onSelectAsset={onSelectAsset}
      />

      <line x1={50} y1={200} x2={850} y2={200} className="stroke-accent" strokeWidth={6} />
      <line
        x1={50}
        y1={200}
        x2={850}
        y2={200}
        className="stroke-accent-strong sld-flow opacity-70"
        strokeWidth={2}
        style={
          {
            "--sld-flow-duration": flowDurationSec(totalKw),
          } as CSSProperties
        }
      />
      <text
        x={450}
        y={192}
        textAnchor="middle"
        className="fill-accent-strong font-condensed text-[13px] font-bold"
      >
        MAIN LV BUS · 415 V · {busMw} MW{staleNote}
      </text>

      <g>
        <line
          x1={470}
          y1={190}
          x2={470}
          y2={155}
          className="stroke-ink-hint"
          strokeWidth={3}
          strokeDasharray="5 4"
        />
        <rect
          x={430}
          y={155}
          width={80}
          height={36}
          rx={4}
          className="fill-well-deep stroke-ink-hint"
          strokeWidth={1.5}
        />
        <text
          x={470}
          y={170}
          textAnchor="middle"
          className={`font-mono text-[10px] font-bold ${FILL_LABEL_MUTED}`}
        >
          DG-01/02
        </text>
        <text
          x={470}
          y={183}
          textAnchor="middle"
          className={`font-mono text-[9px] ${FILL_LABEL_MUTED}`}
        >
          2x1.5MVA STBY
        </text>
      </g>

      <g
        role="button"
        tabIndex={0}
        className="cursor-pointer outline-none"
        onClick={() => onSelectAsset(ups.assetId)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            onSelectAsset(ups.assetId);
          }
        }}
      >
        <line x1={290} y1={190} x2={290} y2={155} className={upsStroke} strokeWidth={3} />
        {upsShowFlow ? (
          <line
            x1={290}
            y1={190}
            x2={290}
            y2={158}
            className={`${upsFlow} sld-flow`}
            strokeWidth={2}
            strokeLinecap="round"
            style={
              {
                "--sld-flow-duration": upsDur,
              } as CSSProperties
            }
          />
        ) : null}
        <rect
          x={240}
          y={155}
          width={100}
          height={36}
          rx={4}
          className={`${upsPanelFillClass} ${upsStroke}`}
          strokeWidth={1.5}
        />
        <text
          x={290}
          y={170}
          textAnchor="middle"
          className="font-mono text-[10px] font-bold fill-accent-strong"
        >
          UPS-500 BANK
        </text>
        <text
          x={290}
          y={183}
          textAnchor="middle"
          className="font-mono text-[9px] fill-accent-strong"
        >
          2,100 kVA · {upsLoadPct(ups.slice.kw)}%
        </text>
        {ups.status === "running" ? (
          <circle cx={245} cy={160} r={3} className={`${FILL_FLOW} sld-blink`} />
        ) : null}
      </g>

      {SLD_FEEDERS.map((f, idx) => (
        <FeederBranch
          key={f.assetCode + f.x}
          x={f.x}
          feederCode={f.feederCode}
          loadLabel={f.loadLabel}
          assetCode={f.assetCode}
          animDelayTop={`${idx * 0.15}s`}
          animDelayBot={`${idx * 0.2}s`}
          onSelectAsset={onSelectAsset}
        />
      ))}

      <g transform="translate(20 430)">
        <rect width={860} height={40} className="fill-well stroke-line-strong" rx={4} />
        <text x={20} y={18} className={`font-mono text-[10px] ${FILL_LABEL_MUTED}`}>
          Total feeders from live telemetry · Main bus {busMw} MW{staleNote} · PUE indicative 1.42 · N+1
        </text>
        <text x={20} y={32} className="font-mono text-[9px] fill-ink-faint">
          Animated dashes show power flow; grey indicates stale or offline points (stop sim to
          verify).
        </text>
      </g>
    </svg>
  );
}
