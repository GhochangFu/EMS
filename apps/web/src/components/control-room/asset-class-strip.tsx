import type { AssetRoleSummaryItem } from "@bms/shared";

import { useAssetRoleSummary } from "../../hooks/use-asset-role-summary";
import type { AssetsStatus } from "./active-alarms-rail";

type PillTone = NonNullable<AssetRoleSummaryItem["worstSeverity"]>["tone"];

/** The `StatusPill` palette, without its uppercase: the label prints verbatim (OQ6). */
const TONE_CLASSES: Record<PillTone, string> = {
  critical: "border-red-200 bg-red-50 text-red-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-sky-200 bg-sky-50 text-sky-800",
  offline: "border-gray-200 bg-gray-50 text-gray-700",
  ok: "border-bms-green/20 bg-bms-green/10 text-bms-green",
};

/** What the strip says when it has no ids, by why it has none. */
const NO_IDS_NOTE: Record<AssetsStatus, string> = {
  pending: "Loading asset classes…",
  error: "Asset classes unavailable.",
  success: "No asset classes in scope",
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
    <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-bms-muted">
      {text}
    </div>
  );
}

/**
 * The `/cr-overview` asset class strip (`F3.28`, ADR 0074, plan task 3.3): one
 * item per asset role in the page's scope, coloured by the worst active
 * severity's tone (`ok` when none).
 *
 * Gates on `isPending` — no answer yet — not `isLoading`: a paused read
 * (offline) is pending but not fetching, and must not fall through to
 * "No asset classes in scope". A failed read says so, for the same reason.
 */
export function AssetClassStrip({
  assetIds,
  assetsStatus = "success",
}: {
  assetIds: readonly string[];
  /**
   * The state of the page's asset read, which resolves `assetIds`. With no ids
   * the read is disabled and answers nothing, so this says why there are none.
   */
  assetsStatus?: AssetsStatus;
}) {
  const summary = useAssetRoleSummary(assetIds);
  const noIdsNote = assetIds.length > 0 ? null : NO_IDS_NOTE[assetsStatus];

  let body;
  if (noIdsNote) {
    body = <StripNote text={noIdsNote} />;
  } else if (summary.isPending) {
    body = <StripNote text="Loading asset classes…" />;
  } else if (summary.isError) {
    body = <StripNote text="Asset classes unavailable." />;
  } else if (summary.data.items.length === 0) {
    body = <StripNote text="No asset classes in scope" />;
  } else {
    body = (
      <ul className="flex flex-wrap gap-2" aria-label="Asset class counts">
        {summary.data.items.map((item) => (
          <li
            key={item.code}
            className={`rounded border px-3 py-1.5 text-xs font-semibold ${TONE_CLASSES[item.worstSeverity?.tone ?? "ok"]}`}
          >
            {assetClassText(item)}
          </li>
        ))}
      </ul>
    );
  }

  return <section aria-label="Asset classes">{body}</section>;
}
