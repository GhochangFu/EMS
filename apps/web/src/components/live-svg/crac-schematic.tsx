import "./crac-styles.css";

import type { CSSProperties } from "react";
import { useMemo } from "react";

import type { LiveSvgStatus } from "./types";
import { CRAC_PRIMARY_CODE, CRAC_ZONE_CODES } from "./crac-bindings";
import {
  useSchematicTelemetryByCode,
  useSchematicTelemetryContext,
} from "./schematic-telemetry-context";

export type CracSchematicProps = {
  onSelectAsset: (assetId: string | undefined) => void;
};

const OK = "#039855";
const MUTED = "#94A3B8";
const FAULT = "#D92D20";
const WARN = "#DC6803";

function cToF(c: number | null): string {
  if (c == null || Number.isNaN(c)) {
    return "—";
  }
  return `${(c * (9 / 5) + 32).toFixed(1)}°F`;
}

function lpsToGpm(lps: number | null): string {
  if (lps == null || Number.isNaN(lps)) {
    return "—";
  }
  return `${(lps * 15.8503231418749).toFixed(1)} gpm`;
}

function strokeFor(status: LiveSvgStatus): string {
  if (status === "fault") {
    return FAULT;
  }
  if (status === "offline") {
    return MUTED;
  }
  return OK;
}

function flowDur(flowLps: number | null): string {
  if (flowLps == null || flowLps <= 0) {
    return "2.5s";
  }
  const t = Math.min(3.2, Math.max(0.6, 2.8 / flowLps));
  return `${t.toFixed(2)}s`;
}

function spinDur(rpm: number | null): string {
  if (rpm == null || rpm <= 0) {
    return "0s";
  }
  const s = Math.min(2.5, Math.max(0.35, 60 / (rpm / 60)));
  return `${s.toFixed(2)}s`;
}

function useCracAggregates(): {
  avgChwSupC: number | null;
  avgChwRetC: number | null;
  avgFlowLps: number | null;
  avgCoolingKw: number | null;
  avgFanRpm: number | null;
} {
  const ctx = useSchematicTelemetryContext();
  return useMemo(() => {
    const empty = {
      avgChwSupC: null as number | null,
      avgChwRetC: null as number | null,
      avgFlowLps: null as number | null,
      avgCoolingKw: null as number | null,
      avgFanRpm: null as number | null,
    };
    if (!ctx) {
      return empty;
    }
    let n = 0;
    let sumSup = 0;
    let sumRet = 0;
    let sumFlow = 0;
    let sumCool = 0;
    let sumRpm = 0;
    for (const code of CRAC_ZONE_CODES) {
      const id = ctx.idByCode.get(code);
      if (!id) {
        continue;
      }
      const s = ctx.byAssetId[id];
      if (!s) {
        continue;
      }
      n += 1;
      if (s.chwSupplyTempC != null) {
        sumSup += s.chwSupplyTempC;
      }
      if (s.chwReturnTempC != null) {
        sumRet += s.chwReturnTempC;
      }
      if (s.chwFlowLps != null) {
        sumFlow += s.chwFlowLps;
      }
      if (s.coolingKw != null) {
        sumCool += s.coolingKw;
      }
      if (s.fanRpm != null) {
        sumRpm += s.fanRpm;
      }
    }
    if (n === 0) {
      return empty;
    }
    return {
      avgChwSupC: sumSup / n,
      avgChwRetC: sumRet / n,
      avgFlowLps: sumFlow / n,
      avgCoolingKw: sumCool / n,
      avgFanRpm: sumRpm / n,
    };
  }, [ctx, ctx?.byAssetId]);
}

function CompressorCell({
  col,
  row,
  label,
  assetCode,
  onSelectAsset,
}: {
  col: 0 | 1;
  row: 0 | 1;
  label: string;
  assetCode: string;
  onSelectAsset: (id: string | undefined) => void;
}) {
  const { assetId, slice, status } = useSchematicTelemetryByCode(assetCode);
  const trip = slice.compressorOk === 0;
  const mode = trip ? "TRIP" : status === "running" ? "ON" : "OFF";
  const fill = trip ? "#FEE4E2" : status === "running" ? "#D1FADF" : "#F1F5F9";
  const stroke = trip ? FAULT : status === "running" ? OK : MUTED;
  const bx = 260 + col * 80;
  const by = 160 + row * 60;

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
      <rect
        x={bx}
        y={by}
        width={70}
        height={48}
        rx={4}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.5}
      />
      <circle cx={bx + 12} cy={by + 14} r={6} fill={stroke} />
      <text
        x={bx + 24}
        y={by + 10}
        className="font-mono text-[10px] font-bold"
        fill={stroke}
      >
        {label}
      </text>
      <text x={bx + 24} y={by + 24} className="font-mono text-[9px]" fill={stroke}>
        {mode}
      </text>
    </g>
  );
}

