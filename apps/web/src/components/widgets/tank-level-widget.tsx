import { WIDGET_TONE_COLOR, type TankLevelConfig, type WidgetStatus } from "../../lib/widget-catalog";
import { tankFillPercent } from "../../lib/widget-value";
import { WidgetFrame } from "./widget-frame";

type TankLevelWidgetProps = {
  title: string;
  status: WidgetStatus;
  primary: number | null;
  config: TankLevelConfig;
};

const VIEW_W = 100;
const VIEW_H = 140;
const WALL = 10;
const FLOOR_Y = VIEW_H - WALL;
const FILL_HEIGHT = FLOOR_Y - WALL;
const FILL_WIDTH = VIEW_W - WALL * 2 - 4;

/**
 * `tank_level`'s SVG fill illustration, styled like `live-svg/` already is.
 *
 * **Deliberately does NOT import `LiveSvgComponent`.** That wrapper binds to
 * `SchematicTelemetryProvider` and pulls its reading from page context; this
 * component is presentational and receives `primary` as a prop, per this
 * row's scope ("no API call, hook, or `apps/web/src/api/` file" — see
 * `docs/BACKLOG.md` F3.1c). Borrowed the visual language, not the wiring.
 */
export function TankLevelWidget({ title, status, primary, config }: TankLevelWidgetProps) {
  const pct = tankFillPercent(primary, config.fullScale);
  const tone = config.fillTone ?? "ok";
  const color = WIDGET_TONE_COLOR[tone];
  const displayPct = pct ?? 0;
  const label = pct === null ? "No data bound" : `${Math.round(pct)}%`;
  const fillHeight = (displayPct / 100) * FILL_HEIGHT;

  return (
    <WidgetFrame title={title} status={status}>
      <svg
        role="img"
        aria-label={`${title}: ${label}`}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="mx-auto h-full max-h-[220px] w-auto"
      >
        <rect
          x={WALL - 2}
          y={WALL}
          width={FILL_WIDTH + 4}
          height={FILL_HEIGHT}
          fill="none"
          stroke="#8A94A6"
          strokeWidth={2}
          rx={4}
        />
        <rect x={WALL} y={FLOOR_Y - fillHeight} width={FILL_WIDTH} height={fillHeight} fill={color} />
        <text
          x={VIEW_W / 2}
          y={VIEW_H / 2}
          textAnchor="middle"
          className="font-mono text-[14px] font-semibold"
          fill="#1A2233"
        >
          {label}
        </text>
      </svg>
    </WidgetFrame>
  );
}
