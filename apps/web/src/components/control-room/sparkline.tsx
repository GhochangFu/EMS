import { useChartTheme } from "../../lib/chart-theme";
import { sparklinePolylines, type SparklineBucket } from "../../lib/trend-strip";

/**
 * `F4.301` U4 (ADR 0108 Amendment 2) — one asset's series as an inline SVG: no axis, no
 * ECharts instance per cell. A `null` bucket breaks the line (`sparklinePolylines`).
 */
export function Sparkline({
  buckets,
  width = 120,
  height = 36,
  label,
}: {
  buckets: readonly SparklineBucket[];
  width?: number;
  height?: number;
  label: string;
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
          stroke={roles.accent}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