function ZoneTile({
  code,
  zoneLabel,
  x,
  onSelectAsset,
}: {
  code: string;
  zoneLabel: string;
  x: number;
  onSelectAsset: (id: string | undefined) => void;
}) {
  const { assetId, slice, status } = useSchematicTelemetryByCode(code);
  const tempF = cToF(slice.supplyAirTempC);
  const numF = slice.supplyAirTempC != null ? slice.supplyAirTempC * (9 / 5) + 32 : null;
  const warn = numF != null && numF > 72;
  const stroke = warn ? WARN : strokeFor(status);
  const fill = warn ? "#FEF0C7" : status === "running" ? "#D1FADF" : "#F1F5F9";

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
      <rect
        x={x}
        y={355}
        width={100}
        height={50}
        rx={4}
        fill={fill}
        stroke={stroke}
        strokeWidth={1}
      />
      <text
        x={x + 50}
        y={372}
        textAnchor="middle"
        className="font-mono text-[10px] font-bold"
        fill={stroke}
      >
        {zoneLabel}
      </text>
      <text
        x={x + 50}
        y={392}
        textAnchor="middle"
        className="font-condensed text-base font-bold"
        fill={stroke}
      >
        {tempF.replace("°F", "F")}
      </text>
    </g>
  );
}

/**
 * Cooling loop schematic (mockup `R.crac`). Primary detail on `CH-CRAC-101`;
 * compressor cells map to CRAC 101–104; plant averages from the four units.
 */
