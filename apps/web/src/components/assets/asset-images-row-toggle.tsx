import { AssetImageGallery } from "./asset-image-gallery";

/**
 * `F3.4` Unit 9 — the reader's "Images" affordance on a table of assets (owner
 * ruling Q-1, option A).
 *
 * ## Why this is a pair and not one component
 *
 * The gallery opens in a full-width row **below** the asset's row, and a `<tr>`
 * cannot contain a sibling `<tr>` from inside one of its cells. So the button
 * and the row are two exports: `AssetImagesToggleButton` goes in the asset
 * row's first cell, `AssetImagesRow` is rendered by the page immediately after
 * that `<tr>`, and the page holds the open id between them.
 *
 * The alternative the plan offered — one component returning a `Fragment` of
 * both `<tr>`s — was rejected on the diff it forces: the asset `<tr>` carries
 * six cells of the page's own data (telemetry, freshness, alarms, work orders),
 * so a fragment component would have to own all of them and the page's change
 * would be its whole table body rather than three lines.
 *
 * ## Laziness is in `AssetImagesRow`, not in the caller
 *
 * `AssetImagesRow` returns `null` while closed, and the page renders it
 * **unconditionally**. That is deliberate: Q-1 requires that a page of 50
 * assets issues no image request until a reader asks for one, and the only
 * thing that makes it true is that `AssetImageGallery` — and with it
 * `useAssetImages` — never mounts while the row is closed. A caller-side
 * `{open ? <AssetImagesRow …/> : null}` would render the same pixels while
 * making the guard below dead code that no mutation of this file can reach.
 *
 * ## No `onDelete`
 *
 * The gallery takes an optional `onDelete` and renders a Delete action only
 * when it is given (U7). This surface passes none, so a reader gets no write
 * affordance. **The absence of the button is a presentation choice, not the
 * permission gate** — `DELETE /api/v1/assets/:assetId/images/:imageId` is
 * behind `canManageAsset` and answers 403 to a reader whatever this renders.
 */

export type AssetImagesToggleButtonProps = {
  assetId: string;
  /** Whether this asset's gallery row is the open one. */
  open: boolean;
  /** Called with the asset id; the parent decides whether that opens or closes. */
  onToggle: (assetId: string) => void;
};

/**
 * The text action that sits in the asset cell.
 *
 * The accessible name stays "Images" in both states — `aria-expanded` carries
 * the state instead. A label that flipped to "Hide images" would make every
 * `getByRole("button", { name: "Images" })` query state-dependent, including
 * the page's own row.
 */
export function AssetImagesToggleButton({
  assetId,
  open,
  onToggle,
}: AssetImagesToggleButtonProps): JSX.Element {
  return (
    <button
      type="button"
      aria-expanded={open}
      className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-bms-muted hover:text-bms-ink"
      onClick={() => onToggle(assetId)}
    >
      Images
    </button>
  );
}

export type AssetImagesRowProps = {
  assetId: string;
  /** The number of columns in the table this row joins. */
  colSpan: number;
  open: boolean;
};

/** The full-width row that holds one asset's read-only gallery. */
export function AssetImagesRow({ assetId, colSpan, open }: AssetImagesRowProps): JSX.Element | null {
  if (!open) {
    return null;
  }

  return (
    <tr className="border-t border-gray-100 bg-gray-50/60">
      <td className="px-3 py-3" colSpan={colSpan}>
        <AssetImageGallery assetId={assetId} />
      </td>
    </tr>
  );
}
