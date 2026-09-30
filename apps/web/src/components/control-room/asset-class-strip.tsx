import { useAssetRoleSummary } from "../../hooks/use-asset-role-summary";
import type { AssetsStatus } from "./active-alarms-rail";
import { AssetClassStripBody } from "./asset-class-strip-body";

export { assetClassText } from "./asset-class-strip-body";

/** What the strip says when it has no ids, by why it has none. */
const NO_IDS_NOTE: Record<AssetsStatus, string> = {
  pending: "Loading asset classes…",
  error: "Asset classes unavailable.",
  success: "No asset classes in scope",
};

/**
 * The `/cr-overview` asset class strip (`F3.28`, ADR 0074, plan task 3.3): one
 * item per asset role in the page's scope, coloured by the worst active
 * severity's tone (`ok` when none).
 *
 * Owns the read; `AssetClassStripBody` owns the drawing (`F3.73`, so the
 * `asset_class_strip` site widget draws the same strip from its own read).
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

  return (
    <section aria-label="Asset classes">
      <AssetClassStripBody
        status={summary.isPending ? "pending" : summary.isError ? "error" : "ready"}
        items={summary.data?.items ?? []}
        noIdsNote={noIdsNote}
      />
    </section>
  );
}
