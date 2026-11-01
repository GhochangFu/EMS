import { Link } from "react-router-dom";

/**
 * `F4.297` — the entry link to `/asset-history/:assetId`, used by the Assets
 * panel, the Control Room asset row and card, and the alarm details panel.
 * The access check is the API's 403 on the page's reads, not this link.
 */
export function AssetHistoryLink({ assetId, code }: { assetId: string; code: string }) {
  return (
    <Link
      to={`/asset-history/${assetId}`}
      aria-label={`History of ${code}`}
      className="text-xs font-semibold text-accent-strong hover:underline"
    >
      History
    </Link>
  );
}
