/**
 * `F4.262` — the key to the Sites map's pin colours. Each swatch is the fill role
 * `world-map.tsx`'s `markerRole` gives that status: `healthy` → accent, `warning`, `critical`,
 * `offline` → ink-faint, a reference station's `nominal` → accent-strong. Keep the two in step.
 */
const ENTRIES: ReadonlyArray<{ label: string; swatch: string }> = [
  { label: "Live", swatch: "bg-accent" },
  { label: "Warning alarm", swatch: "bg-warning" },
  { label: "Critical alarm", swatch: "bg-critical" },
  { label: "Not live", swatch: "bg-ink-faint" },
  { label: "Reference station", swatch: "bg-accent-strong" },
];

export function MapPinLegend() {
  return (
    <ul
      data-testid="map-pin-legend"
      aria-label="Map pin colours"
      className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted"
    >
      {ENTRIES.map((entry) => (
        <li key={entry.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={`inline-flex h-2.5 w-2.5 rounded-full ${entry.swatch}`} />
          {entry.label}
        </li>
      ))}
    </ul>
  );
}