export function CracSchematic({ onSelectAsset }: CracSchematicProps) {
  const primary = useSchematicTelemetryByCode(CRAC_PRIMARY_CODE);
  const plant = useCracAggregates();

  const pStroke = strokeFor(primary.status);
  const fanSpin =
    primary.status === "running" && (primary.slice.fanRpm ?? 0) > 50 ? "crac-spin" : "";
  const chwSupF = cToF(primary.slice.chwSupplyTempC);
  const flowGpm = lpsToGpm(plant.avgFlowLps);
  const chillerLoadPct = plant.avgCoolingKw != null ? Math.min(100, Math.round((plant.avgCoolingKw / 85) * 100)) : null;
  const ctSpinDur = spinDur(plant.avgFanRpm);
  const pumpRun = (plant.avgFlowLps ?? 0) > 0.4;

  return (
    <svg
      viewBox="0 0 1100 460"
      className="h-auto w-full max-w-[1200px] bg-[#FAFBFC]"
      aria-label="CRAC precision cooling schematic"
    >
      <defs>
        <linearGradient id="crac-ub" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#F0F2F5" />
          <stop offset="100%" stopColor="#D8DCE3" />
        </linearGradient>
        <linearGradient id="crac-cb" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#E5E8ED" />
        </linearGradient>
      </defs>

      <rect
        x={80}
        y={80}
        width={340}
        height={320}
        rx={8}
        fill="url(#crac-ub)"
        stroke="#8A94A6"
        strokeWidth={2}
      />
      <text
        x={250}
        y={105}
        textAnchor="middle"
        className="fill-bms-ink font-condensed text-sm font-bold"
      >
        CRAC UNIT 101
      </text>

      <g
        role="button"
        tabIndex={0}
        className="cursor-pointer outline-none"
        onClick={() => onSelectAsset(primary.assetId)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            onSelectAsset(primary.assetId);
          }
        }}
      >
        <rect
          x={100}
          y={125}
          width={120}
          height={35}
          rx={4}
          fill="#E8EEF5"
          stroke="#5A7CA8"
          strokeWidth={1.5}
        />
        <text
          x={160}
          y={148}
          textAnchor="middle"
          className="font-mono text-[10px] font-semibold fill-[#1A3D6B]"
        >
          RET AIR · {cToF(primary.slice.returnAirTempC).replace("°F", "F")}
        </text>

        <rect
          x={100}
          y={170}
          width={120}
          height={22}
          fill="#FEF3C7"
          stroke="#C48E1A"
          strokeWidth={1}
        />
        <text
          x={160}
          y={184}
          textAnchor="middle"
          className="font-mono text-[9px] fill-[#7A5918]"
        >
          FILTERS · MERV 13
        </text>

        <rect
          x={100}
          y={200}
          width={120}
          height={55}
          fill="#D1E9FF"
          stroke="#1570EF"
          strokeWidth={1.5}
        />
        <text
          x={160}
          y={220}
          textAnchor="middle"
          className="font-mono text-[10px] font-semibold fill-[#1570EF]"
        >
          COOLING COIL
        </text>
        <text
          x={160}
          y={234}
          textAnchor="middle"
          className="font-mono text-[9px] fill-[#1570EF]"
        >
          {chwSupF.replace("°F", "F")} supply
        </text>

        <circle cx={160} cy={310} r={36} fill="#F7F8FA" stroke="#475569" strokeWidth={2} />
        <g
          transform="translate(160 310)"
          className={fanSpin}
          style={
            {
              "--crac-spin-dur": spinDur(primary.slice.fanRpm),
            } as CSSProperties
          }
        >
          <path d="M0,-30 Q7,-15 0,0 Q-7,-15 0,-30" fill="#94A3B8" />
          <path d="M30,0 Q15,7 0,0 Q15,-7 30,0" fill="#94A3B8" />
          <path d="M0,30 Q-7,15 0,0 Q7,15 0,30" fill="#94A3B8" />
          <path d="M-30,0 Q-15,-7 0,0 Q-15,7 -30,0" fill="#94A3B8" />
          <circle cx={0} cy={0} r={5} fill="#475569" />
        </g>
        <text
          x={160}
          y={362}
          textAnchor="middle"
          className="font-mono text-[10px] font-semibold"
        >
          EC FAN ·{" "}
          {primary.slice.fanSpeedPct != null
            ? `${Math.round(primary.slice.fanSpeedPct)}%`
            : "—"}
        </text>

        <rect
          x={100}
          y={372}
          width={120}
          height={22}
          rx={4}
          fill="#D1FADF"
          stroke={pStroke}
          strokeWidth={1.5}
        />
        <text
          x={160}
          y={386}
          textAnchor="middle"
          className="font-mono text-[10px] font-semibold"
          fill={pStroke}
        >
          SUP AIR · {cToF(primary.slice.supplyAirTempC).replace("°F", "F")}
        </text>
      </g>

      <rect
        x={240}
        y={125}
        width={170}
        height={155}
        rx={6}
        fill="#FAFBFC"
        stroke="#5A6476"
        strokeWidth={1.5}
      />
      <text
        x={325}
        y={143}
        textAnchor="middle"
        className="font-mono text-[10px] font-bold"
      >
        COMPRESSOR BANK
      </text>
      <CompressorCell col={0} row={0} label="C1" assetCode="CH-CRAC-101" onSelectAsset={onSelectAsset} />
      <CompressorCell col={1} row={0} label="C2" assetCode="CH-CRAC-102" onSelectAsset={onSelectAsset} />
      <CompressorCell col={0} row={1} label="C3" assetCode="CH-CRAC-103" onSelectAsset={onSelectAsset} />
      <CompressorCell col={1} row={1} label="C4" assetCode="CH-CRAC-104" onSelectAsset={onSelectAsset} />

      <path
        d="M 220 230 L 470 230 L 470 170 L 680 170"
        fill="none"
        stroke="#B84A9C"
        strokeWidth={6}
        strokeLinecap="round"
        className="crac-flow-line"
        style={
          {
            "--crac-flow-dur": flowDur(plant.avgFlowLps),
          } as CSSProperties
        }
      />
      <text x={380} y={222} className="font-mono text-[10px] fill-[#B84A9C]">
        CHILLED {cToF(plant.avgChwSupC).replace("°F", "F")} · {flowGpm} →
      </text>

      <path
        d="M 680 200 L 470 200 L 470 245 L 220 245"
        fill="none"
        stroke="#7C4DFF"
        strokeWidth={6}
        strokeLinecap="round"
        className="crac-flow-line"
        style={
          {
            "--crac-flow-dur": flowDur(plant.avgFlowLps),
          } as CSSProperties
        }
      />
      <text x={380} y={262} className="font-mono text-[10px] fill-[#7C4DFF]">
        ← RETURN {cToF(plant.avgChwRetC).replace("°F", "F")}
      </text>

      <rect
        x={680}
        y={120}
        width={160}
        height={100}
        rx={6}
        fill="url(#crac-cb)"
        stroke="#0369A1"
        strokeWidth={2}
      />
      <text
        x={760}
        y={142}
        textAnchor="middle"
        className="fill-[#0369A1] font-condensed text-[13px] font-bold"
      >
        CHILLER CHL-01
      </text>
      <text
        x={760}
        y={158}
        textAnchor="middle"
        className="font-mono text-[9px] fill-[#075985]"
      >
        800 kW · plant avg
      </text>
      <rect x={700} y={168} width={120} height={28} rx={3} fill="#D1FADF" stroke={OK} />
      <text
        x={760}
        y={186}
        textAnchor="middle"
        className="font-mono text-[10px] font-semibold fill-[#039855]"
      >
        Load {chillerLoadPct ?? "—"}% · {plant.avgCoolingKw != null ? `${plant.avgCoolingKw.toFixed(0)} kW` : "—"}{" "}
        · COP 5.8
      </text>

      <text
        x={930}
        y={142}
        textAnchor="middle"
        className="font-condensed text-[11px] font-bold"
      >
        PRIMARY PUMPS
      </text>
      <circle
        cx={905}
        cy={180}
        r={22}
        fill={pumpRun ? "#D1FADF" : "#F1F5F9"}
        stroke={pumpRun ? OK : MUTED}
        strokeWidth={2}
      />
      <g
        transform="translate(905 180)"
        className={pumpRun ? "crac-spin" : ""}
        style={
          { "--crac-spin-dur": pumpRun ? "1.1s" : "0s" } as CSSProperties
        }
      >
        <path
          d="M -12 0 L 12 0 M 0 -12 L 0 12"
          stroke={pumpRun ? OK : MUTED}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
      </g>
      <text
        x={905}
        y={215}
        textAnchor="middle"
        className="font-mono text-[10px] font-bold fill-[#039855]"
      >
        PMP-A1
      </text>
      <text
        x={905}
        y={227}
        textAnchor="middle"
        className="font-mono text-[9px] fill-[#039855]"
      >
        {pumpRun ? "ON" : "—"} · {plant.avgFlowLps != null ? `${Math.round((plant.avgFlowLps / 5.5) * 100)}%` : "—"}
      </text>

      <circle cx={970} cy={180} r={22} fill="#F1F5F9" stroke={MUTED} strokeWidth={2} />
      <g transform="translate(970 180)">
        <path
          d="M -12 0 L 12 0 M 0 -12 L 0 12"
          stroke={MUTED}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
      </g>
      <text
        x={970}
        y={215}
        textAnchor="middle"
        className="font-mono text-[10px] font-bold fill-[#4A5464]"
      >
        PMP-A2
      </text>
      <text
        x={970}
        y={227}
        textAnchor="middle"
        className="font-mono text-[9px] fill-[#4A5464]"
      >
        STBY
      </text>

      <rect
        x={690}
        y={240}
        width={140}
        height={80}
        rx={6}
        fill="#F0F9FF"
        stroke="#0284C7"
        strokeWidth={1.5}
      />
      <text
        x={760}
        y={258}
        textAnchor="middle"
        className="fill-[#0369A1] font-condensed text-xs font-bold"
      >
        COOLING TOWER
      </text>
      <circle cx={760} cy={285} r={16} fill="none" stroke="#0284C7" strokeWidth={1.5} />
      <g
        transform="translate(760 285)"
        className="crac-spin"
        style={
          {
            "--crac-spin-dur": ctSpinDur,
          } as CSSProperties
        }
      >
        <path
          d="M -12 0 L 12 0 M 0 -12 L 0 12"
          stroke="#0284C7"
          strokeWidth={2}
          strokeLinecap="round"
        />
      </g>
      <text
        x={760}
        y={313}
        textAnchor="middle"
        className="font-mono text-[9px] fill-[#0369A1]"
      >
        CT-01 · {cToF(plant.avgChwRetC != null ? plant.avgChwRetC + 18 : null).replace("°F", "F")}{" "}
        inlet
      </text>

      <text x={560} y={345} className="font-condensed text-xs font-bold">
        ZONES SERVED
      </text>
      <ZoneTile code="CH-CRAC-101" zoneLabel="DH101-A" x={560} onSelectAsset={onSelectAsset} />
      <ZoneTile code="CH-CRAC-102" zoneLabel="DH101-B" x={675} onSelectAsset={onSelectAsset} />
      <ZoneTile code="CH-CRAC-103" zoneLabel="DH101-C" x={790} onSelectAsset={onSelectAsset} />
      <ZoneTile code="CH-CRAC-104" zoneLabel="DH101-D" x={905} onSelectAsset={onSelectAsset} />
    </svg>
  );
}
