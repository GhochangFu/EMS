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

const GREEN = "#039855";
const FLOW = "#3DCD58";
const FLOW_BUS = "#7FE591";
const FAULT = "#D92D20";
const MUTED = "#94A3B8";
const LABEL_MUTED = "#4A5464";
const PANEL_FILL = "#D1FADF";

function strokeFor(status: LiveSvgStatus): string {
  if (status === "fault") {
    return FAULT;
  }
  if (status === "offline") {
    return MUTED;
  }
  return GREEN;
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
  const flow = status === "running" ? FLOW : MUTED;
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
        className="fill-bms-ink font-condensed text-[13px] font-bold"
      >
        UTILITY 11kV
      </text>
      <line x1={cx} y1={40} x2={cx} y2={80} stroke={stroke} strokeWidth={4} />
      {showFlow ? (
        <line
          x1={cx}
          y1={40}
          x2={cx}
          y2={78}
          stroke={flow}
          strokeWidth={2.5}
          strokeLinecap="round"
          className="sld-flow"
          style={
            {
              "--sld-flow-duration": dur,
            } as CSSProperties
          }
        />
      ) : null}
      <circle cx={cx - 10} cy={100} r={14} fill="#fff" stroke={stroke} strokeWidth={2} />
      <circle cx={cx + 10} cy={100} r={14} fill="#fff" stroke={stroke} strokeWidth={2} />
      <g transform={`translate(${cx} 100)`} className={status === "running" ? "sld-spin" : ""}>
        <line x1={-9} y1={0} x2={9} y2={0} stroke={stroke} strokeWidth={1.2} />
      </g>
      <text
        x={labelX}
        y={138}
        textAnchor="middle"
        className="font-mono text-[10px] fill-bms-ink"
      >
        {labelLine1}
      </text>
      <text
        x={labelX}
        y={150}
        textAnchor="middle"
        className="font-mono text-[9px]"
        fill={LABEL_MUTED}
      >
        11kV/415V · {loadPct}% load
      </text>
      <line x1={cx} y1={155} x2={cx} y2={200} stroke={stroke} strokeWidth={4} />
      {showFlow ? (
        <line
          x1={cx}
          y1={155}
          x2={cx}
          y2={198}
          stroke={flow}
          strokeWidth={2.5}
          strokeLinecap="round"
          className="sld-flow"
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
  const flow = status === "running" ? FLOW : MUTED;
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
      <line x1={x} y1={200} x2={x} y2={280} stroke={stroke} strokeWidth={3} />
      {showFlow ? (
        <line
          x1={x}
          y1={200}
          x2={x}
          y2={278}
          stroke={flow}
          strokeWidth={2}
          strokeLinecap="round"
          className="sld-flow"
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
        fill="#fff"
        stroke={stroke}
        strokeWidth={2}
      />
      <line
        x1={x - 10}
        y1={290}
        x2={x + 8}
        y2={283}
        stroke={stroke}
        strokeWidth={2}
      />
      {status === "running" ? (
        <circle cx={x} cy={290} r={3} fill={FLOW} className="sld-blink" />
      ) : null}
      <line x1={x} y1={300} x2={x} y2={350} stroke={stroke} strokeWidth={3} />
      {showFlow ? (
        <line
          x1={x}
          y1={300}
          x2={x}
          y2={348}
          stroke={flow}
          strokeWidth={2}
          strokeLinecap="round"
          className="sld-flow"
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
        fill={status === "offline" ? "#F1F5F9" : PANEL_FILL}
        stroke={stroke}
        strokeWidth={1.5}
      />
      <text
        x={x}
        y={368}
        textAnchor="middle"
        className="font-mono text-[10px] font-bold"
        fill={stroke}
      >
        {feederCode}
      </text>
      <text
        x={x}
        y={382}
        textAnchor="middle"
        className="font-mono text-[9px]"
        fill={stroke}
      >
        {loadLabel}
      </text>
      <text
        x={x}
        y={397}
        textAnchor="middle"
        className="font-condensed text-[11px] font-bold"
        fill={stroke}
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

  const ups = useSchematicTelemetryByCode(SLD_UPS_ASSET_CODE);
  const upsStroke = strokeFor(ups.status);
  const upsFlow = ups.status === "running" ? FLOW : MUTED;
  const upsDur = flowDurationSec(ups.slice.kw);
  const upsShowFlow = ups.status === "running";

  return (
    <svg
      viewBox="0 0 900 480"
      className="h-auto min-w-[900px] w-full bg-white"
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

      <line x1={50} y1={200} x2={850} y2={200} stroke={GREEN} strokeWidth={6} />
      <line
        x1={50}
        y1={200}
        x2={850}
        y2={200}
        stroke={FLOW_BUS}
        strokeWidth={2}
        className="sld-flow opacity-70"
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
        className="fill-[#007C3C] font-condensed text-[13px] font-bold"
      >
        MAIN LV BUS · 415 V · {busMw} MW
      </text>

      <g>
        <line
          x1={470}
          y1={190}
          x2={470}
          y2={155}
          stroke={MUTED}
          strokeWidth={3}
          strokeDasharray="5 4"
        />
        <rect
          x={430}
          y={155}
          width={80}
          height={36}
          rx={4}
          fill="#F1F5F9"
          stroke={MUTED}
          strokeWidth={1.5}
        />
        <text
          x={470}
          y={170}
          textAnchor="middle"
          className="font-mono text-[10px] font-bold"
          fill={LABEL_MUTED}
        >
          DG-01/02
        </text>
        <text
          x={470}
          y={183}
          textAnchor="middle"
          className="font-mono text-[9px]"
          fill={LABEL_MUTED}
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
        <line x1={290} y1={190} x2={290} y2={155} stroke={upsStroke} strokeWidth={3} />
        {upsShowFlow ? (
          <line
            x1={290}
            y1={190}
            x2={290}
            y2={158}
            stroke={upsFlow}
            strokeWidth={2}
            strokeLinecap="round"
            className="sld-flow"
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
          fill={ups.status === "offline" ? "#F1F5F9" : PANEL_FILL}
          stroke={upsStroke}
          strokeWidth={1.5}
        />
        <text
          x={290}
          y={170}
          textAnchor="middle"
          className="font-mono text-[10px] font-bold fill-[#007C3C]"
        >
          UPS-500 BANK
        </text>
        <text
          x={290}
          y={183}
          textAnchor="middle"
          className="font-mono text-[9px] fill-[#007C3C]"
        >
          2,100 kVA · {upsLoadPct(ups.slice.kw)}%
        </text>
        {ups.status === "running" ? (
          <circle cx={245} cy={160} r={3} fill={FLOW} className="sld-blink" />
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
        <rect width={860} height={40} fill="#F7F8FA" stroke="#D8DCE3" rx={4} />
        <text x={20} y={18} className="font-mono text-[10px]" fill={LABEL_MUTED}>
          Total feeders from live telemetry · Main bus {busMw} MW · PUE indicative 1.42 · N+1
        </text>
        <text x={20} y={32} className="font-mono text-[9px]" fill="#7A8494">
          Animated dashes show power flow; grey indicates stale or offline points (stop sim to
          verify).
        </text>
      </g>
    </svg>
  );
}
