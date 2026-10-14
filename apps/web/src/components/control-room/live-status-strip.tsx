type LiveStatusStripProps = {
  liveCount: number;
  notLiveCount: number;
};

/**
 * `F4.259` — live and not-live site counts, large: under the organization page's header, and
 * since `F4.262` above the Sites map. The not-live percent is the remainder of the live one, so
 * the two always add up to 100. A site is live on the `F4.260` rule (ADR 0075 Amendment 2).
 * Moved here from `organization-page.tsx` by `F4.261` so both pages draw the same strip.
 */
export function LiveStatusStrip({ liveCount, notLiveCount }: LiveStatusStripProps) {
  const total = liveCount + notLiveCount;
  const livePercent = total > 0 ? Math.round((liveCount / total) * 100) : 0;

  return (
    <div data-testid="live-status-strip" className="grid gap-3 sm:grid-cols-2">
      <StatusTile
        live
        label="Live sites"
        count={liveCount}
        countTestId="live-site-count"
        detail={`of ${total} · ${livePercent}% reporting fresh telemetry`}
      />
      <StatusTile
        live={false}
        label="Not live"
        count={notLiveCount}
        countTestId="not-live-site-count"
        detail={`of ${total} · ${total > 0 ? 100 - livePercent : 0}% with no fresh telemetry`}
      />
    </div>
  );
}

type StatusTileProps = {
  live: boolean;
  label: string;
  count: number;
  countTestId: string;
  detail: string;
};

function StatusTile({ live, label, count, countTestId, detail }: StatusTileProps) {
  return (
    <div
      className={`surface-raised flex items-center gap-4 border-l-4 px-4 py-3 ${
        live ? "border-l-accent" : "border-l-warning"
      }`}
    >
      <span
        aria-hidden
        className={`inline-flex h-3 w-3 shrink-0 rounded-full ${
          live ? "bg-accent" : "border-2 border-warning"
        }`}
      />
      <span
        data-testid={countTestId}
        className={`font-condensed text-3xl font-bold ${live ? "text-ok-ink" : "text-warning-ink"}`}
      >
        {count}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold uppercase tracking-wide text-ink">{label}</span>
        <span className="block text-xs text-ink-muted">{detail}</span>
      </span>
    </div>
  );
}
