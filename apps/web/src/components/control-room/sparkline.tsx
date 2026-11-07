import { useChartTheme } from "../../lib/chart-theme";
import type { TrendStripPointStyle } from "@bms/shared";

import { withAlpha, type RoleName } from "../../lib/theme";
import {
  DEFAULT_POINT_STYLE,
  SPARKLINE_LAYERS,
  sparklineAreas,
  sparklineBars,
  sparklinePolylines,
  type SparklineBucket,
} from "../../lib/trend-strip";

/**
 * `F4.301` U4 (ADR 0108 Amendment 2) — one asset's series as an inline SVG: no axis, no
 * ECharts instance per cell. A `null` bucket breaks the line (`sparklinePolylines`).
 *
 * `F4.306` U9 (ADR 0108 Amendment 7): `stroke` is the line's colour role, `accent` unless the
 * strip's `colors` names one (`strokeRoleFor`).
 *
 * `F4.322` PR 3 (ADR 0108 Amendment 8): `drawStyle` is the point's style, `line` unless the strip's
 * `styles` names one (`pointStyleFor`). `area` fills under each run at low alpha of the same role;
 * `bar` draws one bar per bucket in the role. Still one inline SVG, no ECharts instance.
 */
export function Sparkline({
  buckets,
  width = 120,
  height = 36,
  label,
  stroke = "accent",
  drawStyle = DEFAULT_POINT_STYLE,
}: {
  buckets: readonly SparklineBucket[];
  width?: number;
  height?: number;
  label: string;
  stroke?: RoleName;
  drawStyle?: TrendStripPointStyle;
}) {
  const { roles } = useChartTheme();
  const colour = roles[stroke];
  const layers = SPARKLINE_LAYERS[drawStyle];
  const lines = layers.line ? sparklinePolylines(buckets, width, height) : [];
  const areas = layers.fill ? sparklineAreas(buckets, width, height) : [];
  const bars = layers.bars ? sparklineBars(buckets, width, height) : [];
  return (
    <svg
      role="img"
      aria-label={label}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block overflow-visible"
    >
      {areas.map((points, i) => (
        <polygon key={`area-${i}`} data-role="sparkline-area" points={points} fill={withAlpha(colour, 0.18)} stroke="none" />
      ))}
      {bars.map((bar, i) => (
        <rect key={`bar-${i}`} data-role="sparkline-bar" x={bar.x} y={bar.y} width={bar.width} height={bar.height} fill={colour} />
      ))}
      {lines.map((points, i) => (
        <polyline
          key={i}
          points={points}
          fill="none"
          stroke={colour}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
