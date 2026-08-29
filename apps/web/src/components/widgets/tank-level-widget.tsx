import { WIDGET_TONE_COLOR, type TankLevelConfig, type WidgetStatus } from "../../lib/widget-catalog";
import {
  TANK_FILL_MAX_HEIGHT,
  TANK_FILL_WIDTH,
  TANK_VIEW_H,
  TANK_VIEW_W,
  TANK_WALL,
  tankFillGeometry,
  tankFillPercent,
} from "../../lib/widget-value";
import { WidgetFrame } from "./widget-frame";

type TankLevelWidgetProps = {
  title: string;
  status: WidgetStatus;
  primary: number | null;
  stale?: boolean;
  config: TankLevelConfig;
};

/**
 * `tank_level`'s SVG fill illustration, styled like `live-svg/` already is.
 *
 * **Deliberately does NOT import `LiveSvgComponent`.** That wrapper binds to
 * `SchematicTelemetryProvider` and pulls its reading from page context; this
 * component is presentational and receives `primary` as a prop, per this
 * row's scope ("no API call, hook, or `apps/web/src/api/` file" — see
 * `docs/BACKLOG.md` F3.1c). Borrowed the visual language, not the wiring.
 *
 * The fill rect's `y`/`height` and the percentage label are computed by
 * `tankFillGeometry` in `lib/widget-value.ts`, not here — a sign error in
 * that arithmetic would otherwise draw a full tank empty with no console
 * error and no test to catch it (`F3.1c` `Q1`). This component only reads
 * the vessel's own coordinate system, also owned there so the two files
 * cannot drift out of agreement.
 */
export function TankLevelWidget({ title, status, primary, stale, config }: TankLevelWidgetProps) {
  const pct = tankFillPercent(primary, config.fullScale);
  const tone = config.fillTone ?? "ok";
  const color = WIDGET_TONE_COLOR[tone];
  const { y, height, label, readout } = tankFillGeometry(pct, config.decimals);

  return (
    <WidgetFrame title={title} status={status} stale={stale}>
      <svg
        role="img"
        aria-label={`${title}: ${label}`}
        viewBox={`0 0 ${TANK_VIEW_W} ${TANK_VIEW_H}`}
        className="mx-auto h-full max-h-[220px] w-auto"
      >
        <rect
          x={TANK_WALL - 2}
          y={TANK_WALL}
          width={TANK_FILL_WIDTH + 4}
          height={TANK_FILL_MAX_HEIGHT}
          fill="none"
          stroke="#8A94A6"
          strokeWidth={2}
          rx={4}
        />
        <rect x={TANK_WALL} y={y} width={TANK_FILL_WIDTH} height={height} fill={color} />
        <text
          x={TANK_VIEW_W / 2}
          y={TANK_VIEW_H / 2}
          textAnchor="middle"
          className="fill-bms-ink font-mono text-[14px] font-semibold"
        >
          {readout}
        </text>
      </svg>
    </WidgetFrame>
  );
}
