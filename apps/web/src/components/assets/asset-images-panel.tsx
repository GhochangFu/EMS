import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  MAX_ASSET_IMAGES_PER_ASSET,
  MAX_ASSET_IMAGE_CAPTION_CHARS,
} from "@bms/shared";
import type { AdminAssetDto, AssetImageDto } from "@bms/shared";

import { deleteAssetImage, uploadAssetImage } from "../../api/asset-images";
import { useAssetImages } from "../../hooks/use-asset-images";
import { ApiError } from "../../lib/api-error";
import { apiErrorMessage } from "../../lib/api-error-message";
import {
  ASSET_IMAGE_ACCEPT,
  assetImageCapReason,
  describeAssetImageUploadError,
  uploadBlockedReason,
} from "../../lib/asset-images-view";
import { StatusPill } from "../status-pill";
import { AssetImageGallery } from "./asset-image-gallery";

/**
 * `F3.4` Unit 8 — the admin "Images" panel for one asset (ADR 0066 decision 7,
 * owner rulings Q-0 and Q-2).
 *
 * ## Shape
 *
 * A right-docked `<aside>`, ruled in Q-2 over the page's centred modal. The
 * classes come from the `onboarding-chat-page.tsx:377` precedent with **one
 * deliberate change: `fixed`, not `absolute`.** That aside is `absolute`
 * because it sits inside a positioned chat container; the assets page has no
 * positioned ancestor, so `absolute` would dock this panel to whatever the
 * nearest one happened to be. The page's own overlay uses `fixed inset-0` for
 * the same reason.
 *
 * ## What it decides, and what it does not
 *
 * Every sentence and every enabled/disabled rule comes from
 * `lib/asset-images-view.ts`, which is inside the web coverage `include`
 * (`src/lib/**`) and asserted without a DOM. This file is wiring.
 *
 * There is **no client-side role predicate.** The list this panel is opened
 * from is already scoped to the caller's writable locations, so every row on
 * screen passes `canManageAsset`; a predicate here would invent a permission
 * rule the API does not mirror (the `mapping-sheet-panel` reasoning). A 403
 * from either route renders as its own sentence.
 *
 * Delete has **no confirm dialog** — the Deactivate action on the same page
 * sets that precedent (R-7), and the image is one of up to twenty, not the
 * asset.
 */

export type AssetImagesPanelProps = {
  /** The asset whose images these are; only its identity and its labels are read. */
  asset: Pick<AdminAssetDto, "id" | "code" | "name">;
  onClose: () => void;
};

/**
 * The sentence for a failed write.
 *
 * `adminFetch` throws `ApiError`, which carries the status R-7 branches on. A
 * network failure is an ordinary `Error` with no status; `0` sends it down the
 * generic arm, which is the right sentence for it.
 */
function uploadFailureSentence(cause: unknown): string {
  const status = cause instanceof ApiError ? cause.status : 0;
  const body = cause instanceof Error ? cause.message : String(cause ?? "");
  return describeAssetImageUploadError(status, body);
}

export function AssetImagesPanel({ asset, onClose }: AssetImagesPanelProps): JSX.Element {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // The same query key the gallery below subscribes to, so the count and the
  // grid are one cache entry and one request — not two views that can disagree.
  const imagesQ = useAssetImages(asset.id);
  const imageCount = imagesQ.data?.length ?? 0;

  // The cap is asked first and on its own: it is true whether or not a file has
  // been chosen, and it is what closes the file input.
  const capReason = assetImageCapReason(imageCount);
  const blockedReason = capReason ?? uploadBlockedReason({ file, imageCount });

  async function refreshImages(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ["asset-images", asset.id] });
  }

  const uploadMutation = useMutation({
    mutationFn: async () => {
      // Unreachable through the button, which is disabled without a file. The
      // throw is here so a future caller cannot make this post an empty body.
      if (file === null) {
        throw new Error("Choose an image to upload.");
      }
      return uploadAssetImage(asset.id, file, caption);
    },
    onSuccess: async () => {
      setError(null);
      setFile(null);
      setCaption("");
      // The DOM input keeps the old filename after its React state is cleared —
      // an uncontrolled value only `ref.current.value = ""` resets (the
      // `mapping-sheet-panel` precedent). Without it the field names a file the
      // panel no longer holds.
      if (fileInputRef.current !== null) {
        fileInputRef.current.value = "";
      }
      await refreshImages();
    },
    onError: (cause: Error) => setError(uploadFailureSentence(cause)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (image: AssetImageDto) => deleteAssetImage(asset.id, image.id),
    onMutate: (image: AssetImageDto) => {
      setDeletingId(image.id);
    },
    onSuccess: async () => {
      setError(null);
      await refreshImages();
    },
    onError: (cause: Error) => setError(apiErrorMessage(cause)),
    // `onSettled` rather than the two arms: a failed delete that left the
    // button saying "Deleting…" for ever would look like a hung request.
    onSettled: () => setDeletingId(null),
  });

  return (
    <aside className="fixed right-0 top-0 z-50 flex h-full w-[90%] max-w-[380px] flex-col border-l border-gray-200 bg-white shadow-lg">
      <div className="flex items-start justify-between gap-2 border-b border-gray-200 px-3 py-2">
        <div>
          <h2 className="font-condensed text-base font-bold">Images · {asset.code}</h2>
          <p className="text-xs text-bms-muted">{asset.name}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill
            label={`${imageCount} / ${MAX_ASSET_IMAGES_PER_ASSET}`}
            tone={capReason !== null ? "warning" : "info"}
          />
          <button type="button" className="text-xs text-bms-muted" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <AssetImageGallery
          assetId={asset.id}
          onDelete={(image) => deleteMutation.mutate(image)}
          deletingId={deletingId}
        />

        <form
          className="space-y-2 border-t border-gray-200 pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            uploadMutation.mutate();
          }}
        >
          <label className="block text-xs font-semibold text-bms-muted">
            Image file
            <input
              ref={fileInputRef}
              type="file"
              accept={ASSET_IMAGE_ACCEPT}
              aria-label="Image file"
              className="mt-1 block w-full text-sm"
              disabled={capReason !== null}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                // A new attempt starts with a clean slate: the previous
                // refusal described the previous file.
                setError(null);
              }}
            />
          </label>
          <label className="block text-xs font-semibold text-bms-muted">
            Caption
            <input
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              aria-label="Caption"
              maxLength={MAX_ASSET_IMAGE_CAPTION_CHARS}
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="rounded bg-bms-green px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              disabled={blockedReason !== null || uploadMutation.isPending}
            >
              {uploadMutation.isPending ? "Uploading…" : "Upload"}
            </button>
            {blockedReason !== null ? (
              <span className="text-xs text-bms-muted">{blockedReason}</span>
            ) : null}
          </div>
        </form>

        {error !== null ? <p className="text-xs text-red-700">{error}</p> : null}
      </div>
    </aside>
  );
}
