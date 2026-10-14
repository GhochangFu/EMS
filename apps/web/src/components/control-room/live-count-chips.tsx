type LiveCountChipsProps = {
  live: number;
  notLive: number;
};

/**
 * `F4.261` — an organization's live and not-live site counts as two chips (green, amber) and a
 * bar of the live share, for the estate's organization cards and its location accordion. The
 * same colours and dots as the Control Room's status strip and card badges (`F4.259`); amber,
 * not red, because red is for alarms. The dots are decoration; the words carry the state.
 */
export function LiveCountChips({ live, notLive }: LiveCountChipsProps) {
  const total = live + notLive;
  const share = total > 0 ? Math.round((live / total) * 100) : 0;

  return (
    <span className="block min-w-0">
      <span className="flex flex-wrap items-center gap-2">
        <span
          data-testid="live-chip"
          className="inline-flex items-center gap-1.5 rounded-full bg-ok-wash px-2.5 py-1 text-xs font-bold text-ok-ink"
        >
          <span aria-hidden className="inline-flex h-2 w-2 rounded-full bg-accent" />
          {`${live} live`}
        </span>
        <span
          data-testid="not-live-chip"
          className="inline-flex items-center gap-1.5 rounded-full bg-warning-wash px-2.5 py-1 text-xs font-bold text-warning-ink"
        >
          <span aria-hidden className="inline-flex h-2 w-2 rounded-full border-2 border-warning" />
          {`${notLive} not live`}
        </span>
      </span>
      <span aria-hidden className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-warning/30">
        <span data-testid="live-share-bar" className="block h-full rounded-full bg-accent" style={{ width: `${share}%` }} />
      </span>
    </span>
  );
}
