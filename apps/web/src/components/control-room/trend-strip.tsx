import { useLocation } from "react-router-dom";

import { parseWallParams } from "../../lib/wall-mode";
import { TrendStripBody } from "./trend-strip-body";

/**
 * `F4.301` U4 (ADR 0108 Amendment 2, items 5–9) — the Control Room site page's trend strip: the
 * fixed mount, with its `h2`, around the strip body (`trend-strip-body.tsx`: the range switch,
 * the one read, the segments and the window line).
 *
 * `F4.303` U7: the Export group shows everywhere but on a wall screen (`?wall=1`), which has no
 * actions.
 */

/** The trend strip for one Control Room tab: the whole site (`assetGroupId: null`) or one group. */
export function TrendStrip({ locationId, assetGroupId }: { locationId: string; assetGroupId: string | null }) {
  const wall = parseWallParams(useLocation().search).on;
  return (
    <TrendStripBody
      locationId={locationId}
      assetGroupId={assetGroupId}
      defaultRange="24h"
      exportable={!wall}
      heading={<h2 className="font-condensed text-sm font-bold text-ink">Trends</h2>}
    />
  );
}
