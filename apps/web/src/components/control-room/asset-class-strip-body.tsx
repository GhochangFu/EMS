import type { AssetRoleSummaryItem } from "@bms/shared";

type PillTone = NonNullable<AssetRoleSummaryItem["worstSeverity"]>["tone"];

/** The `StatusPill` palette, without its uppercase: the label prints verbatim (OQ6). */
const TONE_CLASSES: Record<PillTone, string> = {
  critical: "border-critical-line bg-critical-wash text-critical-ink-strong",
  warning: "border-warning-line bg-warning-wash text-warning-ink",
  info: "border-info-line bg-info-wash text-info-ink",
  offline: "border-line bg-well text-neutral-ink",
  ok: "border-accent/20 bg-accent/10 text-accent-strong",
};

/**
 * One item's text: "`{label} {count}` · `{worstCount} {worstSeverity.label}`",
 * then " · `{n}` Offline" when any are offline; "All Good" in place of the
 * severity part when none is active. `label` is `asset_roles.label` verbatim —
 * no plural logic (OQ6).
 *
 * One string, not JSX fragments, so the separators cannot drift apart.
 */
export function assetClassText(item: AssetRoleSummaryItem): string {
  const head = `${item.label} ${item.count}`;
  const worst = item.worstSeverity
    ? `${item.worstCount} ${item.worstSeverity.label}`
    : "All Good";
  const offline = item.offlineCount > 0 ? ` · ${item.offlineCount} Offline` : "";
  return `${head} · ${worst}${offline}`;
}

function StripNote({ text }: { text: string }) {
  return (
    <div className="surface-pressed px-3 py-2 text-sm text-ink-muted">
      {text}
    </div>
  );
}

export type AssetClassStripBodyProps = {
  /** `pending` — no answer yet; `error` — a failed answer; `ready` — `items` is the answer. */
  status: "pending" | "error" | "ready";
  items: readonly AssetRoleSummaryItem[];
  /** Set when there is nothing to ask about; replaces the strip. */
  noIdsNote: string | null;
};

/**
 * The strip's drawing with no read in it (`F3.73` plan Task 3.5): one pill per asset role, coloured
 * by the worst active severity's tone (`ok` when none). `AssetClassStrip` (`/cr-overview`) and the
 * `asset_class_strip` site widget both feed it. Gates on `pending` — no answer yet — so a paused
 * read never falls through to "No asset classes in scope".
 */
export function AssetClassStripBody({ status, items, noIdsNote }: AssetClassStripBodyProps) {
  if (noIdsNote) {
    return <StripNote text={noIdsNote} />;
  }
  if (status === "pending") {
    return <StripNote text="Loading asset classes…" />;
  }
  if (status === "error") {
    return <StripNote text="Asset classes unavailable." />;
  }
  if (items.length === 0) {
    return <StripNote text="No asset classes in scope" />;
  }
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Asset class counts">
      {items.map((item) => (
        <li
          key={item.code}
          className={`surface-pill rounded border px-3 py-1.5 text-xs font-semibold ${TONE_CLASSES[item.worstSeverity?.tone ?? "ok"]}`}
        >
          {assetClassText(item)}
        </li>
      ))}
    </ul>
  );
}
