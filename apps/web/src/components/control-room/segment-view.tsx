import { useSearchParams } from "react-router-dom";

import { SEGMENT_VIEW_SERIES_MAX, type SiteSegmentViewsDto } from "@bms/shared";

import { levelLabel } from "../../lib/energy-view-filter";
import { segmentSchedulePrefill } from "../../lib/schedule-from-view";
import { trendsLinkFromSearch } from "../../lib/view-links";
import { useAuthStore } from "../../stores/auth-store";
import { SectionCard } from "../section-card";
import { PinButton, segmentPinSource } from "../view-actions/pin-dialog";
import { ScheduleButton } from "../view-actions/schedule-button";
import { SegmentAbnormalList } from "./segment-abnormal-list";
import { SegmentRankingTable } from "./segment-ranking-table";
import { SegmentTrendChart } from "./segment-trend-chart";

type Props = {
  data: SiteSegmentViewsDto;
  /** A point chosen in the selector; the caller writes it to the search. */
  onPoint: (code: string) => void;
};

/**
 * `F4.302` U4 (ADR 0108 Amendment 4 items 2, 4, 5, 8) — one segment sub-tab, drawn from one
 * segment-views answer: the point selector (one point at a time), the rollup line, the chart of
 * the top assets, the ranking and the advisory abnormal list. Every label comes from the
 * response; a segment whose effective list holds no point says where to add one.
 */
export function SegmentView({ data, onPoint }: Props) {
  // `F4.303` U15 (ADR 0108 Amendment 6 item 4): Pin reads the section's range key from the URL
  // (a preset pins its own length) and the signed-in role from the store.
  const [searchParams] = useSearchParams();
  const value = trendsLinkFromSearch(searchParams).value;
  const range = value.range;
  const user = useAuthStore((state) => state.user);
  const role = user?.role;
  const point = data.point;
  if (point === null || data.points.length === 0) {
    return (
      <p role="status" className="text-sm text-ink-muted">
        No trend point is listed for this segment. Add one in Reference Data → Trend Points.
      </p>
    );
  }
  const compare = data.compare !== null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="grid gap-1 text-xs text-ink-muted">
          Trend point
          <select
            className="surface-field px-2 py-1.5 text-sm"
            value={point.code}
            onChange={(event) => onPoint(event.target.value)}
          >
            {data.points.map((option) => (
              <option key={option.code} value={option.code}>
                {option.unit === null ? option.name : `${option.name} (${option.unit})`}
              </option>
            ))}
          </select>
        </label>
        <span className="inline-flex flex-wrap items-start gap-3">
          <span className="text-xs text-ink-muted">{levelLabel(data.level, data.bucket, data.timeZone)}</span>
          <PinButton role={role} source={segmentPinSource(data, range)} />
          {/* `F4.303` U16 (Amendment 6 item 6): schedules `trend_points` for the drawn series at this site. */}
          <ScheduleButton user={user} prefill={segmentSchedulePrefill(data.locationId, data, value.compare === "previous")} />
        </span>
      </div>

      <SectionCard
        title={`${point.name} · top assets`}
        subtitle={compare ? "The previous period dashed in each asset's colour" : undefined}
      >
        <SegmentTrendChart
          ranking={data.ranking}
          current={data.current}
          compare={data.compare}
          unit={point.unit}
          pointCode={point.code}
        />
        {data.trimmed ? (
          <p className="mt-2 text-[11px] text-ink-muted">
            {`The chart draws the top ${SEGMENT_VIEW_SERIES_MAX} assets by mean.`}
          </p>
        ) : null}
      </SectionCard>

      <SectionCard title={`${point.name} · assets ranked`} subtitle="Weighted mean and max over the period">
        <SegmentRankingTable
          ranking={data.ranking}
          moreAssets={data.moreAssets}
          pointCode={point.code}
          period={data.current}
          compare={compare}
          timeZone={data.timeZone}
        />
      </SectionCard>

      <SectionCard
        title={`${point.name} · abnormal · advisory`}
        subtitle="Assets far above or below their own recent baseline; never an alarm"
      >
        <SegmentAbnormalList abnormal={data.abnormal} pointCode={point.code} period={data.current} compare={compare} />
      </SectionCard>
    </div>
  );
}
