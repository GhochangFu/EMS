import { useChartTheme } from "../../lib/chart-theme";
import type { RoleName } from "../../lib/theme";
import { sparklinePolylines, type SparklineBucket } from "../../lib/trend-strip";

/**
 * `F4.301` U4 (ADR 0108 Amendment 2) — one asset's series as an inline SVG: no axis, no
 * ECharts instance per cell. A `null` bucket breaks the line (`sparklinePolylines`).
 *
 * `F4.306` U9 (ADR 0108 Amendment 7): `stroke` is the line's colour role, `accent` unless the
 * strip's `colors` names one (`strokeRoleFor`).
 */
export function Sparkline({
  buckets,
  width = 120,
  height = 36,
  label,
  stroke = "accent",
}: {
  buckets: readonly SparklineBucket[];
  width?: number;
  height?: number;
  label: string;
  stroke?: RoleName;
}) {
  const { roles } = useChartTheme();
  const lines = sparklinePolylines(buckets, width, height);
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
      {lines.map((points, i) => (
        <polyline
          key={i}
          points={points}
          fill="none"
          stroke={roles[stroke]}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
