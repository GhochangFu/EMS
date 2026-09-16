import type { AssetImageDto } from "@bms/shared";

import { useAssetImageObjectUrl, useAssetImages } from "../../hooks/use-asset-images";
import { ApiError } from "../../lib/api-error";
import { describeGalleryError } from "../../lib/asset-images-view";

/**
 * `F3.4` Unit 7 — the read-only asset image gallery (ADR 0066 decision 4,
 * owner ruling Q-0).
 *
 * One component serves both surfaces: the admin panel (U8) passes `onDelete`
 * and gets a Delete affordance under every thumbnail; the reader's row toggle
 * (U9) passes nothing and gets the same grid with no way to write. **The
 * absence of the button is a presentation choice, not the permission gate** —
 * the API refuses a delete from a reader with a 403 whatever this renders.
 *
 * The four states are R-7's, in the order the plan lists them: loading, error,
 * empty, then the grid.
 */

export type AssetImageGalleryProps = {
  assetId: string;
  /** When given, each thumbnail gains a Delete action that calls this with its DTO. */
  onDelete?: (image: AssetImageDto) => void;
  /**
   * Every image whose delete is in flight — more than one can be, so this is
   * a list and not a single id (post-merge sweep C2).
   */
  deletingIds?: readonly string[];
};

/**
 * The image's size as the caption line renders it.
 *
 * **Why this lives here and not in `lib/asset-images-view.ts`**, where §1 of
 * the plan puts pure view logic so the coverage `include` (`src/lib/**`) can
 * see it: that file is Unit 1's, already committed, and this unit's file set
 * does not include it. Editing it here would put two units in one file for a
 * one-line formatter. Flagged to the caller rather than worked around; if a
 * second surface needs the same string, moving it is a one-line change.
 */
function kilobytes(byteSize: number): string {
  return `${(byteSize / 1024).toFixed(1)} KB`;
}

/**
 * One thumbnail.
 *
 * The `<img>` cannot point at the content route directly — `JwtAuthGuard`
 * reads `headers.authorization` only and a browser sends none on an `<img>`
 * request, so the element would render a 401. The bytes come through the
 * authenticated fetch in `useAssetImageObjectUrl` instead, and the muted box
 * covers the two states where there is no URL to show.
 */
function AssetImageThumbnail({ image }: { image: AssetImageDto }): JSX.Element {
  const { url, status } = useAssetImageObjectUrl(image.assetId, image.id);

  if (status === "ready" && url !== null) {
    return (
      <img
        src={url}
        alt={image.caption ?? image.originalFilename}
        className="h-24 w-24 rounded border object-cover"
      />
    );
  }

  return (
    <div className="flex h-24 w-24 items-center justify-center rounded border bg-gray-50 text-[10px] text-bms-muted">
      {status === "loading" ? "Loading…" : "Image unavailable"}
    </div>
  );
}

/** One grid cell: the thumbnail, its label, its size and — when writable — Delete. */
function AssetImageCell({
  image,
  onDelete,
  deletingIds,
}: {
  image: AssetImageDto;
  onDelete?: (image: AssetImageDto) => void;
  deletingIds: readonly string[];
}): JSX.Element {
  const deleting = deletingIds.includes(image.id);

  return (
    <li className="flex w-24 flex-col gap-1">
      <AssetImageThumbnail image={image} />
      <span className="truncate text-[11px] text-bms-muted" title={image.caption ?? image.originalFilename}>
        {image.caption ?? image.originalFilename}
      </span>
      <span className="text-[11px] text-bms-muted">{kilobytes(image.byteSize)}</span>
      {onDelete ? (
        <button
          type="button"
          className="text-left text-xs font-semibold text-bms-muted"
          disabled={deleting}
          onClick={() => onDelete(image)}
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      ) : null}
    </li>
  );
}

export function AssetImageGallery({
  assetId,
  onDelete,
  deletingIds = [],
}: AssetImageGalleryProps): JSX.Element {
  const query = useAssetImages(assetId);

  if (query.isPending) {
    return <p className="text-xs text-bms-muted">Loading images...</p>;
  }

  if (query.isError) {
    // `ApiError` is what `adminFetch` throws and it carries the status R-7
    // branches on. A network failure is an ordinary `Error` with no status;
    // `0` sends it down the generic arm, which is the right sentence for it.
    const status = query.error instanceof ApiError ? query.error.status : 0;
    const body = query.error instanceof Error ? query.error.message : "";
    return <p className="text-xs text-bms-muted">{describeGalleryError(status, body)}</p>;
  }

  if (query.data.length === 0) {
    return <p className="text-xs text-bms-muted">No images for this asset yet.</p>;
  }

  return (
    <ul className="flex flex-wrap gap-3">
      {query.data.map((image) => (
        <AssetImageCell key={image.id} image={image} onDelete={onDelete} deletingIds={deletingIds} />
      ))}
    </ul>
  );
}
